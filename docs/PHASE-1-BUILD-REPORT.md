# Phase 1 build report: rule engine, scoring and 25 rules

What Phase 1 built, file by file. How each part works, every problem found in it, and how each was resolved. Everything here is traced to the code and the git history.

| | |
|---|---|
| Commits | `b06ab31` (build, 2026-10-20) and `55c5367` (review fixes, 2026-10-20) |
| Built on | Phase 0, `fd97b42`: monorepo, types, parser, corpus tools |
| Size at end of Phase 1 | 16 source files (1,842 lines), 8 test files (130 tests), 7 study scripts |
| Result | 25 rules; all 12,074 public n8n templates scanned with 0 crashes; median scan 0.31 ms; precision 96.5% on a held-out sample |

## Contents

1. [What Phase 1 is](#1-what-phase-1-is)
2. [The technical base](#2-the-technical-base)
3. [Architecture: how a scan flows](#3-architecture-how-a-scan-flows)
4. [Every file and its purpose](#4-every-file-and-its-purpose)
5. [How each component works](#5-how-each-component-works)
6. [The 25 rules](#6-the-25-rules)
7. [How the build was validated](#7-how-the-build-was-validated)
8. [Problems found and how each was resolved](#8-problems-found-and-how-each-was-resolved)
9. [Holes and gaps still open](#9-holes-and-gaps-still-open)
10. [Numbers to remember](#10-numbers-to-remember)

---

## 1. What Phase 1 is

Phase 0 could *read* any n8n workflow. Phase 1 made it *judge* one: give it a workflow JSON, and it returns every production problem it finds, a 0-100 score and a grade.

```
analyze(workflowJson)  →  { findings[], score: 0-100, grade: ready | needs-work | not-ready }
```

Everything else in the project (the CLI, GitHub Action, website, template study and auto-fix) is built on this one function.

**Exit criteria (from the plan)** and how Phase 1 met them:

| Criterion | Result |
|---|---|
| 25 rules, each with tests that must fire and must stay quiet | 25 rules, 130 tests |
| Run on the whole template corpus without crashing | 12,074 of 12,074, 0 crashes |
| Precision of 95% or more on a labelled sample | 96.5% (193 of 200) on a held-out sample |
| Publish `core` v0.1 to npm | **Deferred**: no npm account yet ([DECISIONS.md](DECISIONS.md)) |

---

## 2. The technical base

### The stack, and why each piece

| Piece | Version | Why |
|---|---|---|
| TypeScript | 5.9.3 | Types catch wrong field names in n8n's loosely shaped JSON before runtime |
| `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | — | The strictest settings. `noUncheckedIndexedAccess` makes `array[i]` possibly `undefined`, which forces handling of missing nodes and slots, the most common bug source when reading user JSON |
| npm workspaces | npm 10 | Monorepo with no extra tool (pnpm wasn't installed; see DECISIONS) |
| Vitest | 4.1.12 | Fast tests, native ESM and TypeScript |
| ESLint + typescript-eslint | 10.13 / 8.72 | Lint, plus `consistent-type-imports` so type-only imports vanish from output |
| tsx | 4.23.15 | Runs the TypeScript study scripts directly |
| ES modules, `NodeNext` | ES2022 target | One module format for Node and, later, the browser |
| **Zero runtime dependencies** | — | The core runs in Node, in browsers and in a GitHub Action. Nothing to audit or bundle. That's why even base64 decoding is hand-written (`values.ts`) |

### Build and quality gates

```
npm run check   =   eslint .   +   tsc -b && tsc -p tsconfig.check.json   +   vitest run
```

- `tsc -b` builds `packages/core` with project references (`composite: true`), emitting `dist/` with `.d.ts` files.
- `tsconfig.check.json` type-checks the tests and study scripts too, without emitting.
- **CI** (`.github/workflows/ci.yml`) runs `npm ci`, `build` and `check` on every push and pull request, across 4 combinations: Ubuntu and Windows × Node 20 and 22. Windows is there because n8n users are on Windows too (line endings, paths, BOMs).

### The data base: the template corpus (from Phase 0)

- `download-corpus.ts` fetched every public template from n8n's template API: 12,074 workflows, 252,965 nodes.
- They're stored locally as `study/corpus/templates.jsonl.gz`, one JSON per line, gzipped.
- **Never committed** (`.gitignore`): it's n8n's data. Only aggregate results go into the repo.
- This corpus is the test bed for everything: crash-testing, performance and precision.

---

## 3. Architecture: how a scan flows

```
 input (string or object)
   │
   ▼
 parse.ts ── parseWorkflow() ─────────► Workflow (typed, normalised)  +  ParseIssue[]
   │   lenient: recoverable problems become warnings; only "not a workflow" fails
   ▼
 graph.ts ── buildGraph() ────────────► WorkflowGraph (built once, shared by every rule)
   │   byName, active nodes, next/prev edges, AI links, downstream, cycles
   ▼
 engine.ts ── analyze() ── for each rule in rules/index.ts:
   │            skip if disabled, or off by default and not enabled
   │            try { rule.check(graph) → RuleHit[] }  catch → ruleErrors (never stops other rules)
   │            add rule id, severity, category → Finding
   ▼
 sort findings: severity, then rule id
   ▼
 score.ts ── scoreFindings() ─────────► { score 0-100, grade }
```

**Design principles:**

1. **Parse once, graph once.** Rules never re-read the raw JSON. They all query the same graph, so a scan stays fast.
2. **Rules are isolated.** Each is a plain object with a `check(graph)` function. A rule that throws is recorded in `ruleErrors`, and the other 24 still run.
3. **Lenient input, strict output.** Real exports vary across n8n versions, so the parser accepts anything recoverable and records a warning. The findings themselves are precise: one line, a node and a path.
4. **Rules report facts; the engine adds metadata.** A rule returns `{ message, node?, path? }`, and the engine attaches id, severity and category. No rule can mislabel its own severity.

---

## 4. Every file and its purpose

### 4.1 Core source: `packages/core/src/` (16 files, 1,842 lines)

| File | Lines | Phase | Purpose |
|---|---|---|---|
| `types.ts` | 99 | 0 | TypeScript model of n8n's workflow JSON: `WorkflowNode`, `Connections`, `WorkflowSettings`, `Workflow`, `ParseIssue`, `ParseResult`. Field names match n8n exactly |
| `parse.ts` | 283 | 0 (+1 fixes) | `parseWorkflow()`: turns any input (file export, canvas copy, template API response, JSON string) into a normalised `Workflow` plus warnings |
| `values.ts` | 108 | 1 | Helpers for node parameters: `isExpression`, `isLiteral`, `walkStrings` (every string with its path), `get`, `namedPairs`, `isPlaceholder`, `decodeBase64` |
| `node-types.ts` | 111 | 1 | What the rules know about node types: the `NODE` constants, `isTrigger`, `isProductionTrigger`, `isManualTrigger`, `isInternalNode`, `isToolNode`, `regularOutputCount`, `canExitLoop` |
| `graph.ts` | 145 | 1 | `buildGraph()`: the read-only graph view all rules share, with iterative Tarjan's algorithm for cycles |
| `rule.ts` | 43 | 1 | The contract: `Rule`, `RuleHit`, `Finding`, `Severity`, `Category` |
| `engine.ts` | 73 | 1 | `analyze()`: parse → graph → run rules safely → sort → score |
| `score.ts` | 30 | 1 | `scoreFindings()`: severity points, repeat cap, grade |
| `index.ts` | 10 | 0/1 | Public API: `analyze`, `buildGraph`, `parseWorkflow`, `rules`, `scoreFindings`, `SEVERITY_POINTS` and the types |
| `rules/index.ts` | 18 | 1 | Assembles the 25 rules in category order and attaches each FlowGenius docs link |
| `rules/error-handling.ts` | 148 | 1 | 5 rules, plus shared helpers `errorMode()`, `externalCallNodes()`, `retries()` |
| `rules/reliability.ts` | 236 | 1 | 7 rules, plus schedule parsing (`schedules()`, cron reading) and loop-exit logic |
| `rules/security.ts` | 347 | 1 | 6 rules, plus 13 secret formats, `mask()`, `isPublicJwt()`, `insertsItemData()`, `isPrivateHost()`, `isPlaceholderHost()` |
| `rules/data.ts` | 92 | 1 | 3 rules, plus shared `isDefaultName()` and `list()` (formats "A", "B" and 3 more) |
| `rules/maintainability.ts` | 70 | 1 | 4 rules |
| `rules/docs-links.ts` | 29 | 1 | Rule id → FlowGenius article URL (22 of 25 rules have one) |

### 4.2 Tests: `packages/core/test/` (8 files, 130 tests)

| File | Tests | What it proves |
|---|---|---|
| `parse.test.ts` | 13 | The parser reads exports, template API wrappers and canvas copies; skips bad nodes; drops dangling connections; keeps null output slots; handles duplicate names, string settings, numeric strings, unnamed sticky notes, old credential format |
| `engine.test.ts` | 9 | The 25 rule ids are unique and match their category; scoring maths, the repeat cap and grade bands; non-workflow input; a well-built workflow scores 100; sorting; `disable`; one throwing rule doesn't stop the rest |
| `rules-error-handling.test.ts` | 18 | Each of the 5 error-handling rules fires when it should and stays quiet when it shouldn't |
| `rules-reliability.test.ts` | 17 | The same for the 7 reliability rules |
| `rules-security.test.ts` | 16 | The same for the 6 security rules |
| `rules-data-maintainability.test.ts` | 13 | The same for the 3 data and 4 maintainability rules |
| `regressions.test.ts` | 18 | Every false-positive pattern found in precision rounds 1 and 2, frozen as a test so it can never come back |
| `pressure.test.ts` | 26 | Every issue from the line-by-line code review: adversarial inputs, prototype pollution, 20,000-deep nesting, 3,000 and 10,000-node workflows |
| `helpers.ts` | — | Test builders: `T` (node type constants), `node()`, `link()`, `hits()` |
| `fixtures/basic-export.json` | — | A small real-shaped n8n export used across tests |

**Test pattern:** every rule has at least one *must fire* and one *must stay quiet* case. The quiet cases matter as much: they're what keeps precision high.

### 4.3 Study scripts: `study/scripts/` (7 files)

| File | Purpose |
|---|---|
| `corpus.ts` | Shared reader for the gzipped corpus (`readCorpus()` async generator), plus paths |
| `download-corpus.ts` | Downloads every public template. Resumable, 4 requests at a time, backoff, a named User-Agent; stops retrying on permanent 4xx errors |
| `parse-corpus.ts` | Phase 0 exit check: the parser must read every template |
| `scan-corpus.ts` | Runs all rules over the corpus, writes counts, scores and timing, and draws a seeded, rule-stratified precision sample. Can exclude earlier samples' templates |
| `show-sample.ts` | Prints each sampled finding with the evidence needed to label it by hand |
| `dump-findings.ts` | Dumps every finding to JSONL and diffs two rule versions: which findings a change added or removed |
| `rules-doc.ts` | Generates `docs/RULES.md` from the rule definitions, so docs can't drift from code |

### 4.4 Precision evidence: `study/precision/`

| File | Content |
|---|---|
| `README.md` | Method, results per round, what the number means, limits, open patterns |
| `dev-sample.json` / `dev-labels.json` | Round 1: 200 findings from rules v1, 20 false positives (90.0%) |
| `test-sample.json` / `test-labels.json` | Round 2: 200 fresh findings from rules v2, 17 false positives (91.5%) |
| `holdout-sample.json` / `holdout-labels.json` | Round 3: 200 held-out findings from rules v3, 7 false positives (**96.5%**) |
| `v4-added-labels.json` | After the code review: all 72 newly added findings, each labelled (68 correct, 94.4%) |
| `scan-report.json` | Corpus scan summary: per-rule counts, score distribution, timing |

### 4.5 Configuration and docs

| File | Purpose |
|---|---|
| `package.json` | Workspace root: scripts (`check`, `corpus:*`, `docs:rules`), pinned dev dependencies, Node ≥ 20 |
| `packages/core/package.json` | `@n8n-preflight/core`: ESM `exports` map, `sideEffects: false`, ships only `dist` |
| `tsconfig.base.json` | Shared strict compiler settings |
| `tsconfig.json` | Project references root (core) |
| `packages/core/tsconfig.json` | Composite build, `src` → `dist`, no ambient types (so the browser build can't accidentally use Node APIs) |
| `tsconfig.check.json` | Type-checks tests and scripts without emitting |
| `eslint.config.js` | Flat config: JS recommended, typescript-eslint recommended, type-import rule |
| `vitest.config.ts` | Test file pattern |
| `.github/workflows/ci.yml` | 4-way CI matrix |
| `.gitignore` | Keeps the corpus and its outputs out of git |
| `docs/PROJECT_PLAN.md` | The original plan (never edited) |
| `docs/DECISIONS.md` | Every deviation from the plan, with the reason |
| `docs/RULES.md` | Generated rule reference |

---

## 5. How each component works

### 5.1 Parser (`parse.ts`)

**The problem:** n8n workflow JSON comes in at least three shapes, and differs across n8n versions.

**How it works:**

1. **Strings → JSON**, stripping a UTF-8 byte-order mark first (Windows editors add one).
2. **`unwrap()`** finds the workflow: it looks for a `nodes` array at the top, under `workflow`, or under `workflow.workflow` (template API responses).
3. **`parseNodes()`** checks each node:
   - A node with no string `name` or `type` is skipped, with a warning.
   - A missing `typeVersion` defaults to 1, and a missing `position` to [0, 0].
   - Known fields are copied only if their type is right.
   - Unknown `onError` values are ignored rather than guessed.
   - Unnamed sticky notes get unique names.
   - Duplicate names produce a warning.
4. **`parseConnections()`** keeps only connections whose source and target nodes exist. Dangling ones become `dangling-connection` warnings, and `data/broken-connections` reports them later. Null output slots are kept, because n8n uses them for unconnected outputs.
5. **`parseSettings()`** accepts settings stored as a JSON string, and an `executionTimeout` stored as a string.
6. **`dict()`**: every map keyed by node names uses `Object.create(null)`, so a node named `__proto__` is just a key and can't corrupt the object.

**Output:** `{ ok: true, workflow, issues }`, or `{ ok: false, issues }` only when the input isn't a workflow at all.

### 5.2 Graph (`graph.ts`)

Built once per scan. Everything the rules need about structure:

| Member | What it gives | How |
|---|---|---|
| `byName` | name → node | Map; on duplicates the **first** node wins, as in n8n's editor |
| `active` | nodes that run | not sticky notes, not disabled |
| `next` / `prev` | main-flow edges | Two adjacency maps built in one pass over connections; deduplicated |
| `outputTargets(name, slot)` | targets of one output | For error outputs (slot after the regular ones) |
| `outputSlots(name)` | number of output slots | Including empty ones |
| `isAiSubNode(name)` | feeds an AI node only | Has `ai_*` connections and no main-flow edges (models, memory, tools) |
| `downstream(name)` | everything reachable | Iterative depth-first walk with a seen set |
| `cycles()` | loops | **Tarjan's strongly connected components, iterative** (an explicit work stack, so a 10,000-node loop can't overflow the call stack); keeps groups larger than 1, or a node linking to itself |
| `isLinked(name)` | has any connection | Any type, in or out |

### 5.3 Engine (`engine.ts`)

```ts
for (const rule of rules) {
  if (disabled.has(rule.id)) continue;
  if (rule.defaultEnabled === false && !enabled.has(rule.id)) continue;
  try { for (const hit of rule.check(graph)) findings.push({ ruleId, severity, category, ...hit }) }
  catch (err) { ruleErrors.push({ ruleId, message }) }   // one bad rule never stops the scan
}
findings.sort(bySeverityThenRuleId);
return { ok: true, workflow, findings, ...scoreFindings(findings), parseIssues, ruleErrors };
```

Options: `disable` (skip rules), `enable` (turn on off-by-default rules), `rules` (custom list, used in tests).

### 5.4 Scoring (`score.ts`)

```
points:  critical 30 · high 15 · medium 5 · low 1
per rule: first finding = full points; each repeat = +half; capped at 2× the first
score = max(0, round(100 − total));  grade: ≥ 90 ready · ≥ 70 needs work · else not ready
```

**Why the cap?** Without it, one rule firing on 40 nodes (for example, no retry on 40 API calls) would push the score to 0 on its own and drown out a single critical leaked key. The cap makes the score reflect *how many kinds* of problem there are, weighted by severity.

**Example:** 6 nodes without retry (medium) gives 5 + 5 × 2.5 = 17.5, capped at 10. One leaked key (critical) costs 30. Score: 100 − 40 = **60**, not ready.

### 5.5 Shared helpers worth knowing

- **`walkStrings(params)`** yields every string in a parameters object with its path (`headerParameters.parameters[0].value`). It's **iterative**, so 20,000-deep nesting doesn't crash. The security and data rules use it to scan all values.
- **`isPlaceholder(value)`** recognises template placeholders: `YOUR_API_KEY`, `<token>`, `xxxx`, `$OPENAI_API_KEY`, `[FACEBOOK_TOKEN]`, `google_api_key`, `aaaaaa`. This is the main precision lever for the secret rules.
- **`errorMode(node)`** gives what n8n actually does on failure: `onError` wins over the legacy `continueOnFail`.
- **`externalCallNodes(graph)`** returns active nodes that aren't triggers, internal nodes (Set, If, Code...), AI tools or AI sub-nodes. These are the ones where a retry can help.

---

## 6. The 25 rules

Findings are from the end-of-Phase-1 scan (rules v4) of 12,074 templates (`study/precision/scan-report.json`).

### Error handling (5)

| Rule | Sev. | Detects | How | Findings |
|---|---|---|---|---|
| `no-error-workflow` | high | Production workflow with no error workflow set | A production trigger exists (not manual, sub-workflow, error or evaluation trigger) and `settings.errorWorkflow` is empty | 9,834 |
| `no-retry` | medium | Outside call without Retry On Fail | `externalCallNodes` where `retryOnFail` isn't true or `maxTries` ≤ 1 | 64,668 |
| `swallowed-errors` | high | "Continue" on error, and nothing checks the error | Node with `continueRegularOutput`; no node reachable downstream reads `$json.error`. One reverse breadth-first search from all checker nodes (linear time) | 5,261 |
| `unconnected-error-output` | high | Error output connected to nothing | `continueErrorOutput`, and the slot after the regular outputs is empty. Skipped when the output count depends on configuration | 597 |
| `silent-error-trigger` | high | Error workflow that sends no alert | Error Trigger with no outgoing edge | 1 |

### Reliability (7)

| Rule | Sev. | Detects | How | Findings |
|---|---|---|---|---|
| `http-no-timeout` | medium | HTTP Request without a timeout | No `options.timeout` | 14,335 |
| `no-execution-timeout` | medium | No workflow timeout | Production trigger, and no positive `executionTimeout` | 9,882 |
| `endless-loop` | high | Loop with no way out (**off by default**) | Tarjan cycles where no node can exit: no loop node, router, error output leading out, or listing read | 0 by default |
| `return-all` | low | "Return All" on unbounded lists | `returnAll: true`, not a tool, no filter or time window, not a small resource (labels, tags, attachments) | 751 |
| `webhook-without-responder` | critical | Webhook waits for a responder that doesn't exist | `responseMode: responseNode`, and no active Respond to Webhook node | 34 |
| `schedule-no-timezone` | medium | Time-of-day schedule without a timezone | Schedule Trigger or Cron runs at a time of day (days, weeks, months, or a cron with a fixed hour); timezone empty or `DEFAULT` | 2,910 |
| `schedule-too-frequent` | medium | Runs more than once a minute | Seconds interval, or a 6-field cron with a non-fixed seconds field | 28 |

### Security (6)

| Rule | Sev. | Detects | How | Findings |
|---|---|---|---|---|
| `hardcoded-secret` | critical | API key written into the workflow | 13 key formats (OpenAI, Anthropic, AWS, Stripe live, GitHub, Slack, Google, Telegram, Groq, Hugging Face, SendGrid, JWT, private key), plus literal values in sensitive headers. Skips placeholders and public Supabase `anon` JWTs. Masks the value (at most a sixth shown) | 67 |
| `secret-in-url` | high | Key as a URL parameter | Sensitive query names (`api_key`, `token`...) with a literal, random-looking value | 59 |
| `webhook-no-auth` | high | Webhook anyone can call | Authentication `none`; not an OAuth callback; first two steps don't read request headers (a signature check) | 2,481 |
| `code-eval` | high | Code runs text as code | `eval`, `new Function`, `child_process` (JavaScript); `eval`, `exec`, `os.system`, `subprocess` (Python); includes LangChain code nodes | 10 |
| `command-injection` | critical | Shell command built from data | Execute Command or SSH with an expression that inserts item data (`$json`, `$input`...), not just `$execution` or values from a fixed-config Set node | 182 |
| `insecure-transport` | medium | Plain HTTP to a public host, or certificate checks off | `http://` with a fixed, public, non-placeholder host; `allowUnauthorizedCerts` on https | 184 |

### Data (3) and maintainability (4)

| Rule | Sev. | Detects | How | Findings |
|---|---|---|---|---|
| `data/pinned-data` | medium | Test data saved in the file | Non-empty `pinData` | 896 |
| `data/test-endpoint` | medium | Points at webhook.site, ngrok, RequestBin... | Known test and tunnel hosts, matched only inside a URL | 92 |
| `data/broken-connections` | medium | Connections to missing nodes, duplicate names | Parser's dangling-connection warnings; duplicate names (excluding sticky notes) | 145 |
| `maintainability/default-node-names` | low | "HTTP Request2" | Name minus trailing digits matches a default list | 4,415 |
| `maintainability/disabled-nodes` | low | Disabled node left in | `disabled: true` | 871 |
| `maintainability/orphan-nodes` | low | Node not connected | No connections at all; skipped when *nothing* is connected (a pasted selection) | 652 |
| `maintainability/undocumented` | low | 8+ nodes, no notes | No sticky note or node note | 236 |

### Rules changed from the plan

9 of the plan's 25 rules were replaced, because they couldn't be detected from the JSON alone without guessing, or duplicated another rule. For example, "Wait node longer than execution limit" depends on the server setup, so it became `schedule-no-timezone` (22% of templates, always certain). Full table: [DECISIONS.md](DECISIONS.md#rule-changes-against-section-7).

---

## 7. How the build was validated

| Layer | What it catches |
|---|---|
| Unit tests per rule (fire / stay quiet) | Logic errors in each rule |
| Corpus scan of all 12,074 templates | Crashes on real-world input; performance |
| Precision rounds on labelled samples | False positives: findings that are wrong |
| Line-by-line code review + pressure tests | Bugs that real templates don't happen to trigger |
| Corpus diff between rule versions | What a fix changed, so no fix silently adds wrong findings |

### Precision method (the key idea)

> **Never grade a fix on the data that shaped it.**

1. Draw 200 findings with a fixed seed, an equal share per rule (rule-stratified), so rare rules get checked as much as common ones.
2. Label each finding against the template JSON: is it true, and is it a real production risk?
3. Fix the false-positive patterns.
4. Measure again on a **fresh sample from templates never seen before.**

| Round | Rules | Templates | Precision |
|---|---|---|---|
| Development | v1 | any | 90.0% (180/200) |
| Test | v2 | excluding dev | 91.5% (183/200), below the 95% gate, so fix again |
| **Held out** | **v3** | **excluding dev and test** | **96.5% (193/200)**, 95% CI 93.0-98.3% |

**What 96.5% means:** precision with every rule weighted equally. It is *not* "96.5% of all findings are right". The common simple rules (`no-retry`) dominate real findings and are likely more accurate, but that hasn't been measured.

---

## 8. Problems found and how each was resolved

Phase 1 problems came in three waves:

- **8.1** false positives found by the precision rounds (37 found in rounds 1 and 2, 7 left in the held-out round)
- **8.2** the 20 issues from the line-by-line code review
- **8.3** design gaps in the plan itself

### 8.1 False positives found by precision rounds

#### Round 1 (development, v1 → v2): 20 false positives

| # | Rule | What was wrong | Root cause | Fix |
|---|---|---|---|---|
| 1 | `endless-loop` (7) | Loops that exit through a Text Classifier, Sentiment Analysis, or a success output (only the *error* output looped back) | Only Loop Over Items and If counted as exits | `routesOutOf()`: any node with 2+ outputs where one output leaves the loop is an exit; error outputs count as outputs |
| 2 | `return-all` (2) | "Get all" bounded by `timeMin`/`timeMax` or a filter | Flagged any `returnAll: true` | `hasFilter()` checks for filter keys with a meaningful value |
| 3 | `hardcoded-secret` (1) | `$OPENAI_API_KEY`-style placeholder | Placeholder list too narrow | `isPlaceholder()`: `$VAR` and `${VAR}` |
| 4 | `secret-in-url` (3) | `[FACEBOOK_ACCESS_TOKEN]`, `google_api_key` placeholders | Same | `[BRACKETED]` and `snake_case_key` patterns |
| 5 | `code-eval` (2) | eval on input stripped to digits; compile for a syntax check | Can't prove safety from the JSON | Counted as false positives to be conservative; not fixed (it's a real risk pattern) |
| 6 | `command-injection` (1) | Only `$execution.id` inserted | Any expression counted | `insertsItemData()`: only item data (`$json`, `$input`, `$items`, `$binary`, `$fromAI`, references to other nodes) |
| 7 | `test-endpoint` (1) | `ngrok.io` in a list of domain suffixes, not a URL | Matched the bare domain | Match only inside `http(s)://` URLs |
| 8 | `broken-connections` (2) | Duplicate *sticky note* names | Sticky notes have no connections | Exclude sticky notes from the duplicate check |
| 9 | `swallowed-errors` (1) | A downstream Code node handles the missing value | Can't see code-level handling | Not fixed: real limit of static analysis |

**Every fixed pattern became a test in `regressions.test.ts`.**

#### Round 2 (test, v2 → v3): 17 false positives, below the gate

| # | Rule | What was wrong | Fix |
|---|---|---|---|
| 1 | `endless-loop` (7) | Retry-on-error loops (success output unconnected = items stop); loops over a listing that ends when empty | An unconnected output counts as an exit; `canReturnNothing()`: listing operations (getAll, search, list...) end the loop when they return nothing |
| 2 | `return-all` (2) | Gmail labels, one message's attachments: always small | `SMALL_RESOURCES` exemption |
| 3 | `hardcoded-secret` (1) | PEM header wrapped around `[INSERT YOUR KEY HERE]` | The private key pattern now requires 40+ characters of real key material after the header |
| 4 | `secret-in-url` (1) | The word `Content-Type` as a value | `literalSecret()`: must mix letters *and* digits, 12+ characters, no spaces |
| 5 | `webhook-no-auth` (2) | First step checks a secret header; OAuth redirect (must be public) | `checksHeadersEarly()`: first two steps read `.headers`; OAuth callback exemption |
| 6 | `command-injection` (1) | Values from a fixed configuration node | *Fixed later in the review (8.2, item 19)* |
| 7 | `insecure-transport` (3) | `00.00.00.000` placeholder; Kubernetes `svc.namespace` names | `isPrivateHost()`: a host with no dot, private IP ranges, `.local`/`.internal`/`.svc`, and a "TLD" that isn't a real public TLD (a cluster namespace) |

#### Round 3 (held out, v3): 7 false positives left, 96.5%

No rule was changed after this sample was drawn. The 7 remaining were:

- 1 endless loop: an HTTP pagination loop ending on an empty page
- 3 command injections: 2 from a fixed config node, 1 base64 inside quotes
- 3 insecure transports: an `XX.XX.XX` placeholder, the certificate flag on plain http, a `your-api.com` placeholder

Most were fixed in the review (8.2), *after* the measurement, and the measured number was not inflated for them.

### 8.2 The code review: 20 issues

After the precision work, the user asked for a harsh line-by-line review before pushing. It found 20 issues: bugs real templates happened not to trigger, or patterns the samples were too small to catch. The commit message groups them into 20; below they are split into each individual code change.

**Every fix has a test in `pressure.test.ts` (26 tests).**

#### High severity

| # | Problem | Failure scenario | Fix (file) |
|---|---|---|---|
| 1 | **AWS access keys never detected** | `AKIAIOSFODNN7EXAMPLE`-style keys are all caps, so `isPlaceholder()`'s ALL_CAPS rule (`/^[A-Z][A-Z0-9_]*$/`) called every AWS key a placeholder. A real leaked AWS key gave **zero findings** | ALL_CAPS now means letters only, or underscore-joined words. Keys that mix in digits without underscores aren't placeholders (`values.ts`) |
| 2 | **Quadratic scan in `swallowed-errors`** | Walked everything downstream for every candidate node: O(n²). A 3,000-node continue-on-fail chain took **7.2 s** | One reverse breadth-first search from all checker nodes (`nodesThatReach()`), then each candidate checks only its direct successors: linear (`error-handling.ts`) |
| 3 | **Quadratic scan in `endless-loop`** | Rebuilt a Set of the cycle for every node in it. A 10,000-node loop took **9.8 s**, with a message listing all 10,000 names | Build the Set once per cycle; message uses `list()` ("A", "B" and 9,995 more) (`reliability.ts`) |
| 4 | **Precision claim overstated** | "96.5% precision" read as "96.5% of findings are right" | Wording everywhere: "held-out, rule-stratified sample", with what that does and doesn't mean (README, precision README) |
| 5 | **Supabase anon keys reported as leaked secrets** | Supabase's `anon` key is a JWT meant to be public (it ships in every browser app); it was a critical finding | `isPublicJwt()` decodes the JWT payload (hand-written `decodeBase64`) and skips `role: "anon"`; service-role keys are still reported (`security.ts`, `values.ts`) |

#### Medium severity

| # | Problem | Failure scenario | Fix (file) |
|---|---|---|---|
| 6 | **Error output guessed on classifiers** | Text Classifier, Sentiment Analysis and Guardrails have configurable outputs; the rule assumed one output and read the wrong slot as the error output | `CONFIGURABLE_OUTPUTS` set → `regularOutputCount()` returns `null`; and if a node has more slots than known, don't guess (`node-types.ts`, `error-handling.ts`) |
| 7 | **`insecure-transport` missed http URLs with expressions** | `http://api.example.com/users/{{ $json.id }}` was skipped entirely because the URL had `{{ }}` | Only the *host* must be fixed text; the path may contain expressions (`security.ts`). Added 29 correct findings |
| 8 | **`code-eval` missed `child_process`** | `require('child_process')` runs shell commands: the most dangerous call, not detected | Added to `DANGEROUS_JS` (`security.ts`) |
| 9 | **`code-eval` skipped LangChain code nodes** | LangChain Code and Tool Code nodes nest code deeper; never scanned | `codeSources()` walks all strings ending in `code` in those nodes (`security.ts`) |
| 10 | **`webhook-no-auth` skipped payment callbacks** | The exemption regex matched any "callback" or "redirect", so Stripe and Twilio callbacks (exactly the webhooks that need auth) were never checked | Narrowed to OAuth only: `/oauth\|auth[\s_-]?(?:code\|callback)/i` (`security.ts`). Added 18 findings, 15 correct |
| 11 | **Timezone `DEFAULT` treated as set** | n8n saves `"DEFAULT"` for "use the server's timezone", the same as not setting one; the rule stayed quiet | Treat `DEFAULT` and empty as no timezone (`reliability.ts`) |
| 12 | **Files with a UTF-8 BOM failed to parse** | Windows editors add a byte-order mark; `JSON.parse` rejects it, so the file "isn't valid JSON" | Strip `﻿` before parsing (`parse.ts`) |
| 13 | **Prototype pollution: node named `__proto__`** | `connections = {}` then `connections["__proto__"] = ...` sets the object's *prototype* instead of a key, so the node's connections vanished | `dict()` = `Object.create(null)` for every name-keyed map (`parse.ts`) |
| 14 | **Manual chat trigger treated as production** | `manualChatTrigger` only runs when someone chats in the editor, yet got "no error workflow" and "no timeout" findings | Added to `MANUAL_TRIGGERS` (`node-types.ts`) |
| 15 | **Respond to Chat and LangChain Code asked to retry** | They run inside n8n; a retry can't help. 147 wrong findings | Added to `INTERNAL_NODES` (`node-types.ts`) |

#### Low severity

| # | Problem | Failure scenario | Fix (file) |
|---|---|---|---|
| 16 | **Recursive parameter walk** | Deeply nested parameters (20,000 levels) overflow the call stack, crashing every rule that scans strings | `walkStrings()` rewritten with an explicit stack (`values.ts`) |
| 17 | **`maxTries: 1` counted as a retry** | Retry On Fail with 1 try never retries | `retries()`: true only when `maxTries` is unset (n8n default 3) or > 1 (`error-handling.ts`) |
| 18 | **Non-Error throws lost** | A rule throwing a string recorded `undefined` as the message | `err instanceof Error ? err.message : String(err)` (`engine.ts`) |
| 19 | **Shell commands from fixed config flagged** | `{{ $('Config').item.json.path }}` where Config is a Set node of fixed text isn't outside data (27 wrong findings) | `isFixedConfiguration()`: references to an all-literal Set node are configuration (`security.ts`) |
| 20 | **Masking showed too much of short secrets** | Always showed 4 characters: 4 of a 12-character secret is a third | Show at most a sixth of the length (`security.ts`) |
| 21 | **Pasted selections called orphaned** | A canvas copy of a few nodes has no connections; every node was "not connected" (72 wrong findings) | Skip when *nothing* in the workflow is connected (`maintainability.ts`) |
| 22 | **Duplicate names: last node won** | `new Map(nodes.map(...))` keeps the *last* duplicate; n8n's editor keeps the first | Keep the first (`graph.ts`) |
| 23 | **Downloader retried permanent errors** | n8n's API answers 400 for unpublished templates; the downloader retried 5 times with backoff, wasting minutes | `PermanentError` for 4xx except 429; no retry (`download-corpus.ts`) |
| 24 | **Placeholder hosts flagged as insecure** | `XX.XX.XX`, `your-api.com`, `example.com` | `isPlaceholderHost()` (`security.ts`) |
| 25 | **Certificate flag flagged on plain http** | `allowUnauthorizedCerts` on an `http://` URL does nothing: no certificate exists | Check the flag only for https (`security.ts`) |
| 26 | **`endless-loop` too unreliable** | 15 of 17 sampled findings across all rounds were wrong: a loop can end when a step returns no items, which the JSON can't show | Rule off by default (`defaultEnabled: false`); opt in with `enable` (`rule.ts`, `engine.ts`, `reliability.ts`) |

(The commit message lists 20 issues; several of its lines combine related changes, such as the two quadratic scans or the three LangChain node fixes. Split into individual code changes, there are 26.)

#### How the review fixes were verified

1. **26 pressure tests** reproduce every issue (130 tests total).
2. **Corpus diff v3 → v4** with `dump-findings.ts`, because fixing rules changes what they report:
   - **270 findings removed:** 266 known false-positive patterns, plus 4 that only changed wording (re-masked secrets). Removing wrong findings can't lower precision.
   - **72 findings added, every one hand-labelled, not sampled:** 68 correct (94.4%). The added findings were never in any precision sample, so labelling them all keeps the claim honest.

### 8.3 Design gaps in the plan itself

| Gap | Resolution |
|---|---|
| 9 planned rules couldn't be detected reliably from JSON | Replaced with checkable rules (DECISIONS) |
| Plan said "label 200 findings": grading fixes on the same sample overstates precision | Three-round method with held-out data |
| `core` v0.1 to npm at Phase 1 exit | Deferred until accounts exist |

---

## 9. Holes and gaps still open

These are known, documented, and not fixed:

| # | Gap | Why it's open | Impact |
|---|---|---|---|
| 1 | **Labels by one reviewer (Claude), not yet checked by Harish** | Pending human review | The 96.5% needs a second reviewer to be fully credible |
| 2 | **Precision only, not recall** | Measuring missed problems needs workflows with known problems | Unknown how many real problems are missed |
| 3 | **Secrets under arbitrary field names** | Found only if they match a known key format | A custom token in a Set node's `myKey` field is missed |
| 4 | **Public chat triggers not checked** | Not built yet | A public AI chat could be abused |
| 5 | **Templates aren't production workflows** | They contain placeholders and demo shortcuts | Real workflows may score differently |
| 6 | **Rare rules barely sampled** | `code-eval` (10 findings in the corpus), `silent-error-trigger` (1) | Their precision is mostly untested |
| 7 | **`command-injection`: base64 inside single quotes** | Proving shell safety needs real shell parsing | Some false positives remain |
| 8 | **`webhook-no-auth`: public-by-design webhooks** | Link shorteners, bank login redirects can't be told apart from the JSON | Some false positives remain |
| 9 | **`secret-in-url`: ambiguous values** | Ambiguous even to a human | Counted wrong to be conservative |
| 10 | **`endless-loop` off by default** | Can't see runtime "no items" exits | Real endless loops are missed unless enabled |
| 11 | **`swallowed-errors` can't see handling inside Code nodes** | Static analysis limit | Occasional false positive |
| 12 | **`no-retry` advises retries on every outside call** *(found in Phase 4)* | Phase 4 hand review showed retrying a send or create can do it twice, so the auto-fixer only retries reads. The Phase 1 rule's advice still says "turn on Retry On Fail" for all calls | The rule's wording should say retries suit reads, or writes the API de-duplicates |
| 13 | **n8n 2.x now rejects dangling connections** *(found in Phase 4)* | `broken-connections` is medium severity, but n8n 2.44 refuses to import such workflows | Severity may need raising, and it's a candidate for an auto-fix |

---

## 10. Numbers to remember

| | |
|---|---|
| Rules | 25 (24 on by default) |
| Templates scanned | 12,074 (252,965 nodes), **0 crashes** |
| Scan speed | median **0.31 ms**, p95 1.2 ms, max 33 ms per template |
| Huge inputs | 3,000-node chain and 10,000-node loop: **7.2 s / 9.8 s** before the review; now each passes a 1.5 s test budget |
| Tests | **130** (13 parser, 9 engine, 64 rule, 18 regression, 26 pressure) |
| Precision | 90.0% → 91.5% → **96.5%** (held out, 95% CI 93.0-98.3%) |
| Review | **20 issues** fixed; corpus diff 270 removed, 72 added (94.4% correct) |
| Most common finding | No retry: **95.6%** of templates |
| Median template score | **64** (settings checks included) |
| Runtime dependencies | **0** |
