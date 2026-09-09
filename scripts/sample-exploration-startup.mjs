import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seal } from "./exploration-trail.mjs";

// Fixed, read-only CLI probes. Never execute a command supplied by a trail.
const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length)
  throw new Error("Usage: node scripts/sample-exploration-startup.mjs new-trail.json");
const cwd = resolve(import.meta.dirname, "..");
const cli = resolve(cwd, "dist/cli.js");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
const evidence = [];
for (let round = 0; round < 3; round++) {
  for (const args of [["--version"], ["--help"], ["attempt", "--help"]]) {
    const startedAt = new Date().toISOString();
    const begin = performance.now();
    let stdout = "",
      stderr = "",
      exitCode = null;
    try {
      stdout = execFileSync(process.execPath, [cli, ...args], {
        cwd,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 8192,
      });
      exitCode = 0;
    } catch (error) {
      stdout = String(error.stdout ?? "").slice(0, 8192);
      stderr = `${error.code ?? "process_error"}: ${String(error.stderr ?? "").slice(0, 7000)}`;
      exitCode = Number.isInteger(error.status) ? error.status : null;
    }
    evidence.push({
      command: [process.execPath, cli, ...args],
      cwd,
      startedAt,
      durationMs: performance.now() - begin,
      exitCode,
      stdout,
      stderr,
    });
  }
}
const record = {
  profile: "exploration-trail-pilot/v1",
  question: "How much of CLI startup is shared overhead versus command-specific work?",
  attempt: "startup-observation-1",
  capturedAt: new Date().toISOString(),
  conditions: [
    `checkout HEAD ${head}`,
    `Node ${process.version}; ${process.platform}/${process.arch}`,
    "Existing local dist build; not a verified clean or reproducible artifact",
    "Three sequential rounds, fixed version/help/attempt-help order; fresh processes, uncontrolled OS cache",
  ],
  premise: "A small version response may still pay shared CLI initialization cost.",
  experiment:
    "Measure three read-only CLI entrypoints in three sequential rounds, retaining output and elapsed wall time.",
  observations: evidence.map(
    (e) =>
      `${e.command.slice(2).join(" ")}: ${e.durationMs.toFixed(2)} ms; exit ${e.exitCode}; ${Buffer.byteLength(e.stdout)} stdout bytes`
  ),
  interpretation:
    "These are timing samples, not an attribution of the time to any module or subsystem.",
  limitations: [
    "Nine samples on one host; no cold-cache claim, randomized order, baseline or causal isolation",
    "No performance improvement or universal platform behavior established",
    "Each process has a 30 second timeout and 8 KiB output cap; error output may be truncated; null exit means no numeric exit observed",
  ],
  openQuestions: [
    "Which initialization costs are shared?",
    "How much variation is explained by cache and host load?",
  ],
  possibleNextExperiments: [
    "Compare a minimal Node process baseline under the same conditions",
    "Randomize probe order and collect more samples before making a causal claim",
  ],
  evidence,
};
const trail = seal(record);
await writeFile(output, JSON.stringify(trail), { flag: "wx" });
console.log(JSON.stringify({ written: output, digest: trail.digest, samples: evidence.length }));
