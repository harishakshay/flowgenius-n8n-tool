#!/usr/bin/env node
import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTty: process.stdout.isTTY === true && !process.env.NO_COLOR,
});
