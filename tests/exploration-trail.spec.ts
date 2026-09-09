import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { seal, resume } from "../scripts/exploration-trail.mjs";

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
