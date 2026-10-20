// The command line: parse arguments, check files, print, return an exit code.
// Exit codes: 0 = passed, 1 = findings at or above --fail-on (or a named file could not be checked), 2 = bad usage.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Severity } from "@n8n-preflight/core";
import { SEVERITIES, checkFiles, knownRuleIds, shouldFail } from "./check.js";
import { discover } from "./discover.js";
import { formatJson, formatSarif, formatText } from "./format.js";

export const HELP = `Usage: n8n-preflight [options] <file or folder>...

Checks n8n workflow JSON files for production problems.
Folders are searched for .json files; files that are not n8n workflows are skipped.

Options:
  -f, --format <text|json|sarif>   Output format (default: text)
  -o, --output <file>              Write the report to a file instead of the screen
      --fail-on <level>            Exit with code 1 when a finding is at least this severe:
                                   critical, high, medium, low, or none (default: high)
      --disable <rule,...>         Rules to skip
      --enable <rule,...>          Rules that are off by default to run (reliability/endless-loop)
      --no-color                   Plain text output
  -h, --help                       Show this help

Examples:
  n8n-preflight workflows/
  n8n-preflight --format sarif --output preflight.sarif .
  n8n-preflight --fail-on critical my-workflow.json
`;

export interface Io {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTty: boolean;
}

export function run(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f", default: "text" },
        output: { type: "string", short: "o" },
        "fail-on": { type: "string", default: "high" },
        disable: { type: "string", multiple: true, default: [] },
        enable: { type: "string", multiple: true, default: [] },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (!positionals.length) {
    io.stderr(`Give at least one file or folder.\n\n${HELP}`);
    return 2;
  }

  const format = values.format;
  if (format !== "text" && format !== "json" && format !== "sarif") {
    io.stderr(`Unknown --format "${format}". Use text, json or sarif.\n`);
    return 2;
  }
  const failOn = values["fail-on"];
  if (failOn !== "none" && !SEVERITIES.includes(failOn as Severity)) {
    io.stderr(`Unknown --fail-on "${failOn}". Use critical, high, medium, low or none.\n`);
    return 2;
  }

  const split = (list: string[]) => list.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  const disable = split(values.disable);
  const enable = split(values.enable);
  const known = knownRuleIds();
  const unknown = [...disable, ...enable].filter((id) => !known.has(id));
  if (unknown.length) {
    io.stderr(`Unknown rule${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}\n`);
    return 2;
  }

  let targets;
  try {
    targets = discover(positionals, io.cwd);
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`);
    return 2;
  }

  const check = checkFiles(targets, { disable, enable });
  const report =
    format === "json" ? formatJson(check) : format === "sarif" ? formatSarif(check) : formatText(check, { color: io.isTty && !values["no-color"] });

  if (values.output) {
    writeFileSync(values.output, report);
    if (format !== "text") io.stdout(formatText(check, { color: io.isTty && !values["no-color"] }));
  } else {
    io.stdout(report);
  }

  if (!check.results.length && !check.errors.length) io.stderr("No n8n workflows found.\n");
  return shouldFail(check, failOn as Severity | "none") ? 1 : 0;
}
