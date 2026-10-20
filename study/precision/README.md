# Precision check (Phase 1)

**Result: 96.5% precision (193 of 200 findings correct) on a held-out sample.** 95% confidence interval: 93.0% to 98.3% (Wilson). Phase 1 gate: 95% or more.

## Method

1. Run every rule over all 12,074 public n8n templates.
2. Draw 200 findings with a fixed seed, spread across rules (an equal share per rule, the rest to the rules with the most findings), so rare rules are checked too.
3. Label each finding against the template's JSON. A finding is correct when what it states is true for that workflow **and** it is a real production risk as described.
4. Fix false-positive patterns, then measure on a **fresh** sample from templates not used before, so the fixes are not graded on the data that shaped them.

| Round | Seed | Rules version | Templates | Precision | File |
|---|---|---|---|---|---|
| Development | 20261020 | v1 | any | 90.0% (180/200) | `dev-labels.json` |
| Test | 20261021 | v2 | excludes dev | 91.5% (183/200) | `test-labels.json` |
| **Held out** | **20261022** | **v3 (shipped)** | **excludes dev and test** | **96.5% (193/200)** | `holdout-labels.json` |

Each `*-labels.json` lists every false positive with its reason; the rest are correct. Each `*-sample.json` is the exact sample. To review a sample yourself:

```bash
npm run corpus:download
npx tsx study/scripts/show-sample.ts study/precision/holdout-sample.json security/
```

## Limits

- Labels are by Claude (Opus 5.5) and still need Harish's review. One reviewer, no second opinion yet.
- Precision only: how often a finding is right. Not recall: how many real problems the rules miss.
- Templates are not production workflows. People who publish templates leave in placeholders and demo shortcuts that production workflows usually don't.
- 200 findings. The rarest rules (`code-eval`: 7 findings in the whole corpus, `silent-error-trigger`: 1) barely appear in any sample.

## Known false positives in the shipped version (follow-ups)

From the held-out sample. Not fixed yet, so the number above stays an honest measurement of what shipped.

| Rule | Pattern | Fix idea |
|---|---|---|
| `reliability/endless-loop` | Pagination loops end when an HTTP call returns an empty page | Weakest rule: 15 of 17 sampled findings across all rounds were wrong. Turn it off by default, or report it as low-confidence |
| `security/command-injection` | Values from a fixed configuration node (Set node with literal values) | Treat references to Set nodes whose values are all literals as constants |
| `security/command-injection` | Base64 text inside single quotes | Hard to detect safely; leave |
| `security/insecure-transport` | Placeholder hosts (`XX.XX.XX`, `your-api.com`) and localhost with the certificate flag | Treat `X`-only and `your-` hosts as placeholders; ignore the certificate flag on `http://` URLs |
