// Automatic fixes for the problems that can be repaired without guessing.
//
// Works on a copy of the raw JSON, never on the parsed model: the parser drops fields n8n needs
// (node ids, credential ids, unknown keys), so each fix changes only the field it targets.
// Every change is listed in the result, so a caller can show exactly what was done and why.

import { analyze } from "./engine.js";
import type { AnalyzeOptions } from "./engine.js";
import { unwrap } from "./parse.js";
import type { Finding } from "./rule.js";
import { type Grade, scoreFindings } from "./score.js";
import { walkStrings } from "./values.js";

export interface FixOptions extends AnalyzeOptions {
  /** IANA timezone for schedules, e.g. "Asia/Kolkata". Without it, timezone findings are left alone. */
  timezone?: string;
  /** Id of an existing error workflow on the user's n8n. Without it, that finding is left alone. */
  errorWorkflowId?: string;
  /** Seconds. Default 600. */
  executionTimeout?: number;
  /** Milliseconds. Default 30000. */
  httpTimeout?: number;
  /**
   * Also remove disabled and unconnected nodes. Off by default: removal doesn't change how the
   * workflow runs, but templates often ship optional steps disabled, and a person may still want them.
   */
  removeUnused?: boolean;
}

export interface AppliedFix {
  ruleId: string;
  /** Node the fix changed or removed. Absent for workflow settings. */
  node?: string;
  /** Plain-language description of the change. */
  change: string;
  /** JSON paths (relative to the workflow object) that this fix changed. */
  paths: string[];
}

export interface SkippedFix {
  ruleId: string;
  node?: string;
  reason: string;
}

export type FixResult =
  | {
      ok: true;
      /** The fixed workflow, in the same wrapper shape it came in. */
      fixed: unknown;
      /** The fixed workflow as formatted JSON, ready to download or import. */
      json: string;
      applied: AppliedFix[];
      skipped: SkippedFix[];
      before: { score: number; grade: Grade };
      after: { score: number; grade: Grade };
      /** Problems still in the fixed workflow: those that need a person, plus any skipped above. */
      remaining: Finding[];
    }
  | { ok: false; reason: string };

/** Rules this module can fix. */
export const FIXABLE_RULES = [
  "error-handling/no-retry",
  "reliability/http-no-timeout",
  "reliability/no-execution-timeout",
  "reliability/schedule-no-timezone",
  "error-handling/no-error-workflow",
  "data/pinned-data",
  "maintainability/disabled-nodes",
  "maintainability/orphan-nodes",
] as const;

type Obj = Record<string, unknown>;
type Target = { node: string; type?: string; index?: number };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Most passes needed in practice is 2; the cap only guards against a bug looping forever. */
const MAX_PASSES = 10;

/**
 * Fixes a workflow. Removing a node can make another fix possible (a node fed only by a removed
 * trigger is now an orphan), so passes repeat until one changes nothing.
 */
export function fixWorkflow(input: unknown, options: FixOptions = {}): FixResult {
  const first = fixOnce(input, options);
  if (!first.ok || !first.applied.length) return first;
  let current = first;
  const applied = [...first.applied];
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const next = fixOnce(current.fixed, options);
    if (!next.ok) return next;
    if (!next.applied.length) break;
    applied.push(...next.applied);
    current = next;
  }
  return { ...current, applied, before: first.before };
}

