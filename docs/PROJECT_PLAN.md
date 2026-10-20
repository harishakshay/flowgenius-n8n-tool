# FlowGenius X-ray: Project Plan

**Owner:** Harish Akshay H · **Builder:** Claude Code · **Status:** Phase 0 not started · **Plan date:** 2026-10-20

---

## 1. Objective

Ship an open-source tool that checks n8n workflows for production failures and fixes them, then get real teams to use it.

**Outcome:** a resume project with measured, verifiable usage numbers, plus a public study.

## 2. Problem

- n8n workflows fail in production because of missing error handling, missing retries, missing timeouts, leaked secrets, and loops with no exit.
- n8n's AI Assistant debugs a workflow **after** it fails. No established tool checks a workflow **before** it ships.
- Teams have no CI gate for n8n workflows.

## 3. Deliverables

| # | Deliverable | Where it lives |
|---|---|---|
| D1 | `@flowgenius/xray-core`: a rule engine that scores a workflow JSON file | npm |
| D2 | Web app that runs in the browser (workflow never leaves the machine) | xray.flowgenius.in |
| D3 | CLI: `npx flowgenius-xray workflow.json` | npm |
| D4 | GitHub Action: fails a PR when a workflow breaks the rules | GitHub Marketplace |
| D5 | Auto-fixer: rule-based fixes, plus AI fixes checked in a sandboxed n8n | Web app + CLI |
| D6 | Public study: every public n8n template scanned, findings published | flowgenius.in + repo |
| D7 | Metrics dashboard: users, scans, downloads, CI installs | Private, shared on request |

## 4. Success metrics

Targets below are goals. Resume numbers come only from measured data.

| Metric | Source | Target (week 20) |
|---|---|---|
| Workflows scanned | Web and CLI counters (anonymous) | 5,000 |
| Unique users | Cloudflare Web Analytics | 2,000 |
| npm downloads per month | npm stats | 1,000 |
| Repos running the Action | GitHub code search | 25 |
| Rule precision (findings correct) | Hand-labelled sample of 200 | ≥ 95% |
| Auto-fixes that import and run cleanly | Sandbox results | ≥ 90% |
| Median scan time | Benchmark | < 200 ms |

## 5. Scope

**In:** n8n workflow JSON (exported or copied from the canvas); 25 rules in v1; findings in text, JSON and SARIF formats; auto-fix; public study.

**Out (v1):** connecting to a live n8n instance; monitoring running executions; other platforms (Make, Zapier); paid features.

## 6. Architecture

```
flowgenius-xray/                     TypeScript monorepo (pnpm)
├── packages/core      Parser, rule engine, scoring, fixers. Pure TS, no I/O. Runs in browser and Node.
├── packages/cli       Node CLI on top of core. Output: text, JSON, SARIF. Exit code for CI.
├── packages/action    GitHub Action that wraps the CLI. Uploads SARIF to GitHub code scanning.
├── apps/web           Vite + React static site. Core runs in a Web Worker. Hosted on Cloudflare Pages.
├── services/verify    Sandboxed n8n in Docker on a small VPS. Imports each fixed workflow, dry-runs it.
├── services/ai-fix    Cloudflare Worker. Calls Claude for fixes the rules can't do. Holds the API key.
├── study/             Template downloader, batch scanner, report generator.
└── docs/              This plan, rule reference, architecture decisions.
```

**Key decisions**

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript | n8n is TypeScript; one engine for browser, CLI and Action |
| Where scans run | In the browser | Privacy (workflows can hold API keys), $0 hosting, instant |
| Telemetry | Anonymous counts only (rule IDs triggered, scan count) | No workflow content ever stored |
| AI use | Only for fixes rules can't express; every AI fix is checked in the sandbox | Never return a broken fix |
| Hosting | Cloudflare Pages + Worker (free tier); VPS only for the sandbox | WordPress on Hostinger stays as it is |

## 7. Rule set v1 (25 rules)

| Category | Rules |
|---|---|
| Error handling (6) | No error workflow set · Critical node (HTTP, database, AI) without retry · `continueOnFail` swallowing errors with nothing checking downstream · Error output not connected · No error notification path · Trigger with no failure handling |
| Reliability (6) | HTTP Request without timeout · Workflow execution timeout not set · Loop with no exit condition · "Return All" on unbounded lists · Webhook response mode mismatch · Wait node longer than the execution limit |
| Security (5) | Hard-coded API key or token in parameters · Credential in URL query string · Webhook with no authentication · `eval`/`exec` in Code node · Secrets written to logs or output |
| Data (4) | Pinned test data left in production · Unhandled empty input · Missing pagination · Unsafe expression (no null check) |
| Maintainability (4) | Default node names ("HTTP Request1") · Disabled nodes left in · Orphan nodes not connected · No workflow description |

