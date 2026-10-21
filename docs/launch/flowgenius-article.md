# We scanned all 12,074 n8n templates. Here's what breaks in production.

*Draft for flowgenius.in. Every number comes from the [study report](../../study/results/n8n-templates-2026-10/REPORT.md); re-check them if the report is re-run before publishing.*

*Before publishing: (1) review the precision labels in `study/precision/` yourself, since the 96.5% should rest on your own check; (2) add the live checker URL; (3) don't mention leaked keys until the n8n notice has been sent and 14 days have passed.*

---

Most n8n workflows don't fail because n8n is broken. They fail because of things nobody notices in the editor: an API that times out at 2 a.m., a step quietly set to "continue on error", a webhook anyone on the internet can call.

At FlowGenius I write about those failures every week. This time I wanted numbers, so I built an open-source checker for n8n workflows and ran it over every public template on n8n.io: **12,074 templates and 185,224 nodes**.

These are the workflows thousands of people import and run every day, so whatever they leave out often stays out.

## The short version

- **93.5% of nodes that call an outside service have no retry.** One rate limit or 502, and the whole run fails.
- **85.5% of HTTP Request nodes have no timeout.** A slow server can stall the run for as long as n8n lets it.
- **17.8% of templates have a webhook anyone can call:** no authentication, and no signature check in the first steps.
- **14% of templates swallow errors.** A step is set to "continue" on failure, and nothing after it checks whether it failed. The run shows green while the work never happened.
- **Templates published in 2026 swallow errors 1.6 to 4 times as often as 2025's**, even comparing workflows of the same size.

## 1. Retries: the cheapest fix nobody turns on

Every API fails briefly: rate limits, a deploy on their side, a network blip. Without a retry, one blip fails your run, and if it's a scheduled job, nobody re-runs it.

**Fix:** open the node → **Settings** → turn on **Retry On Fail**. Three tries with 1-5 seconds between them handles almost every temporary failure. Retries can't help a step that's genuinely broken, and that's what the error workflow (below) is for.

## 2. Timeouts: the run that never ends

An HTTP Request with no timeout waits for the server to answer for as long as n8n allows. If the server hangs, so does your workflow, holding a worker the whole time.

**Fix:** in the HTTP Request node, **Options → Timeout**, for example 30000 ms. Now a hung server fails fast, and your retry or error path takes over.

## 3. Open webhooks

A webhook URL is a door into your workflow. If it has no authentication, anyone who finds or guesses it can start your workflow with whatever data they like: fake orders, fake leads, a flood of executions.

**Fix:** in the Webhook node, set **Authentication** to Header Auth or Basic Auth. For services that sign their requests instead (Stripe, Shopify, Slack), check the signature in the first step.

## 4. Swallowed errors: the most dangerous green checkmark

"Continue (using regular output)" sounds harmless. What it actually does: when the step fails, the error is passed on as if it were normal data. If nothing downstream checks for it, the execution shows success, and you find out weeks later that half your records never synced.

**Fix:** either use **"Continue (using error output)"** and connect that output to an alert, or add an **If** node right after that checks `{{ $json.error }}`.

The worrying part: this got worse. Templates published in 2026 are bigger than 2025's, and bigger workflows have more problems. But even comparing workflows of the same size, 2026 templates swallow errors **1.6 to 4 times as often**. The data shows the change, not the cause.

## Bigger workflows break more

This was the clearest pattern in the whole study. Of templates with 1-5 nodes, **2%** score below 70 on the production check. With 31+ nodes, it's **48%**, and **36%** of them swallow errors somewhere.

That isn't a reason to avoid big workflows. It's a reason to check them more carefully, or to split them into sub-workflows that each have one job.

## Popular doesn't mean production-ready

The 100 most-viewed templates (67,000+ views each) are better in one way: only **3%** leave a webhook open. But **55%** have an HTTP request with no timeout, **96%** skip retries somewhere, and only **22%** score 90 or more. A template with a million views is still a starting point, not a finished production workflow.

## What this doesn't mean

Templates are examples. Authors keep them simple on purpose, and some settings can't travel with a template at all: your error workflow, for instance, is an ID on your own n8n instance. I left those settings out of the scores for exactly that reason.

The point isn't that template authors did something wrong. It's that **importing a template is where production work starts, not where it ends.**

## Check your own workflows

The checker is free and open source. It runs 24 checks, gives a 0-100 production-readiness score, and links every problem to a fix.

- **In your browser:** paste or drop a workflow. It runs entirely on your machine, so your workflow and any keys in it never leave the page. *(Link: add the live site URL here once deployed.)*
- **Command line:** `npx n8n-preflight workflows/`
- **On every pull request:** a GitHub Action that comments on risky workflows.

Code, rules and the full method: [github.com/harishakshay/flowgenius-n8n-tool](https://github.com/harishakshay/flowgenius-n8n-tool)

## How I measured

I tested the checker before trusting it. On a held-out sample of 200 findings from templates it was never tuned on, **96.5% were correct**, each one checked against its workflow. The method, every label and the limits are public. It measures how often a finding is right, not how many problems it misses, so these numbers are a floor, not a ceiling.

Full report with every table: [the study](../../study/results/n8n-templates-2026-10/REPORT.md).

---

*Harish Akshay H, founder of FlowGenius: automation that doesn't break in production.*
