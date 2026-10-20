import { analyze } from "../src/index.js";
import type { Finding } from "../src/index.js";

type NodeInput = { name: string; type: string } & Record<string, unknown>;

export const T = {
  webhook: "n8n-nodes-base.webhook",
  schedule: "n8n-nodes-base.scheduleTrigger",
  cron: "n8n-nodes-base.cron",
  manual: "n8n-nodes-base.manualTrigger",
  errorTrigger: "n8n-nodes-base.errorTrigger",
  http: "n8n-nodes-base.httpRequest",
  slack: "n8n-nodes-base.slack",
  set: "n8n-nodes-base.set",
  if: "n8n-nodes-base.if",
  code: "n8n-nodes-base.code",
  respond: "n8n-nodes-base.respondToWebhook",
  loop: "n8n-nodes-base.splitInBatches",
  exec: "n8n-nodes-base.executeCommand",
  sticky: "n8n-nodes-base.stickyNote",
  agent: "@n8n/n8n-nodes-langchain.agent",
  model: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  gmailTool: "n8n-nodes-base.gmailTool",
  sheets: "n8n-nodes-base.googleSheets",
} as const;

export function node(name: string, type: string, extra: Record<string, unknown> = {}): NodeInput {
  return { name, type, typeVersion: 1, position: [0, 0], parameters: {}, ...extra };
}

/** Connects nodes in a chain: link("A", "B", "C") makes A -> B -> C on main output 0. */
export function link(...names: string[]): Record<string, { main: { node: string; type: string; index: number }[][] }> {
  const connections: Record<string, { main: { node: string; type: string; index: number }[][] }> = {};
  for (let i = 0; i < names.length - 1; i++) {
    const from = names[i]!;
    connections[from] ??= { main: [[]] };
    connections[from].main[0]!.push({ node: names[i + 1]!, type: "main", index: 0 });
  }
  return connections;
}

export function workflow(nodes: NodeInput[], connections: object = {}, extra: Record<string, unknown> = {}) {
  return { nodes, connections, ...extra };
}

/** Findings of one rule for a workflow. */
export function hits(ruleId: string, input: unknown): Finding[] {
  const result = analyze(input);
  if (!result.ok) throw new Error(`parse failed: ${JSON.stringify(result.parseIssues)}`);
  if (result.ruleErrors.length) throw new Error(`rule crashed: ${JSON.stringify(result.ruleErrors)}`);
  return result.findings.filter((f) => f.ruleId === ruleId);
}
