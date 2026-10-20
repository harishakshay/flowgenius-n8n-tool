import type { WorkflowGraph } from "../graph.js";
import { NODE, isStickyNote } from "../node-types.js";
import type { Rule, RuleHit } from "../rule.js";
import type { WorkflowNode } from "../types.js";
import { decodeBase64, get, isExpression, isLiteral, isPlaceholder, namedPairs, walkStrings } from "../values.js";

const BASE = "n8n-nodes-base.";
const LANGCHAIN = "@n8n/n8n-nodes-langchain.";

/** Formats of real secrets. Each is specific enough that a match is almost never a coincidence. */
const SECRET_FORMATS: { name: string; pattern: RegExp }[] = [
  // Header plus real key material, so "[INSERT YOUR KEY HERE]" between the markers does not count.
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/=]{40,}/ },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { name: "Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // No leading \b: in URLs the token follows "bot" directly (".../bot123:AA.../sendMessage").
  { name: "Telegram bot token", pattern: /(?<!\d)\d{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/ },
  { name: "Groq API key", pattern: /\bgsk_[A-Za-z0-9]{40,}/ },
  { name: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{30,}/ },
  { name: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { name: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

const SENSITIVE_HEADERS = new Set([
  "authorization", "x-api-key", "api-key", "apikey", "api_key", "x-auth-token", "x-access-token", "x-token",
  "token", "private-token", "xi-api-key", "x-goog-api-key", "x-apikey", "access-token", "secret",
]);

const SENSITIVE_QUERY = new Set([
  "api_key", "apikey", "api-key", "key", "token", "access_token", "accesstoken", "auth", "secret", "client_secret",
  "password", "pass", "pwd",
]);

/** Shows enough of a secret to find it, never more than a sixth of it. */
export function mask(secret: string): string {
  const shown = Math.min(4, Math.floor(secret.length / 6));
  return `${secret.slice(0, shown)}…(${secret.length} chars)`;
}

function secretFormat(value: string): { name: string; match: string } | null {
  for (const { name, pattern } of SECRET_FORMATS) {
    const m = pattern.exec(value);
    if (!m || isPlaceholder(m[0])) continue;
    if (name === "JSON Web Token" && isPublicJwt(m[0])) continue;
    return { name, match: m[0] };
  }
  return null;
}

/**
 * Tokens meant to be public, such as a Supabase "anon" key (it ships in every browser app).
 * The payload is plain base64url JSON, so the role can be read without verifying the token.
 */
export function isPublicJwt(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;
  const json = decodeBase64(payload);
  if (json === null) return false;
  try {
    return (JSON.parse(json) as { role?: unknown }).role === "anon";
  } catch {
    return false;
  }
}

/** A literal credential value: fixed text, long enough, not a placeholder. */
function literalSecret(value: unknown): string | null {
  if (typeof value !== "string" || !isLiteral(value)) return null;
  const v = value.replace(/^=/, "").replace(/^(Bearer|Basic|Token)\s+/i, "").trim();
  // Real keys mix letters and digits; words like "Content-Type" do not.
  const looksRandom = /\d/.test(v) && /[A-Za-z]/.test(v);
  return v.length >= 12 && looksRandom && !/\s/.test(v) && !isPlaceholder(v) ? v : null;
}

/** Nodes worth scanning for secrets: everything except sticky notes, including disabled nodes. */
function scannable(graph: WorkflowGraph): WorkflowNode[] {
  return graph.workflow.nodes.filter((n) => !isStickyNote(n));
}

const hardcodedSecret: Rule = {
  id: "security/hardcoded-secret",
  category: "security",
  severity: "critical",
  title: "Secret written into the workflow",
  description:
    "Anyone who sees this workflow (an export, a shared template, a screenshot, version control) gets this key. Move it into an n8n credential, then rotate the key, since it has already been exposed.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = [];
    for (const node of scannable(graph)) {
      const seen = new Set<string>();
      for (const { value, path } of walkStrings(node.parameters)) {
        const found = secretFormat(value);
        if (found && !seen.has(found.match)) {
          seen.add(found.match);
          hits.push({ node: node.name, path, message: `"${node.name}" contains a ${found.name} (${mask(found.match)}).` });
        }
      }
      for (const header of namedPairs(node.parameters.headerParameters)) {
        if (!SENSITIVE_HEADERS.has(header.name.trim().toLowerCase())) continue;
        const secret = literalSecret(header.value);
        if (secret && isPublicJwt(secret)) continue;
        if (secret && !seen.has(secret) && ![...seen].some((s) => secret.includes(s))) {
          seen.add(secret);
          hits.push({
            node: node.name,
            path: `headerParameters.parameters[${header.index}].value`,
            message: `"${node.name}" sends a fixed "${header.name}" header (${mask(secret)}).`,
          });
        }
      }
    }
    return hits;
  },
};

const secretInUrl: Rule = {
  id: "security/secret-in-url",
  category: "security",
  severity: "high",
  title: "Secret in a URL",
  description:
    "URLs end up in server logs, proxies and n8n's execution history. Send the key in a header through an n8n credential instead, and rotate it.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = [];
    for (const node of scannable(graph)) {
      const url = node.parameters.url;
      if (typeof url === "string") {
        for (const m of url.matchAll(/[?&]([A-Za-z_-]+)=([^&#\s{}]+)/g)) {
          const name = m[1]!.toLowerCase();
          const secret = literalSecret(decodeURIComponentSafe(m[2]!));
          if (SENSITIVE_QUERY.has(name) && secret && !secretFormat(secret)) {
            hits.push({ node: node.name, path: "url", message: `"${node.name}" puts "${m[1]}" in the URL (${mask(secret)}).` });
          }
        }
      }
      for (const q of namedPairs(node.parameters.queryParameters)) {
        if (!SENSITIVE_QUERY.has(q.name.trim().toLowerCase())) continue;
        const secret = literalSecret(q.value);
        if (secret && !secretFormat(secret)) {
          hits.push({
            node: node.name,
            path: `queryParameters.parameters[${q.index}].value`,
            message: `"${node.name}" sends "${q.name}" as a URL parameter (${mask(secret)}).`,
          });
        }
      }
    }
    return hits;
  },
};

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * OAuth redirect URLs must be public: the provider's browser redirect cannot add a header.
 * Deliberately narrow: payment and event "callbacks" are exactly the webhooks that need auth.
 */
const OAUTH_CALLBACK = /oauth|auth[\s_-]?(?:code|callback)/i;

/** True when one of the first two steps after the webhook reads the request headers (a secret or signature check). */
function checksHeadersEarly(graph: WorkflowGraph, webhook: string): boolean {
  const first = graph.next(webhook);
  const second = first.flatMap((n) => graph.next(n));
  return [...first, ...second].some((name) => {
    const node = graph.byName.get(name);
    return node !== undefined && /\.headers\b|\["headers"\]|\['headers'\]/.test(JSON.stringify(node.parameters));
  });
}

const webhookNoAuth: Rule = {
  id: "security/webhook-no-auth",
  category: "security",
  severity: "high",
  title: "Webhook anyone can call",
  description:
    "Anyone who finds or guesses this URL can start the workflow, with any data. Set Authentication (Header Auth or Basic Auth), or check a signature or shared secret in the first step.",
  fixable: false,
  check(graph) {
    return graph.active
      .filter((n) => n.type === NODE.webhook)
      .filter((n) => n.parameters.authentication === undefined || n.parameters.authentication === "none")
      .filter((n) => !OAUTH_CALLBACK.test(`${n.name} ${String(n.parameters.path ?? "")}`))
      .filter((n) => !checksHeadersEarly(graph, n.name))
      .map((n) => ({ node: n.name, message: `"${n.name}" accepts calls from anyone.` }));
  },
};

const DANGEROUS_JS = /\beval\s*\(|\bnew\s+Function\s*\(|\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/;
const DANGEROUS_PY = /\b(?:eval|exec)\s*\(|\bos\.system\s*\(|\bsubprocess\./;

/** Code nodes and where their source lives. LangChain nodes nest code more deeply, so all strings are read. */
const CODE_NODES = new Set<string>([NODE.code, NODE.function, NODE.functionItem, `${LANGCHAIN}code`, `${LANGCHAIN}toolCode`]);

function codeSources(node: WorkflowNode): { code: string; path: string; python: boolean }[] {
  if (node.type === `${LANGCHAIN}code` || node.type === `${LANGCHAIN}toolCode`) {
    const python = node.parameters.language === "python";
    return walkStrings(node.parameters)
      .filter((s) => /code$/i.test(s.path.split(".").pop() ?? ""))
      .map((s) => ({ code: s.value, path: s.path, python: python || s.path.endsWith("pythonCode") }));
  }
  return ["jsCode", "pythonCode", "functionCode"]
    .filter((field) => typeof node.parameters[field] === "string")
    .map((field) => ({ code: node.parameters[field] as string, path: field, python: field === "pythonCode" }));
}

const codeEval: Rule = {
  id: "security/code-eval",
  category: "security",
  severity: "high",
  title: "Code runs text as code",
  description:
    "eval, new Function, exec, child_process or a shell call turns text into code. If any of that text comes from input (a webhook, an email, an AI reply), an attacker can run their own code on your n8n server.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = [];
    for (const node of graph.active) {
      if (!CODE_NODES.has(node.type)) continue;
      for (const { code, path, python } of codeSources(node)) {
        const m = (python ? DANGEROUS_PY : DANGEROUS_JS).exec(code);
        if (m) hits.push({ node: node.name, path, message: `"${node.name}" uses ${describeCall(m[0])}.` });
      }
    }
    return hits;
  },
};

function describeCall(match: string): string {
  if (/child_process/.test(match)) return "child_process";
  return match.replace(/\s*\($/, "").replace(/\s+/g, " ");
}

/**
 * True when a {{ }} placeholder reads item data (which can come from outside), not just values n8n
 * controls ($execution.id, $now, $env) or fixed settings from a configuration node.
 */
export function insertsItemData(expression: string, graph?: WorkflowGraph): boolean {
  for (const m of expression.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const code = m[1]!;
    if (/\$json|\$input|\$items?\b|\$binary|\$fromAI/.test(code)) return true;
    for (const ref of code.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)|\$node\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
      const name = ref[1] ?? ref[2]!;
      if (!graph || !isFixedConfiguration(graph.byName.get(name))) return true;
    }
    if (/\$\(|\$node\b/.test(code) && !/\$\(\s*['"]|\$node\s*\[\s*['"]/.test(code)) return true; // dynamic reference
  }
  return false;
}

/** A Set node whose values are all fixed text: its output is configuration, not outside data. */
function isFixedConfiguration(node: WorkflowNode | undefined): boolean {
  if (!node || node.type !== `${BASE}set`) return false;
  const values = walkStrings(node.parameters);
  return values.length > 0 && values.every((v) => !isExpression(v.value));
}

const commandInjection: Rule = {
  id: "security/command-injection",
  category: "security",
  severity: "critical",
  title: "Shell command built from data",
  description:
    "The command contains {{ expressions }}, so data from earlier steps becomes part of a shell command. A value like `; rm -rf /` runs on the server. Validate input strictly, or avoid the shell.",
  fixable: false,
  check(graph) {
    return graph.active
      .filter((n) => n.type === NODE.executeCommand || n.type === NODE.ssh)
      .filter((n) => isExpression(n.parameters.command) && insertsItemData(n.parameters.command, graph))
      .map((n) => ({ node: n.name, path: "command", message: `"${n.name}" builds a shell command from workflow data.` }));
  },
};

/** Generic top-level domains common enough to treat a host as public. Any two-letter country code also counts. */
const PUBLIC_TLDS = new Set([
  "com", "net", "org", "io", "ai", "dev", "app", "co", "me", "info", "biz", "xyz", "cloud", "tech", "online", "site",
  "pro", "edu", "gov", "mil", "int", "store", "shop", "live", "news", "media", "digital", "agency", "solutions",
  "services", "systems", "software", "network", "email", "page", "run", "sh", "so", "gg", "tv", "fm", "ly", "to",
]);

/** Hosts that are local, on a private network, or inside a cluster, where plain HTTP is normal. */
export function isPrivateHost(host: string): boolean {
  if (!host.includes(".")) return true; // docker service names, "localhost"
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0+\.)/.test(host)) return true;
  if (/^\d+(\.\d+){3}$/.test(host)) return false; // any other IPv4 address is public
  if (/\.(local|internal|lan|home|localhost|svc|cluster\.local)$/.test(host) || host === "host.docker.internal") return true;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return !(tld.length === 2 || PUBLIC_TLDS.has(tld)); // "prometheus.monitoring": a cluster namespace, not a TLD
}

/** Hosts left as placeholders in templates: "XX.XX.XX", "your-api.com", example.com (reserved for docs). */
export function isPlaceholderHost(host: string): boolean {
  return /^[x.]+$/i.test(host) || /your|placeholder/i.test(host) || /(^|\.)example\.(com|org|net)$/.test(host);
}

const insecureTransport: Rule = {
  id: "security/insecure-transport",
  category: "security",
  severity: "medium",
  title: "Unencrypted or unverified connection",
  description:
    "Plain http:// to a public server, or skipping certificate checks, lets anyone on the network path read or change the data, including credentials. Use https:// and keep certificate checks on.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = [];
    for (const node of graph.active.filter((n) => n.type === NODE.httpRequest)) {
      const url = typeof node.parameters.url === "string" ? node.parameters.url : "";
      // The host must be fixed text; the path may contain {{ }} (".../users/{{ $json.id }}").
      const m = /^=?\s*(https?):\/\/([^/:?#\s{}]+)(.?)/i.exec(url);
      const scheme = m?.[1]!.toLowerCase();
      const host = m?.[2]!.toLowerCase();
      const hostIsFixed = m !== null && m[3] !== "{";
      if (scheme === "http" && hostIsFixed && !isPrivateHost(host!) && !isPlaceholderHost(host!)) {
        hits.push({ node: node.name, path: "url", message: `"${node.name}" sends data unencrypted to ${m![2]}.` });
      }
      // Certificate checks only matter for https; on a plain http URL the flag does nothing.
      if (scheme !== "http" && get(node.parameters, "options.allowUnauthorizedCerts") === true) {
        hits.push({
          node: node.name,
          path: "options.allowUnauthorizedCerts",
          message: `"${node.name}" skips SSL certificate checks.`,
        });
      }
    }
    return hits;
  },
};

export const securityRules: Rule[] = [
  hardcodedSecret,
  secretInUrl,
  webhookNoAuth,
  codeEval,
  commandInjection,
  insecureTransport,
];
