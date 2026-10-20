import { describe, expect, it } from "vitest";
import { analyze, rules, scoreFindings } from "../src/index.js";
import type { Finding, Rule } from "../src/index.js";
import { T, link, node, workflow } from "./helpers.js";

const finding = (ruleId: string, severity: Finding["severity"]): Finding => ({
  ruleId,
  severity,
  category: "reliability",
  message: "",
});

describe("rule set", () => {
  it("has 25 rules with unique ids that match their category", () => {
    expect(rules).toHaveLength(25);
    expect(new Set(rules.map((r) => r.id)).size).toBe(25);
    for (const rule of rules) {
      expect(rule.id.startsWith(`${rule.category}/`)).toBe(true);
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(40);
    }
  });
});

describe("scoreFindings", () => {
  it("is 100 and ready with no findings", () => {
    expect(scoreFindings([])).toEqual({ score: 100, grade: "ready" });
  });

  it("charges by severity and caps repeats of one rule at twice its points", () => {
    expect(scoreFindings([finding("a", "high")]).score).toBe(85);
    expect(scoreFindings([finding("a", "high"), finding("a", "high")]).score).toBe(78); // 15 + 7.5, rounded
    const many = Array.from({ length: 50 }, () => finding("a", "high"));
    expect(scoreFindings(many).score).toBe(70); // capped at 30
  });

  it("never goes below 0 and grades the bands", () => {
    const worst = ["a", "b", "c", "d"].map((id) => finding(id, "critical"));
    expect(scoreFindings(worst)).toEqual({ score: 0, grade: "not-ready" });
    expect(scoreFindings([finding("a", "high")]).grade).toBe("needs-work");
    expect(scoreFindings([finding("a", "medium"), finding("b", "low")]).grade).toBe("ready");
  });
});

describe("analyze", () => {
  it("returns parse issues for input that is not a workflow", () => {
    expect(analyze("nope")).toMatchObject({ ok: false, parseIssues: [{ code: "invalid-json" }] });
  });

  it("gives a clean, well-built workflow a perfect score", () => {
    const wf = workflow(
      [
        node("New order", T.webhook, { parameters: { authentication: "headerAuth" } }),
        node("Create CRM contact", T.http, {
          retryOnFail: true,
          parameters: { url: "https://crm.example.com/contacts", options: { timeout: 30000 } },
        }),
      ],
      link("New order", "Create CRM contact"),
      { settings: { errorWorkflow: "42", executionTimeout: 300, timezone: "Asia/Kolkata" } },
    );
    const result = analyze(wf);
    expect(result.ok && result.findings).toEqual([]);
    expect(result.ok && result.score).toBe(100);
  });

  it("sorts findings by severity, then rule id", () => {
    const result = analyze(workflow([node("Hook", T.webhook), node("Call", T.http)], link("Hook", "Call")));
    if (!result.ok) throw new Error("parse failed");
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const severities = result.findings.map((f) => order[f.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("skips disabled rules", () => {
    const wf = workflow([node("Hook", T.webhook)]);
    const result = analyze(wf, { disable: ["security/webhook-no-auth"] });
    expect(result.ok && result.findings.some((f) => f.ruleId === "security/webhook-no-auth")).toBe(false);
  });

  it("keeps going when one rule throws, and reports it", () => {
    const broken: Rule = {
      id: "reliability/broken",
      category: "reliability",
      severity: "low",
      title: "Broken",
      description: "Always throws.",
      fixable: false,
      check() {
        throw new Error("boom");
      },
    };
    const result = analyze(workflow([node("A", T.set)]), { rules: [broken, ...rules] });
    expect(result.ok && result.ruleErrors).toEqual([{ ruleId: "reliability/broken", message: "boom" }]);
  });
});
