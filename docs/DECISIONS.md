# Decisions

Changes to the plan in [PROJECT_PLAN.md](PROJECT_PLAN.md). The plan file itself stays unchanged.

| Date | Decision | Replaces in plan | Reason |
|---|---|---|---|
| 2026-10-20 | Product name **n8n Preflight** (by FlowGenius) | "FlowGenius X-ray" | A preflight check is what runs before takeoff; this tool runs before a workflow goes to production |
| 2026-10-20 | npm package names: `n8n-preflight` (CLI), `@n8n-preflight/core` (engine) | `flowgenius-xray`, `@flowgenius/xray-core` | Matches the name; "n8n" in the name helps people find it on npm |
| 2026-10-20 | Subdomain `preflight.flowgenius.in` | `xray.flowgenius.in` | Matches the name |
| 2026-10-20 | Repo: `github.com/harishakshay/flowgenius-n8n-tool` (temporary; final name before npm publish in Phase 2) | — | Harish created it; GitHub redirects after a rename |
| 2026-10-20 | npm workspaces instead of pnpm | "TypeScript monorepo (pnpm)" | pnpm is not installed on this machine; npm workspaces need no extra tool and work the same for this repo |
| 2026-10-20 | DNS, npm, Cloudflare and Anthropic accounts deferred until after the build | Section 12, items 3 and 4 | Harish's call: build first, set up accounts at release |
| 2026-10-20 | Phase 1 rule set changed: 9 rules from section 7 replaced with rules that can be checked reliably from the JSON alone (table below). Still 25 rules | Section 7 | The replaced rules either can't be detected without guessing, or duplicate another rule |
| 2026-10-20 | `xray-core` v0.1 on npm (Phase 1 exit) moved to release, with the other accounts | Phase 1 exit | No npm account yet (row above). The package builds and is ready to publish |
| 2026-10-20 | Precision measured on a held-out sample after two rounds of fixes, not on the first sample | Phase 1, "label 200 findings" | Grading the fixes on the sample that shaped them would overstate precision. See `study/precision/README.md` |
| 2026-10-20 | `reliability/endless-loop` off by default (opt in with `enable`); 24 of 25 rules run by default | — | 15 of 17 sampled findings were wrong: a loop can end when a step returns no items, which the JSON alone doesn't show |
| 2026-10-20 | After the code review, every finding a fix adds is labelled in full (corpus diff), not only resampled | — | Fixes that find more were never in a precision sample; checking all 72 added findings keeps the claim true |

| 2026-10-21 | Phase 2 builds the website, CLI and Action; publishing (npm, Marketplace, Cloudflare Pages, subdomain) waits for accounts | Phase 2 exit: "all three surfaces live" | Same as the account decision above. Everything is built, tested and ready to publish |
| 2026-10-21 | "Copy fixed workflow" button moved to Phase 4 | Phase 2 web app | Fixes are built in Phase 4; the button ships with them |
| 2026-10-21 | Action lives in `packages/action`, used as `harishakshay/flowgenius-n8n-tool/packages/action@<ref>` | — | Works today. A GitHub Marketplace listing needs `action.yml` at the root of its own repo; that small repo can be cut at release |
| 2026-10-21 | Action is a Node 24 JavaScript action, bundled with esbuild, without `@actions/core` | — | GitHub is retiring Node 20 actions; no runtime dependencies to install or audit |
| 2026-10-21 | Website on Vite 7 with an npm override, not Vite 8 | — | Vite 8 alongside Vitest 4 installed two Vite copies and broke the dev server; one pinned version for the whole repo |
| 2026-10-24 | Real-n8n check runs n8n installed from npm (under Node 24 from the `node` npm package), not Docker | PLAN-AGENTIC Phase 4, validation 5 | Docker Desktop doesn't start on this machine. Same n8n, same REST API; the script takes any `N8N_URL`, so it runs against Docker too |
| 2026-10-24 | Real-n8n check run on one niche, AI-agent workflows (seeded 50 plus every one where nodes are removed: 258), not 1,000 random templates | PLAN-AGENTIC Phase 4, validation 5 | Harish's call: nail one niche first. Every pair was kept and hand-reviewed, which is what found the two problems below |
| 2026-10-24 | Retries are added only where repeating is harmless: reads (HTTP GET, get/search/list operations) and LLM calls without tools. Sends, creates, agents and send-and-wait steps are left, with the reason | First Phase 4 build retried every outside call | Hand review: a retry after a lost reply sends the email or creates the ticket twice, and re-running an agent repeats its tool calls. Auto-retries fell from 64,664 to 13,305; the rest are listed for a person |
| 2026-10-24 | Removing disabled and unconnected nodes is opt-in (`--remove-unused`); Respond to Webhook nodes are never removed | First Phase 4 build removed them by default | Hand review: templates ship optional steps disabled (a Telegram path, a manual test helper); removal deleted work people may want. One template's webhook needed its unconnected responder to exist |
| 2026-10-24 | The website fixes the schedule timezone with the browser's timezone, and says so | — | The CLI only does it when asked (`--timezone`). On the website the visitor is usually the workflow's owner; the panel tells them to change it if their schedules follow another zone |

## Rule changes against section 7

| Plan rule | Replaced by | Why |
|---|---|---|
| No error notification path | `error-handling/silent-error-trigger` | The plan rule duplicates "no error workflow". The new one checks the error workflow itself |
| Trigger with no failure handling | `reliability/schedule-too-frequent` | Duplicates "no error workflow" |
| Wait node longer than the execution limit | `reliability/schedule-no-timezone` | Can't be judged from the JSON: how long waits interact with the execution timeout depends on the n8n version and setup. The timezone bug is common (22% of templates) and certain |
| Secrets written to logs or output | `security/command-injection` | Can't be detected from the JSON. Shell commands built from data can, and are critical |
| — (new) | `security/insecure-transport` | Takes the slot of the 6th security rule; plain HTTP and skipped certificate checks are checkable facts |
| Unhandled empty input | `data/test-endpoint` | Needs runtime data to judge; test and tunnel URLs are certain |
| Missing pagination | `data/broken-connections` | Can't tell from the JSON whether an API needs paging |
| Unsafe expression (no null check) | (dropped) | Too noisy to reach the precision gate; `broken-connections` covers structural data errors instead |
| Pinned test data left in production | `data/pinned-data`, reworded | n8n ignores pinned data in production runs; the real risk is customer data leaking through exports |
| No workflow description | `maintainability/undocumented` | n8n exports have no description field; sticky notes and node notes are what people use |
