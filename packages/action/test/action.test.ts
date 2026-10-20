import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotation, input } from "../src/github.js";
import { main } from "../src/main.js";

const fixture = readFileSync(join(import.meta.dirname, "../../core/test/fixtures/basic-export.json"), "utf8");

let dir: string;
let log: string;
const env = (inputs: Record<string, string>) => ({
  GITHUB_WORKSPACE: dir,
  GITHUB_OUTPUT: join(dir, "out"),
  GITHUB_STEP_SUMMARY: join(dir, "summary"),
  ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
});
const runAction = (inputs: Record<string, string>) => main(env(inputs), (s) => void (log += s));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "preflight-action-"));
  log = "";
  writeFileSync(join(dir, "orders.json"), fixture);
  writeFileSync(join(dir, "out"), "");
  writeFileSync(join(dir, "summary"), "");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("GitHub Action", () => {
  it("annotates findings, most severe first, and fails on high by default", () => {
    expect(runAction({ path: ".", "fail-on": "high", "sarif-file": "out.sarif", annotations: "true" })).toBe(1);
    const annotations = log.split("\n").filter((l) => l.startsWith("::"));
    expect(annotations[0]).toMatch(/^::error file=orders.json,line=8,title=n8n Preflight%3A security\/webhook-no-auth::/);
    expect(annotations.slice(1).every((a) => a.startsWith("::warning"))).toBe(true);
  });

  it("sets outputs, writes a job summary and a SARIF file", () => {
    runAction({ path: ".", "fail-on": "none", "sarif-file": "out.sarif" });
    expect(readFileSync(join(dir, "out"), "utf8")).toBe("workflows=1\nfindings=4\nlowest-score=70\nsarif-file=out.sarif\n");
    const summary = readFileSync(join(dir, "summary"), "utf8");
    expect(summary).toContain("| `orders.json` | ⚠️ 70 | 0 | 1 | 3 | 0 |");
    expect(summary).toContain("**high** `orders.json:8`");
    expect(JSON.parse(readFileSync(join(dir, "out.sarif"), "utf8")).version).toBe("2.1.0");
  });

  it("passes with fail-on none, and can skip annotations and SARIF", () => {
    expect(runAction({ path: ".", "fail-on": "none", "sarif-file": "", annotations: "false" })).toBe(0);
    expect(log).not.toContain("::warning");
  });

  it("rejects bad inputs with exit code 2", () => {
    expect(runAction({ path: ".", "fail-on": "sometimes" })).toBe(2);
    expect(runAction({ path: ".", disable: "made/up" })).toBe(2);
    expect(runAction({ path: "missing" })).toBe(2);
    expect(log).toContain("::error::Unknown rule: made/up");
  });
});

describe("workflow commands", () => {
  it("escapes data and properties", () => {
    expect(annotation("warning", "50% done\nnext", { file: "a,b:c.json", line: 3, title: "t: x" })).toBe(
      "::warning file=a%2Cb%3Ac.json,line=3,title=t%3A x::50%25 done%0Anext\n",
    );
  });

  it("reads hyphenated inputs the way the runner sets them", () => {
    expect(input("fail-on", { "INPUT_FAIL-ON": " medium " })).toBe("medium");
    expect(input("missing", {})).toBe("");
  });
});
