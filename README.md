# n8n Preflight

Production-readiness checks and fixes for n8n workflows, by [FlowGenius](https://flowgenius.in).

**Status:** Phase 1 (rule engine) done. Not released yet. See the [project plan](docs/PROJECT_PLAN.md), [decisions](docs/DECISIONS.md) and [rules](docs/RULES.md).

- 25 rules across error handling, reliability, security, data and maintainability (24 on by default), scored 0-100
- Checked against all 12,074 public n8n templates: **96.5% precision on a held-out, rule-stratified sample** of 200 findings, labelled by one reviewer ([method and limits](study/precision/README.md))
- About 1 ms median scan per workflow (0.3-1.4 ms across runs), under 1.5 s for a 10,000-node workflow; no dependencies; runs in the browser and in Node

```ts
import { analyze } from "@n8n-preflight/core";

const result = analyze(workflowJson); // options: { disable: [...], enable: ["reliability/endless-loop"] }
if (result.ok) console.log(result.score, result.grade, result.findings);
```

## Development

Requires Node 20 or later.

```bash
npm install
npm run build
npm run check            # lint, typecheck, tests
npm run corpus:download  # download all public n8n templates to study/corpus/ (not committed)
npm run corpus:parse     # parse every template; writes study/output/parse-report.json
npm run corpus:scan      # run every rule over every template; writes study/output/scan-report.json
npm run docs:rules       # regenerate docs/RULES.md from the rule definitions
```

## Layout

| Path | What |
|---|---|
| `packages/core` | Workflow types, parser, graph, rule engine, scoring, 25 rules |
| `study/scripts` | Template corpus download, scans, sample review |
| `study/precision` | Precision samples, labels and method |
| `docs` | Plan, decisions, rule reference |

## License

MIT
