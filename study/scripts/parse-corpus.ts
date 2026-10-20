// Phase 0 exit check: the parser must read every template in the corpus.
// Writes study/output/parse-report.json and exits non-zero if any template fails.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflow } from "@n8n-preflight/core";
import { outputDir, readCorpus } from "./corpus.js";

interface Report {
  templates: number;
  parsed: number;
  failed: { id: number; issues: string[] }[];
  nodes: number;
  warningsByCode: Record<string, number>;
  templatesWithWarnings: number;
  /** Fields seen on nodes that the parser does not model, with counts. Shows what the types might be missing. */
  unmodelledNodeFields: Record<string, number>;
}

const MODELLED = new Set([
  "id", "name", "type", "typeVersion", "position", "parameters", "credentials", "disabled", "notes",
  "notesInFlow", "onError", "continueOnFail", "retryOnFail", "maxTries", "waitBetweenTries",
  "alwaysOutputData", "executeOnce", "webhookId",
]);

async function main(): Promise<void> {
  const report: Report = {
    templates: 0,
    parsed: 0,
    failed: [],
    nodes: 0,
    warningsByCode: {},
    templatesWithWarnings: 0,
    unmodelledNodeFields: {},
  };

  for await (const record of readCorpus()) {
    report.templates++;
    const result = parseWorkflow(record.workflow);
    if (!result.ok) {
      report.failed.push({ id: record.id, issues: result.issues.map((i) => i.message) });
      continue;
    }
    report.parsed++;
    report.nodes += result.workflow.nodes.length;
    if (result.issues.length) report.templatesWithWarnings++;
    for (const issue of result.issues) report.warningsByCode[issue.code] = (report.warningsByCode[issue.code] ?? 0) + 1;

    const rawNodes = (record.workflow as { nodes?: unknown[] }).nodes ?? [];
    for (const rawNode of rawNodes) {
      if (typeof rawNode !== "object" || rawNode === null) continue;
      for (const key of Object.keys(rawNode)) {
        if (!MODELLED.has(key)) report.unmodelledNodeFields[key] = (report.unmodelledNodeFields[key] ?? 0) + 1;
      }
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const file = join(outputDir, "parse-report.json");
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

  const rate = report.templates ? ((report.parsed / report.templates) * 100).toFixed(2) : "0";
  console.log(`templates: ${report.templates}`);
  console.log(`parsed:    ${report.parsed} (${rate}%)`);
  console.log(`failed:    ${report.failed.length}`);
  console.log(`nodes:     ${report.nodes}`);
  console.log(`warnings:  ${JSON.stringify(report.warningsByCode)} in ${report.templatesWithWarnings} templates`);
  console.log(`unmodelled node fields: ${JSON.stringify(report.unmodelledNodeFields)}`);
  console.log(`report:    ${file}`);

  if (report.templates === 0) {
    console.error("corpus is empty: run `npm run corpus:download` first");
    process.exit(1);
  }
  if (report.failed.length) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
