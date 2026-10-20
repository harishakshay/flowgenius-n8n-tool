import { describe, expect, it } from "vitest";
import { T, hits, node, workflow } from "./helpers.js";

// Fake keys built at runtime so this file never contains a string that looks like a real secret.
const OPENAI = ["sk", "proj", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("-");
const GITHUB = `ghp_${"aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5"}`;
const TELEGRAM = `1234567890:AA${"Fq3kZ8wP2mR7tY4uI9oL1aS6dG5hJ0kXc"}`;

const http = (parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  node("Call", T.http, { parameters, ...extra });

describe("security/hardcoded-secret", () => {
  const id = "security/hardcoded-secret";

  it("finds known key formats anywhere in parameters, and masks them", () => {
    const found = hits(id, workflow([http({ body: `{"key":"${OPENAI}"}` })]));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("OpenAI API key");
    expect(found[0]!.message).not.toContain(OPENAI);
    expect(hits(id, workflow([http({ url: `https://api.telegram.org/bot${TELEGRAM}/sendMessage` })]))).toHaveLength(1);
    expect(hits(id, workflow([node("Code", T.code, { parameters: { jsCode: `const t = "${GITHUB}";` } })]))).toHaveLength(1);
  });

  it("finds fixed values in auth headers", () => {
    const headers = { parameters: [{ name: "Authorization", value: "Bearer 9f8e7d6c5b4a39281706f5e4" }] };
    expect(hits(id, workflow([http({ headerParameters: headers })]))).toHaveLength(1);
  });

  it("scans disabled nodes too, since they are still in the export", () => {
    expect(hits(id, workflow([http({ body: OPENAI }, { disabled: true })]))).toHaveLength(1);
  });

  it("ignores expressions, placeholders and sticky notes", () => {
    const headers = (value: string) => ({ parameters: [{ name: "Authorization", value }] });
    expect(hits(id, workflow([http({ headerParameters: headers("=Bearer {{ $json.token }}") })]))).toHaveLength(0);
    expect(hits(id, workflow([http({ headerParameters: headers("Bearer YOUR_API_KEY") })]))).toHaveLength(0);
    expect(hits(id, workflow([http({ headerParameters: headers("Bearer <your-token-here>") })]))).toHaveLength(0);
    expect(hits(id, workflow([http({ body: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx" })]))).toHaveLength(0);
    expect(hits(id, workflow([node("Note", T.sticky, { parameters: { content: OPENAI } })]))).toHaveLength(0);
  });

  it("reports one secret once, even if it is also in a header", () => {
    const headers = { parameters: [{ name: "Authorization", value: `Bearer ${OPENAI}` }] };
    expect(hits(id, workflow([http({ headerParameters: headers })]))).toHaveLength(1);
  });
});

describe("security/secret-in-url", () => {
  const id = "security/secret-in-url";

  it("finds sensitive query parameters with fixed values", () => {
    expect(hits(id, workflow([http({ url: "https://api.a.com/v1?api_key=9f8e7d6c5b4a3928&q=x" })]))).toHaveLength(1);
    const query = { parameters: [{ name: "token", value: "9f8e7d6c5b4a39281706" }] };
    expect(hits(id, workflow([http({ queryParameters: query })]))).toHaveLength(1);
  });

  it("ignores expressions, short values and harmless names", () => {
    expect(hits(id, workflow([http({ url: "=https://a.com?api_key={{ $json.key }}" })]))).toHaveLength(0);
    expect(hits(id, workflow([http({ url: "https://a.com?key=abc" })]))).toHaveLength(0);
    expect(hits(id, workflow([http({ url: "https://a.com?page=12345678901234" })]))).toHaveLength(0);
  });

  it("leaves known key formats to hardcoded-secret", () => {
    expect(hits(id, workflow([http({ url: `https://a.com?key=${OPENAI}` })]))).toHaveLength(0);
  });
});

describe("security/webhook-no-auth", () => {
  const id = "security/webhook-no-auth";

  it("fires without authentication", () => {
    expect(hits(id, workflow([node("Hook", T.webhook)]))).toHaveLength(1);
    expect(hits(id, workflow([node("Hook", T.webhook, { parameters: { authentication: "none" } })]))).toHaveLength(1);
  });

  it("is quiet with header or basic auth", () => {
    expect(hits(id, workflow([node("Hook", T.webhook, { parameters: { authentication: "headerAuth" } })]))).toHaveLength(0);
  });
});

describe("security/code-eval", () => {
  const id = "security/code-eval";
  const code = (parameters: Record<string, unknown>) => workflow([node("Code", T.code, { parameters })]);

  it("finds eval and new Function in JavaScript, exec and shell calls in Python", () => {
    expect(hits(id, code({ jsCode: "return eval(items[0].json.expr);" }))).toHaveLength(1);
    expect(hits(id, code({ jsCode: "const f = new Function('a', body);" }))).toHaveLength(1);
    expect(hits(id, code({ language: "python", pythonCode: "import os\nos.system(cmd)" }))).toHaveLength(1);
  });

  it("ignores words that only look similar", () => {
    expect(hits(id, code({ jsCode: "const evaluation = evaluate(x); // eval later" }))).toHaveLength(0);
    expect(hits(id, code({ pythonCode: "executor = run(x)" }))).toHaveLength(0);
  });
});

describe("security/command-injection", () => {
  const id = "security/command-injection";

  it("fires when a shell command contains expressions", () => {
    const wf = workflow([node("Dig", T.exec, { parameters: { command: "=dig {{ $json.domain }} +short" } })]);
    expect(hits(id, wf)).toHaveLength(1);
  });

  it("is quiet for fixed commands", () => {
    expect(hits(id, workflow([node("Disk", T.exec, { parameters: { command: "df -h" } })]))).toHaveLength(0);
  });
});

describe("security/insecure-transport", () => {
  const id = "security/insecure-transport";

  it("fires for plain http to public hosts and for skipped certificate checks", () => {
    expect(hits(id, workflow([http({ url: "http://api.example.com/v1" })]))).toHaveLength(1);
    expect(hits(id, workflow([http({ url: "https://a.com", options: { allowUnauthorizedCerts: true } })]))).toHaveLength(1);
  });

  it("is quiet for https and for local or private hosts", () => {
    for (const url of ["https://api.example.com", "http://localhost:3000", "http://ollama:11434/api", "http://192.168.1.5/x", "http://10.0.0.2", "http://nas.local/x"]) {
      expect(hits(id, workflow([http({ url })]))).toHaveLength(0);
    }
  });
});
