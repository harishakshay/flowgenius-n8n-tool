# Rules

Generated from the rule definitions by `npm run docs:rules`. Do not edit by hand.

25 rules. Severity sets the score penalty: critical 30, high 15, medium 5, low 1 (repeats of one rule add half, capped at double).

| Rule | Severity | What it catches | Auto-fix (Phase 4) |
|---|---|---|---|
| `error-handling/no-error-workflow` | high | No error workflow | yes |
| `error-handling/no-retry` | medium | Outside call without retry | yes |
| `error-handling/swallowed-errors` | high | Errors swallowed | no |
| `error-handling/unconnected-error-output` | high | Error output not connected | no |
| `error-handling/silent-error-trigger` | high | Error workflow that does nothing | no |
| `reliability/http-no-timeout` | medium | HTTP request without timeout | yes |
| `reliability/no-execution-timeout` | medium | No execution timeout | yes |
| `reliability/endless-loop` | high (off by default) | Loop with no way out | no |
| `reliability/return-all` | low | Fetches every record | no |
| `reliability/webhook-without-responder` | critical | Webhook waits for a reply that never comes | no |
| `reliability/schedule-no-timezone` | medium | Scheduled time without a timezone | yes |
| `reliability/schedule-too-frequent` | medium | Runs more than once a minute | no |
| `security/hardcoded-secret` | critical | Secret written into the workflow | no |
| `security/secret-in-url` | high | Secret in a URL | no |
| `security/webhook-no-auth` | high | Webhook anyone can call | no |
| `security/code-eval` | high | Code runs text as code | no |
| `security/command-injection` | critical | Shell command built from data | no |
| `security/insecure-transport` | medium | Unencrypted or unverified connection | no |
| `data/pinned-data` | medium | Pinned data exported with the workflow | yes |
| `data/test-endpoint` | medium | Points at a test or tunnel URL | no |
| `data/broken-connections` | medium | Broken connections | no |
| `maintainability/default-node-names` | low | Nodes still have default names | no |
| `maintainability/disabled-nodes` | low | Disabled node left in | yes |
| `maintainability/orphan-nodes` | low | Node not connected to anything | yes |
| `maintainability/undocumented` | low | Large workflow with no notes | no |

## `error-handling/no-error-workflow`

**No error workflow** · high

When a production run fails and no error workflow is set, nobody is told. Set Workflow Settings > Error Workflow to a workflow that alerts you (Slack, email).

Learn more: https://flowgenius.in/n8n-silent-failures-no-logs/

## `error-handling/no-retry`

**Outside call without retry** · medium

APIs fail briefly all the time (timeouts, rate limits, 502s). Without Retry On Fail, one blip fails the whole run. Turn on Settings > Retry On Fail (3 tries, 1-5 s apart).

Learn more: https://flowgenius.in/fallback-and-retry-strategies/

## `error-handling/swallowed-errors`

**Errors swallowed** · high

With "Continue" on error, a failed step passes its error on as normal data. If nothing after it checks for that error, the run reports success while the work never happened. Check for `$json.error` with an If node, or use "Continue (using error output)".

Learn more: https://flowgenius.in/n8n-partial-failure-handling/

## `error-handling/unconnected-error-output`

**Error output not connected** · high

The node is set to "Continue (using error output)" but nothing is connected to its error output, so failed items disappear without a trace. Connect the error output to an alert or a retry path.

Learn more: https://flowgenius.in/error-handling-optimizations/

## `error-handling/silent-error-trigger`

**Error workflow that does nothing** · high

This is an error workflow (it starts with Error Trigger) but the trigger is not connected to anything, so failures it catches are never reported.

Learn more: https://flowgenius.in/n8n-error-node-catch-all-failure/

## `reliability/http-no-timeout`

**HTTP request without timeout** · medium

Without its own timeout, a slow or hung server holds the run for as long as n8n's default allows. Set Options > Timeout, for example 30000 ms, so the step fails fast and the retry or error path takes over.

Learn more: https://flowgenius.in/n8n-http-request-node-timeout/

## `reliability/no-execution-timeout`

**No execution timeout** · medium

