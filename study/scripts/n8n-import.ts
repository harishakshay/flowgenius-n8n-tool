// Phase 4 validation against a real n8n: does n8n accept the fixed workflows, and keep the fixes?
//
// Saves each workflow through n8n's REST API (the call the editor makes when you save) and reads it
// back. Every template is saved twice: the original (the control) and the fixed copy. A failure only
// counts against the fixer when n8n accepts the original but not the fixed copy, or loses a fix.
//
// Sample: one niche at a time, AI-agent workflows (those with a LangChain Agent node): a seeded
// random 50 of them, plus every one where the fixer removed nodes, the riskiest change.
// Each pair (original, fixed, change list) is written to study/output/n8n-import/pairs/ for review.
//
// Needs a throwaway n8n on N8N_URL (default http://localhost:5678). It creates a local test owner on
// first run and keeps the generated login in study/output/n8n-import/owner.json (gitignored).
// Usage: tsx study/scripts/n8n-import.ts [sampleSize] [seed]   (defaults: 50, 20261024)

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixWorkflow } from "@n8n-preflight/core";
import { outputDir, readCorpus } from "./corpus.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The workflow object inside a template record (templates may be wrapped). */
function unwrap(data: unknown): Obj | null {
  let current = data;
  for (let i = 0; i < 3; i++) {
    if (!isObj(current)) return null;
    if (Array.isArray(current.nodes)) return current;
    current = current.workflow;
  }
  return null;
}

const BASE = process.env.N8N_URL ?? "http://localhost:5678";
const SAMPLE = Number(process.argv[2] ?? 50);
const SEED = Number(process.argv[3] ?? 20261024);
const dir = join(outputDir, "n8n-import");
const NICHE = "AI-agent workflows";
const AGENT = "@n8n/n8n-nodes-langchain.agent";
const inNiche = (wf: Obj | null): boolean =>
  !!wf && Array.isArray(wf.nodes) && wf.nodes.some((n) => isObj(n) && n.type === AGENT);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- n8n session ----

let cookie = "";
const headers = () => ({ "content-type": "application/json", "browser-id": "n8n-preflight-import-test", cookie });

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Obj | null; text: string }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const setCookie = res.headers.get("set-cookie");
  const auth = setCookie?.match(/n8n-auth=[^;]+/)?.[0];
  if (auth) cookie = auth;
  const text = await res.text();
  let json: Obj | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObj(parsed)) json = parsed;
  } catch {
    // not JSON
  }
  return { status: res.status, json, text };
}

async function signIn(): Promise<void> {
  const ownerFile = join(dir, "owner.json");
  let owner: { email: string; password: string };
  if (existsSync(ownerFile)) {
    owner = JSON.parse(readFileSync(ownerFile, "utf8")) as typeof owner;
  } else {
    owner = { email: "preflight-test@example.test", password: `Pf1${randomBytes(12).toString("hex")}` };
    writeFileSync(ownerFile, JSON.stringify(owner));
  }
  const setup = await call("POST", "/rest/owner/setup", { ...owner, firstName: "Preflight", lastName: "Test" });
  if (setup.status === 200 && cookie) return;
  const login = await call("POST", "/rest/login", { emailOrLdapLoginId: owner.email, email: owner.email, password: owner.password });
  if (login.status !== 200 || !cookie) throw new Error(`Could not sign in to n8n (${login.status}): ${login.text.slice(0, 200)}`);
}

// ---- comparison ----

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) => (isObj(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));

const NODE_FIELDS = ["parameters", "retryOnFail", "maxTries", "waitBetweenTries", "disabled", "onError", "continueOnFail", "type"];

/** Differences between what was sent and what n8n stored. */
function differences(sent: Obj, stored: Obj): string[] {
  const out: string[] = [];
  const sentNodes = (sent.nodes as Obj[]).filter(isObj);
  const storedNodes = Array.isArray(stored.nodes) ? (stored.nodes as unknown[]).filter(isObj) : [];
  const byName = new Map(storedNodes.map((n) => [n.name, n]));
  if (storedNodes.length !== sentNodes.length) out.push(`node count ${sentNodes.length} -> ${storedNodes.length}`);
  for (const n of sentNodes) {
    const s = byName.get(n.name);
    if (!s) {
      out.push(`node "${String(n.name)}" missing`);
      continue;
    }
    for (const f of NODE_FIELDS) if (canon(n[f]) !== canon(s[f])) out.push(`node.${f}`);
  }
  if (canon(sent.connections) !== canon(stored.connections)) out.push("connections");
  const sentSettings = isObj(sent.settings) ? sent.settings : {};
  const storedSettings = isObj(stored.settings) ? stored.settings : {};
  for (const [k, v] of Object.entries(sentSettings)) if (canon(v) !== canon(storedSettings[k])) out.push(`settings.${k}`);
  const sentPins = isObj(sent.pinData) ? Object.keys(sent.pinData).length : 0;
  const storedPins = isObj(stored.pinData) ? Object.keys(stored.pinData).length : 0;
  if (sentPins !== storedPins) out.push(`pinData ${sentPins} -> ${storedPins}`);
  return [...new Set(out)];
}

function body(wf: Obj, name: string): Obj {
  const settings = typeof wf.settings === "string" ? (JSON.parse(wf.settings) as unknown) : wf.settings;
  return {
    name,
    nodes: wf.nodes,
    connections: wf.connections ?? {},
    settings: isObj(settings) ? settings : {},
    ...(isObj(wf.pinData) ? { pinData: wf.pinData } : {}),
    active: false,
  };
}

