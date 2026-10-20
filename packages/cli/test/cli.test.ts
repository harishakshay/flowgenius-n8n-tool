import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineOf, run } from "../src/index.js";

const fixture = readFileSync(join(import.meta.dirname, "../../core/test/fixtures/basic-export.json"), "utf8");

const clean = JSON.stringify(
  {
    name: "Clean",
    nodes: [
      { name: "New order", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], parameters: { authentication: "headerAuth" } },
      {
        name: "Create CRM contact",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [200, 0],
        retryOnFail: true,
        parameters: { url: "https://crm.acme.com/contacts", options: { timeout: 30000 } },
      },
    ],
    connections: { "New order": { main: [[{ node: "Create CRM contact", type: "main", index: 0 }]] } },
    settings: { errorWorkflow: "42", executionTimeout: 300, timezone: "Asia/Kolkata" },
  },
  null,
  2,
);

let dir: string;
let out: string;
let err: string;
const io = () => ({ cwd: dir, stdout: (s: string) => void (out += s), stderr: (s: string) => void (err += s), isTty: false });
const cli = (...args: string[]) => run(args, io());

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "preflight-"));
  out = "";
  err = "";
  mkdirSync(join(dir, "workflows"));
  writeFileSync(join(dir, "workflows", "orders.json"), fixture);
  writeFileSync(join(dir, "workflows", "clean.json"), clean);
  writeFileSync(join(dir, "package.json"), '{"name":"x"}');
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep", "wf.json"), fixture);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("n8n-preflight CLI", () => {
  it("scans a folder, skips non-workflow JSON and node_modules, and fails on high findings", () => {
    expect(cli(".")).toBe(1);
    expect(out).toContain("workflows/orders.json  score 70/100");
    expect(out).toContain("workflows/clean.json  score 100/100");
    expect(out).toContain("2 workflows checked");
    expect(out).toContain("1 non-workflow JSON file skipped");
    expect(out).not.toContain("node_modules");
  });

  it("points findings at the line of the node", () => {
    cli("workflows/orders.json");
    expect(out).toContain("workflows/orders.json:8  \"Webhook\" accepts calls from anyone.");
  });

  it("passes when nothing reaches --fail-on, and with --fail-on none", () => {
    expect(cli("workflows/clean.json")).toBe(0);
    expect(cli("--fail-on", "critical", "workflows/orders.json")).toBe(0);
    expect(cli("--fail-on", "none", ".")).toBe(0);
    expect(cli("--fail-on", "medium", "workflows/orders.json")).toBe(1);
  });

  it("honours --disable", () => {
    expect(cli("--disable", "security/webhook-no-auth", "workflows/orders.json")).toBe(0);
  });

  it("writes JSON with results and skipped files", () => {
    cli("-f", "json", ".");
    const report = JSON.parse(out);
    expect(report.results.map((r: { file: string }) => r.file)).toEqual(["workflows/clean.json", "workflows/orders.json"]);
    expect(report.skipped).toEqual([{ file: "package.json", reason: expect.stringContaining("nodes") }]);
  });

  it("writes valid SARIF 2.1.0 to a file, with every result pointing at a rule and a line", () => {
    expect(cli("-f", "sarif", "-o", join(dir, "out.sarif"), ".")).toBe(1);
    const sarif = JSON.parse(readFileSync(join(dir, "out.sarif"), "utf8"));
    expect(sarif.version).toBe("2.1.0");
    const run0 = sarif.runs[0];
    const ruleIds = run0.tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toHaveLength(25);
    expect(run0.results.length).toBeGreaterThan(0);
    for (const r of run0.results) {
      expect(ruleIds[r.ruleIndex]).toBe(r.ruleId);
      expect(r.locations[0].physicalLocation.artifactLocation.uri).toMatch(/^workflows\//);
      expect(r.locations[0].physicalLocation.region.startLine).toBeGreaterThanOrEqual(1);
    }
    expect(out).toContain("score"); // a text summary still goes to the screen
  });

  it("fails loudly for a named file that is not a workflow, and warns about broken JSON in folders", () => {
    writeFileSync(join(dir, "workflows", "broken.json"), "{broken");
    expect(cli("workflows/broken.json")).toBe(1);
    expect(out).toContain("error workflows/broken.json");
    out = "";
    cli("--fail-on", "none", "workflows");
    expect(out).toContain("warning workflows/broken.json: skipped");
  });

  it("rejects bad usage with exit code 2", () => {
    expect(cli()).toBe(2);
    expect(cli("missing-folder")).toBe(2);
    expect(cli("--format", "xml", ".")).toBe(2);
    expect(cli("--fail-on", "sometimes", ".")).toBe(2);
    expect(cli("--disable", "made/up", ".")).toBe(2);
    expect(cli("--nope", ".")).toBe(2);
    expect(err).toContain("Unknown rule: made/up");
  });

  it("prints help", () => {
    expect(cli("--help")).toBe(0);
    expect(out).toContain("Usage: n8n-preflight");
  });
});

describe("lineOf", () => {
  it("finds the node's name line, tolerating spacing, and falls back to line 1", () => {
    const text = '{\n  "nodes": [\n    {\n      "name" :  "A \\"quoted\\" name"\n    }\n  ]\n}';
    expect(lineOf(text, 'A "quoted" name')).toBe(4);
    expect(lineOf(text, "missing")).toBe(1);
    expect(lineOf(text, undefined)).toBe(1);
  });
});
