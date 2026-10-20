// Finds the workflow files to check.

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Folders that never contain workflows a user wrote. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);

export interface Target {
  /** Absolute path. */
  path: string;
  /** Path shown to the user and written to SARIF: relative to the working directory, with forward slashes. */
  display: string;
  /** True when the user named this file directly (not found by scanning a folder). */
  explicit: boolean;
}

/**
 * Expands the paths given on the command line. Files are taken as they are; folders are searched
 * for .json files. Missing paths throw, so typos fail loudly instead of passing as "no findings".
 */
export function discover(paths: string[], cwd: string): Target[] {
  const targets = new Map<string, Target>();
  const add = (path: string, explicit: boolean) => {
    if (!targets.has(path)) targets.set(path, { path, display: toDisplay(path, cwd), explicit });
  };

  for (const input of paths) {
    const absolute = resolve(cwd, input);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      throw new Error(`No such file or folder: ${input}`);
    }
    if (stat.isDirectory()) for (const file of walk(absolute)) add(file, false);
    else add(absolute, true);
  }
  return [...targets.values()].sort((a, b) => a.display.localeCompare(b.display));
}

function walk(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) stack.push(join(current, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files;
}

function toDisplay(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return (rel && !rel.startsWith("..") ? rel : path).split(sep).join("/");
}