Each rule ships with an ID, a severity, an explanation, a FlowGenius article link, test files that should and shouldn't trigger it, and an auto-fix where one is possible.

## 8. Phases

Each phase ends with a review by Harish, then commit and push.

### Phase 0: Foundations (week 1)
- Repo, monorepo setup, CI (lint, test, build), license (MIT).
- TypeScript types for the n8n workflow format, checked against real exports.
- Corpus: download all public n8n templates. The template API needs confirming here.
- **Exit:** the parser reads 100% of the corpus; CI is green.

### Phase 1: Rule engine (weeks 2–3)
- Engine, scoring formula (0–100), all 25 rules with tests.
- Precision check: label 200 findings by hand and measure.
- **Exit:** ≥ 95% precision; median scan under 200 ms; `xray-core` v0.1 on npm.

### Phase 2: Delivery surfaces (weeks 3–4)
- Web app: drag and drop or paste, score, findings, "copy fixed workflow".
- CLI with text, JSON and SARIF output; GitHub Action on the Marketplace.
- `xray.flowgenius.in` live; links from every Failure Library page.
- **Exit:** all three surfaces live; scanning a workflow takes under 10 seconds end to end.

### Phase 3: Public study (week 5)
- Scan every public template. Publish: share of workflows with each risk, the worst patterns, and the method.
- **Exit:** report on flowgenius.in and in the repo; dataset and scripts reproducible.

### Phase 4: Auto-fix and verification (weeks 6–7)
- Rule-based fixes (retries, timeouts, error workflow stub, renaming).
- AI fixes through the Worker for complex cases.
- Sandbox: import every fixed workflow into n8n and dry-run it.
- **Exit:** ≥ 90% of fixes import and run cleanly; results logged.

### Phase 5: Launch and growth (weeks 8–20)
- Launch posts: FlowGenius, n8n community forum, r/n8n, LinkedIn, X, Show HN.
- Weekly: answer real "my workflow failed" forum posts with X-ray results.
- Metrics review every Monday; ship one improvement a week from user feedback.
- **Exit:** week-20 metrics recorded; resume lines updated with real numbers.

## 9. Roles

| Area | Claude | Harish |
|---|---|---|
| Code, tests, CI, deploys | Builds all of it | Reviews each phase |
| Rule design | Drafts | Approves using FlowGenius failure knowledge |
| Precision labels | Pre-labels | Final check |
| Study write-up | Drafts | Edits and publishes |
| Distribution | Drafts posts | Posts as himself; talks to users |
| Accounts and keys | — | GitHub, npm, Cloudflare, DNS, Anthropic API |

## 10. What Harish learns, per phase

| Phase | Concepts to explain in an interview |
|---|---|
| 0 | Monorepos, CI pipelines, data formats and type safety |
| 1 | Static analysis, rule engines, measuring precision |
| 2 | Web Workers, client-side privacy, SARIF, GitHub Actions |
| 3 | Running a reproducible study at scale |
| 4 | Sandboxing, verifying AI output, cost control |
| 5 | Product analytics, retention, user feedback loops |

## 11. Risks

| Risk | Mitigation |
|---|---|
| n8n adds a built-in checker | Ship first; the CI Action and the study stay unique; a built-in version validates the idea |
| Template API changes or is rate-limited | Cache the corpus in Phase 0 |
| False positives annoy users | 95% precision gate; per-rule disable switch |
| Low adoption | Forum answers each week; Failure Library links; study launch |
| AI fix breaks a workflow | No AI fix is returned without passing the sandbox |

## 12. Decisions needed from Harish before Phase 0

1. Name: **FlowGenius X-ray** (default) or another name.
2. Public GitHub repo under `harishakshay` from day one: yes or no.
3. Subdomain: `xray.flowgenius.in`. Requires DNS access at Hostinger.
4. Accounts: npm and Cloudflare (both free). Anthropic API key needed only from Phase 4.

## 13. Start here

1. Harish answers the four decisions in section 12.
2. Claude runs Phase 0: repo, CI, workflow types, template corpus.
3. Phase 0 review, then commit and push.
