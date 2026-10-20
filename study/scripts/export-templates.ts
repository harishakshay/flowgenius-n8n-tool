// Writes some corpus templates as individual .json files, the way they sit in a real repo.
// Usage: tsx study/scripts/export-templates.ts <folder> <count> [seed]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCorpus } from "./corpus.js";

const [folder, countArg, seedArg] = process.argv.slice(2);
if (!folder) {
  console.error("usage: export-templates.ts <folder> <count> [seed]");
  process.exit(1);
}
const count = Number(countArg ?? 20);
const every = Number(seedArg ?? 600);

mkdirSync(folder, { recursive: true });
let i = 0;
let written = 0;
for await (const r of readCorpus()) {
  if (i++ % every !== 0) continue;
  writeFileSync(join(folder, `template-${r.id}.json`), JSON.stringify(r.workflow, null, 2));
  if (++written >= count) break;
}
console.log(`wrote ${written} templates to ${folder}`);
