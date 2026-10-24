// Reads n8n workflow JSON into a typed, normalised Workflow.
// Lenient on purpose: real exports vary by n8n version, so anything recoverable becomes a warning
// and only input that is not a workflow at all fails.

import type {
  ConnectionTarget,
  Connections,
  NodeConnections,
  NodeCredentialRef,
  NodeErrorMode,
  ParseIssue,
  ParseResult,
  Workflow,
  WorkflowNode,
  WorkflowSettings,
} from "./types.js";

const ERROR_MODES: readonly NodeErrorMode[] = ["stopWorkflow", "continueRegularOutput", "continueErrorOutput"];
const STICKY_NOTE = "n8n-nodes-base.stickyNote";
/** Name given to sticky notes that arrive without one. */
export const UNNAMED_NOTE_PREFIX = "Sticky Note (unnamed) ";

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Objects keyed by names from the input (node names) have no prototype, so a node called
 * "__proto__" or "constructor" is stored as a plain key instead of changing the object.
 */
function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Accepts a workflow as:
 * - a file downloaded from n8n, or a selection copied from the canvas: `{ nodes, connections, ... }`
 * - an n8n template API response: `{ workflow: { workflow: { nodes, ... } } }` or `{ workflow: { nodes, ... } }`
 * Strings are parsed as JSON first.
 */
export function parseWorkflow(input: unknown): ParseResult {
  let data = input;
  if (typeof input === "string") {
    try {
      // Files saved by some Windows editors start with a byte-order mark, which JSON.parse rejects.
      data = JSON.parse(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input);
    } catch (err) {
      return fail("invalid-json", `Not valid JSON: ${(err as Error).message}`);
    }
  }

  const raw = unwrap(data);
  if (!raw) return fail("not-a-workflow", "Expected a workflow object with a `nodes` array.");

  const issues: ParseIssue[] = [];
  const nodes = parseNodes(raw.nodes as unknown[], issues);
  const names = new Set(nodes.map((n) => n.name));

  const workflow: Workflow = {
    nodes,
    connections: parseConnections(raw.connections, names, issues),
    settings: parseSettings(raw.settings, issues),
    pinData: parsePinData(raw.pinData, issues),
  };
  if (typeof raw.id === "string" || typeof raw.id === "number") workflow.id = String(raw.id);
  if (typeof raw.name === "string") workflow.name = raw.name;
  if (typeof raw.active === "boolean") workflow.active = raw.active;
  if (isObj(raw.meta)) workflow.meta = raw.meta;

  return { ok: true, workflow, issues };
}

function fail(code: ParseIssue["code"], message: string): ParseResult {
  return { ok: false, issues: [{ code, severity: "error", message }] };
}

/** The workflow object inside any accepted wrapper (template API responses nest it under `workflow`). */
export function unwrap(data: unknown): Obj | null {
  let current = data;
  // Template API responses nest the workflow up to two levels deep under `workflow`.
  for (let depth = 0; depth < 3; depth++) {
    if (!isObj(current)) return null;
    if (Array.isArray(current.nodes)) return current;
    current = current.workflow;
  }
  return null;
}

function parseNodes(rawNodes: unknown[], issues: ParseIssue[]): WorkflowNode[] {
  const nodes: WorkflowNode[] = [];
  const seen = new Set<string>();

  let unnamedNotes = 0;
  rawNodes.forEach((rawNode, i) => {
    const path = `nodes[${i}]`;
    // Sticky notes never run, and some exports leave them without a name. Keep them under a unique name.
    if (isObj(rawNode) && rawNode.type === STICKY_NOTE && typeof rawNode.name !== "string") {
      rawNode = { ...rawNode, name: `${UNNAMED_NOTE_PREFIX}${++unnamedNotes}` };
    }
    if (!isObj(rawNode) || typeof rawNode.name !== "string" || typeof rawNode.type !== "string") {
      issues.push({
        code: "invalid-node",
        severity: "warning",
        message: "Node skipped: it needs a string `name` and `type`.",
        path,
      });
      return;
    }

    const node: WorkflowNode = {
      name: rawNode.name,
      type: rawNode.type,
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    };

    const typeVersion = toNumber(rawNode.typeVersion);
    if (typeVersion !== null) node.typeVersion = typeVersion;
    else invalidField(issues, `${path}.typeVersion`, "missing or not a number; assuming 1");

    if (isPosition(rawNode.position)) node.position = [rawNode.position[0], rawNode.position[1]];
    else invalidField(issues, `${path}.position`, "missing or not [x, y]; assuming [0, 0]");

    if (isObj(rawNode.parameters)) node.parameters = rawNode.parameters;
    else if (rawNode.parameters !== undefined) invalidField(issues, `${path}.parameters`, "not an object; ignored");

    if (typeof rawNode.id === "string") node.id = rawNode.id;
    if (typeof rawNode.disabled === "boolean") node.disabled = rawNode.disabled;
    if (typeof rawNode.notes === "string") node.notes = rawNode.notes;
    if (typeof rawNode.notesInFlow === "boolean") node.notesInFlow = rawNode.notesInFlow;
    if (typeof rawNode.continueOnFail === "boolean") node.continueOnFail = rawNode.continueOnFail;
    if (typeof rawNode.retryOnFail === "boolean") node.retryOnFail = rawNode.retryOnFail;
    if (typeof rawNode.maxTries === "number") node.maxTries = rawNode.maxTries;
    if (typeof rawNode.waitBetweenTries === "number") node.waitBetweenTries = rawNode.waitBetweenTries;
    if (typeof rawNode.alwaysOutputData === "boolean") node.alwaysOutputData = rawNode.alwaysOutputData;
    if (typeof rawNode.executeOnce === "boolean") node.executeOnce = rawNode.executeOnce;
    if (typeof rawNode.webhookId === "string") node.webhookId = rawNode.webhookId;

    if (rawNode.onError !== undefined) {
      if (ERROR_MODES.includes(rawNode.onError as NodeErrorMode)) node.onError = rawNode.onError as NodeErrorMode;
      else invalidField(issues, `${path}.onError`, `unknown value ${JSON.stringify(rawNode.onError)}; ignored`);
    }

    const credentials = parseCredentials(rawNode.credentials);
    if (credentials) node.credentials = credentials;

    if (seen.has(node.name)) {
      issues.push({
        code: "duplicate-node-name",
        severity: "warning",
        message: `Two nodes are named "${node.name}". n8n connects nodes by name, so connections may be wrong.`,
        path,
      });
    }
    seen.add(node.name);
    nodes.push(node);
  });

  return nodes;
}

