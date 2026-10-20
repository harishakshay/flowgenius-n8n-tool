// src/main.ts
import { writeFileSync } from "node:fs";
import { resolve as resolve2 } from "node:path";

// ../core/dist/node-types.js
var BASE = "n8n-nodes-base.";
var LANGCHAIN = "@n8n/n8n-nodes-langchain.";
var NODE = {
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
  filter: `${BASE}filter`
};
var OTHER_TRIGGERS = /* @__PURE__ */ new Set([NODE.webhook, NODE.cron, NODE.start, `${BASE}interval`, `${BASE}emailReadImap`]);
var MANUAL_TRIGGERS = /* @__PURE__ */ new Set([NODE.manualTrigger, NODE.start, `${LANGCHAIN}manualChatTrigger`]);
var INTERNAL_NODES = new Set([
  "stickyNote",
  "set",
  "if",
  "switch",
  "merge",
  "code",
  "function",
  "functionItem",
  "noOp",
  "splitInBatches",
  "splitOut",
  "aggregate",
  "filter",
  "sort",
  "limit",
  "removeDuplicates",
  "dateTime",
  "wait",
  "executeWorkflow",
  "respondToWebhook",
  "stopAndError",
  "renameKeys",
  "itemLists",
  "html",
  "xml",
  "markdown",
  "crypto",
  "compareDatasets",
  "summarize",
  "executionData",
  "convertToFile",
  "extractFromFile",
  "moveBinaryData",
  "spreadsheetFile",
  "readBinaryFile",
  "readBinaryFiles",
  "writeBinaryFile",
  "readWriteFile",
  "form",
  "editImage",
  "compression",
  "totp",
  "jwt",
  "dataTable",
  "debugHelper",
  "executeCommand",
  "htmlExtract",
  "interval",
  "aiTransform",
  "evaluation"
].map((t) => BASE + t));
for (const t of ["chat", "code"])
  INTERNAL_NODES.add(LANGCHAIN + t);
function isStickyNote(node) {
  return node.type === NODE.stickyNote;
}
function isTrigger(node) {
  return /trigger$/i.test(node.type) || OTHER_TRIGGERS.has(node.type);
}
function isManualTrigger(node) {
  return MANUAL_TRIGGERS.has(node.type);
}
function isProductionTrigger(node) {
  return isTrigger(node) && !node.disabled && !isManualTrigger(node) && node.type !== NODE.executeWorkflowTrigger && node.type !== NODE.errorTrigger && node.type !== `${BASE}evaluationTrigger`;
}
function isInternalNode(node) {
  return INTERNAL_NODES.has(node.type);
}
function isToolNode(node) {
  return /Tool$/.test(node.type) || node.type.startsWith(`${LANGCHAIN}tool`);
}
var CONFIGURABLE_OUTPUTS = /* @__PURE__ */ new Set([
  NODE.switch,
  NODE.filter,
  `${BASE}compareDatasets`,
  `${BASE}removeDuplicates`,
  `${LANGCHAIN}textClassifier`,
  `${LANGCHAIN}sentimentAnalysis`,
  `${LANGCHAIN}guardrails`
]);
function regularOutputCount(node) {
  if (node.type === NODE.if)
    return 2;
  if (node.type === NODE.splitInBatches)
    return node.typeVersion >= 3 ? 2 : 1;
  if (CONFIGURABLE_OUTPUTS.has(node.type))
    return null;
  return 1;
}
var LOOP_EXITS = /* @__PURE__ */ new Set([NODE.splitInBatches, NODE.if, NODE.switch, NODE.filter, `${BASE}limit`]);
function canExitLoop(node) {
  return LOOP_EXITS.has(node.type);
}

// ../core/dist/graph.js
function buildGraph(workflow, parseIssues = []) {
  const byName = /* @__PURE__ */ new Map();
  for (const n of workflow.nodes)
    if (!byName.has(n.name))
      byName.set(n.name, n);
  const nextMap = /* @__PURE__ */ new Map();
  const prevMap = /* @__PURE__ */ new Map();
  const aiSources = /* @__PURE__ */ new Set();
  const linked = /* @__PURE__ */ new Set();
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    for (const [type, slots] of Object.entries(outputs)) {
      for (const slot of slots) {
        for (const target of slot ?? []) {
          linked.add(source);
          linked.add(target.node);
          if (type === "main") {
            push(nextMap, source, target.node);
            push(prevMap, target.node, source);
          } else if (type.startsWith("ai_")) {
            aiSources.add(source);
          }
        }
      }
    }
  }
  const next = (name) => nextMap.get(name) ?? [];
  const prev = (name) => prevMap.get(name) ?? [];
  const mainSlots = (name) => workflow.connections[name]?.main ?? [];
  return {
    workflow,
    parseIssues,
    byName,
    isLinked: (name) => linked.has(name),
    active: workflow.nodes.filter((n) => !isStickyNote(n) && !n.disabled),
    next,
    prev,
    outputTargets: (name, slot) => (mainSlots(name)[slot] ?? []).map((t) => t.node),
    outputSlots: (name) => mainSlots(name).length,
    // A sub-node feeds an AI node and has no main-flow edges of its own.
    isAiSubNode: (name) => aiSources.has(name) && next(name).length === 0 && prev(name).length === 0,
    downstream(name) {
      const seen = /* @__PURE__ */ new Set();
      const stack = [...next(name)];
      while (stack.length) {
        const current = stack.pop();
        if (seen.has(current) || current === name)
          continue;
        seen.add(current);
        stack.push(...next(current));
      }
      return [...seen].map((n) => byName.get(n)).filter((n) => n !== void 0);
    },
    cycles: () => stronglyConnected([...byName.keys()], next).filter((group) => group.length > 1 || next(group[0]).includes(group[0])).map((group) => group.map((n) => byName.get(n)))
  };
}
function push(map, key, value) {
  const list2 = map.get(key);
  if (list2) {
    if (!list2.includes(value))
      list2.push(value);
  } else
    map.set(key, [value]);
}
function stronglyConnected(names, next) {
  let index = 0;
  const indices = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const onStack = /* @__PURE__ */ new Set();
  const stack = [];
  const groups = [];
  for (const root of names) {
    if (indices.has(root))
      continue;
    const work = [{ node: root, edge: 0 }];
    indices.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const edges = next(frame.node);
      if (frame.edge < edges.length) {
        const target = edges[frame.edge++];
        if (!indices.has(target)) {
          indices.set(target, index);
          low.set(target, index++);
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, edge: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node), indices.get(target)));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent)
        low.set(parent.node, Math.min(low.get(parent.node), low.get(frame.node)));
      if (low.get(frame.node) === indices.get(frame.node)) {
        const group = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);
        groups.push(group);
      }
    }
  }
  return groups;
}

