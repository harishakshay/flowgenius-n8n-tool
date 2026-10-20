import type { WorkflowGraph } from "../graph.js";
import { NODE, canExitLoop, isProductionTrigger, isToolNode, regularOutputCount } from "../node-types.js";
import { errorMode } from "./error-handling.js";
import type { Rule } from "../rule.js";
import type { WorkflowNode } from "../types.js";
import { get } from "../values.js";

const httpNoTimeout: Rule = {
  id: "reliability/http-no-timeout",
  category: "reliability",
  severity: "medium",
  title: "HTTP request without timeout",
  description:
    "Without its own timeout, a slow or hung server holds the run for as long as n8n's default allows. Set Options > Timeout, for example 30000 ms, so the step fails fast and the retry or error path takes over.",
  fixable: true,
  check(graph) {
    return graph.active
      .filter((n) => n.type === NODE.httpRequest && get(n.parameters, "options.timeout") === undefined)
      .map((n) => ({ node: n.name, message: `"${n.name}" has no timeout set, so a slow server can stall the run.` }));
  },
};

const noExecutionTimeout: Rule = {
  id: "reliability/no-execution-timeout",
  category: "reliability",
  severity: "medium",
  title: "No execution timeout",
  description:
    "A stuck run holds a worker until someone notices. Set Workflow Settings > Timeout Workflow. (Your instance may set a default with EXECUTIONS_TIMEOUT; n8n's own default is no limit.)",
  fixable: true,
  check(graph) {
    if (!graph.active.some(isProductionTrigger)) return [];
    const timeout = graph.workflow.settings.executionTimeout;
    if (typeof timeout === "number" && timeout > 0) return [];
    return [{ message: "No execution timeout is set, so a stuck run can hang indefinitely." }];
  },
};

const endlessLoop: Rule = {
  id: "reliability/endless-loop",
  category: "reliability",
  severity: "high",
  title: "Loop with no way out",
  description:
    "These nodes feed back into each other, and none of them can send items out of the loop: no Loop Over Items, If, Switch, Filter, Limit, classifier, or error output that leads elsewhere. The run repeats until it is killed or runs out of memory.",
  fixable: false,
  check(graph) {
    return graph
      .cycles()
      .filter((cycle) => !cycle.some((n) => canExitLoop(n) || routesOutOf(graph, n, cycle) || canReturnNothing(n)))
      .map((cycle) => ({
        node: cycle[0]!.name,
        message: `Loop through ${cycle.map((n) => `"${n.name}"`).join(", ")} has no exit condition.`,
      }));
  },
};

/**
 * True when the node chooses between outputs (a router, a classifier, or success vs error output)
 * and at least one of those outputs does not lead back into the loop, even if it leads nowhere
 * (items that reach an unconnected output simply stop). Fan-out from a single output does not
 * count: items then go both ways, and the loop still runs.
 */
function routesOutOf(graph: WorkflowGraph, node: WorkflowNode, cycle: WorkflowNode[]): boolean {
  const inLoop = new Set(cycle.map((n) => n.name));
  const slots = graph.workflow.connections[node.name]?.main ?? [];
  const errorOutput = errorMode(node) === "continueErrorOutput" ? 1 : 0;
  const possible = Math.max(slots.length, (regularOutputCount(node) ?? 1) + errorOutput);
  if (possible < 2) return false;
  for (let i = 0; i < possible; i++) {
    if (!(slots[i] ?? []).some((t) => inLoop.has(t.node))) return true;
  }
  return false;
}

/** Reads that return no items when there is nothing left, which stops the loop. */
const LISTING_OPERATIONS = new Set(["getAll", "getMany", "search", "list", "read", "lookup", "get"]);

function canReturnNothing(node: WorkflowNode): boolean {
  const op = node.parameters.operation;
  return typeof op === "string" && LISTING_OPERATIONS.has(op);
}

/** Lists that stay small however big the account is: labels, tags, one message's attachments. */
const SMALL_RESOURCES = /^(label|labels|tag|tags|attachment|attachments|messageAttachment)$/;

/** Parameters that narrow a "get all" query to matching records. */
const FILTER_KEYS = /^(filters?|filterString|filterByFormula|conditions|queryString|query|where|search|searchQuery|q|timeMin|timeMax)$/;

function hasFilter(params: Record<string, unknown>): boolean {
  const scopes = [params, params.filters, params.options, params.additionalFields].filter(
    (s): s is Record<string, unknown> => !!s && typeof s === "object",
  );
  return scopes.some((scope) =>
    Object.entries(scope).some(([key, value]) => FILTER_KEYS.test(key) && isMeaningful(value)),
  );
}

function isMeaningful(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(isMeaningful);
  return true;
}

