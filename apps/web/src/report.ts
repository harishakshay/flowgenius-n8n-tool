// Pure helpers for the results view: grouping, counts, and the "Copy report" Markdown.

import type { Finding, Rule, Severity } from "@n8n-preflight/core";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export const GRADE_LABEL = { ready: "Ready for production", "needs-work": "Needs work", "not-ready": "Not ready" } as const;

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Findings of the same rule, shown together under the rule's explanation. */
export interface RuleGroup {
  rule: Rule;
  findings: Finding[];
}

export function groupByRule(findings: Finding[], rules: Rule[]): RuleGroup[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const groups = new Map<string, RuleGroup>();
  for (const f of findings) {
    const rule = byId.get(f.ruleId);
    if (!rule) continue;
    const group = groups.get(f.ruleId) ?? { rule, findings: [] };
    group.findings.push(f);
    groups.set(f.ruleId, group);
  }
  // Findings arrive sorted by severity, so groups keep that order.
  return [...groups.values()];
}

export function toMarkdown(input: {
  name: string | undefined;
  score: number;
  grade: keyof typeof GRADE_LABEL;
  groups: RuleGroup[];
}): string {
  const lines = [
    `## n8n Preflight report${input.name ? `: ${input.name}` : ""}`,
    "",
    `**Score ${input.score}/100**: ${GRADE_LABEL[input.grade]}`,
    "",
  ];
  if (!input.groups.length) lines.push("No problems found.");
  for (const { rule, findings } of input.groups) {
    lines.push(`### ${rule.severity.toUpperCase()}: ${rule.title}`, "", rule.description, "");
    for (const f of findings) lines.push(`- ${f.message}`);
    if (rule.docsUrl) lines.push("", `Learn more: ${rule.docsUrl}`);
    lines.push("");
  }
  lines.push("Checked with n8n Preflight by FlowGenius: https://flowgenius.in");
  return lines.join("\n");
}
