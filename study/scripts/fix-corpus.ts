// Phase 4 validation: fix every template in the corpus and check every guarantee on each one.
//   convergence   - no fixed finding comes back
//   idempotence   - fixing the fixed workflow changes nothing
//   preservation  - only the fields listed in the fix report change
//   round trip    - the result parses with no new parse problems
//   no mutation   - the input is untouched
// Writes study/output/fix-corpus-report.json (or fix-corpus-report-remove-unused.json) and exits
// non-zero if any guarantee fails. Pass --remove-unused to check node removal too.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, fixWorkflow, scoreFindings } from "@n8n-preflight/core";
import type { AppliedFix } from "@n8n-preflight/core";
import { outputDir, readCorpus } from "./corpus.js";

type Obj = Record<string, unknown>;
const removeUnused = process.argv.includes("--remove-unused");
const options = { timezone: "UTC", removeUnused };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every leaf path that differs between two JSON values. */
function changedPaths(a: unknown, b: unknown, at = "", out: string[] = []): string[] {
  if (!isObj(a) && !Array.isArray(a)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(at);
    return out;
  }
  if ((!isObj(b) && !Array.isArray(b)) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(at);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
  for (const k of keys) {
    const path = Array.isArray(a) ? `${at}[${k}]` : at ? `${at}.${k}` : k;
    changedPaths((a as Obj)[k], (b as Obj)[k], path, out);
  }
  return out;
}

/** Where the workflow object sits inside the record's JSON (templates may be wrapped). */
function workflowOf(data: unknown): Obj | null {
  let current = data;
  for (let i = 0; i < 3; i++) {
    if (!isObj(current)) return null;
    if (Array.isArray(current.nodes)) return current;
    current = current.workflow;
  }
  return null;
}

/** Fields a fix is allowed to touch, as regular expressions over paths in the workflow object. */
function allowedPaths(applied: AppliedFix[], fixed: Obj, removedAny: boolean): RegExp[] {
  const names = (fixed.nodes as Obj[]).map((n) => n.name);
  const allowed: RegExp[] = [];
  for (const a of applied) {
    const index = a.node === undefined ? -1 : names.indexOf(a.node);
    for (const p of a.paths) {
      if (p.startsWith("nodes[name=") || p.startsWith("connections.")) continue; // removals, handled below
      const concrete = index >= 0 ? p.replace(/^nodes\[\d+\]/, `nodes[${index}]`) : p;
      const escaped = concrete.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // A whole object may be new (options: {} on a node that had none), so allow everything under it.
      allowed.push(new RegExp(`^${escaped}(\\.|\\[|$)`));
      if (concrete.endsWith(".parameters.options.timeout")) allowed.push(new RegExp(`^${escaped.replace(/\\\.timeout$/, "")}$`));
    }
  }
  // settings stored as a string change as a whole string.
  if (applied.some((a) => a.paths.some((p) => p.startsWith("settings.")))) allowed.push(/^settings$/);
  if (removedAny) allowed.push(/^connections(\.|$)/, /^pinData(\.|$)/);
  return allowed;
}

async function main(): Promise<void> {
  const failures: { templateId: number; check: string; detail: string }[] = [];
  const fixesByRule: Record<string, number> = {};
  const skippedByReason: Record<string, number> = {};
  const scores: { before: number; after: number }[] = [];
  let templates = 0;
  let fixedTemplates = 0;
  const times: number[] = [];

  for await (const record of readCorpus()) {
    templates++;
    const original = JSON.stringify(record.workflow);
    const input: unknown = JSON.parse(original);
    const start = performance.now();
    const r = fixWorkflow(input, options);
    times.push(performance.now() - start);
    const fail = (check: string, detail: string) => failures.push({ templateId: record.id, check, detail });

    if (JSON.stringify(input) !== original) fail("no mutation", "input changed");
    if (!r.ok) {
      fail("fix ran", r.reason);
      continue;
    }
    if (r.applied.length) fixedTemplates++;
    for (const a of r.applied) fixesByRule[a.ruleId] = (fixesByRule[a.ruleId] ?? 0) + 1;
    for (const s of r.skipped) {
      const reason = s.reason.replace(/"[^"]*"/g, '"…"');
      skippedByReason[`${s.ruleId}: ${reason}`] = (skippedByReason[`${s.ruleId}: ${reason}`] ?? 0) + 1;
    }

    // Convergence
    const after = analyze(r.fixed, {});
    if (!after.ok) {
      fail("round trip", "fixed workflow does not parse");
      continue;
    }
    const remaining = new Set(after.findings.map((f) => `${f.ruleId}|${f.node ?? ""}`));
    for (const a of r.applied) {
      if (remaining.has(`${a.ruleId}|${a.node ?? ""}`)) fail("convergence", `${a.ruleId} on "${a.node ?? "workflow"}" still reported`);
    }

    // Round trip: no new parse problems
    const before = analyze(input, {});
    if (before.ok && after.parseIssues.length > before.parseIssues.length) {
      fail("round trip", `${after.parseIssues.length - before.parseIssues.length} new parse issues`);
    }

    // Idempotence
    const again = fixWorkflow(r.fixed, options);
    if (!again.ok || again.json !== r.json || again.applied.length) fail("idempotence", again.ok ? `${again.applied.length} more fixes` : again.reason);

    // Preservation
    const wfBefore = workflowOf(input);
    const wfAfter = workflowOf(r.fixed);
    if (wfBefore && wfAfter) {
      const removed = new Set(r.applied.filter((a) => a.paths.some((p) => p.startsWith("nodes[name="))).map((a) => a.node));
      const comparable = { ...wfBefore, nodes: (wfBefore.nodes as unknown[]).filter((n) => !(isObj(n) && removed.has(n.name as string))) };
      const allowed = allowedPaths(r.applied, wfAfter, removed.size > 0);
      const unexpected = changedPaths(comparable, wfAfter).filter((p) => !allowed.some((re) => re.test(p)));
      if (unexpected.length) fail("preservation", unexpected.slice(0, 5).join(", "));
      // Outside the workflow object (template wrappers), nothing may change at all.
      const outside = changedPaths({ ...(input as Obj), workflow: null }, { ...(r.fixed as Obj), workflow: null });
      if (wfBefore !== input && outside.length) fail("preservation", `wrapper changed: ${outside.join(", ")}`);
    }

    scores.push({ before: r.before.score, after: scoreFindings(after.findings).score });
  }

  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const report = {
    removeUnused,
    templates,
    templatesChanged: fixedTemplates,
    failures: failures.length,
    failuresByCheck: failures.reduce<Record<string, number>>((acc, f) => ((acc[f.check] = (acc[f.check] ?? 0) + 1), acc), {}),
    fixesByRule,
    skippedByReason: Object.fromEntries(Object.entries(skippedByReason).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    score: {
      medianBefore: median(scores.map((s) => s.before)),
      medianAfter: median(scores.map((s) => s.after)),
      readyBefore: scores.filter((s) => s.before >= 90).length,
      readyAfter: scores.filter((s) => s.after >= 90).length,
      improved: scores.filter((s) => s.after > s.before).length,
      worse: scores.filter((s) => s.after < s.before).length,
    },
    timingMs: { median: +median(times).toFixed(2), max: +Math.max(...times).toFixed(1) },
    firstFailures: failures.slice(0, 40),
  };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, removeUnused ? "fix-corpus-report-remove-unused.json" : "fix-corpus-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, firstFailures: report.firstFailures.slice(0, 12) }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
