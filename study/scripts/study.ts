// Phase 3 study: what production problems ship in public n8n templates?
// Writes study/results/<name>/summary.json and REPORT.md (every number in the report comes from the
// summary, never typed by hand), plus a private list of leaked keys in study/output/ (not committed).
// Usage: tsx study/scripts/study.ts [name]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, buildGraph, externalCallNodes, rules, scoreFindings } from "@n8n-preflight/core";
import type { Finding } from "@n8n-preflight/core";
import { outputDir, readCorpus, studyRoot } from "./corpus.js";

const NAME = process.argv[2] ?? "n8n-templates-2026-10";

/**
 * Leaked-key numbers stay out of the public report until n8n's security team has been told and
 * authors have had 14 days to rotate their keys. Flip to true after that, then re-run.
 */
const PUBLISH_LEAKED_KEYS = false;
const SECRET_RULES = new Set(["security/hardcoded-secret", "security/secret-in-url"]);

/**
 * Checks on workflow settings (error workflow, execution timeout, timezone). A template often can't
 * carry these: the error workflow is an ID on the author's own server. Reported, but kept out of the
 * headline score so templates aren't blamed for what exporting removes.
 */
const SETTINGS_RULES = new Set([
  "error-handling/no-error-workflow",
  "reliability/no-execution-timeout",
  "reliability/schedule-no-timezone",
]);

/** Problems that sit in the nodes themselves: import the template and you import these. */
const HEADLINE_RULES = [
  "error-handling/no-retry",
  "reliability/http-no-timeout",
  "security/webhook-no-auth",
  "error-handling/swallowed-errors",
  "error-handling/unconnected-error-output",
  "security/hardcoded-secret",
  "security/secret-in-url",
  "data/pinned-data",
  "data/test-endpoint",
  "security/command-injection",
  "reliability/webhook-without-responder",
];

