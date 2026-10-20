// Downloads every public n8n template into study/corpus/templates.jsonl.gz.
// Resumable: templates already in the file are skipped on the next run.
// Polite: 4 requests at a time, retries with backoff, a User-Agent that names the project.

import { createWriteStream, mkdirSync, renameSync } from "node:fs";
import { createGzip } from "node:zlib";
import { type CorpusRecord, corpusDir, corpusFile, readCorpus } from "./corpus.js";

const API = "https://api.n8n.io/api/templates";
const PAGE_SIZE = 100;
const CONCURRENCY = 4;
const USER_AGENT = "n8n-preflight-study (github.com/harishakshay/flowgenius-n8n-tool)";

class PermanentError extends Error {}

async function fetchJson(url: string, attempt = 1): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 404) return null;
    // Other 4xx (the API answers 400 for unpublished templates) will not change on retry; 429 will.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentError(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof PermanentError || attempt >= 5) {
      throw new Error(`${url}: ${(err as Error).message}`, { cause: err });
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fetchJson(url, attempt + 1);
  }
}

async function listTemplateIds(): Promise<number[]> {
  const ids = new Set<number>();
  for (let page = 1; ; page++) {
    const data = (await fetchJson(`${API}/search?page=${page}&rows=${PAGE_SIZE}`)) as {
      workflows: { id: number; price: number | null; purchaseUrl: string | null }[];
    };
    for (const w of data.workflows) {
      // Paid templates do not ship their workflow JSON.
      if (!w.price && !w.purchaseUrl) ids.add(w.id);
    }
    process.stdout.write(`\rlisting: page ${page}, ${ids.size} ids`);
    if (data.workflows.length < PAGE_SIZE) break;
  }
  process.stdout.write("\n");
  return [...ids].sort((a, b) => a - b);
}

async function main(): Promise<void> {
  mkdirSync(corpusDir, { recursive: true });
  const existing: CorpusRecord[] = [];
  for await (const r of readCorpus()) existing.push(r);
  const have = new Set(existing.map((r) => r.id));
  const ids = (await listTemplateIds()).filter((id) => !have.has(id));
  console.log(`already have ${have.size}, downloading ${ids.length}`);

  // Write to a temp file so an interrupted run never corrupts the corpus.
  const tmp = `${corpusFile}.tmp`;
  const gzip = createGzip();
  const done = new Promise<void>((resolve, reject) => {
    gzip.pipe(createWriteStream(tmp)).on("finish", resolve).on("error", reject);
  });
  for (const r of existing) gzip.write(`${JSON.stringify(r)}\n`);

  let next = 0;
  let saved = 0;
  let missing = 0;
  const failures: string[] = [];
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next++]!;
      try {
        const data = (await fetchJson(`${API}/workflows/${id}`)) as {
          workflow?: { name?: string; createdAt?: string; totalViews?: number; workflow?: unknown };
        } | null;
        if (!data?.workflow?.workflow) {
          missing++;
          continue;
        }
        const record: CorpusRecord = {
          id,
          name: data.workflow.name ?? "",
          createdAt: data.workflow.createdAt ?? null,
          totalViews: data.workflow.totalViews ?? null,
          workflow: data.workflow.workflow,
        };
        gzip.write(`${JSON.stringify(record)}\n`);
        saved++;
      } catch (err) {
        failures.push((err as Error).message);
      }
      process.stdout.write(`\rdownloaded ${saved}, missing ${missing}, failed ${failures.length} / ${ids.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  gzip.end();
  await done;
  renameSync(tmp, corpusFile);
  process.stdout.write("\n");
  console.log(`corpus: ${have.size + saved} templates in ${corpusFile}`);
  if (failures.length) console.log(`failed (re-run to retry):\n${failures.slice(0, 20).join("\n")}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
