// Entry point of the GitHub Action. Bundled into dist/index.js by esbuild (Actions can't run npm install).

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rules } from "@n8n-preflight/core";
import type { Severity } from "@n8n-preflight/core";
import { checkFiles, discover, formatSarif, formatText, shouldFail } from "n8n-preflight";
import type { CheckResult } from "n8n-preflight";
import { type AnnotationLevel, annotation, appendSummary, input, setOutput } from "./github.js";

const LEVEL: Record<Severity, AnnotationLevel> = { critical: "error", high: "error", medium: "warning", low: "notice" };
const SEVERITIES = ["critical", "high", "medium", "low"];

export function main(env: NodeJS.ProcessEnv = process.env, write: (s: string) => void = (s) => void process.stdout.write(s)): number {
  const cwd = env.GITHUB_WORKSPACE ?? process.cwd();
  const paths = input("path", env).split(/[\s]+/).filter(Boolean);
  const failOn = input("fail-on", env) || "high";
  const list = (name: string) => input(name, env).split(",").map((s) => s.trim()).filter(Boolean);
  const disable = list("disable");
  const enable = list("enable");
  const sarifFile = input("sarif-file", env);
  const annotate = input("annotations", env) !== "false";

  if (failOn !== "none" && !SEVERITIES.includes(failOn)) {
    write(`::error::Unknown fail-on "${failOn}". Use critical, high, medium, low or none.\n`);
    return 2;
  }
  const known = new Set(rules.map((r) => r.id));
  const unknown = [...disable, ...enable].filter((id) => !known.has(id));
  if (unknown.length) {
    write(`::error::Unknown rule: ${unknown.join(", ")}\n`);
    return 2;
  }

  let check: CheckResult;
  try {
    check = checkFiles(discover(paths.length ? paths : ["."], cwd), { disable, enable });
  } catch (err) {
    write(`::error::${(err as Error).message}\n`);
    return 2;
  }

  write(formatText(check, { color: true }));
  if (annotate) {
    // GitHub shows only the first 10 errors and 10 warnings of a step inline, so send the most severe first.
    const all = check.results.flatMap((r) => r.findings.map((f) => ({ ...f, file: r.file })));
    all.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
    for (const f of all) {
      write(annotation(LEVEL[f.severity], f.message, { file: f.file, line: f.line, title: `n8n Preflight: ${f.ruleId}` }));
    }
  }
  for (const e of check.errors) write(annotation("error", e.reason, { file: e.file, line: 1, title: "n8n Preflight" }));

  if (sarifFile) writeFileSync(resolve(cwd, sarifFile), formatSarif(check));
  appendSummary(summary(check, failOn), env);

  const findings = check.results.reduce((n, r) => n + r.findings.length, 0);
  setOutput("workflows", check.results.length, env);
  setOutput("findings", findings, env);
  setOutput("lowest-score", check.results.length ? Math.min(...check.results.map((r) => r.score)) : 100, env);
  setOutput("sarif-file", sarifFile, env);

  return shouldFail(check, failOn as Severity | "none") ? 1 : 0;
}

/** Markdown for the job summary page: one row per workflow, then the worst findings. */
export function summary(check: CheckResult, failOn: string): string {
  const icon = { ready: "✅", "needs-work": "⚠️", "not-ready": "❌" } as const;
  const lines = ["## n8n Preflight", ""];
  if (!check.results.length) {
    lines.push("No n8n workflow files found.", "");
    return lines.join("\n");
  }
  lines.push("| Workflow | Score | Critical | High | Medium | Low |", "|---|---|---|---|---|---|");
  for (const r of [...check.results].sort((a, b) => a.score - b.score)) {
    const n = (s: Severity) => r.findings.filter((f) => f.severity === s).length;
    lines.push(`| \`${r.file}\` | ${icon[r.grade]} ${r.score} | ${n("critical")} | ${n("high")} | ${n("medium")} | ${n("low")} |`);
  }
  const serious = check.results.flatMap((r) =>
    r.findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => ({ ...f, file: r.file })),
  );
  if (serious.length) {
    lines.push("", "### Critical and high findings", "");
    for (const f of serious.slice(0, 30)) lines.push(`- **${f.severity}** \`${f.file}:${f.line}\` ${f.message} (\`${f.ruleId}\`)`);
    if (serious.length > 30) lines.push(`- ...and ${serious.length - 30} more`);
  }
  lines.push("", `Fails on: \`${failOn}\`. Rules and fixes: https://github.com/harishakshay/flowgenius-n8n-tool/blob/main/docs/RULES.md`, "");
  return lines.join("\n");
}

// Run only when executed as the Action, not when imported by tests.
if (process.env.GITHUB_ACTIONS === "true" && process.argv[1]?.endsWith("index.js")) {
  process.exitCode = main();
}
