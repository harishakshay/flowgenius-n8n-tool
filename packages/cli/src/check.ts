// Runs the engine over files and decides the exit code. No printing here, so it can be tested.

import { readFileSync } from "node:fs";
import { analyze, rules } from "@n8n-preflight/core";
import type { AnalyzeOptions, Finding, Grade, Severity } from "@n8n-preflight/core";
import type { Target } from "./discover.js";

export interface FileResult {
  file: string;
  score: number;
  grade: Grade;
  findings: (Finding & { line: number })[];
  /** Number of nodes, for the summary. */
  nodes: number;
}

export interface SkippedFile {
  file: string;
  reason: string;
}

export interface CheckResult {
  results: FileResult[];
  /** Files found by scanning a folder that are not n8n workflows (package.json, tsconfig.json...). */
  skipped: SkippedFile[];
  /** Files the user named directly that could not be read as workflows. */
  errors: SkippedFile[];
}

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export function checkFiles(targets: Target[], options: AnalyzeOptions): CheckResult {
  const out: CheckResult = { results: [], skipped: [], errors: [] };
  for (const target of targets) {
    let text: string;
    try {
      text = readFileSync(target.path, "utf8");
    } catch (err) {
      out.errors.push({ file: target.display, reason: `could not read: ${(err as Error).message}` });
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
      nodes: result.workflow.nodes.length,
    });
  }
  return out;
}

/**
 * Line of a node's "name" in the file, so editors and GitHub can point at it. Workflow-level
 * findings (and names we can't find) point at line 1.
 */
export function lineOf(text: string, node: string | undefined): number {
  if (!node) return 1;
  const needle = JSON.stringify(node);
  const re = new RegExp(`"name"\\s*:\\s*${escapeRegExp(needle)}`);
  const m = re.exec(text);
  if (!m) return 1;
  let line = 1;
  for (let i = 0; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when any finding is at or above the threshold severity. */
export function shouldFail(check: CheckResult, failOn: Severity | "none"): boolean {
  if (check.errors.length) return true;
  if (failOn === "none") return false;
  const limit = SEVERITIES.indexOf(failOn);
  return check.results.some((r) => r.findings.some((f) => SEVERITIES.indexOf(f.severity) <= limit));
}

export function knownRuleIds(): Set<string> {
  return new Set(rules.map((r) => r.id));
}
