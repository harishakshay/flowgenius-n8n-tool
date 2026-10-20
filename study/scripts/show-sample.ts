// Prints each finding in a precision sample with the evidence needed to judge it.
// Usage: tsx study/scripts/show-sample.ts <sample.json> [rule-id filter]

import { readFileSync } from "node:fs";
import { readCorpus } from "./corpus.js";

interface Sampled {
  ruleId: string;
  node?: string;
  message: string;
  templateId: number;
}

interface RawWorkflow {
  nodes: Record<string, unknown>[];
  connections: Record<string, unknown>;
  settings?: unknown;
}

const [sampleFile, filter] = process.argv.slice(2);
if (!sampleFile) {
  console.error("usage: show-sample.ts <sample.json> [rule-id filter]");
  process.exit(1);
}

const sample = JSON.parse(readFileSync(sampleFile, "utf8")) as Sampled[];
const wanted = new Set(sample.map((s) => s.templateId));
const workflows = new Map<number, RawWorkflow>();
for await (const r of readCorpus()) if (wanted.has(r.id)) workflows.set(r.id, r.workflow as RawWorkflow);

const cut = (v: unknown, n = 350): string => {
  const s = JSON.stringify(v) ?? "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

sample.forEach((s, i) => {
  if (filter && !s.ruleId.includes(filter)) return;
  const w = workflows.get(s.templateId)!;
  const n = s.node ? w.nodes.find((x) => x.name === s.node) : undefined;
  let evidence: string;
  if (n) {
    const { parameters, position: _position, id: _id, ...rest } = n;
    void _position;
    void _id;
    evidence = `${String(n.type)} ${cut(rest, 160)} params=${cut(parameters)} out=${cut(w.connections[String(n.name)], 200)}`;
  } else {
    const triggers = w.nodes
      .filter((x) => /trigger$|webhook|cron/i.test(String(x.type)))
      .map((x) => `${String(x.type).split(".").pop()}${x.disabled ? "(off)" : ""}`);
    evidence = `settings=${cut(w.settings, 200)} triggers=${triggers.join(",")} nodes=${w.nodes.length}`;
  }
  console.log(`#${i} [${s.ruleId}] t${s.templateId} ${s.message}\n    ${evidence}`);
});
