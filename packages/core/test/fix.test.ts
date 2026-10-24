import { describe, expect, it } from "vitest";
import { analyze, fixWorkflow, retryRisk } from "../src/index.js";
import type { FixOptions, FixResult } from "../src/index.js";
import { T, link, node } from "./helpers.js";

type Ok = Extract<FixResult, { ok: true }>;
const to = (n: string) => [{ node: n, type: "main", index: 0 }];

/** Fixes with node removal on, so the removal tests exercise it; defaults are tested on their own. */
function fix(input: unknown, options: FixOptions = {}): Ok {
  const r = fixWorkflow(input, { removeUnused: true, ...options });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

function fixedWorkflow(r: Ok): Record<string, unknown> {
  return r.fixed as Record<string, unknown>;
}

/** A downloaded workflow (has settings), with extra fields n8n relies on. */
function exported(nodes: object[], connections: object = {}, extra: Record<string, unknown> = {}) {
  return { name: "Test", id: "wf1", versionId: "v-123", meta: { instanceId: "abc" }, nodes, connections, settings: { executionOrder: "v1" }, pinData: {}, ...extra };
}

const findingIds = (input: unknown) => {
  const r = analyze(input);
  return r.ok ? r.findings.map((f) => `${f.ruleId}|${f.node ?? ""}`) : [];
};

/** Every leaf path that differs between two JSON values. */
function changedPaths(a: unknown, b: unknown, at = ""): string[] {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [at];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) =>
    changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${at}[${k}]` : at ? `${at}.${k}` : k),
  );
}

describe("fixWorkflow: each fix", () => {
  it("adds retries to steps that only read, keeping a sensible existing setting", () => {
    const read = { parameters: { operation: "getAll" } };
    const r = fix(
      exported(
        [node("Hook", T.webhook), node("A", T.http), node("B", T.slack, { retryOnFail: true, maxTries: 1, ...read }), node("C", T.sheets, { maxTries: 5, parameters: { operation: "read" } })],
        link("Hook", "A", "B", "C"),
      ),
    );
    const nodes = fixedWorkflow(r).nodes as Record<string, unknown>[];
    expect(nodes[1]).toMatchObject({ retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
    expect(nodes[2]).toMatchObject({ retryOnFail: true, maxTries: 3 });
    expect(nodes[3]).toMatchObject({ retryOnFail: true, maxTries: 5 });
  });

  it("never retries a step that could send or create something twice, and says why", () => {
    const r = fix(
      exported(
        [
          node("Hook", T.webhook),
          node("Post", T.http, { parameters: { method: "POST" } }),
          node("Send", T.slack, { parameters: { operation: "post" } }),
          node("Unknown", T.sheets),
          node("Ask", T.slack, { parameters: { operation: "sendAndWait" } }),
        ],
        link("Hook", "Post", "Send", "Unknown", "Ask"),
      ),
    );
    expect(r.applied.filter((a) => a.ruleId === "error-handling/no-retry")).toEqual([]);
    const reasons = Object.fromEntries(r.skipped.filter((s) => s.ruleId === "error-handling/no-retry").map((s) => [s.node, s.reason]));
    expect(reasons.Post).toContain("POST request could do it twice");
    expect(reasons.Send).toContain('retrying "post"');
    expect(reasons.Unknown).toContain("can't tell");
    expect(reasons.Ask).toContain("send it again");
  });

  it("judges retry risk by node type, method and operation", () => {
    const n = (type: string, parameters: object = {}) => ({ type, parameters });
    expect(retryRisk(n(T.http))).toBeNull(); // GET by default
    expect(retryRisk(n(T.http, { method: "get" }))).toBeNull();
    expect(retryRisk(n(T.http, { requestMethod: "HEAD" }))).toBeNull();
    expect(retryRisk(n(T.http, { method: "DELETE" }))).toContain("DELETE");
    expect(retryRisk(n(T.http, { method: "={{ $json.m }}" }))).toContain("expression");
    expect(retryRisk(n("@n8n/n8n-nodes-langchain.chainLlm"))).toBeNull();
    expect(retryRisk(n("@n8n/n8n-nodes-langchain.agent"))).toContain("tool calls");
    for (const operation of ["get", "getAll", "getMany", "search", "lookup", "read", "download", "getRows"]) expect(retryRisk(n(T.sheets, { operation }))).toBeNull();
    for (const operation of ["append", "update", "create", "delete", "send", "upsert", "getAndDelete"]) expect(retryRisk(n(T.sheets, { operation }))).not.toBeNull();
  });

  it("keeps disabled and unconnected nodes unless removal is asked for", () => {
    const input = exported(
      [node("Hook", T.webhook), node("Old", T.set, { disabled: true }), node("Next", T.set), node("Spare", T.set)],
      { Hook: { main: [to("Old")] }, Old: { main: [to("Next")] } },
    );
    const r = fixWorkflow(input);
    if (!r.ok) throw new Error(r.reason);
    expect((fixedWorkflow(r).nodes as unknown[]).length).toBe(4);
    expect(r.applied.some((a) => a.ruleId.startsWith("maintainability/"))).toBe(false);
    expect((fix(input).fixed as { nodes: unknown[] }).nodes.length).toBe(2);
  });

  it("adds HTTP timeouts, even when options is missing or null, on every node version", () => {
    for (const parameters of [{}, { options: null }, { options: { response: {} } }]) {
      for (const typeVersion of [1, 3, 4.2]) {
        const r = fix(exported([node("Call", T.http, { typeVersion, parameters })]));
        const p = (fixedWorkflow(r).nodes as Record<string, Record<string, Record<string, unknown>>>[])[0]!.parameters!.options!;
        expect(p.timeout).toBe(30000);
      }
    }
  });

  it("never touches a timeout that is already an expression", () => {
    const r = fix(exported([node("Call", T.http, { parameters: { options: { timeout: "={{ $json.t }}" } } })]));
    expect(r.applied.some((a) => a.ruleId === "reliability/http-no-timeout")).toBe(false);
  });

  it("sets execution timeout and timezone; timezone and error workflow only when given", () => {
    const wf = exported([node("Daily", T.schedule, { parameters: { rule: { interval: [{ triggerAtHour: 9 }] } } })]);
    const without = fix(wf);
    expect((fixedWorkflow(without).settings as Record<string, unknown>).executionTimeout).toBe(600);
    expect(without.skipped.map((s) => s.ruleId)).toEqual(["reliability/schedule-no-timezone", "error-handling/no-error-workflow"]);
    const withAll = fix(wf, { timezone: "Asia/Kolkata", errorWorkflowId: "err-7" });
    expect(fixedWorkflow(withAll).settings).toMatchObject({ timezone: "Asia/Kolkata", errorWorkflow: "err-7", executionTimeout: 600, executionOrder: "v1" });
    expect(fix(wf, { timezone: "Mars/Olympus" }).skipped[0]!.reason).toContain("not a timezone");
  });

  it("keeps settings stored as a string as a string", () => {
    const wf = exported([node("Hook", T.webhook)], {}, { settings: '{"executionOrder":"v1"}' });
    const settings = fixedWorkflow(fix(wf)).settings;
    expect(typeof settings).toBe("string");
    expect(JSON.parse(settings as string)).toEqual({ executionOrder: "v1", executionTimeout: 600 });
  });

  it("does not add settings to a canvas copy, and says why", () => {
    const copy = { nodes: [node("Hook", T.webhook)], connections: {} };
    const r = fix(copy);
    expect("settings" in fixedWorkflow(r)).toBe(false);
    expect(r.skipped.find((s) => s.ruleId === "reliability/no-execution-timeout")?.reason).toContain("canvas copy");
  });

  it("removes pinned data", () => {
    const r = fix(exported([node("Hook", T.webhook)], {}, { pinData: { Hook: [{ json: { email: "a@b.com" } }] } }));
    expect(fixedWorkflow(r).pinData).toEqual({});
  });

  it("removes orphan nodes", () => {
    const r = fix(exported([node("Hook", T.webhook), node("Used", T.set), node("Lost", T.set)], link("Hook", "Used")));
    expect((fixedWorkflow(r).nodes as { name: string }[]).map((n) => n.name)).toEqual(["Hook", "Used"]);
  });
});

describe("fixWorkflow: removing disabled nodes keeps behaviour", () => {
  const disabled = (name: string, type: string = T.set) => node(name, type, { disabled: true });

  it("reconnects a single input to a single output", () => {
    const r = fix(exported([node("Hook", T.webhook), disabled("Old"), node("Next", T.set)], link("Hook", "Old", "Next")));
    expect(fixedWorkflow(r).connections).toEqual({ Hook: { main: [to("Next")] } });
  });

  it("handles fan-in and fan-out", () => {
    const r = fix(
      exported([node("A", T.webhook), node("B", T.webhook), disabled("Old"), node("X", T.set), node("Y", T.set)], {
        A: { main: [to("Old")] },
        B: { main: [to("Old")] },
        Old: { main: [[...to("X"), ...to("Y")]] },
      }),
    );
    expect(fixedWorkflow(r).connections).toEqual({ A: { main: [[...to("X"), ...to("Y")]] }, B: { main: [[...to("X"), ...to("Y")]] } });
  });

  it("removes two disabled nodes in a row", () => {
    const r = fix(exported([node("Hook", T.webhook), disabled("Old1"), disabled("Old2"), node("Next", T.set)], link("Hook", "Old1", "Old2", "Next")));
    expect(fixedWorkflow(r).connections).toEqual({ Hook: { main: [to("Next")] } });
  });

  it("keeps an If node's other branch, splicing only the disabled one", () => {
    const r = fix(
      exported([node("Hook", T.webhook), node("Check", T.if), disabled("Old"), node("Yes", T.set), node("No", T.set)], {
        Hook: { main: [to("Check")] },
        Check: { main: [to("Yes"), to("Old")] },
        Old: { main: [to("No")] },
      }),
    );
    expect((fixedWorkflow(r).connections as Record<string, unknown>).Check).toEqual({ main: [to("Yes"), to("No")] });
  });

  it("handles a disabled node inside a loop without creating a self-loop", () => {
    const r = fix(
      exported([node("Loop", T.loop), disabled("Old"), node("Work", T.http, { retryOnFail: true, parameters: { options: { timeout: 1 } } })], {
        Loop: { main: [[], to("Old")] },
        Old: { main: [to("Work")] },
        Work: { main: [to("Loop")] },
      }),
    );
    expect(fixedWorkflow(r).connections).toEqual({ Loop: { main: [[], to("Work")] }, Work: { main: [to("Loop")] } });
  });

  it("removes a disabled trigger", () => {
    const r = fix(exported([disabled("Old trigger", T.schedule), node("Hook", T.webhook), node("Next", T.set)], { "Old trigger": { main: [to("Next")] }, Hook: { main: [to("Next")] } }));
    expect((fixedWorkflow(r).nodes as { name: string }[]).map((n) => n.name)).toEqual(["Hook", "Next"]);
  });

  it("refuses when an AI node is connected, when another node reads it by name, or when the name is duplicated", () => {
    const ai = fix(exported([node("Agent", T.agent), disabled("Model", T.model)], { Model: { ai_languageModel: [[{ node: "Agent", type: "ai_languageModel", index: 0 }]] } }));
    expect(ai.skipped.find((s) => s.node === "Model")?.reason).toContain("AI node");
    const read = fix(exported([node("Hook", T.webhook), disabled("Old"), node("Use", T.set, { parameters: { v: "={{ $('Old').item.json.x }}" } })], link("Hook", "Old", "Use")));
    expect(read.skipped.find((s) => s.node === "Old")?.reason).toContain("reads its data by name");
    const dup = fix(exported([node("Hook", T.webhook), disabled("Same"), node("Same", T.set)], link("Hook", "Same")));
    expect(dup.applied.some((a) => a.ruleId === "maintainability/disabled-nodes")).toBe(false);
  });
});

describe("fixWorkflow: never removes a Respond to Webhook node", () => {
  it("keeps an unconnected or disabled responder, since a webhook may need it to exist", () => {
    const hook = node("Hook", T.webhook, { parameters: { responseMode: "responseNode" } });
    for (const extra of [{}, { disabled: true }]) {
      const r = fix(exported([hook, node("Work", T.set), node("Reply", "n8n-nodes-base.respondToWebhook", extra)], { Hook: { main: [to("Work")] } }));
      expect((fixedWorkflow(r).nodes as { name: string }[]).map((n) => n.name)).toContain("Reply");
      expect(r.skipped.find((s) => s.node === "Reply")?.reason).toContain("Respond to Webhook");
    }
  });
});

describe("fixWorkflow: never removes a node that is still read by name", () => {
  const usedBy = (expr: string, name = "Old") =>
    fix(
      exported(
        [node("Hook", T.webhook), node(name, T.set, { disabled: true }), node("Use", T.code, { parameters: { jsCode: `return ${expr};` } })],
        { Hook: { main: [to(name)] }, [name]: { main: [to("Use")] } },
      ),
    );
  const blocked = (r: Ok, name = "Old") => r.skipped.some((s) => s.node === name);

  it.each([
    ["$('Old').item.json.x"],
    ['$node["Old"].json.x'],
    ['$("Old").first()'],
    ["$(`Old`).all()"],
    ['$items("Old")'],
    ["$items('Old', 0)"],
  ])("blocks %s", (expr) => {
    expect(blocked(usedBy(expr))).toBe(true);
  });

  it("handles quotes inside the name, and doesn't confuse similar names", () => {
    expect(blocked(usedBy('$("My \\"Old\\" node").x', 'My "Old" node'), 'My "Old" node')).toBe(true);
    expect(blocked(usedBy("$('Older').x"))).toBe(false);
  });

  it("removes 3,000 disabled nodes in a row quickly and joins the ends", () => {
    const nodes: object[] = [node("Hook", T.webhook)];
    const connections: Record<string, unknown> = {};
    let prev = "Hook";
    for (let i = 0; i < 3000; i++) {
      nodes.push(node(`D${i}`, T.set, { disabled: true }));
      connections[prev] = { main: [to(`D${i}`)] };
      prev = `D${i}`;
    }
    nodes.push(node("End", T.set));
    connections[prev] = { main: [to("End")] };
    const start = performance.now();
    const r = fix(exported(nodes, connections));
    expect(performance.now() - start).toBeLessThan(1500);
    expect(fixedWorkflow(r).connections).toEqual({ Hook: { main: [to("End")] } });
  });

  it("finishes in one call when a removal makes another fix possible", () => {
    // Removing the disabled trigger leaves "Only fed by it" with no connections: an orphan, removed too.
    const r = fix(
      exported([node("Old trigger", T.schedule, { disabled: true }), node("Only fed by it", T.set), node("Hook", T.webhook), node("Next", T.set)], {
        "Old trigger": { main: [to("Only fed by it")] },
        Hook: { main: [to("Next")] },
      }),
    );
    expect((fixedWorkflow(r).nodes as { name: string }[]).map((n) => n.name)).toEqual(["Hook", "Next"]);
    expect(fixWorkflow(r.fixed)).toMatchObject({ ok: true, applied: [] });
  });

  it("drops a loop made only of disabled nodes", () => {
    const r = fix(
      exported([node("Hook", T.webhook), node("A", T.set, { disabled: true }), node("B", T.set, { disabled: true })], {
        Hook: { main: [to("A")] },
        A: { main: [to("B")] },
        B: { main: [to("A")] },
      }),
    );
    expect(fixedWorkflow(r).connections).toEqual({ Hook: { main: [[]] } });
  });
});

describe("fixWorkflow: guarantees", () => {
  const messy = exported(
    [
      { ...node("Hook", T.webhook), id: "n1", webhookId: "wh-1", extraField: { keep: true } },
      { ...node("Call", T.http), id: "n2", credentials: { httpHeaderAuth: { id: "c1", name: "Key" } }, parameters: { url: "https://a.com", options: {} } },
      { ...node("Old", T.set), id: "n3", disabled: true },
      { ...node("Note", T.sticky), id: "n4", parameters: { content: "hi" } },
    ],
    link("Hook", "Call", "Old"),
    { pinData: { Hook: [{ json: { x: 1 } }] }, tags: [{ name: "prod" }], staticData: { lastId: 5 } },
  );

  it("converges: the fixed findings don't come back", () => {
    const r = fix(messy, { timezone: "UTC" });
    const after = findingIds(r.fixed);
    for (const a of r.applied) expect(after).not.toContain(`${a.ruleId}|${a.node ?? ""}`);
  });

  it("is idempotent", () => {
    const once = fix(messy, { timezone: "UTC" });
    const twice = fix(once.fixed, { timezone: "UTC" });
    expect(twice.json).toBe(once.json);
    expect(twice.applied).toEqual([]);
  });

  it("changes only what it reports, and keeps ids, credentials and unknown fields", () => {
    const r = fix(messy);
    const fixed = fixedWorkflow(r);
    const nodes = fixed.nodes as Record<string, unknown>[];
    expect(nodes.map((n) => n.id)).toEqual(["n1", "n2", "n4"]);
    expect(nodes[0]!.extraField).toEqual({ keep: true });
    expect(nodes[1]!.credentials).toEqual({ httpHeaderAuth: { id: "c1", name: "Key" } });
    expect(fixed).toMatchObject({ id: "wf1", versionId: "v-123", meta: { instanceId: "abc" }, tags: [{ name: "prod" }], staticData: { lastId: 5 } });
    // Compare everything except the removed node, which shifts array indexes.
    const withoutOld = { ...messy, nodes: messy.nodes.filter((n) => (n as { name: string }).name !== "Old") };
    const changed = changedPaths(withoutOld, fixed);
    const allowed = /^(nodes\[\d\]\.(retryOnFail|maxTries|waitBetweenTries|parameters\.options\.timeout)|settings\.executionTimeout|pinData\.Hook|connections\.(Call|Old)(\..*)?)$/;
    expect(changed.filter((p) => !allowed.test(p))).toEqual([]);
  });

  it("keeps the template API wrapper shape", () => {
    const wrapped = { workflow: { id: 9, name: "T", workflow: exported([node("Call", T.http)]) } };
    const r = fix(wrapped);
    const out = r.fixed as { workflow: { workflow: { nodes: { retryOnFail?: boolean }[] }; id: number } };
    expect(out.workflow.id).toBe(9);
    expect(out.workflow.workflow.nodes[0]!.retryOnFail).toBe(true);
  });

  it("never mutates its input", () => {
    const input = JSON.parse(JSON.stringify(messy));
    fix(input, { timezone: "UTC" });
    expect(input).toEqual(messy);
  });

  it("accepts a JSON string (with a byte-order mark) and rejects junk", () => {
    expect(fixWorkflow(String.fromCharCode(0xfeff) + JSON.stringify(messy)).ok).toBe(true);
    expect(fixWorkflow("{nope")).toMatchObject({ ok: false });
    expect(fixWorkflow({ hello: 1 })).toMatchObject({ ok: false });
  });

  it("handles names like __proto__ and constructor", () => {
    const input = JSON.parse(JSON.stringify(exported([node("__proto__", T.webhook), node("constructor", T.http)], { __proto__: { main: [to("constructor")] } })));
    const r = fix(input);
    const nodes = fixedWorkflow(r).nodes as Record<string, unknown>[];
    expect(nodes[1]).toMatchObject({ retryOnFail: true });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("handles unicode, emoji and 500-character names, in fixes, splices and name references", () => {
    const long = "L".repeat(500);
    const input = exported(
      [
        node("Hook 🚀", T.webhook),
        node("Récupérer les données", T.http),
        node("旧ステップ", T.set, { disabled: true }),
        node(long, T.set),
        node("Reader 😀", T.set, { parameters: { value: `={{ $('${long}').item.json.x }}` } }),
      ],
      { "Hook 🚀": { main: [to("Récupérer les données")] }, "Récupérer les données": { main: [to("旧ステップ")] }, "旧ステップ": { main: [to(long)] }, [long]: { main: [to("Reader 😀")] } },
    );
    const r = fix(input);
    const wf = fixedWorkflow(r) as { nodes: { name: string; retryOnFail?: boolean }[]; connections: Record<string, { main: { node: string }[][] }> };
    expect(wf.nodes.find((n) => n.name === "Récupérer les données")?.retryOnFail).toBe(true);
    expect(wf.nodes.map((n) => n.name)).not.toContain("旧ステップ");
    expect(wf.connections["Récupérer les données"]!.main[0]![0]!.node).toBe(long);
    expect(wf.nodes.map((n) => n.name)).toContain(long);
  });

  it("fixes a 10,000-node workflow quickly (under 1.5 s, leaving room for slow CI machines)", () => {
    const nodes = [node("Hook", T.webhook), ...Array.from({ length: 10000 }, (_, i) => node(`N${i}`, T.http))];
    const connections: Record<string, unknown> = { Hook: { main: [to("N0")] } };
    for (let i = 0; i < 9999; i++) connections[`N${i}`] = { main: [to(`N${i + 1}`)] };
    const start = performance.now();
    const r = fix(exported(nodes, connections));
    expect(performance.now() - start).toBeLessThan(1500);
    expect(r.applied.filter((a) => a.ruleId === "error-handling/no-retry")).toHaveLength(10000);
  });
});