// ../core/dist/parse.js
var ERROR_MODES = ["stopWorkflow", "continueRegularOutput", "continueErrorOutput"];
var STICKY_NOTE = "n8n-nodes-base.stickyNote";
var UNNAMED_NOTE_PREFIX = "Sticky Note (unnamed) ";
function isObj(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dict() {
  return /* @__PURE__ */ Object.create(null);
}
function parseWorkflow(input2) {
  let data = input2;
  if (typeof input2 === "string") {
    try {
      data = JSON.parse(input2.charCodeAt(0) === 65279 ? input2.slice(1) : input2);
    } catch (err) {
      return fail("invalid-json", `Not valid JSON: ${err.message}`);
    }
  }
  const raw = unwrap(data);
  if (!raw)
    return fail("not-a-workflow", "Expected a workflow object with a `nodes` array.");
  const issues = [];
  const nodes = parseNodes(raw.nodes, issues);
  const names = new Set(nodes.map((n) => n.name));
  const workflow = {
    nodes,
    connections: parseConnections(raw.connections, names, issues),
    settings: parseSettings(raw.settings, issues),
    pinData: parsePinData(raw.pinData, issues)
  };
  if (typeof raw.id === "string" || typeof raw.id === "number")
    workflow.id = String(raw.id);
  if (typeof raw.name === "string")
    workflow.name = raw.name;
  if (typeof raw.active === "boolean")
    workflow.active = raw.active;
  if (isObj(raw.meta))
    workflow.meta = raw.meta;
  return { ok: true, workflow, issues };
}
function fail(code, message) {
  return { ok: false, issues: [{ code, severity: "error", message }] };
}
function unwrap(data) {
  let current = data;
  for (let depth = 0; depth < 3; depth++) {
    if (!isObj(current))
      return null;
    if (Array.isArray(current.nodes))
      return current;
    current = current.workflow;
  }
  return null;
}
function parseNodes(rawNodes, issues) {
  const nodes = [];
  const seen = /* @__PURE__ */ new Set();
  let unnamedNotes = 0;
  rawNodes.forEach((rawNode, i) => {
    const path = `nodes[${i}]`;
    if (isObj(rawNode) && rawNode.type === STICKY_NOTE && typeof rawNode.name !== "string") {
      rawNode = { ...rawNode, name: `${UNNAMED_NOTE_PREFIX}${++unnamedNotes}` };
    }
    if (!isObj(rawNode) || typeof rawNode.name !== "string" || typeof rawNode.type !== "string") {
      issues.push({
        code: "invalid-node",
        severity: "warning",
        message: "Node skipped: it needs a string `name` and `type`.",
        path
      });
      return;
    }
    const node = {
      name: rawNode.name,
      type: rawNode.type,
      typeVersion: 1,
      position: [0, 0],
      parameters: {}
    };
    const typeVersion = toNumber(rawNode.typeVersion);
    if (typeVersion !== null)
      node.typeVersion = typeVersion;
    else
      invalidField(issues, `${path}.typeVersion`, "missing or not a number; assuming 1");
    if (isPosition(rawNode.position))
      node.position = [rawNode.position[0], rawNode.position[1]];
    else
      invalidField(issues, `${path}.position`, "missing or not [x, y]; assuming [0, 0]");
    if (isObj(rawNode.parameters))
      node.parameters = rawNode.parameters;
    else if (rawNode.parameters !== void 0)
      invalidField(issues, `${path}.parameters`, "not an object; ignored");
    if (typeof rawNode.id === "string")
      node.id = rawNode.id;
    if (typeof rawNode.disabled === "boolean")
      node.disabled = rawNode.disabled;
    if (typeof rawNode.notes === "string")
      node.notes = rawNode.notes;
    if (typeof rawNode.notesInFlow === "boolean")
      node.notesInFlow = rawNode.notesInFlow;
    if (typeof rawNode.continueOnFail === "boolean")
      node.continueOnFail = rawNode.continueOnFail;
    if (typeof rawNode.retryOnFail === "boolean")
      node.retryOnFail = rawNode.retryOnFail;
    if (typeof rawNode.maxTries === "number")
      node.maxTries = rawNode.maxTries;
    if (typeof rawNode.waitBetweenTries === "number")
      node.waitBetweenTries = rawNode.waitBetweenTries;
    if (typeof rawNode.alwaysOutputData === "boolean")
      node.alwaysOutputData = rawNode.alwaysOutputData;
    if (typeof rawNode.executeOnce === "boolean")
      node.executeOnce = rawNode.executeOnce;
    if (typeof rawNode.webhookId === "string")
      node.webhookId = rawNode.webhookId;
    if (rawNode.onError !== void 0) {
      if (ERROR_MODES.includes(rawNode.onError))
        node.onError = rawNode.onError;
      else
        invalidField(issues, `${path}.onError`, `unknown value ${JSON.stringify(rawNode.onError)}; ignored`);
    }
    const credentials = parseCredentials(rawNode.credentials);
    if (credentials)
      node.credentials = credentials;
    if (seen.has(node.name)) {
      issues.push({
        code: "duplicate-node-name",
        severity: "warning",
        message: `Two nodes are named "${node.name}". n8n connects nodes by name, so connections may be wrong.`,
        path
      });
    }
    seen.add(node.name);
    nodes.push(node);
  });
  return nodes;
}
function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value))
    return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n))
      return n;
  }
  return null;
}
function isPosition(value) {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}
function parseCredentials(value) {
  if (!isObj(value))
    return null;
  const result = {};
  for (const [type, ref] of Object.entries(value)) {
    if (isObj(ref) && typeof ref.name === "string") {
      const cred = { name: ref.name };
      if (typeof ref.id === "string")
        cred.id = ref.id;
      result[type] = cred;
    } else if (typeof ref === "string") {
      result[type] = { name: ref };
    }
  }
  return Object.keys(result).length ? result : null;
}
function parseConnections(value, names, issues) {
  const connections = dict();
  if (value === void 0)
    return connections;
  if (!isObj(value)) {
    issues.push({ code: "invalid-connection", severity: "warning", message: "`connections` is not an object; ignored." });
    return connections;
  }
  for (const [source, outputs] of Object.entries(value)) {
    if (!isObj(outputs))
      continue;
    if (!names.has(source)) {
      issues.push({
        code: "dangling-connection",
        severity: "warning",
        message: `Connections come from "${source}", which is not a node in this workflow.`,
        path: `connections["${source}"]`
      });
      continue;
    }
    const nodeConnections = dict();
    for (const [connectionType, slots] of Object.entries(outputs)) {
      if (!Array.isArray(slots))
        continue;
      nodeConnections[connectionType] = slots.map((slot, outputIndex) => {
        if (!Array.isArray(slot))
          return null;
        const targets = [];
        for (const target of slot) {
          if (!isObj(target) || typeof target.node !== "string")
            continue;
          if (!names.has(target.node)) {
            issues.push({
              code: "dangling-connection",
              severity: "warning",
              message: `"${source}" connects to "${target.node}", which is not a node in this workflow.`,
              path: `connections["${source}"].${connectionType}[${outputIndex}]`
            });
            continue;
          }
          targets.push({
            node: target.node,
            type: typeof target.type === "string" ? target.type : connectionType,
            index: typeof target.index === "number" ? target.index : 0
          });
        }
        return targets;
      });
    }
    connections[source] = nodeConnections;
  }
  return connections;
}
function parseSettings(value, issues) {
  if (value === void 0 || value === null)
    return {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
    }
  }
  if (!isObj(value)) {
    invalidField(issues, "settings", "not an object; ignored");
    return {};
  }
  const settings = { ...value };
  if (settings.executionTimeout !== void 0) {
    const seconds = toNumber(settings.executionTimeout);
    if (seconds !== null)
      settings.executionTimeout = seconds;
    else
      delete settings.executionTimeout;
  }
  return settings;
}
function parsePinData(value, issues) {
  if (value === void 0 || value === null)
    return dict();
  if (!isObj(value)) {
    invalidField(issues, "pinData", "not an object; ignored");
    return dict();
  }
  const pinData = dict();
  for (const [node, items] of Object.entries(value))
    if (Array.isArray(items))
      pinData[node] = items;
  return pinData;
}
function invalidField(issues, path, detail) {
  issues.push({ code: "invalid-field", severity: "warning", message: `${path}: ${detail}.`, path });
}

