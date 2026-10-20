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
