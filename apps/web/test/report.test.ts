import { analyze, rules } from "@n8n-preflight/core";
import { describe, expect, it } from "vitest";
import { countBySeverity, groupByRule, toMarkdown } from "../src/report";
import { SAMPLE_WORKFLOW } from "../src/sample";

describe("website report", () => {
  const result = analyze(SAMPLE_WORKFLOW);
  if (!result.ok) throw new Error("sample must parse");

  it("the sample workflow shows a wide range of problems", () => {
    expect(result.grade).toBe("not-ready");
    const counts = countBySeverity(result.findings);
    expect(counts.critical).toBeGreaterThan(0);
    expect(counts.high).toBeGreaterThan(0);
    expect(counts.medium).toBeGreaterThan(0);
    expect(new Set(result.findings.map((f) => f.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("groups findings by rule, most severe first", () => {
    const groups = groupByRule(result.findings, rules);
    expect(groups[0]!.rule.severity).toBe("critical");
    expect(groups.reduce((n, g) => n + g.findings.length, 0)).toBe(result.findings.length);
    expect(new Set(groups.map((g) => g.rule.id)).size).toBe(groups.length);
  });

  it("copies a Markdown report that names the workflow, score and every finding", () => {
    const md = toMarkdown({ name: result.workflow.name, score: result.score, grade: result.grade, groups: groupByRule(result.findings, rules) });
    expect(md).toContain("## n8n Preflight report: Sync new Shopify orders to CRM");
    expect(md).toContain(`**Score ${result.score}/100**`);
    for (const f of result.findings) expect(md).toContain(f.message);
    expect(md).not.toContain("9f3b2c7d1e8a4f60b5c2"); // the sample's fake key is masked
  });

  it("says so when there is nothing to fix", () => {
    expect(toMarkdown({ name: undefined, score: 100, grade: "ready", groups: [] })).toContain("No problems found.");
  });
});
