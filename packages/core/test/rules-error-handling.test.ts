import { describe, expect, it } from "vitest";
import { T, hits, link, node, workflow } from "./helpers.js";

describe("error-handling/no-error-workflow", () => {
  const id = "error-handling/no-error-workflow";

  it("fires for a production trigger with no error workflow", () => {
    expect(hits(id, workflow([node("Every day", T.schedule)]))).toHaveLength(1);
  });

  it("is quiet when an error workflow is set", () => {
    const wf = workflow([node("Every day", T.schedule)], {}, { settings: { errorWorkflow: "123" } });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("is quiet for manual-only workflows, sub-workflows and error workflows", () => {
    expect(hits(id, workflow([node("Run", T.manual)]))).toHaveLength(0);
    expect(hits(id, workflow([node("Start", "n8n-nodes-base.executeWorkflowTrigger")]))).toHaveLength(0);
    expect(hits(id, workflow([node("On error", T.errorTrigger)]))).toHaveLength(0);
  });

  it("ignores disabled triggers", () => {
    expect(hits(id, workflow([node("Every day", T.schedule, { disabled: true })]))).toHaveLength(0);
  });
});

describe("error-handling/no-retry", () => {
  const id = "error-handling/no-retry";

  it("fires for outside calls without retry", () => {
    const wf = workflow([node("Hook", T.webhook), node("Call API", T.http), node("Post", T.slack)], link("Hook", "Call API", "Post"));
    expect(hits(id, wf).map((f) => f.node)).toEqual(["Call API", "Post"]);
  });

  it("is quiet when retry is on", () => {
    expect(hits(id, workflow([node("Call API", T.http, { retryOnFail: true })]))).toHaveLength(0);
  });

  it("skips triggers, internal nodes, AI tools and AI sub-nodes", () => {
    const wf = workflow(
      [node("Hook", T.webhook), node("Set", T.set), node("Agent", T.agent, { retryOnFail: true }), node("Model", T.model), node("Mail", T.gmailTool)],
      {
        ...link("Hook", "Set", "Agent"),
        Model: { ai_languageModel: [[{ node: "Agent", type: "ai_languageModel", index: 0 }]] },
        Mail: { ai_tool: [[{ node: "Agent", type: "ai_tool", index: 0 }]] },
      },
    );
    expect(hits(id, wf)).toHaveLength(0);
  });
});

describe("error-handling/swallowed-errors", () => {
  const id = "error-handling/swallowed-errors";

  it("fires when a node continues on fail and nothing checks the error", () => {
    const wf = workflow(
      [node("Call", T.http, { onError: "continueRegularOutput" }), node("Save", T.sheets)],
      link("Call", "Save"),
    );
    expect(hits(id, wf).map((f) => f.node)).toEqual(["Call"]);
  });

  it("treats the old continueOnFail flag the same way", () => {
    expect(hits(id, workflow([node("Call", T.http, { continueOnFail: true })]))).toHaveLength(1);
  });

  it("is quiet when a downstream node checks $json.error", () => {
    const check = node("Failed?", T.if, { parameters: { conditions: { leftValue: "={{ $json.error }}" } } });
    const wf = workflow([node("Call", T.http, { onError: "continueRegularOutput" }), check], link("Call", "Failed?"));
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("is quiet when onError overrides continueOnFail with stopWorkflow", () => {
    expect(hits(id, workflow([node("Call", T.http, { continueOnFail: true, onError: "stopWorkflow" })]))).toHaveLength(0);
  });
});

describe("error-handling/unconnected-error-output", () => {
  const id = "error-handling/unconnected-error-output";

  it("fires when only the success output is connected", () => {
    const wf = workflow([node("Call", T.http, { onError: "continueErrorOutput" }), node("Next", T.set)], link("Call", "Next"));
    expect(hits(id, wf)).toHaveLength(1);
  });

  it("fires when the error slot exists but is empty", () => {
    const wf = workflow([node("Call", T.http, { onError: "continueErrorOutput" }), node("Next", T.set)], {
      Call: { main: [[{ node: "Next", type: "main", index: 0 }], []] },
    });
    expect(hits(id, wf)).toHaveLength(1);
  });

  it("is quiet when the error output is connected", () => {
    const wf = workflow([node("Call", T.http, { onError: "continueErrorOutput" }), node("Next", T.set), node("Alert", T.slack)], {
      Call: { main: [[{ node: "Next", type: "main", index: 0 }], [{ node: "Alert", type: "main", index: 0 }]] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("uses the If node's two regular outputs to find its error output", () => {
    const branches = [[{ node: "Yes", type: "main", index: 0 }], [{ node: "No", type: "main", index: 0 }]];
    const nodes = [node("Check", T.if, { onError: "continueErrorOutput" }), node("Yes", T.set), node("No", T.set), node("Alert", T.slack)];
    expect(hits(id, workflow(nodes, { Check: { main: branches } }))).toHaveLength(1);
    expect(hits(id, workflow(nodes, { Check: { main: [...branches, []] } }))).toHaveLength(1);
    expect(hits(id, workflow(nodes, { Check: { main: [...branches, [{ node: "Alert", type: "main", index: 0 }]] } }))).toHaveLength(0);
  });

  it("only fires for a Switch when no output past the first exists", () => {
    const sw = node("Route", "n8n-nodes-base.switch", { onError: "continueErrorOutput" });
    const to = (n: string) => [{ node: n, type: "main", index: 0 }];
    expect(hits(id, workflow([sw, node("A", T.set)], { Route: { main: [to("A")] } }))).toHaveLength(1);
    expect(hits(id, workflow([sw, node("A", T.set), node("B", T.set)], { Route: { main: [to("A"), to("B")] } }))).toHaveLength(0);
  });
});

describe("error-handling/silent-error-trigger", () => {
  const id = "error-handling/silent-error-trigger";

  it("fires for an Error Trigger connected to nothing", () => {
    expect(hits(id, workflow([node("On error", T.errorTrigger)]))).toHaveLength(1);
  });

  it("is quiet when the Error Trigger sends an alert", () => {
    const wf = workflow([node("On error", T.errorTrigger), node("Alert", T.slack)], link("On error", "Alert"));
    expect(hits(id, wf)).toHaveLength(0);
  });
});
