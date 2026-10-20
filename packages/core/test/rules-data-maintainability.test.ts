import { describe, expect, it } from "vitest";
import { T, hits, link, node, workflow } from "./helpers.js";

describe("data/pinned-data", () => {
  const id = "data/pinned-data";

  it("fires when pinned data is in the file", () => {
    const wf = workflow([node("Hook", T.webhook)], {}, { pinData: { Hook: [{ json: { email: "a@b.com" } }] } });
    expect(hits(id, wf)).toHaveLength(1);
  });

  it("is quiet with no or empty pinned data", () => {
    expect(hits(id, workflow([node("Hook", T.webhook)], {}, { pinData: { Hook: [] } }))).toHaveLength(0);
    expect(hits(id, workflow([node("Hook", T.webhook)]))).toHaveLength(0);
  });
});

describe("data/test-endpoint", () => {
  const id = "data/test-endpoint";

  it("fires for request inspectors and tunnels", () => {
    for (const url of ["https://webhook.site/abc", "https://eo123.m.pipedream.net", "https://ab12.ngrok-free.app/hook", "https://x-y.trycloudflare.com"]) {
      expect(hits(id, workflow([node("Call", T.http, { parameters: { url } })]))).toHaveLength(1);
    }
  });

  it("is quiet for normal hosts and ignores sticky notes", () => {
    expect(hits(id, workflow([node("Call", T.http, { parameters: { url: "https://api.stripe.com" } })]))).toHaveLength(0);
    expect(hits(id, workflow([node("Note", T.sticky, { parameters: { content: "test with webhook.site" } })]))).toHaveLength(0);
  });
});

describe("data/broken-connections", () => {
  const id = "data/broken-connections";

  it("fires for connections to missing nodes and duplicate names", () => {
    expect(hits(id, workflow([node("A", T.set)], link("A", "Ghost")))).toHaveLength(1);
    expect(hits(id, workflow([node("A", T.set), node("A", T.http)]))).toHaveLength(1);
  });

  it("is quiet for a clean workflow", () => {
    expect(hits(id, workflow([node("A", T.set), node("B", T.set)], link("A", "B")))).toHaveLength(0);
  });
});

describe("maintainability/default-node-names", () => {
  const id = "maintainability/default-node-names";

  it("reports default names once per workflow", () => {
    const wf = workflow([node("HTTP Request", T.http), node("HTTP Request2", T.http), node("Code1", T.code)]);
    const found = hits(id, wf);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("3 nodes");
  });

  it("is quiet for descriptive names and triggers", () => {
    expect(hits(id, workflow([node("Create Stripe customer", T.http), node("Webhook", T.webhook)]))).toHaveLength(0);
  });
});

describe("maintainability/disabled-nodes", () => {
  const id = "maintainability/disabled-nodes";

  it("fires per disabled node", () => {
    expect(hits(id, workflow([node("Old", T.http, { disabled: true }), node("New", T.http)]))).toHaveLength(1);
  });
});

describe("maintainability/orphan-nodes", () => {
  const id = "maintainability/orphan-nodes";

  it("fires for nodes with no connections at all", () => {
    const wf = workflow([node("Hook", T.webhook), node("Used", T.set), node("Lost", T.http)], link("Hook", "Used"));
    expect(hits(id, wf).map((f) => f.node)).toEqual(["Lost"]);
  });

  it("counts AI connections as connections, and skips triggers and notes", () => {
    const wf = workflow([node("Chat", "@n8n/n8n-nodes-langchain.chatTrigger"), node("Agent", T.agent), node("Model", T.model), node("Note", T.sticky)], {
      ...link("Chat", "Agent"),
      Model: { ai_languageModel: [[{ node: "Agent", type: "ai_languageModel", index: 0 }]] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });
});

describe("maintainability/undocumented", () => {
  const id = "maintainability/undocumented";
  const many = (n: number) => Array.from({ length: n }, (_, i) => node(`Step ${i}`, T.set));

  it("fires for 8+ nodes with no notes", () => {
    expect(hits(id, workflow(many(8)))).toHaveLength(1);
  });

  it("is quiet for small workflows, or with a sticky note or node note", () => {
    expect(hits(id, workflow(many(7)))).toHaveLength(0);
    expect(hits(id, workflow([...many(8), node("Note", T.sticky)]))).toHaveLength(0);
    expect(hits(id, workflow([...many(7), node("Step 7", T.set, { notes: "Writes the daily report" })]))).toHaveLength(0);
  });
});
