import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { seal, resume, resumeCompact } from "../scripts/exploration-trail.mjs";
import { captureProbe } from "../scripts/exploration-probe.mjs";

function observation() {
  return {
    profile: "exploration-trail-pilot/v1",
    question: "Is there a passage?",
    attempt: "visit-1",
    capturedAt: "2026-09-09T08:00:00Z",
    conditions: ["Western ridge at sunset, one visit"],
    premise: "Birds may lead to water",
    experiment: "Follow birds for one hour",
    observations: ["Mostly birds"],
    interpretation: "No passage observed during this visit",
    limitations: ["One route and time; not an exhaustive survey"],
    openQuestions: ["Does another route or season differ?"],
    possibleNextExperiments: [],
    evidence: [
      {
        command: ["field-note"],
        cwd: "/example",
        startedAt: "2026-09-09T07:00:00Z",
        durationMs: 3600000,
        exitCode: null,
        stdout: "Mostly birds",
        stderr: "",
      },
    ],
  };
}
describe("opt-in exploration trail", () => {
  it("compacts output without hiding failed probes, contradictory observations or limits", () => {
    const record = {
      ...observation(),
      observations: ["Mostly birds on visit one", "A passage was observed on visit two"],
      evidence: [
        {
          ...observation().evidence[0],
          stdout: "鳥".repeat(2000),
          stderr: "decisive detail",
          termination: "timeout",
          outputTruncated: true,
        },
        {
          ...observation().evidence[0],
          exitCode: 0,
          stdout: "passage",
          stderr: "",
          outputTruncated: false,
        },
      ],
    };
    const trail = seal(record),
      before = JSON.stringify(trail);
    const packet = resumeCompact(trail, "/source/trail.json");
    expect(packet.record.observations).toEqual(record.observations);
    expect(packet.record.limitations).toEqual(record.limitations);
    expect(packet.record.openQuestions).toEqual(record.openQuestions);
    expect(packet.record.possibleNextExperiments).toEqual([]);
    expect(packet.record.evidence[0]).toMatchObject({
      exitCode: null,
      termination: "timeout",
      outputTruncated: true,
      sourcePointer: "/record/evidence/0",
      omittedExcerpts: { stdoutUtf8Bytes: 6000, stderrUtf8Bytes: 15 },
    });
    expect(packet.record.evidence[0]).not.toHaveProperty("stdout");
    expect(packet.record.evidence[1].exitCode).toBe(0);
    expect(packet.selection.caution).toContain("decisive details");
    expect(packet.source).toEqual({ location: "/source/trail.json", digest: trail.digest });
    expect(JSON.stringify(trail)).toBe(before);
    expect(resume(trail, packet.source.digest).record.evidence[0].stderr).toBe("decisive detail");
    const replacement = seal({ ...record, observations: ["Different history"] });
    expect(() => resume(replacement, packet.source.digest)).toThrow("expected source digest");
  });
  it("refuses oversized compact narratives and tampered sources instead of silently dropping meaning", () => {
    const large = seal({ ...observation(), observations: Array(5).fill("x".repeat(3990)) });
    expect(() => resumeCompact(large, "/source")).toThrow("16 KiB");
    expect(resume(large).record.observations).toHaveLength(5);
    const altered = seal(observation());
    altered.record.limitations = ["Changed after sealing"];
    expect(() => resumeCompact(altered, "/source")).toThrow("digest mismatch");
  });
  it("retrieves omitted details in a separate CLI process only from the expected source", async () => {
    const root = await mkdtemp(join(tmpdir(), "exploration-compact-"));
    try {
      const source = join(root, "trail.json"),
        script = resolve("scripts/exploration-trail.mjs");
      const trail = seal(observation());
      await writeFile(source, JSON.stringify(trail));
      const packet = JSON.parse(
        execFileSync(process.execPath, [script, "resume", source, "--compact"], {
          encoding: "utf8",
        })
      );
      const full = JSON.parse(
        execFileSync(
          process.execPath,
          [script, "resume", packet.source.location, "--expect-digest", packet.source.digest],
          { encoding: "utf8" }
        )
      );
      expect(full.record).toEqual(trail.record);
      await writeFile(
        source,
        JSON.stringify(seal({ ...observation(), observations: ["Replacement"] }))
      );
      expect(() =>
        execFileSync(
          process.execPath,
          [script, "resume", source, "--expect-digest", packet.source.digest],
          { stdio: "pipe" }
        )
      ).toThrow();
      expect(() =>
        execFileSync(process.execPath, [script, "resume", source, "--compact", "--compact"], {
          stdio: "pipe",
        })
      ).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("preserves exact argv including whitespace and empty arguments", () => {
    const record = observation();
    record.evidence[0].command = ["node", " spaced ", ""];
    record.evidence[0].cwd = "/path with trailing space ";
    expect(resume(seal(record)).record).toEqual(record);
  });
  it("drains large process output without replacing completion with a buffer failure", async () => {
    const result = await captureProbe(
      [process.execPath, "-e", "process.stdout.write('x'.repeat(100000))"],
      process.cwd()
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdoutBytes).toBe(100000);
    expect(result.stdout.length).toBe(4096);
    expect(result.outputTruncated).toBe(true);
  });
  it("retains an explicit process timeout without calling it successful completion", async () => {
    const result = await captureProbe(
      [process.execPath, "-e", "setInterval(()=>{},1000)"],
      process.cwd(),
      100
    );
    expect(result.termination).toContain("timeout");
    expect(result.exitCode).not.toBe(0);
  });
  it("retains an unremarkable observation, limits and open question without inventing a next step", () => {
    const result = resume(seal(observation()));
    expect(result.questionDisposition).toBe("open");
    expect(result.record).toEqual(observation());
    expect(result.record.possibleNextExperiments).toEqual([]);
  });
  it("rejects altered observations instead of silently resealing history", () => {
    const trail = seal(observation());
    trail.record.observations = ["No passage exists anywhere"];
    expect(() => resume(trail)).toThrow("digest mismatch");
  });
  it("requires observational limits and rejects unknown authority fields", () => {
    expect(() => seal({ ...observation(), limitations: [] })).toThrow();
    expect(() => seal({ ...observation(), authorized: true })).toThrow();
  });
  it("bounds the whole record, not just individual strings", () => {
    expect(() =>
      seal({ ...observation(), observations: Array(24).fill("x".repeat(4000)) })
    ).toThrow("64 KiB");
  });
  it("the CLI preserves existing trails and resumes in a separate process", async () => {
    const root = await mkdtemp(join(tmpdir(), "exploration-trail-"));
    try {
      const input = join(root, "input.json"),
        output = join(root, "trail.json");
      await writeFile(input, JSON.stringify(observation()));
      const script = resolve("scripts/exploration-trail.mjs");
      execFileSync(process.execPath, [script, "seal", input, output]);
      const original = await readFile(output, "utf8");
      expect(() =>
        execFileSync(process.execPath, [script, "seal", input, output], { stdio: "pipe" })
      ).toThrow();
      expect(await readFile(output, "utf8")).toBe(original);
      const packet = JSON.parse(
        execFileSync(process.execPath, [script, "resume", output], { encoding: "utf8" })
      );
      expect(packet.record.observations).toEqual(["Mostly birds"]);
      expect(packet.questionDisposition).toBe("open");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