const returnAll: Rule = {
  id: "reliability/return-all",
  category: "reliability",
  severity: "low",
  title: "Fetches every record",
  description:
    '"Return All" loads every record into memory at once. Fine for small lists; on a large account it slows the run or crashes the worker. Use a limit, or page through results with Loop Over Items.',
  fixable: false,
  check(graph) {
    return graph.active
      .filter((n) => n.parameters.returnAll === true && !isToolNode(n) && !hasFilter(n.parameters))
      .filter((n) => !SMALL_RESOURCES.test(String(n.parameters.resource ?? "")))
      .map((n) => ({ node: n.name, message: `"${n.name}" loads every record at once.` }));
  },
};

const webhookNoResponder: Rule = {
  id: "reliability/webhook-without-responder",
  category: "reliability",
  severity: "critical",
  title: "Webhook waits for a reply that never comes",
  description:
    'The webhook is set to respond "Using Respond to Webhook node", but the workflow has no active Respond to Webhook node. Every call fails. Add the node, or change the response mode.',
  fixable: false,
  check(graph) {
    const hasResponder = graph.active.some((n) => n.type === NODE.respondToWebhook);
    if (hasResponder) return [];
    return graph.active
      .filter((n) => n.type === NODE.webhook && n.parameters.responseMode === "responseNode")
      .map((n) => ({ node: n.name, message: `"${n.name}" expects a Respond to Webhook node, and there is none.` }));
  },
};

interface Schedule {
  /** Runs at a time of day, so the timezone changes when it fires. */
  timeOfDay: boolean;
  /** Fires more than once a minute. */
  subMinute: boolean;
}

/** Splits a cron expression; returns null for expressions we should not guess about. */
function cronParts(expr: unknown): string[] | null {
  if (typeof expr !== "string" || expr.startsWith("=")) return null;
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6 ? parts : null;
}

function fromCron(expr: unknown): Schedule | null {
  const parts = cronParts(expr);
  if (!parts) return null;
  const hasSeconds = parts.length === 6;
  const hour = parts[hasSeconds ? 2 : 1]!;
  return {
    timeOfDay: hour !== "*" && !hour.startsWith("*/"),
    subMinute: hasSeconds && !/^\d+$/.test(parts[0]!),
  };
}

export function schedules(node: WorkflowNode): Schedule[] {
  if (node.type === NODE.scheduleTrigger) {
    const intervals = get(node.parameters, "rule.interval");
    if (!Array.isArray(intervals)) return [{ timeOfDay: true, subMinute: false }]; // default: every day at midnight
    return intervals.map((raw: Record<string, unknown>) => {
      const field = raw?.field ?? "days";
      if (field === "cronExpression") return fromCron(raw.expression) ?? { timeOfDay: false, subMinute: false };
      return { timeOfDay: field === "days" || field === "weeks" || field === "months", subMinute: field === "seconds" };
    });
  }
  if (node.type === NODE.cron) {
    const items = get(node.parameters, "triggerTimes.item");
    if (!Array.isArray(items)) return [];
    return items.map((raw: Record<string, unknown>) => {
      const mode = raw?.mode ?? "everyDay";
      if (mode === "custom") return fromCron(raw.cronExpression) ?? { timeOfDay: false, subMinute: false };
      return { timeOfDay: mode === "everyDay" || mode === "everyWeek" || mode === "everyMonth", subMinute: false };
    });
  }
  return [];
}

function scheduledNodes(graph: WorkflowGraph): WorkflowNode[] {
  return graph.active.filter((n) => n.type === NODE.scheduleTrigger || n.type === NODE.cron);
}

const scheduleNoTimezone: Rule = {
  id: "reliability/schedule-no-timezone",
  category: "reliability",
  severity: "medium",
  title: "Scheduled time without a timezone",
  description:
    "This schedule runs at a set time of day, but the workflow has no timezone, so it uses the server's default (often UTC). Reports and reminders then fire hours early or late, and shift with daylight saving. Set Workflow Settings > Timezone.",
  fixable: true,
  check(graph) {
    if (graph.workflow.settings.timezone) return [];
    return scheduledNodes(graph)
      .filter((n) => schedules(n).some((s) => s.timeOfDay))
      .map((n) => ({ node: n.name, message: `"${n.name}" runs at a time of day, but no timezone is set.` }));
  },
};

const scheduleTooFrequent: Rule = {
  id: "reliability/schedule-too-frequent",
  category: "reliability",
  severity: "medium",
  title: "Runs more than once a minute",
  description:
    "Every run is stored as an execution and usually calls an API. Running every few seconds fills the database and hits rate limits. Use a webhook or app trigger instead, or run at most once a minute.",
  fixable: false,
  check(graph) {
    return scheduledNodes(graph)
      .filter((n) => schedules(n).some((s) => s.subMinute))
      .map((n) => ({ node: n.name, message: `"${n.name}" fires more than once a minute.` }));
  },
};

export const reliabilityRules: Rule[] = [
  httpNoTimeout,
  noExecutionTimeout,
  endlessLoop,
  returnAll,
  webhookNoResponder,
  scheduleNoTimezone,
  scheduleTooFrequent,
];
