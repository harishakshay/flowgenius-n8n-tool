// Turns findings into a 0-100 production-readiness score.
//
// Each rule costs points by severity. Repeats of the same rule cost half as much again, capped at
// twice the first, so one rule firing on 40 nodes cannot drown out everything else.

import type { Finding, Severity } from "./rule.js";

export const SEVERITY_POINTS: Record<Severity, number> = { critical: 30, high: 15, medium: 5, low: 1 };

export type Grade = "ready" | "needs-work" | "not-ready";

export interface Score {
  score: number;
  grade: Grade;
}

export function scoreFindings(findings: Finding[]): Score {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);

  let penalty = 0;
  for (const hits of byRule.values()) {
    const points = SEVERITY_POINTS[hits[0]!.severity];
    penalty += Math.min(points + (hits.length - 1) * (points / 2), points * 2);
  }

  const score = Math.max(0, Math.round(100 - penalty));
  const grade: Grade = score >= 90 ? "ready" : score >= 70 ? "needs-work" : "not-ready";
  return { score, grade };
}