interface Row {
  id: number;
  views: number;
  year: number | null;
  ai: boolean;
  nodes: number;
  score: number;
  nodeScore: number;
  rules: Set<string>;
  findings: Finding[];
  /** Active HTTP Request nodes. */
  httpNodes: number;
  /** Nodes that call an outside service (what the no-retry rule looks at). */
  outsideCalls: number;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function describe(rows: Row[]) {
  const ruleShare = Object.fromEntries(
    rules
      .filter((r) => PUBLISH_LEAKED_KEYS || !SECRET_RULES.has(r.id))
      .map((r) => [r.id, pct(rows.filter((x) => x.rules.has(r.id)).length, rows.length)]),
  );
  return {
    templates: rows.length,
    medianNodes: median(rows.map((r) => r.nodes)),
    score: { median: median(rows.map((r) => r.score)), ready: pct(rows.filter((r) => r.score >= 90).length, rows.length) },
    nodeScore: {
      median: median(rows.map((r) => r.nodeScore)),
      ready: pct(rows.filter((r) => r.nodeScore >= 90).length, rows.length),
      notReady: pct(rows.filter((r) => r.nodeScore < 70).length, rows.length),
    },
    atLeastOneHeadline: pct(rows.filter((r) => HEADLINE_RULES.some((id) => r.rules.has(id))).length, rows.length),
    rules: ruleShare,
  };
}

/** What kind of key, from the finding message ("contains an OpenAI API key", "fixed ... header"). */
function keyKind(f: Finding): string {
  const m = /contains an? (.+?):/.exec(f.message);
  if (m) return m[1]!;
  if (/header/.test(f.message)) return "fixed auth header value";
  return "key in URL parameter";
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  const leaks: { templateId: number; node?: string; ruleId: string; kind: string }[] = [];
  let unreadable = 0;

  for await (const record of readCorpus()) {
    const result = analyze(record.workflow);
    if (!result.ok) {
      unreadable++;
      continue;
    }
    const nodeFindings = result.findings.filter((f) => !SETTINGS_RULES.has(f.ruleId));
    const year = record.createdAt ? new Date(record.createdAt).getUTCFullYear() : null;
    rows.push({
      id: record.id,
      views: record.totalViews ?? 0,
      year: Number.isFinite(year) ? year : null,
      ai: result.workflow.nodes.some((n) => n.type.startsWith("@n8n/n8n-nodes-langchain.")),
      nodes: result.workflow.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote").length,
      score: result.score,
      nodeScore: scoreFindings(nodeFindings).score,
      rules: new Set(result.findings.map((f) => f.ruleId)),
      findings: result.findings,
      httpNodes: result.workflow.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest" && !n.disabled).length,
      outsideCalls: externalCallNodes(buildGraph(result.workflow)).length,
    });
    for (const f of result.findings) {
      if (f.ruleId === "security/hardcoded-secret" || f.ruleId === "security/secret-in-url") {
        const leak: (typeof leaks)[number] = { templateId: record.id, ruleId: f.ruleId, kind: keyKind(f) };
        if (f.node !== undefined) leak.node = f.node;
        leaks.push(leak);
      }
    }
  }

  // Popularity: split templates into four equal groups by views.
  const byViews = [...rows].sort((a, b) => a.views - b.views);
  const quartile = (q: number) => byViews.slice(Math.floor((q * byViews.length) / 4), Math.floor(((q + 1) * byViews.length) / 4));
  const top100 = [...rows].sort((a, b) => b.views - a.views).slice(0, 100);
  const years = [...new Set(rows.map((r) => r.year).filter((y): y is number => y !== null))].sort();
  const sizes: [string, (r: Row) => boolean][] = [
    ["1-5 nodes", (r) => r.nodes <= 5],
    ["6-15 nodes", (r) => r.nodes > 5 && r.nodes <= 15],
    ["16-30 nodes", (r) => r.nodes > 15 && r.nodes <= 30],
    ["31+ nodes", (r) => r.nodes > 30],
  ];

  const leakTemplates = new Set(leaks.map((l) => l.templateId));
  const leakKinds = leaks.reduce<Record<string, number>>((acc, l) => ((acc[l.kind] = (acc[l.kind] ?? 0) + 1), acc), {});

  // Per node, not per template: "x% of HTTP Request nodes have no timeout".
  const httpNodes = rows.reduce((n, r) => n + r.httpNodes, 0);
  const httpNoTimeout = rows.reduce((n, r) => n + r.findings.filter((f) => f.ruleId === "reliability/http-no-timeout").length, 0);
  const outsideCalls = rows.reduce((n, r) => n + r.outsideCalls, 0);
  const outsideNoRetry = rows.reduce((n, r) => n + r.findings.filter((f) => f.ruleId === "error-handling/no-retry").length, 0);

  const summary = {
    name: NAME,
    generated: new Date().toISOString().slice(0, 10),
    rulesVersion: "v4",
    corpus: { templates: rows.length + unreadable, analysed: rows.length, unreadable, nodes: rows.reduce((n, r) => n + r.nodes, 0) },
    overall: describe(rows),
    perNode: {
      httpRequestNodes: httpNodes,
      httpRequestWithoutTimeout: httpNoTimeout,
      httpRequestWithoutTimeoutPct: pct(httpNoTimeout, httpNodes),
      outsideCalls,
      outsideCallsWithoutRetry: outsideNoRetry,
      outsideCallsWithoutRetryPct: pct(outsideNoRetry, outsideCalls),
    },
    leakedKeys: PUBLISH_LEAKED_KEYS
      ? { findings: leaks.length, templates: leakTemplates.size, templatesPct: pct(leakTemplates.size, rows.length), byKind: leakKinds }
      : null,
    breakdowns: {
      aiVsClassic: { ai: describe(rows.filter((r) => r.ai)), classic: describe(rows.filter((r) => !r.ai)) },
      popularity: {
        leastViewed25: describe(quartile(0)),
        mostViewed25: describe(quartile(3)),
        top100: describe(top100),
        viewThresholds: { mostViewed25From: quartile(3)[0]?.views ?? 0, top100From: top100.at(-1)?.views ?? 0 },
      },
      byYear: Object.fromEntries(years.map((y) => [y, describe(rows.filter((r) => r.year === y))])),
      bySize: Object.fromEntries(sizes.map(([label, test]) => [label, describe(rows.filter(test))])),
      // 2026 templates are bigger, and bigger workflows have more problems. Comparing within the
      // same size group shows whether a change between years is more than size.
      year2025vs2026BySize: Object.fromEntries(
        sizes.map(([label, test]) => [
          label,
          {
            2025: describe(rows.filter((r) => r.year === 2025 && test(r))),
            2026: describe(rows.filter((r) => r.year === 2026 && test(r))),
          },
        ]),
      ),
    },
    settingsRules: [...SETTINGS_RULES],
    headlineRules: HEADLINE_RULES,
  };

  const dir = join(studyRoot, "results", NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(dir, "REPORT.md"), renderReport(summary));
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "leaked-keys-private.json"), `${JSON.stringify(leaks, null, 2)}\n`);
  console.log(JSON.stringify({ corpus: summary.corpus, overall: { ...summary.overall, rules: undefined }, perNode: summary.perNode, leakedKeys: summary.leakedKeys ?? "held" }, null, 2));
  console.log(`private leaked-key list (never commit): ${leaks.length} findings in ${leakTemplates.size} templates`);
}

type Described = ReturnType<typeof describe>;

const OFF_BY_DEFAULT = new Set(rules.filter((r) => r.defaultEnabled === false).map((r) => r.id));

