# n8n Preflight

Production-readiness checks and fixes for n8n workflows, by [FlowGenius](https://flowgenius.in).

**Status:** Phase 0 (foundations). Not released yet. See the [project plan](docs/PROJECT_PLAN.md) and [decisions](docs/DECISIONS.md).

## Development

Requires Node 20 or later.

```bash
npm install
npm run build
npm run check            # lint, typecheck, tests
npm run corpus:download  # download all public n8n templates to study/corpus/ (not committed)
npm run corpus:parse     # parse every template; writes study/output/parse-report.json
```

## Layout

| Path | What |
|---|---|
| `packages/core` | Workflow types and parser (rule engine from Phase 1) |
| `study/scripts` | Template corpus download and analysis |
| `docs` | Plan and decisions |

## License

MIT
