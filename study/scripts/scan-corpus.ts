// Runs every rule over the whole corpus.
// Writes study/output/scan-report.json (counts, scores, timing) and
// study/output/precision-sample.json (a fixed, seeded sample of findings for hand labelling).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, rules } from "@n8n-preflight/core";
import type { Finding } from "@n8n-preflight/core";
import { outputDir, readCorpus } from "./corpus.js";

const SAMPLE_SIZE = 200;
// Usage: scan-corpus.ts [seed] [exclude.json] [sample-out-name]
// The exclude file is an earlier sample; its templates are left out of this sample (not out of the counts).
const SEED = Number(process.argv[2] ?? 20261020);
const EXCLUDE_FILE = process.argv[3];
const SAMPLE_NAME = process.argv[4] ?? "precision-sample.json";

interface SampledFinding extends Finding {
  templateId: number;
  templateName: string;
}

/** Small deterministic PRNG so the sample is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function main(): Promise<void> {
  const byRule: Record<string, { findings: number; templates: number }> = {};
  for (const r of rules) byRule[r.id] = { findings: 0, templates: 0 };
  const grades: Record<string, number> = { ready: 0, "needs-work": 0, "not-ready": 0 };
  const scores: number[] = [];
  const times: number[] = [];
  const ruleErrors: { templateId: number; ruleId: string; message: string }[] = [];
  // Reservoir per rule, so every rule gets labelled, not just the noisiest.
  const perRule = new Map<string, SampledFinding[]>();
  const seen = new Map<string, number>();
  const random = mulberry32(SEED);
  const RESERVOIR = 40;
  const excluded = new Set<number>(
    EXCLUDE_FILE ? (JSON.parse(readFileSync(EXCLUDE_FILE, "utf8")) as { templateId: number }[]).map((f) => f.templateId) : [],
  );
  let templates = 0;
  let failed = 0;

  for await (const record of readCorpus()) {
    templates++;
    const start = performance.now();
    const result = analyze(record.workflow);
    times.push(performance.now() - start);
    if (!result.ok) {
      failed++;
      continue;
    }
    scores.push(result.score);
    grades[result.grade]!++;
    for (const e of result.ruleErrors) ruleErrors.push({ templateId: record.id, ...e });

    const rulesHit = new Set<string>();
    for (const f of result.findings) {
      byRule[f.ruleId]!.findings++;
      rulesHit.add(f.ruleId);
      if (excluded.has(record.id)) continue;
      const n = (seen.get(f.ruleId) ?? 0) + 1;
      seen.set(f.ruleId, n);
      const bucket = perRule.get(f.ruleId) ?? [];
      const item = { ...f, templateId: record.id, templateName: record.name };
      if (bucket.length < RESERVOIR) bucket.push(item);
      else {
        const j = Math.floor(random() * n);
        if (j < RESERVOIR) bucket[j] = item;
      }
      perRule.set(f.ruleId, bucket);
    }
    for (const id of rulesHit) byRule[id]!.templates++;
  }

  // Spread the sample across rules: equal share each, leftovers to the rules with the most findings.
  const ids = rules.map((r) => r.id).filter((id) => (perRule.get(id)?.length ?? 0) > 0);
  const share = Math.floor(SAMPLE_SIZE / ids.length);
  const sample: SampledFinding[] = [];
  for (const id of ids) sample.push(...perRule.get(id)!.slice(0, share));
  const byVolume = [...ids].sort((a, b) => byRule[b]!.findings - byRule[a]!.findings);
  for (let i = 0; sample.length < SAMPLE_SIZE && i < byVolume.length * RESERVOIR; i++) {
    const id = byVolume[i % byVolume.length]!;
    const next = perRule.get(id)![share + Math.floor(i / byVolume.length)];
    if (next) sample.push(next);
  }

  const sortedTimes = [...times].sort((a, b) => a - b);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const report = {
    templates,
    failed,
    timingMs: {
      median: +percentile(sortedTimes, 50).toFixed(3),
      p95: +percentile(sortedTimes, 95).toFixed(3),
      p99: +percentile(sortedTimes, 99).toFixed(3),
      max: +(sortedTimes.at(-1) ?? 0).toFixed(3),
    },
    score: {
      median: percentile(sortedScores, 50),
      mean: +(scores.reduce((a, b) => a + b, 0) / (scores.length || 1)).toFixed(1),
      grades,
    },
    rules: Object.fromEntries(
      Object.entries(byRule).map(([id, v]) => [
        id,
        { ...v, templatesPct: +((v.templates / (templates - failed || 1)) * 100).toFixed(1) },
      ]),
    ),
    ruleErrors,
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "scan-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDir, SAMPLE_NAME), `${JSON.stringify(sample, null, 2)}\n`);

  console.log(`templates ${templates}, failed ${failed}, rule errors ${ruleErrors.length}`);
  console.log(`time per workflow: ${JSON.stringify(report.timingMs)}`);
  console.log(`score: ${JSON.stringify(report.score)}`);
  for (const [id, v] of Object.entries(report.rules)) {
    console.log(`${id.padEnd(42)} ${String(v.findings).padStart(7)} findings  ${String(v.templatesPct).padStart(5)}% of templates`);
  }
  console.log(`sample: ${sample.length} findings`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
