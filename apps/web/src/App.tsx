import { rules } from "@n8n-preflight/core";
import type { AnalyzeResult, Severity } from "@n8n-preflight/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { GRADE_LABEL, SEVERITIES, countBySeverity, groupByRule, toMarkdown } from "./report";
import { SAMPLE_WORKFLOW } from "./sample";
import { latestId, scan } from "./scan";

const REPO = "https://github.com/harishakshay/flowgenius-n8n-tool";
const MAX_BYTES = 20 * 1024 * 1024;

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "done"; result: Extract<AnalyzeResult, { ok: true }>; ms: number };

export function App() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const check = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setState({ kind: "scanning" });
    const { id, done } = scan(text);
    let response;
    try {
      response = await done;
    } catch (err) {
      if (id === latestId()) setState({ kind: "error", message: `Something went wrong while checking: ${(err as Error).message}` });
      return;
    }
    const { result, ms } = response;
    if (id !== latestId()) return; // a newer scan started meanwhile
    if (!result.ok) {
      setState({ kind: "error", message: friendlyError(result.parseIssues[0]?.code) });
    } else {
      setState({ kind: "done", result, ms });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const readFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        setState({ kind: "error", message: "That file is over 20 MB, which is far bigger than any n8n workflow." });
        return;
      }
      await check(await file.text());
    },
    [check],
  );

  // Ctrl+V anywhere on the page (outside the text box) checks the clipboard straight away.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof Element && e.target.closest("textarea, input")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim().startsWith("{")) {
        e.preventDefault();
        void check(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [check]);

  const reset = () => {
    setState({ kind: "idle" });
    setPasted("");
  };

  return (
    <div className="page">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => (e.preventDefault(), reset())}>
          <Logo /> n8n Preflight <span className="by">by FlowGenius</span>
        </a>
        <nav>
          <a href="https://flowgenius.in">Blog</a>
          <a href={`${REPO}/blob/main/docs/RULES.md`}>Rules</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </header>

      <main>
        {state.kind === "done" ? (
          <Results result={state.result} ms={state.ms} onReset={reset} />
        ) : (
          <section className="hero">
            <h1>Will your n8n workflow survive production?</h1>
            <p className="lede">
              Drop in a workflow and get a production-readiness score in seconds. {rules.length} checks for the problems
              that break automations: missing error handling, retries and timeouts, leaked API keys, open webhooks.
            </p>

            <div
              className={`drop${dragging ? " dragging" : ""}`}
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void readFile(file);
              }}
            >
              <p className="drop-title">Drop a workflow .json file here</p>
              <div className="actions">
                <button className="primary" onClick={() => fileInput.current?.click()}>
                  Choose file
                </button>
                <button onClick={() => void check(JSON.stringify(SAMPLE_WORKFLOW))}>Try a sample workflow</button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            <label className="paste">
              <span>Or paste the workflow JSON (in n8n: select all nodes, Ctrl+C)</span>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='{ "nodes": [ ... ], "connections": { ... } }'
                spellCheck={false}
                rows={6}
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={!pasted.trim() || state.kind === "scanning"} onClick={() => void check(pasted)}>
                {state.kind === "scanning" ? "Checking..." : "Check workflow"}
              </button>
            </div>

            {state.kind === "error" && (
              <p className="error" role="alert">
                {state.message}
              </p>
            )}

            <p className="privacy">
              <LockIcon /> Runs entirely in your browser. Your workflow, and any keys in it, never leave this page.
            </p>
          </section>
        )}
      </main>

      <footer>
        <p>
          Tested on all 12,074 public n8n templates. In a held-out check, 96.5% of sampled findings were correct.{" "}
          <a href={`${REPO}/blob/main/study/precision/README.md`}>How we measured</a>
        </p>
        <p>
          Open source (MIT) · <a href="https://flowgenius.in">FlowGenius</a>: automation that doesn't break in production
        </p>
      </footer>
    </div>
  );
}

function friendlyError(code: string | undefined): string {
  if (code === "invalid-json") {
    return "That isn't valid JSON. In n8n, select all nodes and press Ctrl+C, or use the workflow menu's Download, then try again.";
  }
  return "This JSON isn't an n8n workflow: it has no nodes. Copy the nodes from the n8n canvas, or download the workflow file.";
}

function Results({ result, ms, onReset }: { result: Extract<AnalyzeResult, { ok: true }>; ms: number; onReset: () => void }) {
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const counts = countBySeverity(result.findings);
  const groups = groupByRule(result.findings, rules);
  const shown = filter === "all" ? groups : groups.filter((g) => g.rule.severity === filter);
  const nodes = result.workflow.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote").length;

  const copy = async () => {
    await navigator.clipboard.writeText(toMarkdown({ name: result.workflow.name, score: result.score, grade: result.grade, groups }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="results">
      <div className={`summary ${result.grade}`}>
        <ScoreRing score={result.score} />
        <div className="summary-text">
          <p className="grade">{GRADE_LABEL[result.grade]}</p>
          <h2>{result.workflow.name ?? "Your workflow"}</h2>
          <p className="meta">
            {nodes} node{nodes === 1 ? "" : "s"} · {result.findings.length} finding{result.findings.length === 1 ? "" : "s"} · checked in{" "}
            {ms < 1 ? "<1" : Math.round(ms)} ms
          </p>
          <div className="actions">
            <button className="primary" onClick={onReset}>
              Check another workflow
            </button>
            <button onClick={() => void copy()}>{copied ? "Copied" : "Copy report"}</button>
          </div>
        </div>
      </div>

      {result.findings.length > 0 && (
        <div className="filters" role="group" aria-label="Filter by severity">
          <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")}>
            All {result.findings.length}
          </button>
          {SEVERITIES.filter((s) => counts[s]).map((s) => (
            <button key={s} className={`chip ${s}${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
              {s} {counts[s]}
            </button>
          ))}
        </div>
      )}

      {result.findings.length === 0 && <p className="clean">No problems found. This workflow follows every production check we have.</p>}

      <ul className="groups">
        {shown.map(({ rule, findings }) => (
          <li key={rule.id} className="group">
            <div className="group-head">
              <span className={`pill ${rule.severity}`}>{rule.severity}</span>
              <h3>{rule.title}</h3>
              {findings.length > 1 && <span className="count">{findings.length}</span>}
            </div>
            <p className="why">{rule.description}</p>
            <ul className="hits">
              {findings.map((f, i) => (
                <li key={i}>{f.message}</li>
              ))}
            </ul>
            <p className="rule-foot">
              <code>{rule.id}</code>
              {rule.docsUrl && (
                <a href={rule.docsUrl} target="_blank" rel="noopener">
                  How to fix it on FlowGenius →
                </a>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="60" cy="60" r={r} className="ring-track" />
      <circle cx="60" cy="60" r={r} className="ring-value" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      <text x="60" y="66" textAnchor="middle" className="ring-text">
        {score}
      </text>
    </svg>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#ea4b71" />
      <path d="M10 16.5l4 4 8-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