/** Numbers, or numeric strings such as "3.4" (n8n imports both). */
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function parseCredentials(value: unknown): Record<string, NodeCredentialRef> | null {
  if (!isObj(value)) return null;
  const result: Record<string, NodeCredentialRef> = {};
  for (const [type, ref] of Object.entries(value)) {
    if (isObj(ref) && typeof ref.name === "string") {
      const cred: NodeCredentialRef = { name: ref.name };
      if (typeof ref.id === "string") cred.id = ref.id;
      result[type] = cred;
    } else if (typeof ref === "string") {
      // Very old exports stored the credential name directly.
      result[type] = { name: ref };
    }
  }
  return Object.keys(result).length ? result : null;
}

function parseConnections(value: unknown, names: Set<string>, issues: ParseIssue[]): Connections {
  const connections: Connections = dict();
  if (value === undefined) return connections;
  if (!isObj(value)) {
    issues.push({ code: "invalid-connection", severity: "warning", message: "`connections` is not an object; ignored." });
    return connections;
  }
  // JSON.parse turns a "__proto__" key into an own property; read keys with Object.entries only.

  for (const [source, outputs] of Object.entries(value)) {
    if (!isObj(outputs)) continue;
    if (!names.has(source)) {
      issues.push({
        code: "dangling-connection",
        severity: "warning",
        message: `Connections come from "${source}", which is not a node in this workflow.`,
        path: `connections["${source}"]`,
      });
      continue;
    }

    const nodeConnections: NodeConnections = dict();
    for (const [connectionType, slots] of Object.entries(outputs)) {
      if (!Array.isArray(slots)) continue;
      nodeConnections[connectionType] = slots.map((slot, outputIndex) => {
        if (!Array.isArray(slot)) return null;
        const targets: ConnectionTarget[] = [];
        for (const target of slot) {
          if (!isObj(target) || typeof target.node !== "string") continue;
          if (!names.has(target.node)) {
            issues.push({
              code: "dangling-connection",
              severity: "warning",
              message: `"${source}" connects to "${target.node}", which is not a node in this workflow.`,
              path: `connections["${source}"].${connectionType}[${outputIndex}]`,
            });
            continue;
          }
          targets.push({
            node: target.node,
            type: typeof target.type === "string" ? target.type : connectionType,
            index: typeof target.index === "number" ? target.index : 0,
          });
        }
        return targets;
      });
    }
    connections[source] = nodeConnections;
  }
  return connections;
}

function parseSettings(value: unknown, issues: ParseIssue[]): WorkflowSettings {
  if (value === undefined || value === null) return {};
  // Some exports store settings as a JSON string.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // Fall through to the "not an object" warning below.
    }
  }
  if (!isObj(value)) {
    invalidField(issues, "settings", "not an object; ignored");
    return {};
  }
  const settings: WorkflowSettings = { ...value };
  // Older exports store the timeout as a string.
  if (settings.executionTimeout !== undefined) {
    const seconds = toNumber(settings.executionTimeout);
    if (seconds !== null) settings.executionTimeout = seconds;
    else delete settings.executionTimeout;
  }
  return settings;
}

function parsePinData(value: unknown, issues: ParseIssue[]): Record<string, unknown[]> {
  if (value === undefined || value === null) return dict();
  if (!isObj(value)) {
    invalidField(issues, "pinData", "not an object; ignored");
    return dict();
  }
  const pinData = dict<unknown[]>();
  for (const [node, items] of Object.entries(value)) if (Array.isArray(items)) pinData[node] = items;
  return pinData;
}

function invalidField(issues: ParseIssue[], path: string, detail: string): void {
  issues.push({ code: "invalid-field", severity: "warning", message: `${path}: ${detail}.`, path });
}
