// Generates docs/RULES.md from the rule definitions, so the reference never drifts from the code.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rules } from "@n8n-preflight/core";
import { studyRoot } from "./corpus.js";

const lines = [
  "# Rules",
  "",
  "Generated from the rule definitions by `npm run docs:rules`. Do not edit by hand.",
  "",
  `${rules.length} rules. Severity sets the score penalty: critical 30, high 15, medium 5, low 1 (repeats of one rule add half, capped at double).`,
  "",
  "| Rule | Severity | What it catches | Auto-fix (Phase 4) |",
  "|---|---|---|---|",
  ...rules.map(
    (r) =>
      `| \`${r.id}\` | ${r.severity}${r.defaultEnabled === false ? " (off by default)" : ""} | ${r.title} | ${r.fixable ? "yes" : "no"} |`,
  ),
  "",
];

for (const r of rules) {
  lines.push(`## \`${r.id}\``, "", `**${r.title}** · ${r.severity}`, "", r.description, "");
  if (r.docsUrl) lines.push(`Learn more: ${r.docsUrl}`, "");
}

const file = join(studyRoot, "..", "docs", "RULES.md");
writeFileSync(file, lines.join("\n"));
console.log(`wrote ${file}`);
