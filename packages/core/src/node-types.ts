// What we know about n8n node types. Only what the rules need.

import type { WorkflowNode } from "./types.js";

const BASE = "n8n-nodes-base.";
const LANGCHAIN = "@n8n/n8n-nodes-langchain.";

export const NODE = {
  stickyNote: `${BASE}stickyNote`,
  httpRequest: `${BASE}httpRequest`,
  webhook: `${BASE}webhook`,
  respondToWebhook: `${BASE}respondToWebhook`,
  scheduleTrigger: `${BASE}scheduleTrigger`,
  cron: `${BASE}cron`,
  manualTrigger: `${BASE}manualTrigger`,
  start: `${BASE}start`,
  errorTrigger: `${BASE}errorTrigger`,
  executeWorkflowTrigger: `${BASE}executeWorkflowTrigger`,
  executeCommand: `${BASE}executeCommand`,
  ssh: `${BASE}ssh`,
  code: `${BASE}code`,
  function: `${BASE}function`,
  functionItem: `${BASE}functionItem`,
  splitInBatches: `${BASE}splitInBatches`,
  if: `${BASE}if`,
  switch: `${BASE}switch`,
  filter: `${BASE}filter`,
} as const;

/** Triggers whose type name does not end in "Trigger". */
const OTHER_TRIGGERS = new Set([NODE.webhook, NODE.cron, NODE.start, `${BASE}interval`, `${BASE}emailReadImap`]);

/** Triggers that only run when a person clicks "Execute" in the editor. */
const MANUAL_TRIGGERS = new Set<string>([NODE.manualTrigger, NODE.start]);

/**
 * Nodes that run inside n8n and do not call an outside service, so retrying them does not help.
 * Anything not listed (and not a trigger or AI sub-node) is treated as calling an outside service.
 */
const INTERNAL_NODES = new Set(
  [
    "stickyNote", "set", "if", "switch", "merge", "code", "function", "functionItem", "noOp", "splitInBatches",
    "splitOut", "aggregate", "filter", "sort", "limit", "removeDuplicates", "dateTime", "wait", "executeWorkflow",
    "respondToWebhook", "stopAndError", "renameKeys", "itemLists", "html", "xml", "markdown", "crypto",
    "compareDatasets", "summarize", "executionData", "convertToFile", "extractFromFile", "moveBinaryData",
    "spreadsheetFile", "readBinaryFile", "readBinaryFiles", "writeBinaryFile", "readWriteFile", "form",
    "editImage", "compression", "totp", "jwt", "dataTable", "debugHelper", "executeCommand", "htmlExtract",
    "splitInBatchesV3", "interval", "noOpTool", "aiTransform", "evaluation", "evaluationTrigger",
  ].map((t) => BASE + t),
);

export function isStickyNote(node: WorkflowNode): boolean {
  return node.type === NODE.stickyNote;
}

export function isTrigger(node: WorkflowNode): boolean {
  return /trigger$/i.test(node.type) || OTHER_TRIGGERS.has(node.type);
}

export function isManualTrigger(node: WorkflowNode): boolean {
  return MANUAL_TRIGGERS.has(node.type);
}

/** Triggers that start real, unattended runs: not manual, not a sub-workflow entry point, not an error handler. */
export function isProductionTrigger(node: WorkflowNode): boolean {
  return (
    isTrigger(node) &&
    !node.disabled &&
    !isManualTrigger(node) &&
    node.type !== NODE.executeWorkflowTrigger &&
    node.type !== NODE.errorTrigger &&
    !/evaluationTrigger$/.test(node.type)
  );
}

export function isInternalNode(node: WorkflowNode): boolean {
  return INTERNAL_NODES.has(node.type);
}

/** AI tool nodes (for example "gmailTool") are called by an agent, which handles their errors. */
export function isToolNode(node: WorkflowNode): boolean {
  return /Tool$/.test(node.type) || node.type.startsWith(`${LANGCHAIN}tool`);
}

/** Number of regular (non-error) outputs, where it is fixed. null when it depends on configuration. */
export function regularOutputCount(node: WorkflowNode): number | null {
  if (node.type === NODE.if) return 2;
  if (node.type === NODE.splitInBatches) return node.typeVersion >= 3 ? 2 : 1;
  if (node.type === NODE.switch || node.type === `${BASE}compareDatasets` || node.type === NODE.filter) return null;
  return 1;
}

const LOOP_EXITS = new Set<string>([NODE.splitInBatches, NODE.if, NODE.switch, NODE.filter, `${BASE}limit`]);

/** Nodes that can end a loop: Loop Over Items, or any branch that can route items elsewhere. */
export function canExitLoop(node: WorkflowNode): boolean {
  return LOOP_EXITS.has(node.type);
}
