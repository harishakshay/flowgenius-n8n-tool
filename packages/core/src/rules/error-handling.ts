import type { WorkflowGraph } from "../graph.js";
import { NODE, isInternalNode, isProductionTrigger, isToolNode, isTrigger, regularOutputCount } from "../node-types.js";
import type { Rule } from "../rule.js";
import type { NodeErrorMode, WorkflowNode } from "../types.js";

/** What n8n actually does when the node fails. `onError` wins over the older `continueOnFail`. */
export function errorMode(node: WorkflowNode): NodeErrorMode {
  return node.onError ?? (node.continueOnFail ? "continueRegularOutput" : "stopWorkflow");
}

/** Nodes that call an outside service through the main flow (where a retry can help). */
export function externalCallNodes(graph: WorkflowGraph): WorkflowNode[] {
  return graph.active.filter(
    (n) => !isTrigger(n) && !isInternalNode(n) && !isToolNode(n) && !graph.isAiSubNode(n.name),
  );
}

const noErrorWorkflow: Rule = {
  id: "error-handling/no-error-workflow",
  category: "error-handling",
  severity: "high",
  title: "No error workflow",
  description:
    "When a production run fails and no error workflow is set, nobody is told. Set Workflow Settings > Error Workflow to a workflow that alerts you (Slack, email).",
  fixable: true,
  check(graph) {
    const triggers = graph.active.filter(isProductionTrigger);
    if (!triggers.length || graph.workflow.settings.errorWorkflow) return [];
    return [{ message: `Runs from "${triggers[0]!.name}" can fail silently: no error workflow is set.` }];
  },
};

const noRetry: Rule = {
  id: "error-handling/no-retry",
  category: "error-handling",
  severity: "medium",
  title: "Outside call without retry",
  description:
    "APIs fail briefly all the time (timeouts, rate limits, 502s). Without Retry On Fail, one blip fails the whole run. Turn on Settings > Retry On Fail (3 tries, 1-5 s apart).",
  fixable: true,
  check(graph) {
    return externalCallNodes(graph)
      .filter((n) => !retries(n))
      .map((n) => ({ node: n.name, message: `"${n.name}" calls an outside service with no retry.` }));
  },
};

/** Retry On Fail with more than one try. n8n's default is 3 tries when maxTries is not set. */
export function retries(node: WorkflowNode): boolean {
  return node.retryOnFail === true && (node.maxTries === undefined || node.maxTries > 1);
}

/** Parameters that read the error message n8n puts on failed items. */
const READS_ERROR = /\$json\s*(\.\s*error\b|\[\s*['"]error['"]\s*\])|\.json\.error\b|\berror\.message\b/;

const swallowedErrors: Rule = {
  id: "error-handling/swallowed-errors",
  category: "error-handling",
  severity: "high",
  title: "Errors swallowed",
  description:
    'With "Continue" on error, a failed step passes its error on as normal data. If nothing after it checks for that error, the run reports success while the work never happened. Check for `$json.error` with an If node, or use "Continue (using error output)".',
  fixable: false,
  check(graph) {
    const candidates = graph.active.filter(
      (n) => errorMode(n) === "continueRegularOutput" && !isTrigger(n) && !graph.isAiSubNode(n.name),
    );
    if (!candidates.length) return [];
    // Active nodes only: a disabled If node passes items through without checking anything.
    const checkers = new Set(graph.active.filter((n) => READS_ERROR.test(JSON.stringify(n.parameters))).map((n) => n.name));
    // One pass over the graph instead of a walk per node: every node from which a checker can be reached.
    const leadsToCheck = nodesThatReach(graph, [...checkers]);
    const checked = (n: WorkflowNode): boolean =>
      // A node that reads $json.error itself is checking the step before it, not its own failure.
      // When it is a checker, walk its downstream directly so a loop back to itself doesn't count.
      checkers.has(n.name)
        ? graph.downstream(n.name).some((d) => checkers.has(d.name))
        : graph.next(n.name).some((s) => leadsToCheck.has(s));
    return candidates
      .filter((n) => !checked(n))
      .map((n) => ({
        node: n.name,
        message: `"${n.name}" continues after failing, and nothing downstream checks for the error.`,
      }));
  },
};

/** The targets plus every node that can reach one of them through the main flow. */
function nodesThatReach(graph: WorkflowGraph, targets: string[]): Set<string> {
  const reached = new Set<string>(targets);
  const queue = [...targets];
  while (queue.length) {
    for (const p of graph.prev(queue.pop()!)) {
      if (!reached.has(p)) {
        reached.add(p);
        queue.push(p);
      }
    }
  }
  return reached;
}

const unconnectedErrorOutput: Rule = {
  id: "error-handling/unconnected-error-output",
  category: "error-handling",
  severity: "high",
  title: "Error output not connected",
  description:
    'The node is set to "Continue (using error output)" but nothing is connected to its error output, so failed items disappear without a trace. Connect the error output to an alert or a retry path.',
  fixable: false,
  check(graph) {
    return graph.active
      .filter((n) => errorMode(n) === "continueErrorOutput")
      .filter((n) => {
        const slots = graph.outputSlots(n.name);
        const regular = regularOutputCount(n);
        // The error output comes right after the regular outputs. More slots than that means the
        // node has outputs we don't know about, so its error slot can't be located.
        if (regular !== null && slots <= regular + 1) return graph.outputTargets(n.name, regular).length === 0;
        // Output count depends on configuration (Switch, classifiers): only certain when nothing past slot 0 exists.
        return slots <= 1;
      })
      .map((n) => ({ node: n.name, message: `"${n.name}" sends failures to an error output that goes nowhere.` }));
  },
};

const silentErrorTrigger: Rule = {
  id: "error-handling/silent-error-trigger",
  category: "error-handling",
  severity: "high",
  title: "Error workflow that does nothing",
  description:
    "This is an error workflow (it starts with Error Trigger) but the trigger is not connected to anything, so failures it catches are never reported.",
  fixable: false,
  check(graph) {
    return graph.active
      .filter((n) => n.type === NODE.errorTrigger && graph.next(n.name).length === 0)
      .map((n) => ({ node: n.name, message: `"${n.name}" catches failures but sends no alert.` }));
  },
};

export const errorHandlingRules: Rule[] = [
  noErrorWorkflow,
  noRetry,
  swallowedErrors,
  unconnectedErrorOutput,
  silentErrorTrigger,
];
