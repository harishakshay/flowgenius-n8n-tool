// Runs the engine off the main thread, so a huge workflow never freezes the page.
// Nothing here talks to the network: the workflow stays in the browser.

import { analyze, fixWorkflow } from "@n8n-preflight/core";

export interface ScanRequest {
  id: number;
  text: string;
  /** The browser's timezone, used for schedules that have none. */
  timezone?: string;
}

self.onmessage = (event: MessageEvent<ScanRequest>) => {
  const { id, text, timezone } = event.data;
  const started = performance.now();
  const result = analyze(text);
  const ms = performance.now() - started;
  const fix = result.ok ? fixWorkflow(text, timezone ? { timezone } : {}) : undefined;
  self.postMessage({ id, result, ms, fix });
};