function fixOnce(input: unknown, options: FixOptions): FixResult {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input);
    } catch (err) {
      return { ok: false, reason: `Not valid JSON: ${(err as Error).message}` };
    }
  }
  const analyzeOptions: AnalyzeOptions = {};
  if (options.disable) analyzeOptions.disable = options.disable;
  if (options.enable) analyzeOptions.enable = options.enable;

  const before = analyze(data, analyzeOptions);
  if (!before.ok) return { ok: false, reason: before.parseIssues[0]?.message ?? "Not an n8n workflow." };

  // A deep copy; the input is JSON, so a JSON round trip copies it exactly.
  const copy: unknown = JSON.parse(JSON.stringify(data));
  const wf = unwrap(copy);
  if (!wf) return { ok: false, reason: "Not an n8n workflow." };

  const applied: AppliedFix[] = [];
  const skipped: SkippedFix[] = [];
  const nodes = wf.nodes as unknown[];
  const nameCounts = new Map<string, number>();
  const indexByName = new Map<string, number>();
  nodes.forEach((n, i) => {
    if (!isObj(n) || typeof n.name !== "string") return;
    nameCounts.set(n.name, (nameCounts.get(n.name) ?? 0) + 1);
    if (!indexByName.has(n.name)) indexByName.set(n.name, i);
  });

  /** The raw node a finding is about, or a reason it can't be touched safely. */
  const rawNode = (f: Finding): { node: Obj; index: number } | string => {
    if (!f.node) return "no node";
    if ((nameCounts.get(f.node) ?? 0) > 1) return `two nodes are named "${f.node}"; rename one first`;
    const index = indexByName.get(f.node);
    return index === undefined ? "node not found" : { node: nodes[index] as Obj, index };
  };

  const byRule = (id: string) => before.findings.filter((f) => f.ruleId === id);

  // ---- node fields ------------------------------------------------------------------------

  for (const f of byRule("error-handling/no-retry")) {
    const found = rawNode(f);
    if (typeof found === "string") {
      skipped.push({ ruleId: f.ruleId, node: f.node!, reason: found });
      continue;
    }
    const { node, index } = found;
    const unsafe = retryRisk(node);
    if (unsafe) {
      skipped.push({ ruleId: f.ruleId, node: f.node!, reason: unsafe });
      continue;
    }
    const paths = [`nodes[${index}].retryOnFail`];
    node.retryOnFail = true;
    if (typeof node.maxTries !== "number" || node.maxTries <= 1) {
      node.maxTries = 3;
      paths.push(`nodes[${index}].maxTries`);
    }
    if (typeof node.waitBetweenTries !== "number") {
      node.waitBetweenTries = 2000;
      paths.push(`nodes[${index}].waitBetweenTries`);
    }
    applied.push({
      ruleId: f.ruleId,
      node: f.node!,
      change: `Retry on fail: ${node.maxTries as number} tries, ${node.waitBetweenTries as number} ms apart`,
      paths,
    });
  }

  const httpTimeout = options.httpTimeout ?? 30000;
  for (const f of byRule("reliability/http-no-timeout")) {
    const found = rawNode(f);
    if (typeof found === "string") {
      skipped.push({ ruleId: f.ruleId, node: f.node!, reason: found });
      continue;
    }
    const { node, index } = found;
    if (!isObj(node.parameters)) node.parameters = {};
    const params = node.parameters as Obj;
    if (!isObj(params.options)) params.options = {};
    (params.options as Obj).timeout = httpTimeout;
    applied.push({
      ruleId: f.ruleId,
      node: f.node!,
      change: `Timeout: ${httpTimeout / 1000} s`,
      paths: [`nodes[${index}].parameters.options.timeout`],
    });
  }

  // ---- workflow settings ------------------------------------------------------------------

  const settingsWasString = typeof wf.settings === "string";
  // A selection copied from the canvas has no settings; pasted back, added settings would be ignored.
  const hasSettings = "settings" in wf;
  const settingsRules = ["reliability/no-execution-timeout", "reliability/schedule-no-timezone", "error-handling/no-error-workflow"];
  if (!hasSettings) {
    for (const id of settingsRules) {
      if (byRule(id).length) {
        skipped.push({ ruleId: id, reason: "this is a canvas copy, which has no workflow settings; set it in Workflow Settings in n8n" });
      }
    }
  }
  const held: { settings: Obj | null } = { settings: null };
  const getSettings = (): Obj => {
    if (held.settings) return held.settings;
    let settings: Obj;
    if (settingsWasString) {
      try {
        const parsed: unknown = JSON.parse(wf.settings as string);
        settings = isObj(parsed) ? parsed : {};
      } catch {
        settings = {};
      }
    } else settings = isObj(wf.settings) ? (wf.settings as Obj) : {};
    held.settings = settings;
    return settings;
  };

  if (hasSettings && byRule("reliability/no-execution-timeout").length) {
    const seconds = options.executionTimeout ?? 600;
    getSettings().executionTimeout = seconds;
    applied.push({
      ruleId: "reliability/no-execution-timeout",
      change: `Workflow timeout: ${seconds / 60} min`,
      paths: ["settings.executionTimeout"],
    });
  }

  const zoneFindings = byRule("reliability/schedule-no-timezone");
  if (hasSettings && zoneFindings.length) {
    if (options.timezone && isTimezone(options.timezone)) {
      getSettings().timezone = options.timezone;
      applied.push({ ruleId: "reliability/schedule-no-timezone", change: `Timezone: ${options.timezone}`, paths: ["settings.timezone"] });
    } else {
      skipped.push({
        ruleId: "reliability/schedule-no-timezone",
        reason: options.timezone ? `"${options.timezone}" is not a timezone` : "choose a timezone (for example Asia/Kolkata)",
      });
    }
  }

  if (hasSettings && byRule("error-handling/no-error-workflow").length) {
    if (options.errorWorkflowId) {
      getSettings().errorWorkflow = options.errorWorkflowId;
      applied.push({ ruleId: "error-handling/no-error-workflow", change: "Error workflow set", paths: ["settings.errorWorkflow"] });
    } else {
      skipped.push({ ruleId: "error-handling/no-error-workflow", reason: "give the id of your error workflow (Workflow Settings > Error Workflow)" });
    }
  }

  if (held.settings) wf.settings = settingsWasString ? JSON.stringify(held.settings) : held.settings;

  if (byRule("data/pinned-data").length && isObj(wf.pinData)) {
    wf.pinData = {};
    applied.push({ ruleId: "data/pinned-data", change: "Pinned test data removed", paths: ["pinData"] });
  }

  // ---- node removal (last, so the indexes above stay valid) ----------------------------------

  const removals: { ruleId: string; name: string; splice: boolean }[] = [];
  if (options.removeUnused) {
    for (const f of byRule("maintainability/disabled-nodes")) removals.push({ ruleId: f.ruleId, name: f.node!, splice: true });
    for (const f of byRule("maintainability/orphan-nodes")) removals.push({ ruleId: f.ruleId, name: f.node!, splice: false });
  }

  const blocker = removalBlockers(wf, nameCounts);
  const toRemove = new Map<string, boolean>();
  for (const r of removals) {
    const reason = blocker(r.name);
    if (reason) {
      skipped.push({ ruleId: r.ruleId, node: r.name, reason });
      continue;
    }
    toRemove.set(r.name, r.splice);
    applied.push({
      ruleId: r.ruleId,
      node: r.name,
      change: r.splice ? "Removed; its inputs now connect to its outputs, as when it was disabled" : "Removed (it was not connected)",
      paths: [`nodes[name=${r.name}]`, `connections.${r.name}`],
    });
  }
  if (toRemove.size) removeNodes(wf, toRemove);

  const after = analyze(copy, analyzeOptions);
  if (!after.ok) return { ok: false, reason: "Fixing produced an unreadable workflow. This is a bug; please report it." };
  return {
    ok: true,
    fixed: copy,
    json: `${JSON.stringify(copy, null, 2)}\n`,
    applied,
    skipped,
    before: { score: before.score, grade: before.grade },
    after: scoreFindings(after.findings),
    remaining: after.findings,
  };
}

