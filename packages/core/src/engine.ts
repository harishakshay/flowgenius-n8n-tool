// Runs every rule over a workflow and scores the result.

import { buildGraph } from "./graph.js";
import { parseWorkflow } from "./parse.js";
import type { Finding, Rule, Severity } from "./rule.js";
import { rules as allRules } from "./rules/index.js";
import { type Grade, scoreFindings } from "./score.js";
import type { ParseIssue, Workflow } from "./types.js";

export interface AnalyzeOptions {
  /** Rule ids to skip, for example ["maintainability/default-node-names"]. */
  disable?: string[];
  /** Rule ids that are off by default to run anyway, for example ["reliability/endless-loop"]. */
  enable?: string[];
  /** Run a custom rule list instead of the built-in one. */
  rules?: Rule[];
}

export type AnalyzeResult =
  | {
      ok: true;
      workflow: Workflow;
      findings: Finding[];
      score: number;
      grade: Grade;
      parseIssues: ParseIssue[];
      /** Rules that threw. A crashing rule never stops the others. */
      ruleErrors: { ruleId: string; message: string }[];
    }
  | { ok: false; parseIssues: ParseIssue[] };

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function analyze(input: unknown, options: AnalyzeOptions = {}): AnalyzeResult {
  const parsed = parseWorkflow(input);
  if (!parsed.ok) return { ok: false, parseIssues: parsed.issues };

  const disabled = new Set(options.disable ?? []);
  const enabled = new Set(options.enable ?? []);
  const graph = buildGraph(parsed.workflow, parsed.issues);
  const findings: Finding[] = [];
  const ruleErrors: { ruleId: string; message: string }[] = [];

  for (const rule of options.rules ?? allRules) {
    if (disabled.has(rule.id)) continue;
    if (rule.defaultEnabled === false && !enabled.has(rule.id)) continue;
    try {
      for (const hit of rule.check(graph)) {
        const finding: Finding = {
          ruleId: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: hit.message,
        };
        if (hit.node !== undefined) finding.node = hit.node;
        if (hit.path !== undefined) finding.path = hit.path;
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
    ruleErrors,
  };
}
