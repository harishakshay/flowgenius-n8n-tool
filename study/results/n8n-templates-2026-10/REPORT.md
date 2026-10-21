# What production problems ship in public n8n templates?

A scan of all **12,074 public templates** on n8n.io (185,224 nodes), with the open-source [n8n Preflight](../../../README.md) rules (v4). Generated 2026-10-21 by `npm run study`; numbers come from [summary.json](summary.json).

## Key findings

1. **93.5% of nodes that call an outside service have no retry** (64,668 of 69,133). One rate limit or 502 and the run fails. 95.6% of templates have at least one.
2. **85.5% of HTTP Request nodes have no timeout** (14,335 of 16,760).
3. **17.8% of templates have a webhook anyone can call**, with no authentication and no signature check in the first steps.
4. **14% of templates swallow errors:** a step set to "continue on error" whose failure nothing checks, so the run reports success while the work never happened.
5. **Some templates contain what look like real API keys or tokens.** Those details are being reported privately first; see [How we handled leaked keys](#how-we-handled-leaked-keys).
6. **Bigger workflows are much riskier.** 48.1% of templates with 31+ nodes score below 70, against 2% of templates with 1-5 nodes.
7. **Templates published in 2026 swallow errors more often than 2025's at every size: 1.6x to 4.1x as often.** See [the size-controlled comparison](#2025-vs-2026-at-the-same-size).
8. **Popular isn't safer.** The 100 most-viewed templates rarely leave webhooks open (3%), but 55% have an HTTP request with no timeout; only 22% score 90+.
9. **AI-agent workflows are no worse than classic ones:** median score 84 vs 84.

## The score

Each template gets a 0-100 score from the problems in its **nodes** (rules and weights: [RULES.md](../../../docs/RULES.md)). The median is **84**; **28.1%** score 90 or more and **18.7%** score below 70.

Three checks look at workflow **settings** (error workflow, execution timeout, timezone), and templates often can't carry those: an error workflow is an ID on the author's own server. They are left out of the score above. For the record, 81.4% of templates set no error workflow and 81.8% no execution timeout; counting them, the median score is 64 and 6.8% score 90+.

## Every rule

| Rule | Templates affected |
|---|---|
| `error-handling/no-retry` | 95.6% |
| `reliability/no-execution-timeout` | 81.8% |
| `error-handling/no-error-workflow` | 81.4% |
| `reliability/http-no-timeout` | 44.5% |
| `maintainability/default-node-names` | 36.6% |
| `reliability/schedule-no-timezone` | 22.4% |
| `security/webhook-no-auth` | 17.8% |
| `error-handling/swallowed-errors` | 14% |
| `data/pinned-data` | 7.4% |
| `reliability/return-all` | 4.3% |
| `maintainability/disabled-nodes` | 3.5% |
| `maintainability/orphan-nodes` | 2.4% |
| `error-handling/unconnected-error-output` | 2.3% |
| `maintainability/undocumented` | 2% |
| `security/insecure-transport` | 0.9% |
| `security/command-injection` | 0.7% |
| `data/test-endpoint` | 0.6% |
| `data/broken-connections` | 0.4% |
| `reliability/webhook-without-responder` | 0.3% |
| `reliability/schedule-too-frequent` | 0.2% |
| `security/code-eval` | 0.1% |
| `error-handling/silent-error-trigger` | 0% |
| `reliability/endless-loop` (off by default, not run) | 0% |

## By size

| Group | Templates | Median nodes | Median score | Score 90+ | Swallow errors | Open webhook | HTTP without timeout |
|---|---|---|---|---|---|---|---|
| 1-5 nodes | 1,394 | 4 | 90 | 61% | 1.9% | 13.1% | 28.6% |
| 6-15 nodes | 6,332 | 10 | 85 | 29.5% | 8.9% | 15.5% | 42.9% |
| 16-30 nodes | 3,422 | 20 | 79 | 17.2% | 22.4% | 21.1% | 51% |
| 31+ nodes | 926 | 39 | 72.5 | 9.5% | 35.9% | 28.2% | 55.5% |

## 2025 vs 2026 at the same size

Templates got bigger in 2026, and bigger workflows have more problems, so a plain year-to-year comparison would mostly measure size. Within each size group:

| Size | 2025 templates | 2026 templates | Swallow errors 2025 | 2026 | Open webhook 2025 | 2026 |
|---|---|---|---|---|---|---|
| 1-5 nodes | 625 | 199 | 1.6% | 6.5% | 14.4% | 20.1% |
| 6-15 nodes | 3,225 | 2,678 | 5.8% | 13% | 13.8% | 17.4% |
| 16-30 nodes | 1,342 | 1,955 | 12.8% | 29.3% | 16.7% | 24.4% |
| 31+ nodes | 353 | 547 | 26.1% | 42.6% | 21.8% | 32.4% |

The data shows the change, not its cause.

## By popularity

| Group | Templates | Median nodes | Median score | Score 90+ | Swallow errors | Open webhook | HTTP without timeout |
|---|---|---|---|---|---|---|---|
| Least-viewed 25% | 3,018 | 15 | 82 | 31.2% | 27% | 21.3% | 37.2% |
| Most-viewed 25% (1,476+ views) | 3,019 | 11 | 85 | 27.1% | 7.9% | 13.5% | 48.8% |
| Top 100 (67,756+ views) | 100 | 14 | 84 | 22% | 9% | 3% | 55% |

New templates have had less time to collect views, so the least-viewed group leans toward 2026 templates: popularity and year overlap here.

## AI-agent vs classic workflows

AI-agent workflows are those with at least one LangChain node (agent, chain, model).

| Group | Templates | Median nodes | Median score | Score 90+ | Swallow errors | Open webhook | HTTP without timeout |
|---|---|---|---|---|---|---|---|
| AI agent | 6,366 | 15 | 84 | 26.6% | 14.1% | 16.8% | 42.3% |
| Classic | 5,708 | 10 | 84 | 29.8% | 13.9% | 18.9% | 47% |

## By year published

| Group | Templates | Median nodes | Median score | Score 90+ | Swallow errors | Open webhook | HTTP without timeout |
|---|---|---|---|---|---|---|---|
| 2019 | 24 | 4 | 91 | 54.2% | 8.3% | 16.7% | 25% |
| 2020 | 309 | 3 | 94 | 74.8% | 1.3% | 3.6% | 13.9% |
| 2021 | 141 | 4 | 90 | 56% | 1.4% | 10.6% | 17.7% |
| 2022 | 144 | 6.5 | 88 | 42.4% | 8.3% | 17.4% | 29.9% |
| 2023 | 86 | 7.5 | 88.5 | 40.7% | 10.5% | 17.4% | 43% |
| 2024 | 446 | 10 | 83 | 21.5% | 7% | 18.6% | 57.2% |
| 2025 | 5,545 | 12 | 84 | 24% | 8.3% | 15.1% | 48.9% |
| 2026 | 5,379 | 15 | 82 | 28.8% | 21.7% | 21.6% | 41.8% |

## How we handled leaked keys

Numbers and details are held back for now: n8n's security team is told first, and template authors get 14 days to rotate their keys. This section will be filled in after that. Template ids and key values will never be published, and we did not test any key: using someone else's credential is not ours to do.

## Method and limits

- **Templates are not production workflows.** They are shared examples; people are expected to adapt them. But they are what thousands of people import and run, so what they leave out often stays out.
- **Precision:** on a held-out, rule-stratified sample, 96.5% of findings were correct; see [the precision check](../../precision/README.md). Labels were checked by one reviewer.
- **Recall is not measured:** the rules can miss problems, so these numbers are a floor, not a ceiling.
- **Static analysis:** findings come from the workflow JSON. Some risks depend on the server's own settings (a default timeout, an instance timezone), which a template doesn't show.
- **Reproduce it:** `npm run corpus:download && npm run study`.
