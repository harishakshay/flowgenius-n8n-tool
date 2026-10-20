# Precision check (Phase 1)

**Result: 96.5% precision (193 of 200 correct) on a held-out, rule-stratified sample of rule version 3.** 95% confidence interval: 93.0% to 98.3% (Wilson). Phase 1 gate: 95% or more.

What that number means, exactly:
- **Rule-stratified:** each rule gets an equal share of the sample, so rare rules are checked as much as common ones. It is the precision you'd see if every rule fired equally often, **not** "96.5% of all findings are right". Across the real mix of findings, where the simple rules (`no-retry`, `no-error-workflow`) dominate, precision is likely higher, but that hasn't been measured.
- **Held out:** drawn from templates not used to design or fix the rules.
- **One reviewer:** labelled by Claude, not yet checked by Harish.

## Method

1. Run every rule over all 12,074 public n8n templates.
2. Draw 200 findings with a fixed seed: an equal share per rule, the rest to the rules with the most findings.
3. Label each finding against the template's JSON. A finding is correct when what it states is true for that workflow **and** it is a real production risk as described.
4. Fix false-positive patterns, then measure on a **fresh** sample of templates not used before, so the fixes are not graded on the data that shaped them.

| Round | Seed | Rules version | Templates | Precision | File |
|---|---|---|---|---|---|
| Development | 20261020 | v1 | any | 90.0% (180/200) | `dev-labels.json` |
| Test | 20261021 | v2 | excludes dev | 91.5% (183/200) | `test-labels.json` |
| **Held out** | **20261022** | **v3** | **excludes dev and test** | **96.5% (193/200)** | `holdout-labels.json` |

## Version 4: fixes from the code review

A line-by-line review and adversarial tests found 20 issues (for example: AWS keys never detected, 7-10 s scans on very large workflows). Version 4 fixes them. Since the fixes change what the rules report, the full corpus was scanned with both versions and diffed (`study/scripts/dump-findings.ts`):

- **Removed: 270 findings.** 4 are only the old wording of re-masked secrets. The other 266 are known false-positive patterns: Respond to Chat and LangChain Code asked to retry (147), pasted selections called orphaned (72), shell commands built only from fixed configuration (27), placeholder hosts and the certificate flag on `http://` (10), the manual chat trigger treated as production (6), and `endless-loop` turned off by default (4). Removing findings cannot lower precision.
- **Added: 72 findings, every one labelled (not sampled): 68 correct, 94.4%.** See `v4-added-labels.json`. One of the 4 false positives (an OAuth "Auth Callback") was fixed after labelling.

So the shipped version is v3's measured 96.5%, minus known false positives, plus 72 new findings that are 94.4% correct. Those 72 are 0.06% of all findings.

`reliability/endless-loop` is now **off by default** (opt in with `enable`). It was the weakest rule: 15 of 17 sampled findings across all rounds were wrong, because a loop can end when a step returns no items, which the JSON alone doesn't show.

## Review a sample yourself

```bash
npm run corpus:download
npx tsx study/scripts/show-sample.ts study/precision/holdout-sample.json security/
```

## Limits

- Precision only: how often a finding is right. Not recall: how many real problems the rules miss. Known recall gaps: secrets typed into JSON bodies or Set nodes under arbitrary field names are found only when they match a known key format; public chat triggers are not checked.
- Templates are not production workflows. People who publish templates leave in placeholders and demo shortcuts that production workflows usually don't.
- The rarest rules (`code-eval`: 10 findings in the whole corpus, `silent-error-trigger`: 1) barely appear in any sample.

## Still open

| Rule | Pattern | Why not fixed |
|---|---|---|
| `security/command-injection` | Base64 text inside single quotes | Proving a value is safe for the shell needs real parsing |
| `security/webhook-no-auth` | Public-by-design redirects (link shorteners, bank login callbacks) | Can't tell from the JSON that a webhook is meant to be public |
| `security/secret-in-url` | Values that may or may not be keys (a base64 timestamp on a demo API) | Ambiguous even to a human |
