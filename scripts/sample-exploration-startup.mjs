import { execFileSync } from "node:child_process";
import { captureProbe } from "./exploration-probe.mjs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seal, resume, readBounded } from "./exploration-trail.mjs";

// Fixed, read-only CLI probes. Never execute a command supplied by a trail.
const [output, previousPath, ...extra] = process.argv.slice(2);
if (!output || extra.length)
  throw new Error(
    "Usage: node scripts/sample-exploration-startup.mjs new-trail.json [previous-trail.json]"
  );
const cwd = resolve(import.meta.dirname, "..");
const cli = resolve(cwd, "dist/cli.js");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
const previous = previousPath ? resume(await readBounded(previousPath)) : undefined;
const evidence = [];
for (let round = 0; round < 3; round++) {
  for (const args of [["--version"], ["--help"], ["attempt", "--help"]]) {
    evidence.push(await captureProbe([process.execPath, cli, ...args], cwd));
  }
}
const record = {
  profile: "exploration-trail-pilot/v1",
  question: "How much of CLI startup is shared overhead versus command-specific work?",
  attempt: previous ? "startup-observation-successor" : "startup-observation",
  ...(previous ? { previousTrail: { location: previousPath, digest: previous.sourceDigest } } : {}),
  capturedAt: new Date().toISOString(),
  conditions: [
    `checkout HEAD ${head}`,
    `Node ${process.version}; ${process.platform}/${process.arch}`,
    "Existing local dist build; not a verified clean or reproducible artifact",
    "Three sequential rounds, fixed version/help/attempt-help order; fresh processes, uncontrolled OS cache",
  ],
  premise: previous
    ? "Reassess timing after replacing buffer-limited termination with streamed output capture; prior observations remain retained."
    : "A small version response may still pay shared CLI initialization cost.",
  experiment:
    "Measure three read-only CLI entrypoints in three sequential rounds, retaining output and elapsed wall time.",
  observations: evidence.map(
    (e) =>
      `${e.command.slice(2).join(" ")}: ${e.durationMs.toFixed(2)} ms; exit ${e.exitCode}; ${e.stdoutBytes} stdout bytes observed; excerpt truncated=${e.outputTruncated}`
  ),
  interpretation:
    "These are timing samples, not an attribution of the time to any module or subsystem.",
  limitations: [
    "Nine samples on one host; no cold-cache claim, randomized order, baseline or causal isolation",
    "No performance improvement or universal platform behavior established",
    "Each direct child has a 30 second timeout; streams are drained and counted with only their first4KiB retained. No descendant-process containment claim; null exit is not success",
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
