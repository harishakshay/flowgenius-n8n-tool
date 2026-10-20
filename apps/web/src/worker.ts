// Runs the engine off the main thread, so a huge workflow never freezes the page.
// Nothing here talks to the network: the workflow stays in the browser.

import { analyze } from "@n8n-preflight/core";

export interface ScanRequest {
  id: number;
  text: string;
}

self.onmessage = (event: MessageEvent<ScanRequest>) => {
  const { id, text } = event.data;
  const started = performance.now();
  const result = analyze(text);
  self.postMessage({ id, result, ms: performance.now() - started });
};
