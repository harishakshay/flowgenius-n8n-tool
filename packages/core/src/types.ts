// Types for the n8n workflow JSON format (what "Download" or copy from the canvas produces).
// Field names match n8n exactly. Unknown extra fields are kept on the raw input, not modelled here.

/** What a node does when it throws. Set in the node's "On Error" setting. */
export type NodeErrorMode = "stopWorkflow" | "continueRegularOutput" | "continueErrorOutput";

export interface NodeCredentialRef {
  id?: string;
  name: string;
}

export interface WorkflowNode {
  id?: string;
  name: string;
  /** For example "n8n-nodes-base.httpRequest" or "@n8n/n8n-nodes-langchain.agent". */
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, NodeCredentialRef>;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  onError?: NodeErrorMode;
  /** Older equivalent of onError: "continueRegularOutput". */
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  webhookId?: string;
}

export interface ConnectionTarget {
  /** Name of the node this connection goes to. */
  node: string;
  /** Connection type at the target, for example "main" or "ai_tool". */
  type: string;
  /** Input index on the target node. */
  index: number;
}

/** Outputs of one node: connection type -> output index -> targets. A null slot is an unconnected output. */
export type NodeConnections = Record<string, (ConnectionTarget[] | null)[]>;

/** Keyed by source node name. */
export type Connections = Record<string, NodeConnections>;

export interface WorkflowSettings {
  executionOrder?: string;
  /** ID of the workflow n8n runs when this one fails. */
  errorWorkflow?: string;
  /** Seconds. -1 or absent means no limit. */
  executionTimeout?: number;
  saveDataErrorExecution?: string;
  saveDataSuccessExecution?: string;
  saveManualExecutions?: boolean;
  saveExecutionProgress?: boolean;
  timezone?: string;
  callerPolicy?: string;
  [key: string]: unknown;
}

export interface Workflow {
  id?: string;
  name?: string;
  active?: boolean;
  nodes: WorkflowNode[];
  connections: Connections;
  settings: WorkflowSettings;
  /** Test data pinned to nodes in the editor, keyed by node name. */
  pinData: Record<string, unknown[]>;
  meta?: Record<string, unknown>;
}

export type IssueSeverity = "error" | "warning";

/** A problem found while reading the JSON itself (not a production-readiness finding). */
export interface ParseIssue {
  code: ParseIssueCode;
  severity: IssueSeverity;
  message: string;
  /** Where in the input, for example "nodes[3].position". */
  path?: string;
}

export type ParseIssueCode =
  | "invalid-json"
  | "not-a-workflow"
  | "invalid-node"
  | "invalid-field"
  | "duplicate-node-name"
  | "invalid-connection"
  | "dangling-connection";

export type ParseResult =
  | { ok: true; workflow: Workflow; issues: ParseIssue[] }
  | { ok: false; issues: ParseIssue[] };
