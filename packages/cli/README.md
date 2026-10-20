# n8n-preflight

Check n8n workflows for production problems before they ship: missing error handling, retries and timeouts, leaked API keys, open webhooks, and more. 25 rules, a 0-100 score, and a link to a fix for every finding.

```bash
npx n8n-preflight workflows/
```

```
workflows/orders.json  score 70/100 (needs work), 3 nodes
  HIGH     workflows/orders.json:8  "Webhook" accepts calls from anyone.
           security/webhook-no-auth  https://flowgenius.in/insecure-webhook-exposure/
  MEDIUM   workflows/orders.json:17  "Create contact" has no timeout set, so a slow server can stall the run.
           reliability/http-no-timeout  https://flowgenius.in/n8n-http-request-node-timeout/
```

## Options

| Option | Meaning |
|---|---|
| `-f, --format text\|json\|sarif` | Output format. SARIF works with GitHub code scanning |
| `-o, --output <file>` | Write the report to a file |
| `--fail-on <level>` | Exit 1 when a finding is at least this severe: `critical`, `high` (default), `medium`, `low`, `none` |
| `--disable <rule,...>` | Skip rules |
| `--enable <rule,...>` | Run off-by-default rules (`reliability/endless-loop`) |
| `--no-color` | Plain output |

Folders are searched for `.json` files (skipping `node_modules`, `dist` and hidden folders). Files that aren't n8n workflows are skipped.

Rules: https://github.com/harishakshay/flowgenius-n8n-tool/blob/main/docs/RULES.md · By [FlowGenius](https://flowgenius.in) · MIT