/** "1.6x to 4.1x": how much more often 2026 templates swallow errors than 2025's, across size groups. */
function swallowRatio(bySize: Record<string, { 2025: Described; 2026: Described }>): string {
  const ratios = Object.values(bySize)
    .map((y) => (y[2026].rules["error-handling/swallowed-errors"] ?? 0) / (y[2025].rules["error-handling/swallowed-errors"] || NaN))
    .filter(Number.isFinite);
  const fmt = (x: number) => `${Math.round(x * 10) / 10}x`;
  return `${fmt(Math.min(...ratios))} to ${fmt(Math.max(...ratios))}`;
}

/** The published report. Every number is read from the summary, so the text can't drift from the data. */
function renderReport(s: {
  generated: string;
  rulesVersion: string;
  corpus: { templates: number; nodes: number };
  overall: Described;
  perNode: {
    httpRequestNodes: number;
    httpRequestWithoutTimeout: number;
    httpRequestWithoutTimeoutPct: number;
    outsideCalls: number;
    outsideCallsWithoutRetry: number;
    outsideCallsWithoutRetryPct: number;
  };
  leakedKeys: { findings: number; templates: number; templatesPct: number; byKind: Record<string, number> } | null;
  breakdowns: {
    aiVsClassic: { ai: Described; classic: Described };
    popularity: { leastViewed25: Described; mostViewed25: Described; top100: Described; viewThresholds: { mostViewed25From: number; top100From: number } };
    byYear: Record<string, Described>;
    bySize: Record<string, Described>;
    year2025vs2026BySize: Record<string, { 2025: Described; 2026: Described }>;
  };
}): string {
  const o = s.overall;
  const r = (d: Described, id: string) => `${d.rules[id] ?? 0}%`;
  const n = (x: number) => x.toLocaleString("en-US");
  const b = s.breakdowns;
  const row = (label: string, d: Described) =>
    `| ${label} | ${n(d.templates)} | ${d.medianNodes} | ${d.nodeScore.median} | ${d.nodeScore.ready}% | ${r(d, "error-handling/swallowed-errors")} | ${r(d, "security/webhook-no-auth")} | ${r(d, "reliability/http-no-timeout")} |`;
  const head = "| Group | Templates | Median nodes | Median score | Score 90+ | Swallow errors | Open webhook | HTTP without timeout |\n|---|---|---|---|---|---|---|---|";

  const lines = [
    "# What production problems ship in public n8n templates?",
    "",
    `A scan of all **${n(s.corpus.templates)} public templates** on n8n.io (${n(s.corpus.nodes)} nodes), with the open-source [n8n Preflight](../../../README.md) rules (${s.rulesVersion}). Generated ${s.generated} by \`npm run study\`; numbers come from [summary.json](summary.json).`,
    "",
    "## Key findings",
    "",
    `1. **${s.perNode.outsideCallsWithoutRetryPct}% of nodes that call an outside service have no retry** (${n(s.perNode.outsideCallsWithoutRetry)} of ${n(s.perNode.outsideCalls)}). One rate limit or 502 and the run fails. ${r(o, "error-handling/no-retry")} of templates have at least one.`,
    `2. **${s.perNode.httpRequestWithoutTimeoutPct}% of HTTP Request nodes have no timeout** (${n(s.perNode.httpRequestWithoutTimeout)} of ${n(s.perNode.httpRequestNodes)}).`,
    `3. **${r(o, "security/webhook-no-auth")} of templates have a webhook anyone can call**, with no authentication and no signature check in the first steps.`,
    `4. **${r(o, "error-handling/swallowed-errors")} of templates swallow errors:** a step set to "continue on error" whose failure nothing checks, so the run reports success while the work never happened.`,
    s.leakedKeys
      ? `5. **${s.leakedKeys.templates} templates (${s.leakedKeys.templatesPct}%) contain what looks like a real API key or token** (${s.leakedKeys.findings} in total). They are not listed here; see [How we handled leaked keys](#how-we-handled-leaked-keys).`
      : "5. **Some templates contain what look like real API keys or tokens.** Those details are being reported privately first; see [How we handled leaked keys](#how-we-handled-leaked-keys).",
    `6. **Bigger workflows are much riskier.** ${b.bySize["31+ nodes"]!.nodeScore.notReady}% of templates with 31+ nodes score below 70, against ${b.bySize["1-5 nodes"]!.nodeScore.notReady}% of templates with 1-5 nodes.`,
    `7. **Templates published in 2026 swallow errors more often than 2025's at every size: ${swallowRatio(b.year2025vs2026BySize)} as often.** See [the size-controlled comparison](#2025-vs-2026-at-the-same-size).`,
    `8. **Popular isn't safer.** The ${b.popularity.top100.templates} most-viewed templates rarely leave webhooks open (${r(b.popularity.top100, "security/webhook-no-auth")}), but ${r(b.popularity.top100, "reliability/http-no-timeout")} have an HTTP request with no timeout; only ${b.popularity.top100.nodeScore.ready}% score 90+.`,
    `9. **AI-agent workflows are no worse than classic ones:** median score ${b.aiVsClassic.ai.nodeScore.median} vs ${b.aiVsClassic.classic.nodeScore.median}.`,
    "",
    "## The score",
    "",
    `Each template gets a 0-100 score from the problems in its **nodes** (rules and weights: [RULES.md](../../../docs/RULES.md)). The median is **${o.nodeScore.median}**; **${o.nodeScore.ready}%** score 90 or more and **${o.nodeScore.notReady}%** score below 70.`,
    "",
    `Three checks look at workflow **settings** (error workflow, execution timeout, timezone), and templates often can't carry those: an error workflow is an ID on the author's own server. They are left out of the score above. For the record, ${r(o, "error-handling/no-error-workflow")} of templates set no error workflow and ${r(o, "reliability/no-execution-timeout")} no execution timeout; counting them, the median score is ${o.score.median} and ${o.score.ready}% score 90+.`,
    "",
    "## Every rule",
    "",
    "| Rule | Templates affected |",
    "|---|---|",
    ...Object.entries(o.rules)
      .sort((a, z) => z[1] - a[1])
      .map(([id, share]) => `| \`${id}\`${OFF_BY_DEFAULT.has(id) ? " (off by default, not run)" : ""} | ${share}% |`),
    "",
    "## By size",
    "",
    head,
    ...Object.entries(b.bySize).map(([label, d]) => row(label, d)),
    "",
    "## 2025 vs 2026 at the same size",
    "",
    "Templates got bigger in 2026, and bigger workflows have more problems, so a plain year-to-year comparison would mostly measure size. Within each size group:",
    "",
    "| Size | 2025 templates | 2026 templates | Swallow errors 2025 | 2026 | Open webhook 2025 | 2026 |",
    "|---|---|---|---|---|---|---|",
    ...Object.entries(b.year2025vs2026BySize).map(
      ([label, y]) =>
        `| ${label} | ${n(y[2025].templates)} | ${n(y[2026].templates)} | ${r(y[2025], "error-handling/swallowed-errors")} | ${r(y[2026], "error-handling/swallowed-errors")} | ${r(y[2025], "security/webhook-no-auth")} | ${r(y[2026], "security/webhook-no-auth")} |`,
    ),
    "",
    "The data shows the change, not its cause.",
    "",
    "## By popularity",
    "",
    head,
    row("Least-viewed 25%", b.popularity.leastViewed25),
    row(`Most-viewed 25% (${n(b.popularity.viewThresholds.mostViewed25From)}+ views)`, b.popularity.mostViewed25),
    row(`Top 100 (${n(b.popularity.viewThresholds.top100From)}+ views)`, b.popularity.top100),
    "",
    "New templates have had less time to collect views, so the least-viewed group leans toward 2026 templates: popularity and year overlap here.",
    "",
    "## AI-agent vs classic workflows",
    "",
    "AI-agent workflows are those with at least one LangChain node (agent, chain, model).",
    "",
    head,
    row("AI agent", b.aiVsClassic.ai),
    row("Classic", b.aiVsClassic.classic),
    "",
    "## By year published",
    "",
    head,
    ...Object.entries(b.byYear).map(([y, d]) => row(y, d)),
    "",
    "## How we handled leaked keys",
    "",
    s.leakedKeys
      ? `Of the ${s.leakedKeys.findings} key-like values found, by kind: ${Object.entries(s.leakedKeys.byKind)
          .sort((a, z) => z[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}. Template ids and values are kept private. Some may be expired or demo keys; we did not test any, since using someone else's credential is not ours to do.`
      : "Numbers and details are held back for now: n8n's security team is told first, and template authors get 14 days to rotate their keys. This section will be filled in after that. Template ids and key values will never be published, and we did not test any key: using someone else's credential is not ours to do.",
    "",
    "## Method and limits",
    "",
    "- **Templates are not production workflows.** They are shared examples; people are expected to adapt them. But they are what thousands of people import and run, so what they leave out often stays out.",
    "- **Precision:** on a held-out, rule-stratified sample, 96.5% of findings were correct; see [the precision check](../../precision/README.md). Labels were checked by one reviewer.",
    "- **Recall is not measured:** the rules can miss problems, so these numbers are a floor, not a ceiling.",
    "- **Static analysis:** findings come from the workflow JSON. Some risks depend on the server's own settings (a default timeout, an instance timezone), which a template doesn't show.",
    "- **Reproduce it:** `npm run corpus:download && npm run study`.",
    "",
  ];
  return lines.join("\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
