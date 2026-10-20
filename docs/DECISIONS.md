# Decisions

Changes to the plan in [PROJECT_PLAN.md](PROJECT_PLAN.md). The plan file itself stays unchanged.

| Date | Decision | Replaces in plan | Reason |
|---|---|---|---|
| 2026-10-20 | Product name **n8n Preflight** (by FlowGenius) | "FlowGenius X-ray" | A preflight check is what runs before takeoff; this tool runs before a workflow goes to production |
| 2026-10-20 | npm package names: `n8n-preflight` (CLI), `@n8n-preflight/core` (engine) | `flowgenius-xray`, `@flowgenius/xray-core` | Matches the name; "n8n" in the name helps people find it on npm |
| 2026-10-20 | Repo: `github.com/harishakshay/n8n-preflight`; subdomain `preflight.flowgenius.in` | `xray.flowgenius.in` | Matches the name |
| 2026-10-20 | npm workspaces instead of pnpm | "TypeScript monorepo (pnpm)" | pnpm is not installed on this machine; npm workspaces need no extra tool and work the same for this repo |
| 2026-10-20 | DNS, npm, Cloudflare and Anthropic accounts deferred until after the build | Section 12, items 3 and 4 | Harish's call: build first, set up accounts at release |
