// Shared access to the local template corpus (study/corpus/templates.jsonl.gz).

import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const studyRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const corpusDir = join(studyRoot, "corpus");
export const corpusFile = join(corpusDir, "templates.jsonl.gz");
export const outputDir = join(studyRoot, "output");

export interface CorpusRecord {
  id: number;
  name: string;
  createdAt: string | null;
  totalViews: number | null;
  /** The workflow JSON exactly as the template API returns it. */
  workflow: unknown;
}

export async function* readCorpus(): AsyncGenerator<CorpusRecord> {
  if (!existsSync(corpusFile)) return;
  const lines = createInterface({ input: createReadStream(corpusFile).pipe(createGunzip()) });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as CorpusRecord;
}
