// Talks to the scan worker. One worker for the page; each request gets an id so a slow old
// scan can never overwrite the result of a newer one.

import type { AnalyzeResult } from "@n8n-preflight/core";

export interface ScanResponse {
  id: number;
  result: AnalyzeResult;
  ms: number;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: ScanResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<ScanResponse>) => {
      pending.get(event.data.id)?.resolve(event.data);
      pending.delete(event.data.id);
    };
    // If the worker dies, fail every waiting scan instead of leaving the page on "Checking...",
    // and start a fresh worker next time.
    worker.onerror = (event) => {
      event.preventDefault();
      for (const p of pending.values()) p.reject(new Error(event.message || "The checker stopped unexpectedly."));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export function scan(text: string): { id: number; done: Promise<ScanResponse> } {
  const id = ++nextId;
  const done = new Promise<ScanResponse>((resolve, reject) => pending.set(id, { resolve, reject }));
  getWorker().postMessage({ id, text });
  return { id, done };
}

export function latestId(): number {
  return nextId;
}