// ---- is a retry safe? -------------------------------------------------------------------------
//
// A retry repeats the call. That is harmless for a read, but when the first attempt went through
// and only the reply was lost, repeating a write sends the email or creates the ticket twice.
// So retries are turned on only where repeating can't do anything twice; the rest is left to a person.

/** LLM calls with no tools: repeating one costs tokens but changes nothing. */
const LLM_ONLY = /^@n8n\/n8n-nodes-langchain\.(chainLlm|chainSummarization|chainRetrievalQa|informationExtractor|textClassifier|sentimentAnalysis)$/;
const AGENT = /^@n8n\/n8n-nodes-langchain\.agent/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_OPERATION = /^(get|getAll|getMany|search|list|read|lookup|download|fetch|find|query|count|exists|retrieve|select)([A-Z].*)?$/;
/** "getAndDelete", "readAndUpdate": a read name that also writes is not a read. */
const WRITE_WORD = /create|update|delete|remove|send|post|add|set|move|mark|insert|upsert|append|clear|archive|reply|write|publish|execute|run|trigger/i;

/** Why retrying this node could do something twice, or null when a retry is safe. */
export function retryRisk(node: Obj): string | null {
  const type = typeof node.type === "string" ? node.type : "";
  const params = isObj(node.parameters) ? node.parameters : {};
  if (AGENT.test(type)) return "re-running an AI agent repeats its tool calls; turn on retries yourself if every tool is safe to repeat";
  if (LLM_ONLY.test(type)) return null;
  const operation = typeof params.operation === "string" ? params.operation : undefined;
  if (operation === "sendAndWait") return "it sends a message and waits for a reply; a retry would send it again";
  if (type === "n8n-nodes-base.httpRequest") {
    const raw = params.method ?? params.requestMethod ?? "GET";
    if (typeof raw !== "string" || raw.startsWith("=")) return "the request method is set by an expression, so a retry might repeat a write";
    const method = raw.toUpperCase();
    return SAFE_METHODS.has(method) ? null : `retrying a ${method} request could do it twice; turn on retries yourself if the API ignores repeats`;
  }
  if (operation === undefined) return "can't tell whether this step only reads; a retry could create or send something twice";
  if (READ_OPERATION.test(operation) && !WRITE_WORD.test(operation)) return null;
  return `retrying "${operation}" could do it twice; turn on retries yourself if that is safe`;
}

function isTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a function telling why a node can't be removed safely (or null when it can).
 * Everything it needs is gathered in one pass over the workflow, so checking thousands of
 * candidates stays linear.
 */
