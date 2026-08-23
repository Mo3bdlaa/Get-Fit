#!/usr/bin/env node
/**
 * Runs lint, typecheck, and the unit tests concurrently, then builds, then
 * checks what the build traced into the serverless output.
 *
 * The Stop hook kills `npm run verify` at 45 seconds and reports the timeout as
 * a failure, so the budget is real. The three checks do not depend on each
 * other, and running them together costs the slowest rather than the sum.
 * Output is buffered per job and printed in a fixed order, so a failure reads
 * the same way it would have serially.
 */
import { spawn } from "node:child_process";

const JOBS = [
  ["lint", ["run", "lint"]],
  ["typecheck", ["run", "typecheck"]],
  ["test", ["run", "test"]],
];

function run(name, args) {
  return new Promise((resolve) => {
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ name, code: code ?? 1, output }));
  });
}

const results = await Promise.all(JOBS.map(([name, args]) => run(name, args)));
const failed = results.filter((result) => result.code !== 0);

for (const result of failed.length ? failed : results) {
  process.stdout.write(`\n─── ${result.name} ───\n${result.output}`);
}

if (failed.length) {
  console.error(`\nverify: ${failed.map((f) => f.name).join(", ")} failed`);
  process.exit(1);
}

// The build is last and alone: it is the slowest job and the one that needs the
// machine to itself.
const build = await run("build", ["run", "build"]);
if (build.code !== 0) {
  process.stdout.write(`\n─── build ───\n${build.output}`);
  console.error("\nverify: build failed");
  process.exit(1);
}
// The build's own success says nothing about what it traced into the serverless
// output. This is what catches a devDependency reaching production.
const traces = await run("check-traces", ["run", "check:traces"]);
if (traces.code !== 0) {
  process.stdout.write(`\n─── check-traces ───\n${traces.output}`);
  console.error("\nverify: trace check failed");
  process.exit(1);
}
process.stdout.write(traces.output);

console.log("\nverify: lint, typecheck, tests, build, traces all passed");
