# Auto-fix: does it fix safely, and does n8n accept the result?

Phase 4 of [n8n Preflight](../../../README.md) adds `fixWorkflow` (core), `--fix` (CLI) and a "safe fixes ready" panel (website). This report shows how it was checked. Generated 2026-10-24; the numbers come from [summary.json](summary.json), produced by `npm run study:fix` and `npm run study:n8n`.

## Key results

1. **Every guarantee holds on all 12,074 public templates, in both modes** (default, and `--remove-unused`): 0 failures of convergence, idempotence, preservation, round trip or no-mutation.
2. **Real n8n accepts the fixed workflows.** On n8n 2.44.6, across 258 AI-agent templates, the fixed copy saved every time the original did (248 of 248), and the copy with unused nodes removed saved too (201 of 201). Read back from n8n, no fix was lost or changed.
3. **The fixer leaves anything risky to a person, and says why.** A retry can send an email or create a ticket twice, so retries are added only to steps that just read. 13,305 retries were added automatically; 51,363 were left, each with its reason.
4. **Fixing raises the median template score from 64 to 74** (settings checks included), and no template scores lower after fixing. Median time per template: 1.9 ms.

## What gets fixed

| Rule | Fix | Applied across the corpus |
|---|---|---|
| `reliability/http-no-timeout` | `options.timeout: 30000` | 14,335 |
| `error-handling/no-retry` | Retry on fail, 3 tries, 2 s apart, **only on steps that just read** | 13,305 |
| `reliability/no-execution-timeout` | Workflow timeout 10 min | 7,419 |
| `reliability/schedule-no-timezone` | Timezone the user gives (the website uses the browser's, and says so) | 2,095 (corpus run with UTC) |
| `data/pinned-data` | Pinned test data removed | 896 |
| `error-handling/no-error-workflow` | Only when the user gives an error workflow id | (none here; no id given) |
| `maintainability/disabled-nodes` | With `--remove-unused`: remove, reconnecting inputs to outputs as n8n does | 775 |
| `maintainability/orphan-nodes` | With `--remove-unused`: remove | 590 |

10,656 of 12,074 templates get at least one fix (10,728 with `--remove-unused`).

## What is left to a person, and why

| Reason a fix was left | Times |
|---|---|
| Retry: the step uses its default operation, so we can't tell whether it only reads | 23,764 |
| Retry: the operation writes ("create", "send", "append", ...) | 14,293 |
| Retry: an HTTP POST, PUT, PATCH or DELETE | 7,739 |
| Error workflow: needs the id of your error workflow | 7,371 |
| Retry: an AI agent; re-running it repeats every tool call | 5,149 |
| Settings: a canvas copy has no workflow settings to change | 5,534 |
| Retry: a send-and-wait step; a retry would send the message again | 361 |
| Retry: the HTTP method is an expression | 53 |
| Two nodes share a name | 4 |

These stay in the report as problems, with the reason shown next to them.

## How it was checked

### Every template (`study:fix`)

Each template is fixed, then:

- **Convergence:** re-analysing the fixed workflow finds none of the fixed problems again.
- **Idempotence:** fixing the fixed workflow changes nothing.
- **Preservation:** a structural diff between input and output touches only the fields the fix report lists. Node ids, credentials, positions and unknown fields stay as they were.
- **Round trip:** the result parses, with no new parse problems.
- **No mutation:** the input object is untouched.

### Real n8n (`study:n8n`)

One niche, done thoroughly: **AI-agent workflows** (templates with a LangChain Agent node; 3,731 of the corpus). The sample is every AI-agent template where `--remove-unused` removes nodes (211), the riskiest change, plus a seeded random 50 (3 of which were already in the first group): 258 templates in all.

Each template is saved through n8n's REST API (`POST /rest/workflows`, the call the editor makes when you save) on a local n8n 2.44.6, in three forms: the original as a control, the default fix, and the fix with unused nodes removed. Each is read back (`GET /rest/workflows/:id`) and compared field by field with what was sent. A result counts against the fixer only if n8n accepts the original but not a fixed copy, or stores a fixed copy differently from what was sent.

| | |
|---|---|
| Originals n8n accepted | 248 of 258 |
| Fixed copies accepted, where the original was | **248 of 248** |
| Copies with unused nodes removed, accepted | **201 of 201** |
| Fields n8n stored differently from what was sent | **0** (originals included, so the comparison is strict) |

n8n rejects 10 of the originals before any fix: 9 connect to or from a node that doesn't exist, 1 uses a deprecated node type. The fixer doesn't touch either problem yet.

## What hand review changed

Every saved pair (original, fixed, change list) was kept and reviewed. The first build retried every outside call and removed disabled and unconnected nodes by default. Review found three problems, all fixed before release:

1. **Retrying writes can do them twice.** The first build added retries to "Send a message", "Create an issue", "Reply to thread", a human-review send-and-wait step and AI agents. If the first attempt went through and only the reply was lost, a retry repeats it. Retries are now limited to reads and to LLM calls without tools (64,664 auto-retries before, 13,305 after).
2. **Removal deleted work people may want.** Templates ship optional steps disabled (one had a whole Telegram path) and leave helpers unconnected to run by hand. Removal is now opt-in.
3. **One removal broke a webhook.** An unconnected Respond to Webhook node was removed, but the workflow's webhook was set to answer through one, so the node must exist. Respond to Webhook nodes are never removed now. This showed up as the only template whose score dropped after fixing; it is now zero.

## Limits

- **Saving is not running.** The real-n8n check proves n8n accepts and keeps the fixed workflows. It doesn't execute them; the workflows need credentials and outside services.
- **One niche.** The real-n8n check covered AI-agent workflows only. The corpus checks cover every template.
- **Read detection is by name.** A step counts as a read when its operation is named like one (get, getAll, search, lookup, download, select, ...) and contains no write word. Steps that rely on their default operation are left alone, which is cautious: many of them are reads.
- **Speed.** A 10,000-node workflow is fixed in 0.84-1.27 s on the development laptop: inside the test's 1.5 s budget, but not always under the plan's 1 s.