// ../core/dist/values.js
function isExpression(value) {
  return typeof value === "string" && value.startsWith("=");
}
function isLiteral(value) {
  return typeof value === "string" && !value.includes("{{");
}
function walkStrings(params, path = "") {
  const out = [];
  const stack = [{ value: params, at: path }];
  while (stack.length) {
    const { value, at } = stack.pop();
    if (typeof value === "string")
      out.push({ value, path: at });
    else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--)
        stack.push({ value: value[i], at: `${at}[${i}]` });
    } else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i];
        stack.push({ value: v, at: at ? `${at}.${k}` : k });
      }
    }
  }
  return out;
}
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64(input2) {
  const s = input2.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  let bits = 0;
  let buffer = 0;
  let out = "";
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0)
      return null;
    buffer = buffer << 6 | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode(buffer >> bits & 255);
    }
  }
  return out;
}
function get(obj, path) {
  let current = obj;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object")
      return void 0;
    current = current[key];
  }
  return current;
}
function namedPairs(collection) {
  const list2 = get(collection, "parameters");
  if (!Array.isArray(list2))
    return [];
  return list2.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && typeof entry === "object" && typeof entry.name === "string").map(({ entry, index }) => ({
    name: entry.name,
    value: entry.value,
    index
  }));
}
function isPlaceholder(value) {
  const v = value.trim();
  return v.length === 0 || /your|replace|example|placeholder|insert|enter[_ -]?|change[_ -]?me|dummy|sample|<[^>]*>|\.\.\.|^x{3,}$|^\*+$/i.test(v) || // ALL_CAPS names: letters only, or words joined by underscores. Not AKIA... AWS keys, which mix in digits.
  /^[A-Z][A-Z_]*$/.test(v) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v) || /^\[[^\]]+\]$/.test(v) || // [FACEBOOK_ACCESS_TOKEN]
  /^\$\{?[A-Za-z_]/.test(v) || // $OPENAI_API_KEY, ${TOKEN}
  /^[a-z]+(?:_[a-z]+)*_(?:key|token|secret|id|password|pass)$/.test(v) || // google_api_key
  /(.)\1{5,}/.test(v);
}

// ../core/dist/rules/data.js
var pinnedData = {
  id: "data/pinned-data",
  category: "data",
  severity: "medium",
  title: "Pinned data exported with the workflow",
  description: "Pinned data is copied into every export, share and backup of this workflow. It is often real customer data captured while testing. Unpin it before sharing or committing the workflow.",
  fixable: true,
  check(graph) {
    const nodes = Object.keys(graph.workflow.pinData).filter((n) => graph.workflow.pinData[n].length > 0);
    if (!nodes.length)
      return [];
    return [{ message: `Pinned test data on ${list(nodes)} is saved inside the workflow file.` }];
  }
};
var TEST_HOSTS = /https?:\/\/((?:[\w-]+\.)*(?:webhook\.site|requestbin\.(?:com|net)|m\.pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev)|beeceptor\.com|mockbin\.(?:org|io)|httpbin\.org|postman-echo\.com|requestcatcher\.com|hookbin\.com|loca\.lt|trycloudflare\.com))\b/i;
var testEndpoint = {
  id: "data/test-endpoint",
  category: "data",
  severity: "medium",
  title: "Points at a test or tunnel URL",
  description: "Request inspectors (webhook.site, RequestBin) and tunnels (ngrok, Cloudflare quick tunnels) are for testing. In production the data goes to a public inbox, or nowhere once the tunnel closes. Point it at the real service.",
  fixable: false,
  check(graph) {
    const hits = [];
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
  }
};
var brokenConnections = {
  id: "data/broken-connections",
  category: "data",
  severity: "medium",
  title: "Broken connections",
  description: "The workflow file has connections to nodes that do not exist, or two nodes with the same name. n8n routes data by node name, so items can go to the wrong step or nowhere. Re-import the workflow, rename duplicates, and reconnect.",
  fixable: false,
  check(graph) {
    const hits = graph.parseIssues.filter((i) => i.code === "dangling-connection").map((i) => ({ message: i.message }));
    const counts = /* @__PURE__ */ new Map();
    for (const n of graph.workflow.nodes)
      if (!isStickyNote(n))
        counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1)
        hits.push({ message: `${count} nodes are named "${name}", so connections to it are ambiguous.` });
    }
    return hits;
  }
};
var DEFAULT_NAMES = new Set([
  "HTTP Request",
  "Code",
  "Edit Fields",
  "Edit Fields (Set)",
  "Set",
  "If",
  "IF",
  "Switch",
  "Merge",
  "Function",
  "Function Item",
  "Wait",
  "Filter",
  "Loop Over Items",
  "Split In Batches",
  "SplitInBatches",
  "Aggregate",
  "Split Out",
  "Respond to Webhook",
  "Execute Workflow",
  "Call n8n Workflow Tool",
  "No Operation, do nothing",
  "AI Agent",
  "Basic LLM Chain",
  "OpenAI",
  "Message a model",
  "Limit",
  "Sort",
  "Remove Duplicates",
  "Date & Time",
  "Execute Command",
  "Send Email",
  "Information Extractor",
  "Text Classifier",
  "Summarize",
  "Item Lists",
  "Convert to File",
  "Extract from File",
  "HTML",
  "XML",
  "Crypto",
  "Rename Keys",
  "Postgres",
  "MySQL",
  "Google Sheets",
  "Gmail",
  "Slack",
  "Telegram",
  "Airtable",
  "Notion",
  "Discord",
  "Google Drive"
].map((n) => n.toLowerCase()));
function isDefaultName(name) {
  const base = name.replace(/\d+$/, "").trim().toLowerCase();
  return DEFAULT_NAMES.has(base);
}
function list(names, max = 5) {
  const shown = names.slice(0, max).map((n) => `"${n}"`).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}
var dataRules = [pinnedData, testEndpoint, brokenConnections];

// ../core/dist/rules/docs-links.js
var BASE2 = "https://flowgenius.in/";
var DOCS_LINKS = {
  "error-handling/no-error-workflow": `${BASE2}n8n-silent-failures-no-logs/`,
  "error-handling/no-retry": `${BASE2}fallback-and-retry-strategies/`,
  "error-handling/swallowed-errors": `${BASE2}n8n-partial-failure-handling/`,
  "error-handling/unconnected-error-output": `${BASE2}error-handling-optimizations/`,
  "error-handling/silent-error-trigger": `${BASE2}n8n-error-node-catch-all-failure/`,
  "reliability/http-no-timeout": `${BASE2}n8n-http-request-node-timeout/`,
  "reliability/no-execution-timeout": `${BASE2}n8n-stuck-executions-detection/`,
  "reliability/endless-loop": `${BASE2}n8n-long-running-workflow-failures/`,
  "reliability/return-all": `${BASE2}memory-limit-error-n8n/`,
  "reliability/webhook-without-responder": `${BASE2}n8n-webhook-response-errors/`,
  "reliability/schedule-no-timezone": `${BASE2}cron-job-setup-error-n8n/`,
  "reliability/schedule-too-frequent": `${BASE2}n8n-execution-history-time-bomb/`,
  "security/hardcoded-secret": `${BASE2}n8n-secrets-management/`,
  "security/secret-in-url": `${BASE2}n8n-secrets-management/`,
  "security/webhook-no-auth": `${BASE2}insecure-webhook-exposure/`,
  "security/code-eval": `${BASE2}xss-vectors-in-custom-code/`,
  "security/command-injection": `${BASE2}n8n-security-errors-guide/`,
  "security/insecure-transport": `${BASE2}ssl-certificate-issues/`,
  "maintainability/default-node-names": `${BASE2}workflow-design-best-practices/`,
  "maintainability/disabled-nodes": `${BASE2}lifecycle-management-for-n8n-workflows/`,
  "maintainability/orphan-nodes": `${BASE2}workflow-design-best-practices/`,
  "maintainability/undocumented": `${BASE2}n8n-ownership-handoff-risks/`
};