async function save(wf: Obj, name: string): Promise<{ ok: true; diffs: string[] } | { ok: false; error: string }> {
  const sent = body(wf, name);
  const created = await call("POST", "/rest/workflows", sent);
  const data = created.json && isObj(created.json.data) ? created.json.data : null;
  if (created.status !== 200 || !data || typeof data.id !== "string") {
    const message = created.json && typeof created.json.message === "string" ? created.json.message : created.text.slice(0, 160);
    return { ok: false, error: `${created.status} ${message}` };
  }
  const read = await call("GET", `/rest/workflows/${data.id}`);
  const stored = read.json && isObj(read.json.data) ? read.json.data : null;
  if (!stored) return { ok: false, error: `read back failed: ${read.status}` };
  return { ok: true, diffs: differences(sent, stored) };
}

// ---- main ----

async function main(): Promise<void> {
  mkdirSync(dir, { recursive: true });
  // /healthz answers before the database is migrated; wait for readiness.
  for (let i = 0; ; i++) {
    const ready = await fetch(`${BASE}/healthz/readiness`).then((r) => r.ok, () => false);
    if (ready) break;
    if (i >= 120) throw new Error(`n8n at ${BASE} is not ready`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  await signIn();
  const settingsRes = await call("GET", "/rest/settings");
  const settingsData = settingsRes.json && isObj(settingsRes.json.data) ? settingsRes.json.data : {};
  const n8nVersion = typeof settingsData.versionCli === "string" ? settingsData.versionCli : (process.env.N8N_VERSION ?? "unknown");

  // Pick the sample: every template with a removal, plus a seeded random SAMPLE of the rest.
  const records: { id: number; name: string; workflow: unknown }[] = [];
  for await (const r of readCorpus()) if (inNiche(unwrap(r.workflow))) records.push({ id: r.id, name: r.name, workflow: r.workflow });
  mkdirSync(join(dir, "pairs"), { recursive: true });
  const random = mulberry32(SEED);
  const shuffled = records.map((r) => ({ r, k: random() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const randomIds = new Set(shuffled.slice(0, SAMPLE).map((r) => r.id));

  const rows: { id: number; group: string; original: string; fixed: string; pruned: string; originalDiffs: string[]; fixedDiffs: string[]; prunedDiffs: string[] }[] = [];
  let checked = 0;
  for (const rec of records) {
    // Both modes: the default fixes, and the same with --remove-unused.
    const fix = fixWorkflow(rec.workflow, { timezone: "UTC" });
    const prune = fixWorkflow(rec.workflow, { timezone: "UTC", removeUnused: true });
    if (!fix.ok || !prune.ok) continue;
    const removed = prune.applied.some((a) => a.paths.some((p) => p.startsWith("nodes[name=")));
    if (!removed && !randomIds.has(rec.id)) continue;
    const original = unwrap(rec.workflow);
    const fixed = unwrap(fix.fixed);
    const pruned = unwrap(prune.fixed);
    if (!original || !fixed || !pruned) continue;

    const a = await save(original, `${rec.id} original`);
    const b = await save(fixed, `${rec.id} fixed`);
    const c = removed ? await save(pruned, `${rec.id} fixed, unused removed`) : b;
    const pair = { id: rec.id, name: rec.name, before: fix.before, after: fix.after, applied: fix.applied, skipped: fix.skipped, removed: prune.applied.filter((x) => !fix.applied.includes(x) && x.paths.some((p) => p.startsWith("nodes[name="))), original, fixed };
    writeFileSync(join(dir, "pairs", `${rec.id}.json`), `${JSON.stringify(pair, null, 2)}
`);
    rows.push({
      id: rec.id,
      group: removed ? "removal" : "random",
      original: a.ok ? "saved" : a.error,
      fixed: b.ok ? "saved" : b.error,
      pruned: c.ok ? "saved" : c.error,
      originalDiffs: a.ok ? a.diffs : [],
      fixedDiffs: b.ok ? b.diffs : [],
      prunedDiffs: c.ok ? c.diffs : [],
    });
    if (++checked % 10 === 0) console.log(`${checked} templates checked`);
  }

  const originalsSaved = rows.filter((r) => r.original === "saved");
  // A fix is at fault when the original saved but the fixed copy did not, or the fixed copy lost
  // something the original kept.
  const regressions = originalsSaved.filter(
    (r) =>
      r.fixed !== "saved" ||
      r.pruned !== "saved" ||
      [...r.fixedDiffs, ...r.prunedDiffs].some((d) => !r.originalDiffs.includes(d)),
  );
  const count = (group: string) => rows.filter((r) => r.group === group).length;
  const report = {
    n8nVersion,
    niche: NICHE,
    nicheSize: records.length,
    method: "POST /rest/workflows then GET /rest/workflows/:id on a local, throwaway n8n",
    seed: SEED,
    templates: rows.length,
    randomSample: count("random"),
    withRemovals: count("removal"),
    originalsSaved: originalsSaved.length,
    fixedSaved: rows.filter((r) => r.fixed === "saved").length,
    prunedSaved: rows.filter((r) => r.group === "removal" && r.pruned === "saved").length,
    fixedSavedWhereOriginalSaved: originalsSaved.filter((r) => r.fixed === "saved").length,
    regressions: regressions.length,
    successRate: originalsSaved.length ? +(1 - regressions.length / originalsSaved.length).toFixed(4) : 0,
    originalFailures: rows.filter((r) => r.original !== "saved").map((r) => ({ id: r.id, error: r.original })).slice(0, 20),
    differencesInOriginals: tally(rows.flatMap((r) => r.originalDiffs)),
    firstRegressions: regressions.slice(0, 30),
  };
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.successRate < 0.99) process.exit(1);
}

function tally(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
