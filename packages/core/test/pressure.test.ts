// Adversarial inputs from the Phase 1 code review. Each one broke, or was wrong, before its fix.

import { describe, expect, it } from "vitest";
import { analyze, parseWorkflow, rules } from "../src/index.js";
import { mask } from "../src/rules/security.js";
import { walkStrings } from "../src/values.js";
import { T, hits, node, workflow } from "./helpers.js";

const to = (n: string) => [{ node: n, type: "main", index: 0 }];
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (role: string) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", ref: "abcdefghijklmnop", role, iat: 1700000000, exp: 2000000000 })}.Xy9kLm2Np4Qr6St8Uv0Wx3Yz5Ab7Cd9Ef`;

describe("secrets", () => {
  it("detects AWS access keys (all caps with digits, not a placeholder)", () => {
    const key = `AKIA${"Q7XK2M9PLR4TZ8WD"}`;
    expect(hits("security/hardcoded-secret", workflow([node("Call", T.http, { parameters: { body: key } })]))).toHaveLength(1);
  });

  it("still treats ALL_CAPS names as placeholders", () => {
    const headers = (value: string) => ({ parameters: [{ name: "x-api-key", value }] });
    expect(hits("security/hardcoded-secret", workflow([node("Call", T.http, { parameters: { headerParameters: headers("OPENAI_API_KEY_2") } })]))).toHaveLength(0);
  });

  it("reports a Supabase service key but not the public anon key", () => {
    const header = (value: string) => node("Call", T.http, { parameters: { headerParameters: { parameters: [{ name: "apikey", value }] } } });
    expect(hits("security/hardcoded-secret", workflow([header(jwt("anon"))]))).toHaveLength(0);
    expect(hits("security/hardcoded-secret", workflow([header(jwt("service_role"))]))).toHaveLength(1);
  });

  it("masks at most a sixth of a secret", () => {
    expect(mask("abcdefghijkl")).toBe("ab…(12 chars)");
    expect(mask("abcdefghijklmnopqrstuvwxyz0123")).toBe("abcd…(30 chars)");
  });
});

describe("parser robustness", () => {
  it("reads files that start with a UTF-8 byte-order mark", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseWorkflow(`${bom}${JSON.stringify({ nodes: [], connections: {} })}`).ok).toBe(true);
    expect(parseWorkflow(`FEFF${JSON.stringify({ nodes: [] })}`).ok).toBe(false);
  });

  it("keeps connections of a node named __proto__ and does not touch prototypes", () => {
    const input = JSON.parse('{"nodes":[{"name":"__proto__","type":"t","typeVersion":1,"position":[0,0]},{"name":"B","type":"t","typeVersion":1,"position":[0,0]}],"connections":{"__proto__":{"main":[[{"node":"B","type":"main","index":0}]]}}}');
    const result = parseWorkflow(input);
    if (!result.ok) throw new Error("parse failed");
    expect(result.workflow.connections["__proto__"]?.main).toEqual([[{ node: "B", type: "main", index: 0 }]]);
    expect(({} as Record<string, unknown>).main).toBeUndefined();
    expect(hits("maintainability/orphan-nodes", input)).toHaveLength(0);
  });

  it("treats node names like constructor and toString as plain names", () => {
    const wf = workflow([node("constructor", T.set), node("toString", T.set)], { constructor: { main: [to("toString")] } });
    const result = analyze(wf);
    expect(result.ok && result.ruleErrors).toEqual([]);
    expect(hits("maintainability/orphan-nodes", wf)).toHaveLength(0);
  });

  it("walks 20,000-deep parameters without crashing a rule", () => {
    let deep: Record<string, unknown> = { v: "x" };
    for (let i = 0; i < 20000; i++) deep = { a: deep };
    const result = analyze(workflow([node("Deep", T.http, { parameters: deep })]));
    expect(result.ok && result.ruleErrors).toEqual([]);
    expect(walkStrings({ a: ["x", { b: "y" }], c: "z" }).map((s) => s.path)).toEqual(["a[0]", "a[1].b", "c"]);
  });

  it("keeps the first of two nodes with the same name", () => {
    const wf = workflow([node("Dup", T.http, { retryOnFail: true }), node("Dup", T.set)]);
    const result = analyze(wf);
    expect(result.ok && result.findings.some((f) => f.ruleId === "data/broken-connections")).toBe(true);
  });
});

