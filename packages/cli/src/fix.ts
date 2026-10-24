// --fix: repair what can be repaired without guessing, and say what was left.
// Default is a dry run. --out writes fixed copies; --write overwrites the originals.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixWorkflow } from "@n8n-preflight/core";
import type { FixOptions } from "@n8n-preflight/core";
import type { Target } from "./discover.js";

export interface FixRun {
  options: FixOptions;
  out?: string;
  write: boolean;
  color: boolean;
}

export interface FixSummary {
  files: number;
  changed: number;
  fixes: number;
  errors: number;
}

export function fixFiles(targets: Target[], run: FixRun, print: (s: string) => void): FixSummary {
  const c = (code: string, s: string) => (run.color ? `${code}${s}\x1b[0m` : s);
  const summary: FixSummary = { files: 0, changed: 0, fixes: 0, errors: 0 };

  for (const target of targets) {
    let text: string;
    try {
      text = readFileSync(target.path, "utf8");
    } catch (err) {
      print(`${c("\x1b[31m", "error")} ${target.display}: could not read: ${(err as Error).message}\n`);
      summary.errors++;
      continue;
    }
    const r = fixWorkflow(text, run.options);
    if (!r.ok) {
      if (target.explicit) {
        print(`${c("\x1b[31m", "error")} ${target.display}: ${r.reason}\n`);
        summary.errors++;
      }
      continue;
    }
    summary.files++;
    if (!r.applied.length && !r.skipped.length) {
      const extra = r.remaining.length ? `; ${r.remaining.length} problem${r.remaining.length === 1 ? " needs" : "s need"} a person` : "";
      print(`${c("\x1b[1m", target.display)}  nothing to fix automatically (score ${r.before.score}${extra})\n`);
      continue;
    }
    print(`${c("\x1b[1m", target.display)}  score ${r.before.score} -> ${r.after.score}\n`);
    for (const a of r.applied) print(`  ${c("\x1b[32m", "fixed  ")} ${a.node ? `"${a.node}": ` : ""}${a.change}\n`);
    for (const s of r.skipped) print(`  ${c("\x1b[33m", "left   ")} ${s.node ? `"${s.node}" ` : ""}${s.ruleId}: ${s.reason}\n`);
    // Problems no fixer handles: point to the full report rather than leaving them out silently.
    const needPerson = r.remaining.length - r.skipped.length;
    if (needPerson > 0) {
      print(`  ${c("\x1b[33m", "left   ")} ${needPerson} more problem${needPerson === 1 ? " needs" : "s need"} a person: run without --fix to see them\n`);
    }

    if (r.applied.length) {
      summary.changed++;
      summary.fixes += r.applied.length;
      const destination = run.write ? target.path : run.out ? join(run.out, target.display) : null;
      if (destination) {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, r.json);
        print(`  ${c("\x1b[2m", `written to ${run.write ? target.display : destination}`)}\n`);
      }
    }
    print("\n");
  }

  const mode = run.write ? "files updated" : run.out ? `fixed copies written to ${run.out}` : "dry run: use --out <folder> or --write to save";
  print(`${summary.fixes} fix${summary.fixes === 1 ? "" : "es"} in ${summary.changed} of ${summary.files} workflow${summary.files === 1 ? "" : "s"} (${mode})\n`);
  return summary;
}
