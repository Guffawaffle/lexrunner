import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorktreeTarget } from "../../src/workspaces/git-worktree-broker.js";
import { NodeGitWorktreeBroker } from "../../src/workspaces/node-git-worktree-broker.js";

const REPOSITORY_ID = "repo-integration";
const HOST_ID = "host-integration";
const GIT_RUNTIME = "git-linux-integration";

describe("NodeGitWorktreeBroker real Git integration", () => {
  let sandbox: string;
  let repositoryRoot: string;
  let worktreeRoot: string;
  let baseSha: string;
  let broker: NodeGitWorktreeBroker;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "lexrunner worktree broker "));
    repositoryRoot = join(sandbox, "repository");
    worktreeRoot = join(sandbox, "leased worktrees");
    await mkdir(repositoryRoot);
    await mkdir(worktreeRoot);

    await git(repositoryRoot, "init", "-b", "main");
    await git(repositoryRoot, "config", "user.name", "LexRunner Integration");
    await git(repositoryRoot, "config", "user.email", "lexrunner@example.invalid");
    await git(repositoryRoot, "config", "commit.gpgsign", "false");
    await writeFile(join(repositoryRoot, ".gitignore"), "ignored.log\n", "utf8");
    await writeFile(join(repositoryRoot, "tracked.txt"), "base\n", "utf8");
    await git(repositoryRoot, "add", ".gitignore", "tracked.txt");
    await git(repositoryRoot, "commit", "-m", "initial");
    baseSha = await gitStdout(repositoryRoot, "rev-parse", "HEAD");

    broker = new NodeGitWorktreeBroker({
      repositoryId: REPOSITORY_ID,
      repositoryRoot,
      worktreeRoot,
      hostId: HOST_ID,
      gitRuntime: GIT_RUNTIME,
      pathComparison: "case-sensitive",
    });
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("creates from the pinned full SHA even after the source branch advances", async () => {
    await writeFile(join(repositoryRoot, "tracked.txt"), "new main state\n", "utf8");
    await git(repositoryRoot, "commit", "-am", "advance main");
    const movingHead = await gitStdout(repositoryRoot, "rev-parse", "HEAD");
    const target = makeTarget("pinned", { worktreePath: join(worktreeRoot, "path with spaces") });

    const result = await broker.create(target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("created");
    expect(result.observation.headSha).toBe(baseSha);
    expect(await gitStdout(target.worktreePath, "rev-parse", "HEAD")).toBe(baseSha);
    expect(await readFile(join(target.worktreePath, "tracked.txt"), "utf8")).toBe("base\n");
    expect(movingHead).not.toBe(baseSha);
  });

  it("reuses an exact registered worktree idempotently", async () => {
    const target = makeTarget("retry");

    const first = await broker.create(target);
    const retry = await broker.create(target);

    expect(first.ok && first.outcome).toBe("created");
    expect(retry.ok && retry.outcome).toBe("reused");
    if (retry.ok) {
      expect(retry.observation.registered).toBe(true);
      expect(retry.observation.branch).toBe(target.branch);
      expect(retry.observation.headSha).toBe(baseSha);
      expect(retry.observation.cleanliness).toBe("clean");
      expect(retry.observation.dirtyPaths).toBeUndefined();
    }

    const gitAdminDir = await gitStdout(target.worktreePath, "rev-parse", "--absolute-git-dir");
    const marker = JSON.parse(
      await readFile(join(gitAdminDir, "lexrunner-attempt.json"), "utf8")
    ) as Record<string, unknown>;
    expect(marker).toMatchObject({
      schemaVersion: 1,
      repositoryId: REPOSITORY_ID,
      attemptId: target.attemptId,
      hostId: HOST_ID,
      gitRuntime: GIT_RUNTIME,
      projectRoot: repositoryRoot,
      worktreePath: target.worktreePath,
      branch: target.branch,
      baseSha,
    });
  });

  it("rejects a mismatched project root before running commands or mutating Git", async () => {
    const run = vi.fn(async () => {
      throw new Error("the command boundary must not be reached");
    });
    const guardedBroker = new NodeGitWorktreeBroker({
      repositoryId: REPOSITORY_ID,
      repositoryRoot,
      worktreeRoot,
      hostId: HOST_ID,
      gitRuntime: GIT_RUNTIME,
      pathComparison: "case-sensitive",
      runner: { run },
    });
    const target = makeTarget("wrong-root", { projectRoot: join(sandbox, "other repository") });

    const result = await guardedBroker.create(target);
    const relativeProjectRoot = await guardedBroker.create(
      makeTarget("relative-project", { projectRoot: "relative/repository" })
    );
    const relativeWorktree = await guardedBroker.create(
      makeTarget("relative-worktree", { worktreePath: "relative/worktree" })
    );
    const outsideWorktree = await guardedBroker.create(
      makeTarget("outside-worktree", { worktreePath: join(sandbox, "outside allocation") })
    );

    expect(result).toMatchObject({ ok: false, reason: "runtime_mismatch" });
    expect(relativeProjectRoot).toMatchObject({ ok: false, reason: "invalid_path" });
    expect(relativeWorktree).toMatchObject({ ok: false, reason: "invalid_path" });
    expect(outsideWorktree).toMatchObject({ ok: false, reason: "invalid_path" });
    expect(run).not.toHaveBeenCalled();
    expect(await pathExists(target.worktreePath)).toBe(false);
    expect(await localBranchExists(repositoryRoot, target.branch)).toBe(false);

    expect(
      () =>
        new NodeGitWorktreeBroker({
          repositoryId: REPOSITORY_ID,
          repositoryRoot,
          worktreeRoot: join(repositoryRoot, "nested worktrees"),
          hostId: HOST_ID,
          gitRuntime: GIT_RUNTIME,
          pathComparison: "case-sensitive",
        })
    ).toThrow(/must not overlap/);
  });

  it("rejects non-full SHAs and invalid branch names before mutation", async () => {
    const invalidSha = await broker.create(
      makeTarget("short-sha", { baseSha: baseSha.slice(0, 12) })
    );
    const invalidBranch = await broker.create(
      makeTarget("bad-branch", { branch: "agent/bad..branch" })
    );

    expect(invalidSha).toMatchObject({ ok: false, reason: "invalid_base_sha" });
    expect(invalidBranch).toMatchObject({ ok: false, reason: "invalid_branch" });
  });

  it("reports existing branch and occupied path conflicts without changing either", async () => {
    const branchTarget = makeTarget("branch-conflict");
    await git(repositoryRoot, "branch", branchTarget.branch, baseSha);

    const branchConflict = await broker.create(branchTarget);

    expect(branchConflict).toMatchObject({ ok: false, reason: "branch_conflict" });
    expect(await gitStdout(repositoryRoot, "rev-parse", branchTarget.branch)).toBe(baseSha);

    const pathTarget = makeTarget("path-conflict");
    await mkdir(pathTarget.worktreePath);
    await writeFile(join(pathTarget.worktreePath, "keep.txt"), "do not replace\n", "utf8");

    const pathConflict = await broker.create(pathTarget);

    expect(pathConflict).toMatchObject({ ok: false, reason: "path_conflict" });
    expect(await readFile(join(pathTarget.worktreePath, "keep.txt"), "utf8")).toBe(
      "do not replace\n"
    );
  });

  it("observes tracked, untracked, and ignored dirtiness with exact paths", async () => {
    const target = makeTarget("dirty-observe");
    expect((await broker.create(target)).ok).toBe(true);
    await writeFile(join(target.worktreePath, "tracked.txt"), "modified\n", "utf8");
    await mkdir(join(target.worktreePath, "untracked dir"));
    await writeFile(join(target.worktreePath, "untracked dir", "new file.txt"), "new\n", "utf8");
    await writeFile(join(target.worktreePath, "ignored.log"), "ignored\n", "utf8");

    const result = await broker.observe(target);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.observation.cleanliness).toBe("dirty");
    expect(result.observation.dirtyPaths).toEqual(
      expect.arrayContaining(["tracked.txt", "untracked dir/new file.txt", "ignored.log"])
    );
  });

  it("preserves a dirty worktree instead of force-removing it", async () => {
    const target = makeTarget("dirty-preserve");
    expect((await broker.create(target)).ok).toBe(true);
    await writeFile(join(target.worktreePath, "untracked.txt"), "handoff\n", "utf8");

    const result = await broker.remove(target);

    expect(result).toMatchObject({ ok: true, outcome: "preserved", preservationReason: "dirty" });
    expect(await readFile(join(target.worktreePath, "untracked.txt"), "utf8")).toBe("handoff\n");
    expect(await registeredWorktreePaths(repositoryRoot)).toContain(target.worktreePath);
  });

  it("does not transfer observe, reuse, or removal ownership to another Attempt", async () => {
    const owner = makeTarget("attempt-owner");
    expect((await broker.create(owner)).ok).toBe(true);
    const stranger = { ...owner, attemptId: "attempt-stranger" };

    const observation = await broker.observe(stranger);
    const reuse = await broker.create(stranger);
    const removal = await broker.remove(stranger);

    expect(observation.ok).toBe(true);
    if (observation.ok) {
      expect(observation.observation.attemptId).toBeNull();
      expect(observation.observation.reason).toMatch(/Attempt marker does not match/);
    }
    expect(reuse).toMatchObject({ ok: false, reason: "identity_mismatch" });
    expect(removal).toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "identity_ambiguous",
    });
    expect(await registeredWorktreePaths(repositoryRoot)).toContain(owner.worktreePath);
    expect(await pathExists(owner.worktreePath)).toBe(true);

    const ownerObservation = await broker.observe(owner);
    expect(ownerObservation).toMatchObject({
      ok: true,
      observation: { attemptId: owner.attemptId, cleanliness: "clean" },
    });
  });

  it("proactively preserves a clean locked worktree", async () => {
    const target = makeTarget("locked");
    expect((await broker.create(target)).ok).toBe(true);
    await git(
      repositoryRoot,
      "worktree",
      "lock",
      "--reason",
      "leased elsewhere",
      target.worktreePath
    );

    const observation = await broker.observe(target);
    const removal = await broker.remove(target);

    expect(observation).toMatchObject({
      ok: true,
      observation: {
        registered: true,
        attemptId: null,
        cleanliness: "clean",
        reason: "leased elsewhere",
      },
    });
    expect(removal).toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "identity_ambiguous",
    });
    expect(await registeredWorktreePaths(repositoryRoot)).toContain(target.worktreePath);
    expect(await pathExists(target.worktreePath)).toBe(true);
  });

  it("preserves missing registrations and unregistered occupied paths", async () => {
    const missing = makeTarget("missing");
    expect((await broker.create(missing)).ok).toBe(true);
    await rm(missing.worktreePath, { recursive: true, force: true });

    await expect(broker.remove(missing)).resolves.toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "missing",
      observation: { exists: false, registered: true },
    });

    const unregistered = makeTarget("unregistered");
    await mkdir(unregistered.worktreePath);
    await writeFile(join(unregistered.worktreePath, "keep.txt"), "keep\n", "utf8");
    await expect(broker.remove(unregistered)).resolves.toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "unregistered",
      observation: { exists: true, registered: false, repositoryId: null },
    });
    expect(await readFile(join(unregistered.worktreePath, "keep.txt"), "utf8")).toBe("keep\n");
  });

  it("preserves a registered worktree whose branch no longer matches", async () => {
    const target = makeTarget("wrong-branch");
    expect((await broker.create(target)).ok).toBe(true);
    await git(target.worktreePath, "switch", "-c", "agent/reassigned");

    await expect(broker.remove(target)).resolves.toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "wrong_branch",
      observation: { registered: true, branch: "agent/reassigned", attemptId: null },
    });
    expect(await registeredWorktreePaths(repositoryRoot)).toContain(target.worktreePath);
  });

  it("treats a path registered by another repository as unregistered and never removes it", async () => {
    const foreignRepository = join(sandbox, "foreign repository");
    await execa("git", ["clone", repositoryRoot, foreignRepository]);
    const target = makeTarget("foreign", { branch: "agent/foreign" });
    await git(
      foreignRepository,
      "worktree",
      "add",
      "-b",
      target.branch,
      target.worktreePath,
      baseSha
    );

    await expect(broker.remove(target)).resolves.toMatchObject({
      ok: true,
      outcome: "preserved",
      preservationReason: "unregistered",
      observation: { exists: true, registered: false, repositoryId: null },
    });
    expect(await registeredWorktreePaths(foreignRepository)).toContain(target.worktreePath);
    expect(await pathExists(target.worktreePath)).toBe(true);
  });

  it("treats missing and malformed Attempt markers as ambiguous ownership", async () => {
    for (const [suffix, markerContents, expectedReason] of [
      ["marker-missing", null, /marker is missing/],
      ["marker-malformed", "null\n", /marker is malformed/],
    ] as const) {
      const target = makeTarget(suffix);
      expect((await broker.create(target)).ok).toBe(true);
      const gitAdminDir = await gitStdout(target.worktreePath, "rev-parse", "--absolute-git-dir");
      const markerPath = join(gitAdminDir, "lexrunner-attempt.json");
      if (markerContents === null) await rm(markerPath);
      else await writeFile(markerPath, markerContents, "utf8");

      const observed = await broker.observe(target);
      expect(observed).toMatchObject({
        ok: true,
        observation: { registered: true, attemptId: null, cleanliness: "clean" },
      });
      if (observed.ok) expect(observed.observation.reason).toMatch(expectedReason);
      await expect(broker.remove(target)).resolves.toMatchObject({
        ok: true,
        outcome: "preserved",
        preservationReason: "identity_ambiguous",
      });
    }
  });

  it("removes a clean matching worktree while retaining its local branch", async () => {
    const target = makeTarget("clean-remove");
    expect((await broker.create(target)).ok).toBe(true);

    const result = await broker.remove(target);

    expect(result).toMatchObject({ ok: true, outcome: "removed" });
    expect(await registeredWorktreePaths(repositoryRoot)).not.toContain(target.worktreePath);
    expect(
      await gitStdout(repositoryRoot, "show-ref", "--hash", `refs/heads/${target.branch}`)
    ).toBe(baseSha);
  });

  it("keeps paths opaque and rejects a target owned by another Git runtime", async () => {
    const target = makeTarget("runtime", {
      worktreePath: join(worktreeRoot, "C:\\opaque windows-looking path"),
      gitRuntime: "windows-git",
    });

    const create = await broker.create(target);
    const observe = await broker.observe(target);
    const remove = await broker.remove(target);

    expect(create).toMatchObject({ ok: false, reason: "runtime_mismatch" });
    expect(observe).toMatchObject({ ok: false, reason: "runtime_mismatch" });
    expect(remove).toMatchObject({ ok: false, reason: "runtime_mismatch" });
  });

  function makeTarget(suffix: string, overrides: Partial<WorktreeTarget> = {}): WorktreeTarget {
    return {
      repositoryId: REPOSITORY_ID,
      hostId: HOST_ID,
      gitRuntime: GIT_RUNTIME,
      projectRoot: repositoryRoot,
      branch: `agent/${suffix}`,
      worktreePath: join(worktreeRoot, suffix),
      attemptId: `attempt-${suffix}`,
      baseSha,
      ...overrides,
    };
  }
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}

async function gitStdout(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd });
  return result.stdout.trim();
}

async function registeredWorktreePaths(repositoryRoot: string): Promise<string[]> {
  const output = await gitStdout(repositoryRoot, "worktree", "list", "--porcelain");
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
    throw error;
  }
}

async function localBranchExists(repositoryRoot: string, branch: string): Promise<boolean> {
  const result = await execa("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: repositoryRoot,
    reject: false,
  });
  return result.exitCode === 0;
}
