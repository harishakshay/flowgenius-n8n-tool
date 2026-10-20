import { isStickyNote } from "../node-types.js";
import type { Rule, RuleHit } from "../rule.js";
import { walkStrings } from "../values.js";

const pinnedData: Rule = {
  id: "data/pinned-data",
  category: "data",
  severity: "medium",
  title: "Pinned data exported with the workflow",
  description:
    "Pinned data is copied into every export, share and backup of this workflow. It is often real customer data captured while testing. Unpin it before sharing or committing the workflow.",
  fixable: true,
  check(graph) {
    const nodes = Object.keys(graph.workflow.pinData).filter((n) => graph.workflow.pinData[n]!.length > 0);
    if (!nodes.length) return [];
    return [{ message: `Pinned test data on ${list(nodes)} is saved inside the workflow file.` }];
  },
};

/** Request inspectors and tunnels: fine while building, wrong in production. Only matched inside a URL. */
const TEST_HOSTS =
  /https?:\/\/((?:[\w-]+\.)*(?:webhook\.site|requestbin\.(?:com|net)|m\.pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev)|beeceptor\.com|mockbin\.(?:org|io)|httpbin\.org|postman-echo\.com|requestcatcher\.com|hookbin\.com|loca\.lt|trycloudflare\.com))\b/i;

const testEndpoint: Rule = {
  id: "data/test-endpoint",
  category: "data",
  severity: "medium",
  title: "Points at a test or tunnel URL",
  description:
    "Request inspectors (webhook.site, RequestBin) and tunnels (ngrok, Cloudflare quick tunnels) are for testing. In production the data goes to a public inbox, or nowhere once the tunnel closes. Point it at the real service.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = [];
    for (const node of graph.active) {
      for (const { value, path } of walkStrings(node.parameters)) {
        const m = TEST_HOSTS.exec(value);
        if (m) {
          hits.push({ node: node.name, path, message: `"${node.name}" sends data to ${m[1]}.` });
          break;
        }
      }
    }
    return hits;
  },
};

const brokenConnections: Rule = {
  id: "data/broken-connections",
  category: "data",
  severity: "medium",
  title: "Broken connections",
  description:
    "The workflow file has connections to nodes that do not exist, or two nodes with the same name. n8n routes data by node name, so items can go to the wrong step or nowhere. Re-import the workflow, rename duplicates, and reconnect.",
  fixable: false,
  check(graph) {
    const hits: RuleHit[] = graph.parseIssues
      .filter((i) => i.code === "dangling-connection")
      .map((i) => ({ message: i.message }));
    // Duplicate sticky notes are harmless: notes have no connections.
    const counts = new Map<string, number>();
    for (const n of graph.workflow.nodes) if (!isStickyNote(n)) counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) hits.push({ message: `${count} nodes are named "${name}", so connections to it are ambiguous.` });
    }
    return hits;
  },
};

/** Default names n8n gives new nodes. "HTTP Request2" is a default too. */
const DEFAULT_NAMES = new Set(
  [
    "HTTP Request", "Code", "Edit Fields", "Edit Fields (Set)", "Set", "If", "IF", "Switch", "Merge", "Function",
    "Function Item", "Wait", "Filter", "Loop Over Items", "Split In Batches", "SplitInBatches", "Aggregate",
    "Split Out", "Respond to Webhook", "Execute Workflow", "Call n8n Workflow Tool", "No Operation, do nothing",
    "AI Agent", "Basic LLM Chain", "OpenAI", "Message a model", "Limit", "Sort", "Remove Duplicates", "Date & Time",
    "Execute Command", "Send Email", "Information Extractor", "Text Classifier", "Summarize", "Item Lists",
    "Convert to File", "Extract from File", "HTML", "XML", "Crypto", "Rename Keys", "Postgres", "MySQL",
    "Google Sheets", "Gmail", "Slack", "Telegram", "Airtable", "Notion", "Discord", "Google Drive",
  ].map((n) => n.toLowerCase()),
);

export function isDefaultName(name: string): boolean {
  const base = name.replace(/\d+$/, "").trim().toLowerCase();
  return DEFAULT_NAMES.has(base);
}

export function list(names: string[], max = 5): string {
  const shown = names.slice(0, max).map((n) => `"${n}"`).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

export const dataRules: Rule[] = [pinnedData, testEndpoint, brokenConnections];