// ../core/dist/rules/error-handling.js
function errorMode(node) {
  return node.onError ?? (node.continueOnFail ? "continueRegularOutput" : "stopWorkflow");
}
function externalCallNodes(graph) {
  return graph.active.filter((n) => !isTrigger(n) && !isInternalNode(n) && !isToolNode(n) && !graph.isAiSubNode(n.name));
}
var noErrorWorkflow = {
  id: "error-handling/no-error-workflow",
  category: "error-handling",
  severity: "high",
  title: "No error workflow",
  description: "When a production run fails and no error workflow is set, nobody is told. Set Workflow Settings > Error Workflow to a workflow that alerts you (Slack, email).",
  fixable: true,
  check(graph) {
    const triggers = graph.active.filter(isProductionTrigger);
    if (!triggers.length || graph.workflow.settings.errorWorkflow)
      return [];
    return [{ message: `Runs from "${triggers[0].name}" can fail silently: no error workflow is set.` }];
  }
};
var noRetry = {
  id: "error-handling/no-retry",
  category: "error-handling",
  severity: "medium",
  title: "Outside call without retry",
  description: "APIs fail briefly all the time (timeouts, rate limits, 502s). Without Retry On Fail, one blip fails the whole run. Turn on Settings > Retry On Fail (3 tries, 1-5 s apart).",
  fixable: true,
  check(graph) {
    return externalCallNodes(graph).filter((n) => !retries(n)).map((n) => ({ node: n.name, message: `"${n.name}" calls an outside service with no retry.` }));
  }
};
function retries(node) {
  return node.retryOnFail === true && (node.maxTries === void 0 || node.maxTries > 1);
}
var READS_ERROR = /\$json\s*(\.\s*error\b|\[\s*['"]error['"]\s*\])|\.json\.error\b|\berror\.message\b/;
var swallowedErrors = {
  id: "error-handling/swallowed-errors",
  category: "error-handling",
  severity: "high",
  title: "Errors swallowed",
  description: 'With "Continue" on error, a failed step passes its error on as normal data. If nothing after it checks for that error, the run reports success while the work never happened. Check for `$json.error` with an If node, or use "Continue (using error output)".',
  fixable: false,
  check(graph) {
    const candidates = graph.active.filter((n) => errorMode(n) === "continueRegularOutput" && !isTrigger(n) && !graph.isAiSubNode(n.name));
    if (!candidates.length)
      return [];
    const checkers = new Set(graph.active.filter((n) => READS_ERROR.test(JSON.stringify(n.parameters))).map((n) => n.name));
    const leadsToCheck = nodesThatReach(graph, [...checkers]);
    const checked = (n) => (
      // A node that reads $json.error itself is checking the step before it, not its own failure.
      // When it is a checker, walk its downstream directly so a loop back to itself doesn't count.
      checkers.has(n.name) ? graph.downstream(n.name).some((d) => checkers.has(d.name)) : graph.next(n.name).some((s) => leadsToCheck.has(s))
    );
    return candidates.filter((n) => !checked(n)).map((n) => ({
      node: n.name,
      message: `"${n.name}" continues after failing, and nothing downstream checks for the error.`
    }));
  }
};
function nodesThatReach(graph, targets) {
  const reached = new Set(targets);
  const queue = [...targets];
  while (queue.length) {
    for (const p of graph.prev(queue.pop())) {
      if (!reached.has(p)) {
        reached.add(p);
        queue.push(p);
      }
    }
  }
  return reached;
}
var unconnectedErrorOutput = {
  id: "error-handling/unconnected-error-output",
  category: "error-handling",
  severity: "high",
  title: "Error output not connected",
  description: 'The node is set to "Continue (using error output)" but nothing is connected to its error output, so failed items disappear without a trace. Connect the error output to an alert or a retry path.',
  fixable: false,
  check(graph) {
    return graph.active.filter((n) => errorMode(n) === "continueErrorOutput").filter((n) => {
      const slots = graph.outputSlots(n.name);
      const regular = regularOutputCount(n);
      if (regular !== null && slots <= regular + 1)
        return graph.outputTargets(n.name, regular).length === 0;
      return slots <= 1;
    }).map((n) => ({ node: n.name, message: `"${n.name}" sends failures to an error output that goes nowhere.` }));
  }
};
var silentErrorTrigger = {
  id: "error-handling/silent-error-trigger",
  category: "error-handling",
  severity: "high",
  title: "Error workflow that does nothing",
  description: "This is an error workflow (it starts with Error Trigger) but the trigger is not connected to anything, so failures it catches are never reported.",
  fixable: false,
  check(graph) {
    return graph.active.filter((n) => n.type === NODE.errorTrigger && graph.next(n.name).length === 0).map((n) => ({ node: n.name, message: `"${n.name}" catches failures but sends no alert.` }));
  }
};
var errorHandlingRules = [
  noErrorWorkflow,
  noRetry,
  swallowedErrors,
  unconnectedErrorOutput,
  silentErrorTrigger
];

// ../core/dist/rules/maintainability.js
var defaultNodeNames = {
  id: "maintainability/default-node-names",
  category: "maintainability",
  severity: "low",
  title: "Nodes still have default names",
  description: 'Names like "HTTP Request2" make error alerts and execution logs unreadable at 2 a.m. Name each node for what it does, for example "Create Stripe customer".',
  fixable: false,
  check(graph) {
    const names = graph.active.filter((n) => !isTrigger(n) && isDefaultName(n.name)).map((n) => n.name);
    if (!names.length)
      return [];
    return [{ message: `${names.length} node${names.length > 1 ? "s" : ""} still named by default: ${list(names)}.` }];
  }
};
var disabledNodes = {
  id: "maintainability/disabled-nodes",
  category: "maintainability",
  severity: "low",
  title: "Disabled node left in",
  description: "Disabled nodes are skipped, and data passes straight through them. Left in, they hide what the workflow really does and are easy to re-enable by mistake. Delete them, or note why they are kept.",
  fixable: true,
  check(graph) {
    return graph.workflow.nodes.filter((n) => n.disabled && !isStickyNote(n)).map((n) => ({ node: n.name, message: `"${n.name}" is disabled.` }));
  }
};
var orphanNodes = {
  id: "maintainability/orphan-nodes",
  category: "maintainability",
  severity: "low",
  title: "Node not connected to anything",
  description: "This node has no connections, so it never runs. Connect it or delete it.",
  fixable: true,
  check(graph) {
    if (!graph.workflow.nodes.some((n) => graph.isLinked(n.name)))
      return [];
    return graph.active.filter((n) => !isTrigger(n) && !graph.isLinked(n.name)).map((n) => ({ node: n.name, message: `"${n.name}" is not connected, so it never runs.` }));
  }
};
var DOCUMENT_ABOVE = 8;
var undocumented = {
  id: "maintainability/undocumented",
  category: "maintainability",
  severity: "low",
  title: "Large workflow with no notes",
  description: "Nobody, including you in six months, can tell what this workflow is for or why it is built this way. Add a sticky note with its purpose, trigger, and who to contact when it fails.",
  fixable: false,
  check(graph) {
    const nodes = graph.active.length;
    const hasNotes = graph.workflow.nodes.some((n) => isStickyNote(n) || (n.notes ?? "").trim() !== "");
    if (nodes < DOCUMENT_ABOVE || hasNotes)
      return [];
    return [{ message: `${nodes} nodes and no sticky notes or node notes explaining the workflow.` }];
  }
};
var maintainabilityRules = [defaultNodeNames, disabledNodes, orphanNodes, undocumented];

// ../core/dist/rules/reliability.js
var httpNoTimeout = {
  id: "reliability/http-no-timeout",
  category: "reliability",
  severity: "medium",
  title: "HTTP request without timeout",
  description: "Without its own timeout, a slow or hung server holds the run for as long as n8n's default allows. Set Options > Timeout, for example 30000 ms, so the step fails fast and the retry or error path takes over.",
  fixable: true,
  check(graph) {
    return graph.active.filter((n) => n.type === NODE.httpRequest && get(n.parameters, "options.timeout") === void 0).map((n) => ({ node: n.name, message: `"${n.name}" has no timeout set, so a slow server can stall the run.` }));
  }
};
var noExecutionTimeout = {
  id: "reliability/no-execution-timeout",
  category: "reliability",
  severity: "medium",
  title: "No execution timeout",
  description: "A stuck run holds a worker until someone notices. Set Workflow Settings > Timeout Workflow. (Your instance may set a default with EXECUTIONS_TIMEOUT; n8n's own default is no limit.)",
  fixable: true,
  check(graph) {
    if (!graph.active.some(isProductionTrigger))
      return [];
    const timeout = graph.workflow.settings.executionTimeout;
    if (typeof timeout === "number" && timeout > 0)
      return [];
    return [{ message: "No execution timeout is set, so a stuck run can hang indefinitely." }];
  }
};
var endlessLoop = {
  id: "reliability/endless-loop",
  category: "reliability",
  severity: "high",
  title: "Loop with no way out",
  description: "These nodes feed back into each other, and none of them can send items out of the loop: no Loop Over Items, If, Switch, Filter, Limit, classifier, or error output that leads elsewhere. The run repeats until it is killed or runs out of memory. Off by default: a loop can also end because a step returns no items (an empty page from an API), which the JSON alone can't show.",
  fixable: false,
  // Precision on sampled templates was too low to report by default (see study/precision/README.md).
  defaultEnabled: false,
  check(graph) {
    return graph.cycles().filter((cycle) => {
      const inLoop = new Set(cycle.map((n) => n.name));
      return !cycle.some((n) => canExitLoop(n) || routesOutOf(graph, n, inLoop) || canReturnNothing(n));
    }).map((cycle) => ({
      node: cycle[0].name,
      message: `Loop through ${list(cycle.map((n) => n.name))} has no exit condition.`
    }));
  }
};
function routesOutOf(graph, node, inLoop) {
  const slots = graph.workflow.connections[node.name]?.main ?? [];
  const errorOutput = errorMode(node) === "continueErrorOutput" ? 1 : 0;
  const possible = Math.max(slots.length, (regularOutputCount(node) ?? 1) + errorOutput);
  if (possible < 2)
    return false;
  for (let i = 0; i < possible; i++) {
    if (!(slots[i] ?? []).some((t) => inLoop.has(t.node)))
      return true;
  }
  return false;
}
var LISTING_OPERATIONS = /* @__PURE__ */ new Set(["getAll", "getMany", "search", "list", "read", "lookup", "get"]);
function canReturnNothing(node) {
  const op = node.parameters.operation;
  return typeof op === "string" && LISTING_OPERATIONS.has(op);
}
var SMALL_RESOURCES = /^(label|labels|tag|tags|attachment|attachments|messageAttachment)$/;
var FILTER_KEYS = /^(filters?|filterString|filterByFormula|conditions|queryString|query|where|search|searchQuery|q|timeMin|timeMax)$/;
function hasFilter(params) {
  const scopes = [params, params.filters, params.options, params.additionalFields].filter((s) => !!s && typeof s === "object");
  return scopes.some((scope) => Object.entries(scope).some(([key, value]) => FILTER_KEYS.test(key) && isMeaningful(value)));
}
function isMeaningful(value) {
  if (value === void 0 || value === null || value === "")
    return false;
  if (Array.isArray(value))
    return value.length > 0;
  if (typeof value === "object")
    return Object.values(value).some(isMeaningful);
  return true;
}
var returnAll = {
  id: "reliability/return-all",
  category: "reliability",
  severity: "low",
  title: "Fetches every record",
  description: '"Return All" loads every record into memory at once. Fine for small lists; on a large account it slows the run or crashes the worker. Use a limit, or page through results with Loop Over Items.',
  fixable: false,
  check(graph) {
    return graph.active.filter((n) => n.parameters.returnAll === true && !isToolNode(n) && !hasFilter(n.parameters)).filter((n) => !SMALL_RESOURCES.test(String(n.parameters.resource ?? ""))).map((n) => ({ node: n.name, message: `"${n.name}" loads every record at once.` }));
  }
};
var webhookNoResponder = {
  id: "reliability/webhook-without-responder",
  category: "reliability",
  severity: "critical",
  title: "Webhook waits for a reply that never comes",
  description: 'The webhook is set to respond "Using Respond to Webhook node", but the workflow has no active Respond to Webhook node. Every call fails. Add the node, or change the response mode.',
  fixable: false,
  check(graph) {
    const hasResponder = graph.active.some((n) => n.type === NODE.respondToWebhook);
    if (hasResponder)
      return [];
    return graph.active.filter((n) => n.type === NODE.webhook && n.parameters.responseMode === "responseNode").map((n) => ({ node: n.name, message: `"${n.name}" expects a Respond to Webhook node, and there is none.` }));
  }
};
function cronParts(expr) {
  if (typeof expr !== "string" || expr.startsWith("="))
    return null;
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6 ? parts : null;
}
function fromCron(expr) {
  const parts = cronParts(expr);
  if (!parts)
    return null;
  const hasSeconds = parts.length === 6;
  const hour = parts[hasSeconds ? 2 : 1];
  return {
    timeOfDay: hour !== "*" && !hour.startsWith("*/"),
    subMinute: hasSeconds && !/^\d+$/.test(parts[0])
  };
}
function schedules(node) {
  if (node.type === NODE.scheduleTrigger) {
    const intervals = get(node.parameters, "rule.interval");
    if (!Array.isArray(intervals))
      return [{ timeOfDay: true, subMinute: false }];
    return intervals.map((raw) => {
      const field = raw?.field ?? "days";
      if (field === "cronExpression")
        return fromCron(raw.expression) ?? { timeOfDay: false, subMinute: false };
      return { timeOfDay: field === "days" || field === "weeks" || field === "months", subMinute: field === "seconds" };
    });
  }
  if (node.type === NODE.cron) {
    const items = get(node.parameters, "triggerTimes.item");
    if (!Array.isArray(items))
      return [];
    return items.map((raw) => {
      const mode = raw?.mode ?? "everyDay";
      if (mode === "custom")
        return fromCron(raw.cronExpression) ?? { timeOfDay: false, subMinute: false };
      return { timeOfDay: mode === "everyDay" || mode === "everyWeek" || mode === "everyMonth", subMinute: false };
    });
  }
  return [];
}
function scheduledNodes(graph) {
  return graph.active.filter((n) => n.type === NODE.scheduleTrigger || n.type === NODE.cron);
}
var scheduleNoTimezone = {
  id: "reliability/schedule-no-timezone",
  category: "reliability",
  severity: "medium",
  title: "Scheduled time without a timezone",
  description: "This schedule runs at a set time of day, but the workflow has no timezone, so it uses the server's default (often UTC). Reports and reminders then fire hours early or late, and shift with daylight saving. Set Workflow Settings > Timezone.",
  fixable: true,
  check(graph) {
    const timezone = graph.workflow.settings.timezone;
    if (typeof timezone === "string" && timezone.trim() !== "" && timezone !== "DEFAULT")
      return [];
    return scheduledNodes(graph).filter((n) => schedules(n).some((s) => s.timeOfDay)).map((n) => ({ node: n.name, message: `"${n.name}" runs at a time of day, but no timezone is set.` }));
  }
};
var scheduleTooFrequent = {
  id: "reliability/schedule-too-frequent",
  category: "reliability",
  severity: "medium",
  title: "Runs more than once a minute",
  description: "Every run is stored as an execution and usually calls an API. Running every few seconds fills the database and hits rate limits. Use a webhook or app trigger instead, or run at most once a minute.",
  fixable: false,
  check(graph) {
    return scheduledNodes(graph).filter((n) => schedules(n).some((s) => s.subMinute)).map((n) => ({ node: n.name, message: `"${n.name}" fires more than once a minute.` }));
  }
};
var reliabilityRules = [
  httpNoTimeout,
  noExecutionTimeout,
  endlessLoop,
  returnAll,
  webhookNoResponder,
  scheduleNoTimezone,
  scheduleTooFrequent
];

// ../core/dist/rules/security.js
var BASE3 = "n8n-nodes-base.";
var LANGCHAIN2 = "@n8n/n8n-nodes-langchain.";
var SECRET_FORMATS = [
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
  { name: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ }
];
var SENSITIVE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "apikey",
  "api_key",
  "x-auth-token",
  "x-access-token",
  "x-token",
  "token",
  "private-token",
  "xi-api-key",
  "x-goog-api-key",
  "x-apikey",
  "access-token",
  "secret"
]);
var SENSITIVE_QUERY = /* @__PURE__ */ new Set([
  "api_key",
  "apikey",
  "api-key",
  "key",
  "token",
  "access_token",
  "accesstoken",
  "auth",
  "secret",
  "client_secret",
  "password",
  "pass",
  "pwd"
]);
function mask(secret) {
  const shown = Math.min(4, Math.floor(secret.length / 6));
  return `${secret.slice(0, shown)}\u2026(${secret.length} chars)`;
}
function secretFormat(value) {
  for (const { name, pattern } of SECRET_FORMATS) {
    const m = pattern.exec(value);
    if (!m || isPlaceholder(m[0]))
      continue;
    if (name === "JSON Web Token" && isPublicJwt(m[0]))
      continue;
    return { name, match: m[0] };
  }
  return null;
}
function isPublicJwt(token) {
  const payload = token.split(".")[1];
  if (!payload)
    return false;
  const json = decodeBase64(payload);
  if (json === null)
    return false;
  try {
    return JSON.parse(json).role === "anon";
  } catch {
    return false;
  }
}
function literalSecret(value) {
  if (typeof value !== "string" || !isLiteral(value))
    return null;
  const v = value.replace(/^=/, "").replace(/^(Bearer|Basic|Token)\s+/i, "").trim();
  const looksRandom = /\d/.test(v) && /[A-Za-z]/.test(v);
  return v.length >= 12 && looksRandom && !/\s/.test(v) && !isPlaceholder(v) ? v : null;
}
function scannable(graph) {
  return graph.workflow.nodes.filter((n) => !isStickyNote(n));
}
var hardcodedSecret = {
  id: "security/hardcoded-secret",
  category: "security",
  severity: "critical",
  title: "Secret written into the workflow",
  description: "Anyone who sees this workflow (an export, a shared template, a screenshot, version control) gets this key. Move it into an n8n credential, then rotate the key, since it has already been exposed.",
  fixable: false,
  check(graph) {
    const hits = [];
    for (const node of scannable(graph)) {
      const seen = /* @__PURE__ */ new Set();
      for (const { value, path } of walkStrings(node.parameters)) {
        const found = secretFormat(value);
        if (found && !seen.has(found.match)) {
          seen.add(found.match);
          hits.push({ node: node.name, path, message: `"${node.name}" contains a ${found.name} (${mask(found.match)}).` });
        }
      }
      for (const header of namedPairs(node.parameters.headerParameters)) {
        if (!SENSITIVE_HEADERS.has(header.name.trim().toLowerCase()))
          continue;
        const secret = literalSecret(header.value);
        if (secret && isPublicJwt(secret))
          continue;
        if (secret && !seen.has(secret) && ![...seen].some((s) => secret.includes(s))) {
          seen.add(secret);
          hits.push({
            node: node.name,
            path: `headerParameters.parameters[${header.index}].value`,
            message: `"${node.name}" sends a fixed "${header.name}" header (${mask(secret)}).`
          });
        }
      }
    }
    return hits;
  }
};
var secretInUrl = {
  id: "security/secret-in-url",
  category: "security",
  severity: "high",
  title: "Secret in a URL",
  description: "URLs end up in server logs, proxies and n8n's execution history. Send the key in a header through an n8n credential instead, and rotate it.",
  fixable: false,
  check(graph) {
    const hits = [];
    for (const node of scannable(graph)) {
      const url = node.parameters.url;
      if (typeof url === "string") {
        for (const m of url.matchAll(/[?&]([A-Za-z_-]+)=([^&#\s{}]+)/g)) {
          const name = m[1].toLowerCase();
          const secret = literalSecret(decodeURIComponentSafe(m[2]));
          if (SENSITIVE_QUERY.has(name) && secret && !secretFormat(secret)) {
            hits.push({ node: node.name, path: "url", message: `"${node.name}" puts "${m[1]}" in the URL (${mask(secret)}).` });
          }
        }
      }
      for (const q of namedPairs(node.parameters.queryParameters)) {
        if (!SENSITIVE_QUERY.has(q.name.trim().toLowerCase()))
          continue;
        const secret = literalSecret(q.value);
        if (secret && !secretFormat(secret)) {
          hits.push({
            node: node.name,
            path: `queryParameters.parameters[${q.index}].value`,
            message: `"${node.name}" sends "${q.name}" as a URL parameter (${mask(secret)}).`
          });
        }
      }
    }
    return hits;
  }
};
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
var OAUTH_CALLBACK = /oauth|auth[\s_-]?(?:code|callback)/i;
function checksHeadersEarly(graph, webhook) {
  const first = graph.next(webhook);
  const second = first.flatMap((n) => graph.next(n));
  return [...first, ...second].some((name) => {
    const node = graph.byName.get(name);
    return node !== void 0 && /\.headers\b|\["headers"\]|\['headers'\]/.test(JSON.stringify(node.parameters));
  });
}
var webhookNoAuth = {
  id: "security/webhook-no-auth",
  category: "security",
  severity: "high",
  title: "Webhook anyone can call",
  description: "Anyone who finds or guesses this URL can start the workflow, with any data. Set Authentication (Header Auth or Basic Auth), or check a signature or shared secret in the first step.",
  fixable: false,
  check(graph) {
    return graph.active.filter((n) => n.type === NODE.webhook).filter((n) => n.parameters.authentication === void 0 || n.parameters.authentication === "none").filter((n) => !OAUTH_CALLBACK.test(`${n.name} ${String(n.parameters.path ?? "")}`)).filter((n) => !checksHeadersEarly(graph, n.name)).map((n) => ({ node: n.name, message: `"${n.name}" accepts calls from anyone.` }));
  }
};
var DANGEROUS_JS = /\beval\s*\(|\bnew\s+Function\s*\(|\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/;
var DANGEROUS_PY = /\b(?:eval|exec)\s*\(|\bos\.system\s*\(|\bsubprocess\./;
var CODE_NODES = /* @__PURE__ */ new Set([NODE.code, NODE.function, NODE.functionItem, `${LANGCHAIN2}code`, `${LANGCHAIN2}toolCode`]);
function codeSources(node) {
  if (node.type === `${LANGCHAIN2}code` || node.type === `${LANGCHAIN2}toolCode`) {
    const python = node.parameters.language === "python";
    return walkStrings(node.parameters).filter((s) => /code$/i.test(s.path.split(".").pop() ?? "")).map((s) => ({ code: s.value, path: s.path, python: python || s.path.endsWith("pythonCode") }));
  }
  return ["jsCode", "pythonCode", "functionCode"].filter((field) => typeof node.parameters[field] === "string").map((field) => ({ code: node.parameters[field], path: field, python: field === "pythonCode" }));
}
var codeEval = {
  id: "security/code-eval",
  category: "security",
  severity: "high",
  title: "Code runs text as code",
  description: "eval, new Function, exec, child_process or a shell call turns text into code. If any of that text comes from input (a webhook, an email, an AI reply), an attacker can run their own code on your n8n server.",
  fixable: false,
  check(graph) {
    const hits = [];
    for (const node of graph.active) {
      if (!CODE_NODES.has(node.type))
        continue;
      for (const { code, path, python } of codeSources(node)) {
        const m = (python ? DANGEROUS_PY : DANGEROUS_JS).exec(code);
        if (m)
          hits.push({ node: node.name, path, message: `"${node.name}" uses ${describeCall(m[0])}.` });
      }
    }
    return hits;
  }
};
function describeCall(match) {
  if (/child_process/.test(match))
    return "child_process";
  return match.replace(/\s*\($/, "").replace(/\s+/g, " ");
}
function insertsItemData(expression, graph) {
  for (const m of expression.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const code = m[1];
    if (/\$json|\$input|\$items?\b|\$binary|\$fromAI/.test(code))
      return true;
    for (const ref of code.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)|\$node\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
      const name = ref[1] ?? ref[2];
      if (!graph || !isFixedConfiguration(graph.byName.get(name)))
        return true;
    }
    if (/\$\(|\$node\b/.test(code) && !/\$\(\s*['"]|\$node\s*\[\s*['"]/.test(code))
      return true;
  }
  return false;
}
function isFixedConfiguration(node) {
  if (!node || node.type !== `${BASE3}set`)
    return false;
  const values = walkStrings(node.parameters);
  return values.length > 0 && values.every((v) => !isExpression(v.value));
}
var commandInjection = {
  id: "security/command-injection",
  category: "security",
  severity: "critical",
  title: "Shell command built from data",
  description: "The command contains {{ expressions }}, so data from earlier steps becomes part of a shell command. A value like `; rm -rf /` runs on the server. Validate input strictly, or avoid the shell.",
  fixable: false,
  check(graph) {
    return graph.active.filter((n) => n.type === NODE.executeCommand || n.type === NODE.ssh).filter((n) => isExpression(n.parameters.command) && insertsItemData(n.parameters.command, graph)).map((n) => ({ node: n.name, path: "command", message: `"${n.name}" builds a shell command from workflow data.` }));
  }
};
var PUBLIC_TLDS = /* @__PURE__ */ new Set([
  "com",
  "net",
  "org",
  "io",
  "ai",
  "dev",
  "app",
  "co",
  "me",
  "info",
  "biz",
  "xyz",
  "cloud",
  "tech",
  "online",
  "site",
  "pro",
  "edu",
  "gov",
  "mil",
  "int",
  "store",
  "shop",
  "live",
  "news",
  "media",
  "digital",
  "agency",
  "solutions",
  "services",
  "systems",
  "software",
  "network",
  "email",
  "page",
  "run",
  "sh",
  "so",
  "gg",
  "tv",
  "fm",
  "ly",
  "to"
]);
function isPrivateHost(host) {
  if (!host.includes("."))
    return true;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0+\.)/.test(host))
    return true;
  if (/^\d+(\.\d+){3}$/.test(host))
    return false;
  if (/\.(local|internal|lan|home|localhost|svc|cluster\.local)$/.test(host) || host === "host.docker.internal")
    return true;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return !(tld.length === 2 || PUBLIC_TLDS.has(tld));
}
function isPlaceholderHost(host) {
  return /^[x.]+$/i.test(host) || /your|placeholder/i.test(host) || /(^|\.)example\.(com|org|net)$/.test(host);
}
var insecureTransport = {
  id: "security/insecure-transport",
  category: "security",
  severity: "medium",
  title: "Unencrypted or unverified connection",
  description: "Plain http:// to a public server, or skipping certificate checks, lets anyone on the network path read or change the data, including credentials. Use https:// and keep certificate checks on.",
  fixable: false,
  check(graph) {
    const hits = [];
    for (const node of graph.active.filter((n) => n.type === NODE.httpRequest)) {
      const url = typeof node.parameters.url === "string" ? node.parameters.url : "";
      const m = /^=?\s*(https?):\/\/([^/:?#\s{}]+)(.?)/i.exec(url);
      const scheme = m?.[1].toLowerCase();
      const host = m?.[2].toLowerCase();
      const hostIsFixed = m !== null && m[3] !== "{";
      if (scheme === "http" && hostIsFixed && !isPrivateHost(host) && !isPlaceholderHost(host)) {
        hits.push({ node: node.name, path: "url", message: `"${node.name}" sends data unencrypted to ${m[2]}.` });
      }
      if (scheme !== "http" && get(node.parameters, "options.allowUnauthorizedCerts") === true) {
        hits.push({
          node: node.name,
          path: "options.allowUnauthorizedCerts",
          message: `"${node.name}" skips SSL certificate checks.`
        });
      }
    }
    return hits;
  }
};
var securityRules = [
  hardcodedSecret,
  secretInUrl,
  webhookNoAuth,
  codeEval,
  commandInjection,
  insecureTransport
];

// ../core/dist/rules/index.js
var rules = [
  ...errorHandlingRules,
  ...reliabilityRules,
  ...securityRules,
  ...dataRules,
  ...maintainabilityRules
].map((rule) => {
  const docsUrl = DOCS_LINKS[rule.id];
  return docsUrl ? { ...rule, docsUrl } : rule;
});

// ../core/dist/score.js
var SEVERITY_POINTS = { critical: 30, high: 15, medium: 5, low: 1 };
function scoreFindings(findings) {
  const byRule = /* @__PURE__ */ new Map();
  for (const f of findings)
    byRule.set(f.ruleId, [...byRule.get(f.ruleId) ?? [], f]);
  let penalty = 0;
  for (const hits of byRule.values()) {
    const points = SEVERITY_POINTS[hits[0].severity];
    penalty += Math.min(points + (hits.length - 1) * (points / 2), points * 2);
  }
  const score = Math.max(0, Math.round(100 - penalty));
  const grade = score >= 90 ? "ready" : score >= 70 ? "needs-work" : "not-ready";
  return { score, grade };
}

// ../core/dist/engine.js
var SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
function analyze(input2, options = {}) {
  const parsed = parseWorkflow(input2);
  if (!parsed.ok)
    return { ok: false, parseIssues: parsed.issues };
  const disabled = new Set(options.disable ?? []);
  const enabled = new Set(options.enable ?? []);
  const graph = buildGraph(parsed.workflow, parsed.issues);
  const findings = [];
  const ruleErrors = [];
  for (const rule of options.rules ?? rules) {
    if (disabled.has(rule.id))
      continue;
    if (rule.defaultEnabled === false && !enabled.has(rule.id))
      continue;
    try {
      for (const hit of rule.check(graph)) {
        const finding = {
          ruleId: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: hit.message
        };
        if (hit.node !== void 0)
          finding.node = hit.node;
        if (hit.path !== void 0)
          finding.path = hit.path;
        findings.push(finding);
      }
    } catch (err) {
      ruleErrors.push({ ruleId: rule.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
  return {
    ok: true,
    workflow: parsed.workflow,
    findings,
    ...scoreFindings(findings),
    parseIssues: parsed.issues,
    ruleErrors
  };
}

// ../cli/dist/check.js
import { readFileSync } from "node:fs";
var SEVERITIES = ["critical", "high", "medium", "low"];
function checkFiles(targets, options) {
  const out = { results: [], skipped: [], errors: [] };
  for (const target of targets) {
    let text;
    try {
      text = readFileSync(target.path, "utf8");
    } catch (err) {
      out.errors.push({ file: target.display, reason: `could not read: ${err.message}` });
      continue;
    }
    const result = analyze(text, options);
    if (!result.ok) {
      const reason = result.parseIssues[0]?.message ?? "not an n8n workflow";
      (target.explicit ? out.errors : out.skipped).push({ file: target.display, reason });
      continue;
    }
    for (const e of result.ruleErrors) {
      out.errors.push({ file: target.display, reason: `rule ${e.ruleId} crashed: ${e.message}` });
    }
    out.results.push({
      file: target.display,
      score: result.score,
      grade: result.grade,
      findings: result.findings.map((f) => ({ ...f, line: lineOf(text, f.node) })),
      nodes: result.workflow.nodes.length
    });
  }
  return out;
}
function lineOf(text, node) {
  if (!node)
    return 1;
  const needle = JSON.stringify(node);
  const re = new RegExp(`"name"\\s*:\\s*${escapeRegExp(needle)}`);
  const m = re.exec(text);
  if (!m)
    return 1;
  let line = 1;
  for (let i = 0; i < m.index; i++)
    if (text.charCodeAt(i) === 10)
      line++;
  return line;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function shouldFail(check, failOn) {
  if (check.errors.length)
    return true;
  if (failOn === "none")
    return false;
  const limit = SEVERITIES.indexOf(failOn);
  return check.results.some((r) => r.findings.some((f) => SEVERITIES.indexOf(f.severity) <= limit));
}

// ../cli/dist/discover.js
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
function discover(paths, cwd) {
  const targets = /* @__PURE__ */ new Map();
  const add = (path, explicit) => {
    if (!targets.has(path))
      targets.set(path, { path, display: toDisplay(path, cwd), explicit });
  };
  for (const input2 of paths) {
    const absolute = resolve(cwd, input2);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      throw new Error(`No such file or folder: ${input2}`);
    }
    if (stat.isDirectory())
      for (const file of walk(absolute))
        add(file, false);
    else
      add(absolute, true);
  }
  return [...targets.values()].sort((a, b) => a.display.localeCompare(b.display));
}
function walk(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
          stack.push(join(current, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files;
}
function toDisplay(path, cwd) {
  const rel = relative(cwd, path);
  return (rel && !rel.startsWith("..") ? rel : path).split(sep).join("/");
}

// ../cli/dist/format.js
var VERSION = "0.0.0";
var LABEL = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
var COLOR = { critical: "\x1B[1;31m", high: "\x1B[31m", medium: "\x1B[33m", low: "\x1B[2m" };
var GRADE_TEXT = { ready: "ready", "needs-work": "needs work", "not-ready": "not ready" };
function formatText(check, opts) {
  const c = (code, s) => opts.color ? `${code}${s}\x1B[0m` : s;
  const docs = new Map(rules.map((r) => [r.id, r.docsUrl]));
  const lines = [];
  for (const r of check.results) {
    lines.push(`${c("\x1B[1m", r.file)}  score ${r.score}/100 (${GRADE_TEXT[r.grade]}), ${r.nodes} nodes`);
    for (const f of r.findings) {
      lines.push(`  ${c(COLOR[f.severity], LABEL[f.severity].padEnd(8))} ${r.file}:${f.line}  ${f.message}`);
      lines.push(`  ${" ".repeat(8)} ${c("\x1B[2m", f.ruleId + (docs.get(f.ruleId) ? `  ${docs.get(f.ruleId)}` : ""))}`);
    }
    if (!r.findings.length)
      lines.push(`  ${c("\x1B[32m", "no problems found")}`);
    lines.push("");
  }
  for (const e of check.errors)
    lines.push(`${c("\x1B[31m", "error")} ${e.file}: ${e.reason}`);
  for (const s of check.skipped.filter((s2) => s2.reason.startsWith("Not valid JSON"))) {
    lines.push(`${c("\x1B[33m", "warning")} ${s.file}: skipped, ${s.reason}`);
  }
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of check.results)
    for (const f of r.findings)
      counts[f.severity]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const files = check.results.length;
  lines.push(`${files} workflow${files === 1 ? "" : "s"} checked, ${total} finding${total === 1 ? "" : "s"}` + (total ? ` (${Object.keys(counts).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(", ")})` : "") + (check.skipped.length ? `, ${check.skipped.length} non-workflow JSON file${check.skipped.length === 1 ? "" : "s"} skipped` : ""));
  return `${lines.join("\n")}
`;
}
var SARIF_LEVEL = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note"
};
var SECURITY_SEVERITY = { critical: "9.0", high: "7.0", medium: "5.0", low: "2.0" };
function formatSarif(check) {
  const index = new Map(rules.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "n8n-preflight",
            version: VERSION,
            informationUri: "https://github.com/harishakshay/flowgenius-n8n-tool",
            rules: rules.map((r) => ({
              id: r.id,
              name: r.id.replace(/[/-](\w)/g, (_, ch) => ch.toUpperCase()),
              shortDescription: { text: r.title },
              fullDescription: { text: r.description },
              ...r.docsUrl ? { helpUri: r.docsUrl } : {},
              help: { text: r.description },
              defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
              properties: {
                tags: [r.category, ...r.category === "security" ? ["security"] : []],
                ...r.category === "security" ? { "security-severity": SECURITY_SEVERITY[r.severity] } : {}
              }
            }))
          }
        },
        results: check.results.flatMap((r) => r.findings.map((f) => ({
          ruleId: f.ruleId,
          ruleIndex: index.get(f.ruleId),
          level: SARIF_LEVEL[f.severity],
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.file },
                region: { startLine: f.line }
              }
            }
          ],
          // Stable across edits elsewhere in the file, so GitHub keeps tracking the same alert.
          partialFingerprints: { "n8nPreflightFinding/v1": `${f.ruleId}:${f.node ?? "<workflow>"}:${f.path ?? ""}` }
        })))
      }
    ]
  };
  return `${JSON.stringify(sarif, null, 2)}
`;
}

// src/github.ts
import { appendFileSync } from "node:fs";
function input(name, env = process.env) {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function setOutput(name, value, env = process.env) {
  const file = env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${String(value)}
`);
}
function appendSummary(markdown, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown);
}
function escapeData(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
function annotation(level, message, props) {
  const p = `file=${escapeProperty(props.file)},line=${props.line},title=${escapeProperty(props.title)}`;
  return `::${level} ${p}::${escapeData(message)}
`;
}

// src/main.ts
var LEVEL = { critical: "error", high: "error", medium: "warning", low: "notice" };
var SEVERITIES2 = ["critical", "high", "medium", "low"];
function main(env = process.env, write = (s) => void process.stdout.write(s)) {
  const cwd = env.GITHUB_WORKSPACE ?? process.cwd();
  const paths = input("path", env).split(/[\s]+/).filter(Boolean);
  const failOn = input("fail-on", env) || "high";
  const list2 = (name) => input(name, env).split(",").map((s) => s.trim()).filter(Boolean);
  const disable = list2("disable");
  const enable = list2("enable");
  const sarifFile = input("sarif-file", env);
  const annotate = input("annotations", env) !== "false";
  if (failOn !== "none" && !SEVERITIES2.includes(failOn)) {
    write(`::error::Unknown fail-on "${failOn}". Use critical, high, medium, low or none.
`);
    return 2;
  }
  const known = new Set(rules.map((r) => r.id));
  const unknown = [...disable, ...enable].filter((id) => !known.has(id));
  if (unknown.length) {
    write(`::error::Unknown rule: ${unknown.join(", ")}
`);
    return 2;
  }
  let check;
  try {
    check = checkFiles(discover(paths.length ? paths : ["."], cwd), { disable, enable });
  } catch (err) {
    write(`::error::${err.message}
`);
    return 2;
  }
  write(formatText(check, { color: true }));
  if (annotate) {
    const all = check.results.flatMap((r) => r.findings.map((f) => ({ ...f, file: r.file })));
    all.sort((a, b) => SEVERITIES2.indexOf(a.severity) - SEVERITIES2.indexOf(b.severity));
    for (const f of all) {
      write(annotation(LEVEL[f.severity], f.message, { file: f.file, line: f.line, title: `n8n Preflight: ${f.ruleId}` }));
    }
  }
  for (const e of check.errors) write(annotation("error", e.reason, { file: e.file, line: 1, title: "n8n Preflight" }));
  if (sarifFile) writeFileSync(resolve2(cwd, sarifFile), formatSarif(check));
  appendSummary(summary(check, failOn), env);
  const findings = check.results.reduce((n, r) => n + r.findings.length, 0);
  setOutput("workflows", check.results.length, env);
  setOutput("findings", findings, env);
  setOutput("lowest-score", check.results.length ? Math.min(...check.results.map((r) => r.score)) : 100, env);
  setOutput("sarif-file", sarifFile, env);
  return shouldFail(check, failOn) ? 1 : 0;
}
function summary(check, failOn) {
  const icon = { ready: "\u2705", "needs-work": "\u26A0\uFE0F", "not-ready": "\u274C" };
  const lines = ["## n8n Preflight", ""];
  if (!check.results.length) {
    lines.push("No n8n workflow files found.", "");
    return lines.join("\n");
  }
  lines.push("| Workflow | Score | Critical | High | Medium | Low |", "|---|---|---|---|---|---|");
  for (const r of [...check.results].sort((a, b) => a.score - b.score)) {
    const n = (s) => r.findings.filter((f) => f.severity === s).length;
    lines.push(`| \`${r.file}\` | ${icon[r.grade]} ${r.score} | ${n("critical")} | ${n("high")} | ${n("medium")} | ${n("low")} |`);
  }
  const serious = check.results.flatMap(
    (r) => r.findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => ({ ...f, file: r.file }))
  );
  if (serious.length) {
    lines.push("", "### Critical and high findings", "");
    for (const f of serious.slice(0, 30)) lines.push(`- **${f.severity}** \`${f.file}:${f.line}\` ${f.message} (\`${f.ruleId}\`)`);
    if (serious.length > 30) lines.push(`- ...and ${serious.length - 30} more`);
  }
  lines.push("", `Fails on: \`${failOn}\`. Rules and fixes: https://github.com/harishakshay/flowgenius-n8n-tool/blob/main/docs/RULES.md`, "");
  return lines.join("\n");
}
if (process.env.GITHUB_ACTIONS === "true" && process.argv[1]?.endsWith("index.js")) {
  process.exitCode = main();
}
export {
  main,
  summary
};
