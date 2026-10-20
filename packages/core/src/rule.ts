// The contract every rule follows.

import type { WorkflowGraph } from "./graph.js";

export type Severity = "critical" | "high" | "medium" | "low";

export type Category = "error-handling" | "reliability" | "security" | "data" | "maintainability";

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: Category;
  /** One line: what is wrong. */
  message: string;
  /** The node the finding is about. Absent for workflow-level findings. */
  node?: string;
  /** Where in the node's parameters, when it helps to point at a field. */
  path?: string;
}

/** What a rule reports; the engine adds the rule's id, severity and category. */
export interface RuleHit {
  message: string;
  node?: string;
  path?: string;
}

export interface Rule {
  /** Stable id, "category/name". Used to disable a rule and to link its docs. */
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** Why it matters in production, and what to do about it. */
  description: string;
  /** True when Phase 4's auto-fixer can repair it without guessing. */
  fixable: boolean;
  /** FlowGenius article that explains the problem in depth. */
  docsUrl?: string;
  check(graph: WorkflowGraph): RuleHit[];
}