function removalBlockers(wf: Obj, nameCounts: Map<string, number>): (name: string) => string | null {
  const connections = isObj(wf.connections) ? wf.connections : {};
  // AI connections (model, memory, tool) can't be rewired without changing behaviour.
  const aiLinked = new Set<string>();
  for (const [source, outputs] of Object.entries(connections)) {
    if (!isObj(outputs)) continue;
    for (const [type, slots] of Object.entries(outputs)) {
      if (type === "main" || !Array.isArray(slots)) continue;
      aiLinked.add(source);
      for (const slot of slots) {
        if (Array.isArray(slot)) for (const t of slot) if (isObj(t) && typeof t.node === "string") aiLinked.add(t.node);
      }
    }
  }
  // A webhook set to answer "using Respond to Webhook node" fails when no such node exists,
  // even an unconnected one, so these are never removed.
  const responders = new Set<string>();
  for (const n of wf.nodes as unknown[]) {
    if (isObj(n) && n.type === "n8n-nodes-base.respondToWebhook" && typeof n.name === "string") responders.add(n.name);
  }
  // Nodes whose output another node reads by name: $('Name'), $node["Name"].
  const readBy = new Map<string, string>();
  // $('Name'), $node["Name"], and the legacy $items("Name").
  const reference = /\$(?:items)?\(\s*(['"`])(.+?)\1\s*[,)]|\$node\s*\[\s*(['"])(.+?)\3\s*\]/g;
  for (const n of wf.nodes as unknown[]) {
    if (!isObj(n)) continue;
    // Scan the real string values, not JSON text, where every " would appear as \".
    for (const { value } of walkStrings(n.parameters ?? {})) {
      for (const m of value.matchAll(reference)) {
        // A name containing quotes is written escaped inside the expression ("My \"Old\" node").
        const target = (m[2] ?? m[4] ?? "").replace(/\\(["'`\\])/g, "$1");
        if (target !== n.name && !readBy.has(target)) readBy.set(target, String(n.name));
      }
    }
  }
  return (name) => {
    if ((nameCounts.get(name) ?? 0) > 1) return `two nodes are named "${name}"; rename one first`;
    if (aiLinked.has(name)) return "connected to an AI node; remove it by hand";
    if (responders.has(name)) return "a webhook may need this Respond to Webhook node to exist; remove it by hand";
    const reader = readBy.get(name);
    if (reader) return `"${reader}" reads its data by name; remove it by hand`;
    return null;
  };
}

/**
 * Removes nodes in one pass. For spliced (disabled) nodes, every connection into the node is
 * redirected to what its first main output fed, which is what n8n does with a disabled node:
 * items pass straight through. Chains of removed nodes resolve to the first node that stays.
 */
function removeNodes(wf: Obj, toRemove: Map<string, boolean>): void {
  wf.nodes = (wf.nodes as unknown[]).filter((n) => !(isObj(n) && typeof n.name === "string" && toRemove.has(n.name)));
  if (isObj(wf.pinData)) for (const name of toRemove.keys()) delete (wf.pinData as Obj)[name];
  if (!isObj(wf.connections)) return;
  const connections = wf.connections;

  const resolved = new Map<string, Target[]>();
  const resolve = (name: string, visiting: Set<string>): Target[] => {
    const known = resolved.get(name);
    if (known) return known;
    if (visiting.has(name) || !toRemove.get(name)) return []; // a loop of removed nodes, or an orphan
    visiting.add(name);
    const own = connections[name];
    const firstOutput = isObj(own) && Array.isArray(own.main) && Array.isArray(own.main[0]) ? (own.main[0] as unknown[]) : [];
    const out: Target[] = [];
    for (const t of firstOutput) {
      if (!isObj(t) || typeof t.node !== "string" || t.node === name) continue;
      if (toRemove.has(t.node)) out.push(...resolve(t.node, visiting));
      else out.push(t as Target);
    }
    visiting.delete(name);
    resolved.set(name, out);
    return out;
  };
  const key = (t: Target) => `${t.node}\u0000${t.type ?? ""}\u0000${t.index ?? ""}`;

  // Resolve before deleting, so chains can still be followed.
  for (const name of toRemove.keys()) resolve(name, new Set());
  for (const name of toRemove.keys()) delete connections[name];

  for (const outputs of Object.values(connections)) {
    if (!isObj(outputs) || !Array.isArray(outputs.main)) continue;
    outputs.main = (outputs.main as unknown[]).map((slot) => {
      if (!Array.isArray(slot) || !slot.some((t) => isObj(t) && typeof t.node === "string" && toRemove.has(t.node))) return slot;
      const next: unknown[] = [];
      const seen = new Set<string>();
      for (const t of slot) {
        if (isObj(t) && typeof t.node === "string" && toRemove.has(t.node)) {
          for (const p of resolved.get(t.node) ?? []) {
            if (!seen.has(key(p))) {
              seen.add(key(p));
              next.push({ ...p });
            }
          }
        } else {
          if (isObj(t) && typeof t.node === "string") seen.add(key(t as Target));
          next.push(t);
        }
      }
      return next;
    });
  }
}
