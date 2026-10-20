// Output formats: text for people, JSON for scripts, SARIF for GitHub code scanning.

import { rules } from "@n8n-preflight/core";
import type { Severity } from "@n8n-preflight/core";
import type { CheckResult } from "./check.js";

const VERSION = "0.0.0";

// ---------------------------------------------------------------- text

const LABEL: Record<Severity, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
const COLOR: Record<Severity, string> = { critical: "\x1b[1;31m", high: "\x1b[31m", medium: "\x1b[33m", low: "\x1b[2m" };
const GRADE_TEXT = { ready: "ready", "needs-work": "needs work", "not-ready": "not ready" } as const;

export function formatText(check: CheckResult, opts: { color: boolean }): string {
  const c = (code: string, s: string) => (opts.color ? `${code}${s}\x1b[0m` : s);
  const docs = new Map(rules.map((r) => [r.id, r.docsUrl]));
  const lines: string[] = [];

  for (const r of check.results) {
    lines.push(`${c("\x1b[1m", r.file)}  score ${r.score}/100 (${GRADE_TEXT[r.grade]}), ${r.nodes} nodes`);
    for (const f of r.findings) {
      lines.push(`  ${c(COLOR[f.severity], LABEL[f.severity].padEnd(8))} ${r.file}:${f.line}  ${f.message}`);
      lines.push(`  ${" ".repeat(8)} ${c("\x1b[2m", f.ruleId + (docs.get(f.ruleId) ? `  ${docs.get(f.ruleId)}` : ""))}`);
    }
    if (!r.findings.length) lines.push(`  ${c("\x1b[32m", "no problems found")}`);
    lines.push("");
  }

  for (const e of check.errors) lines.push(`${c("\x1b[31m", "error")} ${e.file}: ${e.reason}`);
  // A folder file that isn't valid JSON is often a workflow that got corrupted: worth a look.
  for (const s of check.skipped.filter((s) => s.reason.startsWith("Not valid JSON"))) {
    lines.push(`${c("\x1b[33m", "warning")} ${s.file}: skipped, ${s.reason}`);
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of check.results) for (const f of r.findings) counts[f.severity]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const files = check.results.length;
  lines.push(
    `${files} workflow${files === 1 ? "" : "s"} checked, ${total} finding${total === 1 ? "" : "s"}` +
      (total ? ` (${(Object.keys(counts) as Severity[]).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(", ")})` : "") +
      (check.skipped.length ? `, ${check.skipped.length} non-workflow JSON file${check.skipped.length === 1 ? "" : "s"} skipped` : ""),
  );
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- json

export function formatJson(check: CheckResult): string {
  return `${JSON.stringify({ version: VERSION, ...check }, null, 2)}\n`;
}

// ---------------------------------------------------------------- sarif

/** SARIF levels GitHub understands. Critical and high block; medium warns; low is a note. */
const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
};

/** GitHub sorts code scanning alerts by this score (0-10). */
const SECURITY_SEVERITY: Record<Severity, string> = { critical: "9.0", high: "7.0", medium: "5.0", low: "2.0" };

export function formatSarif(check: CheckResult): string {
  const index = new Map(rules.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "n8n-preflight",
            version: VERSION,
            informationUri: "https://github.com/harishakshay/flowgenius-n8n-tool",
            rules: rules.map((r) => ({
              id: r.id,
              name: r.id.replace(/[/-](\w)/g, (_, ch: string) => ch.toUpperCase()),
              shortDescription: { text: r.title },
              fullDescription: { text: r.description },
              ...(r.docsUrl ? { helpUri: r.docsUrl } : {}),
              help: { text: r.description },
              defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
              properties: {
                tags: [r.category, ...(r.category === "security" ? ["security"] : [])],
                ...(r.category === "security" ? { "security-severity": SECURITY_SEVERITY[r.severity] } : {}),
              },
            })),
          },
        },
        results: check.results.flatMap((r) =>
          r.findings.map((f) => ({
            ruleId: f.ruleId,
            ruleIndex: index.get(f.ruleId),
            level: SARIF_LEVEL[f.severity],
            message: { text: f.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: r.file },
                  region: { startLine: f.line },
                },
              },
            ],
            // Stable across edits elsewhere in the file, so GitHub keeps tracking the same alert.
            partialFingerprints: { "n8nPreflightFinding/v1": `${f.ruleId}:${f.node ?? "<workflow>"}:${f.path ?? ""}` },
          })),
        ),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
