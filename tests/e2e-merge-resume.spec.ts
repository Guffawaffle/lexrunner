import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalResumeCheckpoint,
  LocalWeaveResumeDriver,
} from "../src/weave/local-resume-driver.js";
import { resumePersistedWeave } from "../src/weave/resume-service.js";
import { loadCheckpoint, saveCheckpoint } from "../src/weave/checkpoint/storage.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  );
});

describe("merge-weave process restart", () => {
  it("observes a merge applied immediately before process exit and continues without replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-merge-resume-e2e-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const working = join(root, "working");
    const checkpoints = join(working, ".lexrunner", "checkpoints");

    await git(root, "init", "--bare", remote);
    await git(root, "clone", remote, seed);
    await configureGit(seed);
    await writeFile(join(seed, "base.txt"), "base\n", "utf-8");
    await git(seed, "add", "base.txt");
    await git(seed, "commit", "-m", "base");
    await git(seed, "branch", "-M", "main");
    await git(seed, "push", "-u", "origin", "main");
    await git(seed, "checkout", "-b", "feature");
    await writeFile(join(seed, "feature.txt"), "feature\n", "utf-8");
    await git(seed, "add", "feature.txt");
    await git(seed, "commit", "-m", "feature");
    await git(seed, "push", "-u", "origin", "feature");
    await git(root, "clone", remote, working);
    await configureGit(working);
    await git(working, "checkout", "main");

    const plan = {
      schemaVersion: "1.0.0" as const,
      target: "main",
      items: [{ name: "feature", deps: [], gates: [] }],
    };
    const checkpoint = await createLocalResumeCheckpoint({
      plan,
      workingDir: working,
      runId: "PROCESS-RESTART",
      now: "2026-07-19T12:00:00.000Z",
    });
    await saveCheckpoint(checkpoint, { checkpointDir: checkpoints, skipCleanup: true });
    await writeFile(join(working, "weave-lock.json"), "{}\n", "utf-8");

    const crashProgram = `
      import { LocalWeaveResumeDriver } from "./src/weave/local-resume-driver.ts";
      import { resumePersistedWeave } from "./src/weave/resume-service.ts";
      class CrashAfterSideEffect extends LocalWeaveResumeDriver {
        async execute(operation, checkpoint) {
          const result = await super.execute(operation, checkpoint);
          if (result.completed) process.exit(91);
          return result;
        }
      }
      const result = await resumePersistedWeave({
        runId: process.argv[1],
        checkpointDir: process.argv[2],
        driver: new CrashAfterSideEffect(process.argv[3]),
      });
      console.error(JSON.stringify(result));
    `;
    const crashed = await execa(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        crashProgram,
        checkpoint.runId,
        checkpoints,
        working,
      ],
      { cwd: process.cwd(), reject: false, timeout: 15_000 }
    );
    expect(crashed.exitCode, `${crashed.stdout}\n${crashed.stderr}`).toBe(91);

    const stranded = await loadCheckpoint(checkpoint.runId, {
      checkpointDir: checkpoints,
      validatePlanHash: false,
    });
    expect(stranded.metadata?.resume?.operations[0]).toMatchObject({
      status: "in_progress",
      attempts: 1,
    });

    await expect(
      resumePersistedWeave({
        runId: checkpoint.runId,
        checkpointDir: checkpoints,
        driver: new LocalWeaveResumeDriver(working),
      })
    ).resolves.toMatchObject({ ok: true, outcome: "completed", completed: 1 });

    const completed = await loadCheckpoint(checkpoint.runId, {
      checkpointDir: checkpoints,
      validatePlanHash: false,
    });
    expect(completed.metadata?.resume?.operations[0]).toMatchObject({
      status: "completed",
      attempts: 1,
      result: { outcome: "observed" },
    });
    await git(working, "checkout", completed.metadata!.resume!.repository.integrationBranch);
    await expect(readFile(join(working, "feature.txt"), "utf-8")).resolves.toBe("feature\n");
  }, 20_000);
});

async function configureGit(cwd: string): Promise<void> {
  await git(cwd, "config", "user.name", "LexRunner Test");
  await git(cwd, "config", "user.email", "test@example.invalid");
  await git(cwd, "config", "commit.gpgsign", "false");
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}