describe("node classification", () => {
  it("does not treat a manual chat trigger as production", () => {
    expect(hits("error-handling/no-error-workflow", workflow([node("Chat", "@n8n/n8n-nodes-langchain.manualChatTrigger")]))).toHaveLength(0);
  });

  it("does not ask for retries on Respond to Chat or LangChain Code", () => {
    expect(hits("error-handling/no-retry", workflow([node("Reply", "@n8n/n8n-nodes-langchain.chat"), node("Logic", "@n8n/n8n-nodes-langchain.code")]))).toHaveLength(0);
  });

  it("counts a retry setting of 1 try as no retry", () => {
    expect(hits("error-handling/no-retry", workflow([node("Call", T.http, { retryOnFail: true, maxTries: 1 })]))).toHaveLength(1);
    expect(hits("error-handling/no-retry", workflow([node("Call", T.http, { retryOnFail: true, maxTries: 3 })]))).toHaveLength(0);
  });
});

describe("error outputs on multi-output nodes", () => {
  const id = "error-handling/unconnected-error-output";
  const classifier = node("Classify", "@n8n/n8n-nodes-langchain.textClassifier", { onError: "continueErrorOutput" });
  const cats = [node("A", T.set), node("B", T.set), node("C", T.set)];

  it("does not guess which classifier slot is the error output", () => {
    const wf = workflow([classifier, ...cats, node("Err", T.slack)], { Classify: { main: [to("A"), to("B"), to("C"), to("Err")] } });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("still fires when only the first output exists", () => {
    expect(hits(id, workflow([classifier, ...cats], { Classify: { main: [to("A")] } }))).toHaveLength(1);
  });

  it("does not misread a node with more outputs than we know about", () => {
    const http = node("Call", T.http, { onError: "continueErrorOutput" });
    const wf = workflow([http, node("A", T.set), node("B", T.set), node("C", T.set)], { Call: { main: [to("A"), [], to("C")] } });
    expect(hits(id, wf)).toHaveLength(0);
  });
});

describe("schedules, webhooks, transport, code", () => {
  it("treats timezone DEFAULT as no timezone", () => {
    const daily = node("Daily", T.schedule, { parameters: { rule: { interval: [{ triggerAtHour: 9 }] } } });
    expect(hits("reliability/schedule-no-timezone", workflow([daily], {}, { settings: { timezone: "DEFAULT" } }))).toHaveLength(1);
  });

  it("checks payment callbacks for auth, but not OAuth callbacks", () => {
    expect(hits("security/webhook-no-auth", workflow([node("Stripe payment callback", T.webhook, { parameters: { path: "payment-callback" } })]))).toHaveLength(1);
    expect(hits("security/webhook-no-auth", workflow([node("OAuth callback", T.webhook)]))).toHaveLength(0);
    expect(hits("security/webhook-no-auth", workflow([node("Google Auth Callback", T.webhook)]))).toHaveLength(0);
    expect(hits("security/webhook-no-auth", workflow([node("Twilio Status Callback", T.webhook)]))).toHaveLength(1);
  });

  it("checks http URLs whose path has expressions, but not a computed host", () => {
    const call = (url: string) => workflow([node("Call", T.http, { parameters: { url } })]);
    expect(hits("security/insecure-transport", call("=http://api.acme-corp.com/users/{{ $json.id }}"))).toHaveLength(1);
    expect(hits("security/insecure-transport", call("=http://{{ $json.host }}/x"))).toHaveLength(0);
    expect(hits("security/insecure-transport", call("=http://api{{ $json.env }}.acme.com/x"))).toHaveLength(0);
  });

  it("skips placeholder hosts and the certificate flag on plain http", () => {
    const call = (url: string, options: object = {}) => workflow([node("Call", T.http, { parameters: { url, options } })]);
    expect(hits("security/insecure-transport", call("http://XX.XX.XX:6333/collections"))).toHaveLength(0);
    expect(hits("security/insecure-transport", call("http://your-api.com"))).toHaveLength(0);
    expect(hits("security/insecure-transport", call("http://localhost:5678/api", { allowUnauthorizedCerts: true }))).toHaveLength(0);
    expect(hits("security/insecure-transport", call("https://self-signed.acme.com", { allowUnauthorizedCerts: true }))).toHaveLength(1);
  });

  it("finds child_process in JavaScript and dangerous calls in LangChain code nodes", () => {
    const js = node("Run", T.code, { parameters: { jsCode: "const { execSync } = require('child_process'); return [];" } });
    expect(hits("security/code-eval", workflow([js]))[0]?.message).toContain("child_process");
    const lc = node("Tool", "@n8n/n8n-nodes-langchain.toolCode", { parameters: { jsCode: "return eval(query);" } });
    expect(hits("security/code-eval", workflow([lc]))).toHaveLength(1);
    const regexExec = node("Parse", T.code, { parameters: { jsCode: "const m = /a/.exec(s); return [];" } });
    expect(hits("security/code-eval", workflow([regexExec]))).toHaveLength(0);
  });

  it("treats values from a fixed Set node as configuration, not outside data", () => {
    const config = node("Config", T.set, { parameters: { assignments: { assignments: [{ name: "dir", value: "/backups" }] } } });
    const cmd = (command: string) => node("Run", T.exec, { parameters: { command } });
    expect(hits("security/command-injection", workflow([config, cmd("=tar -czf {{ $('Config').item.json.dir }}/b.tgz /data")]))).toHaveLength(0);
    const dynamic = node("Config", T.set, { parameters: { assignments: { assignments: [{ name: "dir", value: "={{ $json.path }}" }] } } });
    expect(hits("security/command-injection", workflow([dynamic, cmd("=ls {{ $('Config').item.json.dir }}")]))).toHaveLength(1);
  });
});

describe("noise and engine edge cases", () => {
  it("does not call a pasted selection with no connections orphaned", () => {
    expect(hits("maintainability/orphan-nodes", workflow([node("Call", T.http), node("Set", T.set)]))).toHaveLength(0);
  });

  it("records a rule that throws a non-Error", () => {
    const thrower = { ...rules[0]!, id: "reliability/thrower", check: () => { throw "boom"; } };
    const result = analyze(workflow([node("A", T.set)]), { rules: [thrower] });
    expect(result.ok && result.ruleErrors).toEqual([{ ruleId: "reliability/thrower", message: "boom" }]);
  });

  it("keeps endless-loop off unless enabled", () => {
    const wf = workflow([node("A", T.http)], { A: { main: [to("A")] } });
    const off = analyze(wf);
    const on = analyze(wf, { enable: ["reliability/endless-loop"] });
    expect(off.ok && off.findings.some((f) => f.ruleId === "reliability/endless-loop")).toBe(false);
    expect(on.ok && on.findings.some((f) => f.ruleId === "reliability/endless-loop")).toBe(true);
  });
});

describe("performance on huge workflows", () => {
  // Budgets are loose so slow CI machines pass; before the fix these took 7 and 10 seconds.
  it("scans a 3,000-node chain of continue-on-fail nodes quickly", () => {
    const chain = Array.from({ length: 3000 }, (_, i) =>
      node(`S${i}`, T.http, { onError: "continueRegularOutput", parameters: { url: "https://a.com", body: "x".repeat(200) } }),
    );
    const connections: Record<string, unknown> = {};
    for (let i = 0; i < chain.length - 1; i++) connections[`S${i}`] = { main: [to(`S${i + 1}`)] };
    const start = performance.now();
    analyze(workflow(chain, connections));
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("scans a 10,000-node loop quickly, with a short message", () => {
    const nodes = Array.from({ length: 10000 }, (_, i) => node(`N${i}`, T.set));
    const connections: Record<string, unknown> = {};
    for (let i = 0; i < nodes.length; i++) connections[`N${i}`] = { main: [to(`N${(i + 1) % nodes.length}`)] };
    const start = performance.now();
    const result = analyze(workflow(nodes, connections), { enable: ["reliability/endless-loop"] });
    expect(performance.now() - start).toBeLessThan(1500);
    const loop = result.ok ? result.findings.find((f) => f.ruleId === "reliability/endless-loop") : undefined;
    expect(loop?.message.length).toBeLessThan(200);
  });
});
