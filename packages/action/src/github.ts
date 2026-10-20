// The parts of the GitHub Actions runtime we need, without @actions/core.
// Reference: https://docs.github.com/actions/reference/workflow-commands-for-github-actions

import { appendFileSync } from "node:fs";

export function input(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}

export function setOutput(name: string, value: string | number, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${String(value)}\n`);
}

export function appendSummary(markdown: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown);
}

/** Escaping rules for workflow command data and properties. */
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export type AnnotationLevel = "error" | "warning" | "notice";

/** An inline comment on the file in the pull request's "Files changed" view. */
export function annotation(level: AnnotationLevel, message: string, props: { file: string; line: number; title: string }): string {
  const p = `file=${escapeProperty(props.file)},line=${props.line},title=${escapeProperty(props.title)}`;
  return `::${level} ${p}::${escapeData(message)}\n`;
}
