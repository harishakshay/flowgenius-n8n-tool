import { isStickyNote, isTrigger } from "../node-types.js";
import type { Rule } from "../rule.js";
import { isDefaultName, list } from "./data.js";

const defaultNodeNames: Rule = {
  id: "maintainability/default-node-names",
  category: "maintainability",
  severity: "low",
  title: "Nodes still have default names",
  description:
    'Names like "HTTP Request2" make error alerts and execution logs unreadable at 2 a.m. Name each node for what it does, for example "Create Stripe customer".',
  fixable: false,
  check(graph) {
    const names = graph.active.filter((n) => !isTrigger(n) && isDefaultName(n.name)).map((n) => n.name);
    if (!names.length) return [];
    return [{ message: `${names.length} node${names.length > 1 ? "s" : ""} still named by default: ${list(names)}.` }];
  },
};

const disabledNodes: Rule = {
  id: "maintainability/disabled-nodes",
  category: "maintainability",
  severity: "low",
  title: "Disabled node left in",
  description:
    "Disabled nodes are skipped, and data passes straight through them. Left in, they hide what the workflow really does and are easy to re-enable by mistake. Delete them, or note why they are kept.",
  fixable: true,
  check(graph) {
    return graph.workflow.nodes
      .filter((n) => n.disabled && !isStickyNote(n))
      .map((n) => ({ node: n.name, message: `"${n.name}" is disabled.` }));
  },
};

const orphanNodes: Rule = {
  id: "maintainability/orphan-nodes",
  category: "maintainability",
  severity: "low",
  title: "Node not connected to anything",
  description: "This node has no connections, so it never runs. Connect it or delete it.",
  fixable: true,
  check(graph) {
    return graph.active
      .filter((n) => !isTrigger(n) && !graph.isLinked(n.name))
      .map((n) => ({ node: n.name, message: `"${n.name}" is not connected, so it never runs.` }));
  },
};

/** Below this size a workflow explains itself. */
const DOCUMENT_ABOVE = 8;

const undocumented: Rule = {
  id: "maintainability/undocumented",
  category: "maintainability",
  severity: "low",
  title: "Large workflow with no notes",
  description:
    "Nobody, including you in six months, can tell what this workflow is for or why it is built this way. Add a sticky note with its purpose, trigger, and who to contact when it fails.",
  fixable: false,
  check(graph) {
    const nodes = graph.active.length;
    const hasNotes = graph.workflow.nodes.some((n) => isStickyNote(n) || (n.notes ?? "").trim() !== "");
    if (nodes < DOCUMENT_ABOVE || hasNotes) return [];
    return [{ message: `${nodes} nodes and no sticky notes or node notes explaining the workflow.` }];
  },
};

export const maintainabilityRules: Rule[] = [defaultNodeNames, disabledNodes, orphanNodes, undocumented];