A stuck run holds a worker until someone notices. Set Workflow Settings > Timeout Workflow. (Your instance may set a default with EXECUTIONS_TIMEOUT; n8n's own default is no limit.)

Learn more: https://flowgenius.in/n8n-stuck-executions-detection/

## `reliability/endless-loop`

**Loop with no way out** · high

These nodes feed back into each other, and none of them can send items out of the loop: no Loop Over Items, If, Switch, Filter, Limit, classifier, or error output that leads elsewhere. The run repeats until it is killed or runs out of memory. Off by default: a loop can also end because a step returns no items (an empty page from an API), which the JSON alone can't show.

Learn more: https://flowgenius.in/n8n-long-running-workflow-failures/

## `reliability/return-all`

**Fetches every record** · low

"Return All" loads every record into memory at once. Fine for small lists; on a large account it slows the run or crashes the worker. Use a limit, or page through results with Loop Over Items.

Learn more: https://flowgenius.in/memory-limit-error-n8n/

## `reliability/webhook-without-responder`

**Webhook waits for a reply that never comes** · critical

The webhook is set to respond "Using Respond to Webhook node", but the workflow has no active Respond to Webhook node. Every call fails. Add the node, or change the response mode.

Learn more: https://flowgenius.in/n8n-webhook-response-errors/

## `reliability/schedule-no-timezone`

**Scheduled time without a timezone** · medium

This schedule runs at a set time of day, but the workflow has no timezone, so it uses the server's default (often UTC). Reports and reminders then fire hours early or late, and shift with daylight saving. Set Workflow Settings > Timezone.

Learn more: https://flowgenius.in/cron-job-setup-error-n8n/

## `reliability/schedule-too-frequent`

**Runs more than once a minute** · medium

Every run is stored as an execution and usually calls an API. Running every few seconds fills the database and hits rate limits. Use a webhook or app trigger instead, or run at most once a minute.

Learn more: https://flowgenius.in/n8n-execution-history-time-bomb/

## `security/hardcoded-secret`

**Secret written into the workflow** · critical

Anyone who sees this workflow (an export, a shared template, a screenshot, version control) gets this key. Move it into an n8n credential, then rotate the key, since it has already been exposed.

Learn more: https://flowgenius.in/n8n-secrets-management/

## `security/secret-in-url`

**Secret in a URL** · high

URLs end up in server logs, proxies and n8n's execution history. Send the key in a header through an n8n credential instead, and rotate it.

Learn more: https://flowgenius.in/n8n-secrets-management/

## `security/webhook-no-auth`

**Webhook anyone can call** · high

Anyone who finds or guesses this URL can start the workflow, with any data. Set Authentication (Header Auth or Basic Auth), or check a signature or shared secret in the first step.

Learn more: https://flowgenius.in/insecure-webhook-exposure/

## `security/code-eval`

**Code runs text as code** · high

eval, new Function, exec, child_process or a shell call turns text into code. If any of that text comes from input (a webhook, an email, an AI reply), an attacker can run their own code on your n8n server.

Learn more: https://flowgenius.in/xss-vectors-in-custom-code/

## `security/command-injection`

**Shell command built from data** · critical

The command contains {{ expressions }}, so data from earlier steps becomes part of a shell command. A value like `; rm -rf /` runs on the server. Validate input strictly, or avoid the shell.

Learn more: https://flowgenius.in/n8n-security-errors-guide/

## `security/insecure-transport`

**Unencrypted or unverified connection** · medium

Plain http:// to a public server, or skipping certificate checks, lets anyone on the network path read or change the data, including credentials. Use https:// and keep certificate checks on.

Learn more: https://flowgenius.in/ssl-certificate-issues/

## `data/pinned-data`

**Pinned data exported with the workflow** · medium

Pinned data is copied into every export, share and backup of this workflow. It is often real customer data captured while testing. Unpin it before sharing or committing the workflow.

## `data/test-endpoint`

**Points at a test or tunnel URL** · medium

Request inspectors (webhook.site, RequestBin) and tunnels (ngrok, Cloudflare quick tunnels) are for testing. In production the data goes to a public inbox, or nowhere once the tunnel closes. Point it at the real service.

## `data/broken-connections`

**Broken connections** · medium

The workflow file has connections to nodes that do not exist, or two nodes with the same name. n8n routes data by node name, so items can go to the wrong step or nowhere. Re-import the workflow, rename duplicates, and reconnect.

## `maintainability/default-node-names`

**Nodes still have default names** · low

Names like "HTTP Request2" make error alerts and execution logs unreadable at 2 a.m. Name each node for what it does, for example "Create Stripe customer".

Learn more: https://flowgenius.in/workflow-design-best-practices/

## `maintainability/disabled-nodes`

**Disabled node left in** · low

Disabled nodes are skipped, and data passes straight through them. Left in, they hide what the workflow really does and are easy to re-enable by mistake. Delete them, or note why they are kept.

Learn more: https://flowgenius.in/lifecycle-management-for-n8n-workflows/

## `maintainability/orphan-nodes`

**Node not connected to anything** · low

This node has no connections, so it never runs. Connect it or delete it.

Learn more: https://flowgenius.in/workflow-design-best-practices/

## `maintainability/undocumented`

**Large workflow with no notes** · low

Nobody, including you in six months, can tell what this workflow is for or why it is built this way. Add a sticky note with its purpose, trigger, and who to contact when it fails.

Learn more: https://flowgenius.in/n8n-ownership-handoff-risks/
