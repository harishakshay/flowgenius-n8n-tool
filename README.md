# n8n Preflight

Production-readiness checks for n8n workflows, by [FlowGenius](https://flowgenius.in). Catch the problems that break automations in production (no error workflow, no retries, no timeouts, leaked API keys, open webhooks) before you ship.

**Status:** Phases 0-2 built (engine, CLI, GitHub Action, website). Not released yet. See the [project plan](docs/PROJECT_PLAN.md), [decisions](docs/DECISIONS.md) and [rules](docs/RULES.md).

- 25 rules across error handling, reliability, security, data and maintainability (24 on by default), scored 0-100
- Checked against all 12,074 public n8n templates: **96.5% precision on a held-out, rule-stratified sample** of 200 findings, labelled by one reviewer ([method and limits](study/precision/README.md))
- About 1 ms median scan per workflow; under 1.5 s for a 10,000-node workflow; no runtime dependencies

## Three ways to use it

### Website: paste, drop, done
`apps/web`. Drop a workflow file or paste nodes copied from the n8n canvas, and get a score with every problem explained and linked to a fix. Runs entirely in the browser, so the workflow never leaves the page.

```bash
npm run dev:web     # http://localhost:5173
```

### Command line
```bash
npx n8n-preflight workflows/                       # check every workflow in a folder
npx n8n-preflight --fail-on critical my-flow.json  # only fail on critical findings
npx n8n-preflight -f sarif -o preflight.sarif .    # SARIF for GitHub code scanning
```

Exit codes: `0` passed, `1` a finding reached `--fail-on` (default `high`) or a named file isn't a workflow, `2` bad usage. Run `n8n-preflight --help` for every option.

### GitHub Action
Checks the workflows in every pull request, comments inline on the changed files, and adds a summary table to the run.

```yaml
- uses: actions/checkout@v5
- uses: harishakshay/flowgenius-n8n-tool/packages/action@main
  with:
    path: workflows        # files or folders; default "."
    fail-on: high          # critical, high, medium, low or none
# Optional: show findings in the Security tab
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: n8n-preflight.sarif
```

Outputs: `workflows`, `findings`, `lowest-score`, `sarif-file`.

### Library
```ts
import { analyze } from "@n8n-preflight/core";

const result = analyze(workflowJson); // options: { disable: [...], enable: ["reliability/endless-loop"] }
if (result.ok) console.log(result.score, result.grade, result.findings);
```

## Development

Requires Node 20 or later.

```bash
npm install
npm run build            # engine, CLI, Action bundle, website
npm run check            # lint, typecheck, tests
npm run corpus:download  # download all public n8n templates to study/corpus/ (not committed)
npm run corpus:scan      # run every rule over every template; writes study/output/scan-report.json
npm run docs:rules       # regenerate docs/RULES.md from the rule definitions
```

After changing the Action, the CLI or the engine, run `npm run build` and commit `packages/action/dist`: CI fails if the bundle is out of date.

## Layout

| Path | What |
|---|---|
| `packages/core` | Workflow types, parser, graph, rule engine, scoring, 25 rules |
| `packages/cli` | `n8n-preflight` command: file discovery, text/JSON/SARIF output |
| `packages/action` | GitHub Action (bundled into `dist/index.js`) |
| `apps/web` | Website: React, scanning in a Web Worker |
| `study/scripts` | Template corpus download, scans, sample review, corpus diffs |
| `study/precision` | Precision samples, labels and method |
| `docs` | Plan, decisions, rule reference |

## License

MIT
