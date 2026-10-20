import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../src/index.js";
import { UNNAMED_NOTE_PREFIX } from "../src/parse.js";

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

function parsed(input: unknown) {
  const result = parseWorkflow(input);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result;
}

describe("parseWorkflow", () => {
  it("reads a downloaded workflow file", () => {
    const { workflow, issues } = parsed(fixture("basic-export.json"));
    expect(issues).toEqual([]);
    expect(workflow.name).toBe("Sync new orders to CRM");
    expect(workflow.nodes.map((n) => n.name)).toEqual(["Webhook", "Create contact", "Alert on failure"]);

    const http = workflow.nodes[1]!;
    expect(http).toMatchObject({ retryOnFail: true, maxTries: 3, onError: "continueErrorOutput" });
    expect(http.credentials).toEqual({ httpHeaderAuth: { id: "c1", name: "CRM key" } });

    expect(workflow.connections["Create contact"]!.main).toEqual([
      [],
      [{ node: "Alert on failure", type: "main", index: 0 }],
    ]);
    expect(workflow.settings.errorWorkflow).toBe("err-wf-1");
    expect(workflow.settings.executionTimeout).toBe(300);
    expect(Object.keys(workflow.pinData)).toEqual(["Webhook"]);
  });

  it("unwraps template API responses", () => {
    const inner = JSON.parse(fixture("basic-export.json"));
    expect(parsed({ workflow: { workflow: inner } }).workflow.nodes).toHaveLength(3);
    expect(parsed({ workflow: inner }).workflow.nodes).toHaveLength(3);
  });

  it("reads a canvas copy, which has no name, settings or id", () => {
    const { workflow, issues } = parsed({
      nodes: [{ name: "Code", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: {} }],
      connections: {},
    });
    expect(issues).toEqual([]);
    expect(workflow.settings).toEqual({});
    expect(workflow.pinData).toEqual({});
    expect(workflow.name).toBeUndefined();
  });

  it("rejects input that is not a workflow", () => {
    expect(parseWorkflow("{not json")).toMatchObject({ ok: false, issues: [{ code: "invalid-json" }] });
    expect(parseWorkflow({ hello: "world" })).toMatchObject({ ok: false, issues: [{ code: "not-a-workflow" }] });
    expect(parseWorkflow([1, 2])).toMatchObject({ ok: false, issues: [{ code: "not-a-workflow" }] });
    expect(parseWorkflow(null)).toMatchObject({ ok: false });
  });

  it("skips nodes without a name or type and fills defaults for the rest", () => {
    const { workflow, issues } = parsed({
      nodes: [{ type: "n8n-nodes-base.set" }, { name: "Set", type: "n8n-nodes-base.set" }],
      connections: {},
    });
    expect(workflow.nodes).toEqual([
      { name: "Set", type: "n8n-nodes-base.set", typeVersion: 1, position: [0, 0], parameters: {} },
    ]);
    expect(issues.map((i) => i.code)).toEqual(["invalid-node", "invalid-field", "invalid-field"]);
  });

  it("drops connections to or from nodes that do not exist", () => {
    const { workflow, issues } = parsed({
      nodes: [{ name: "A", type: "t", typeVersion: 1, position: [0, 0] }],
      connections: {
        A: { main: [[{ node: "Ghost", type: "main", index: 0 }]] },
        Missing: { main: [[{ node: "A", type: "main", index: 0 }]] },
      },
    });
    expect(workflow.connections).toEqual({ A: { main: [[]] } });
    expect(issues.map((i) => i.code)).toEqual(["dangling-connection", "dangling-connection"]);
  });

  it("keeps null output slots, which n8n uses for unconnected outputs", () => {
    const { workflow } = parsed({
      nodes: [
        { name: "If", type: "n8n-nodes-base.if", typeVersion: 2, position: [0, 0] },
        { name: "B", type: "t", typeVersion: 1, position: [0, 0] },
      ],
      connections: { If: { main: [null, [{ node: "B", type: "main", index: 0 }]] } },
    });
    expect(workflow.connections.If!.main).toEqual([null, [{ node: "B", type: "main", index: 0 }]]);
  });

  it("flags duplicate node names", () => {
    const node = { name: "Same", type: "t", typeVersion: 1, position: [0, 0] };
    const { issues } = parsed({ nodes: [node, node], connections: {} });
    expect(issues.map((i) => i.code)).toEqual(["duplicate-node-name"]);
  });

  it("ignores unknown onError values instead of guessing", () => {
    const { workflow, issues } = parsed({
      nodes: [{ name: "A", type: "t", typeVersion: 1, position: [0, 0], onError: "explode" }],
      connections: {},
    });
    expect(workflow.nodes[0]!.onError).toBeUndefined();
    expect(issues.map((i) => i.code)).toEqual(["invalid-field"]);
  });

  it("accepts numeric strings for typeVersion and executionTimeout", () => {
    const { workflow, issues } = parsed({
      nodes: [{ name: "Set", type: "n8n-nodes-base.set", typeVersion: "3.4", position: [0, 0] }],
      connections: {},
      settings: { executionTimeout: "abc" },
    });
    expect(issues).toEqual([]);
    expect(workflow.nodes[0]!.typeVersion).toBe(3.4);
    expect(workflow.settings.executionTimeout).toBeUndefined();
  });

  it("parses settings stored as a JSON string", () => {
    const { workflow, issues } = parsed({ nodes: [], connections: {}, settings: '{"executionOrder":"v1"}' });
    expect(issues).toEqual([]);
    expect(workflow.settings).toEqual({ executionOrder: "v1" });
  });

  it("keeps sticky notes that have no name, under unique names", () => {
    const note = { type: "n8n-nodes-base.stickyNote", typeVersion: 1, position: [0, 0], parameters: { content: "Hi" } };
    const { workflow, issues } = parsed({ nodes: [note, note], connections: {} });
    expect(issues).toEqual([]);
    expect(workflow.nodes.map((n) => n.name)).toEqual([`${UNNAMED_NOTE_PREFIX}1`, `${UNNAMED_NOTE_PREFIX}2`]);
  });

  it("accepts the old string form of credentials", () => {
    const { workflow } = parsed({
      nodes: [{ name: "A", type: "t", typeVersion: 1, position: [0, 0], credentials: { slackApi: "My Slack" } }],
      connections: {},
    });
    expect(workflow.nodes[0]!.credentials).toEqual({ slackApi: { name: "My Slack" } });
  });
});
