// Writes every finding over the corpus to study/output/<name>.jsonl, one per line, so two rule
// versions can be compared: which findings a change added or removed.
// Usage: tsx study/scripts/dump-findings.ts <name>
//        tsx study/scripts/dump-findings.ts --diff <before> <after>

import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { analyze } from "@n8n-preflight/core";
import { outputDir, readCorpus } from "./corpus.js";

interface Row {
  templateId: number;
  ruleId: string;
  node?: string;
  message: string;
}

const key = (r: Row): string => `${r.templateId}|${r.ruleId}|${r.node ?? ""}|${r.message}`;

async function load(name: string): Promise<Map<string, Row>> {
  const rows = new Map<string, Row>();
  const lines = createInterface({ input: createReadStream(join(outputDir, `${name}.jsonl`)) });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Row;
    rows.set(key(row), row);
  }
  return rows;
}

async function dump(name: string): Promise<void> {
  const out: string[] = [];
  for await (const record of readCorpus()) {
    const result = analyze(record.workflow);
    if (!result.ok) continue;
    for (const f of result.findings) {
      const row: Row = { templateId: record.id, ruleId: f.ruleId, message: f.message };
      if (f.node !== undefined) row.node = f.node;
      out.push(JSON.stringify(row));
    }
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${name}.jsonl`), `${out.join("\n")}\n`);
  console.log(`${out.length} findings -> ${name}.jsonl`);
}

async function diff(before: string, after: string): Promise<void> {
  const a = await load(before);
  const b = await load(after);
  const added = [...b.values()].filter((r) => !a.has(key(r)));
  const removed = [...a.values()].filter((r) => !b.has(key(r)));
  const byRule = (rows: Row[]) =>
    rows.reduce<Record<string, number>>((acc, r) => ((acc[r.ruleId] = (acc[r.ruleId] ?? 0) + 1), acc), {});
  console.log("added by rule:  ", byRule(added));
  console.log("removed by rule:", byRule(removed));
  writeFileSync(join(outputDir, `diff-${before}-${after}-added.json`), JSON.stringify(added, null, 2));
  writeFileSync(join(outputDir, `diff-${before}-${after}-removed.json`), JSON.stringify(removed, null, 2));
}

const args = process.argv.slice(2);
(args[0] === "--diff" ? diff(args[1]!, args[2]!) : dump(args[0] ?? "findings")).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
