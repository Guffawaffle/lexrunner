import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
  NATIVE_WSL_PROJECTION_HASH_PROFILE,
  createNativeWslProjectionRequest,
  nativeWslProjectionId,
  type NativeWslProjectionRequest_v1 as NativeWslProjectionRequest,
} from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import {
  ExecaCommandRunner,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "../../src/workspaces/command-runner.js";
import type { WorktreeTarget } from "../../src/workspaces/git-worktree-broker.js";
import {
  NativeWslProjectionEngine,
  type NativeWslProjectionStateWriter,
} from "../../src/workspaces/native-wsl-projection-engine.js";

const WINDOWS_SOURCE = "D:\\dev\\stfc-mod";
const REMOTE_URL = "https://example.invalid/Guffawaffle/stfc-mod.git";
const DEAD_PROCESS_ID = 2_147_483_647;
const OWNER_FILE = "lexrunner-native-wsl-owner.json";
const STAGING_DIRECTORY = ".lexrunner-projection-staging";
const LOCK_DIRECTORY = ".lexrunner-projection-locks";
const QUARANTINE_DIRECTORY = ".lexrunner-projection-quarantine";

describe("NativeWslProjectionEngine real Git integration", () => {
  let sandbox: string;
  let sourceRoot: string;
  let projectionRoot: string;
  let worktreeRoot: string;
  let baseSha: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "lexrunner-native-projection-"));
    sourceRoot = join(sandbox, "mapped-source");
    projectionRoot = join(sandbox, "native-projections");
    worktreeRoot = join(sandbox, "native-worktrees");
    await mkdir(sourceRoot);
    await mkdir(projectionRoot);
    await mkdir(worktreeRoot);

    await git(sourceRoot, "init", "-b", "main");
    await git(sourceRoot, "config", "user.name", "LexRunner Integration");
    await git(sourceRoot, "config", "user.email", "lexrunner@example.invalid");
    await git(sourceRoot, "config", "commit.gpgsign", "false");
    await writeFile(join(sourceRoot, "tracked.txt"), "base\n", "utf8");
    await git(sourceRoot, "add", "tracked.txt");
    await git(sourceRoot, "commit", "-m", "initial");
    baseSha = await gitStdout(sourceRoot, "rev-parse", "HEAD");
    await git(sourceRoot, "remote", "add", "origin", REMOTE_URL);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("projects only the pinned commit and hands the verified roots to the worktree broker", async () => {
    await writeFile(join(sourceRoot, "tracked.txt"), "moving head\n", "utf8");
    await git(sourceRoot, "commit", "-am", "advance source");
    const movingHead = await gitStdout(sourceRoot, "rev-parse", "HEAD");
    await writeFile(join(sourceRoot, "uncommitted.txt"), "must not cross\n", "utf8");
    const request = makeRequest();
    const sourceIndexBefore = await stat(join(sourceRoot, ".git", "index"), {
      bigint: true,
    });

    const result = await new NativeWslProjectionEngine().prepare(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("prepared");
    expect(result.manifest.base_sha).toBe(baseSha);
    expect(result.manifest.source_observation).toMatchObject({
      source_head_sha: movingHead,
      requested_object_sha: baseSha,
      cleanliness: "dirty",
    });
    const sourceIndexAfter = await stat(join(sourceRoot, ".git", "index"), {
      bigint: true,
    });
    expect(sourceIndexAfter.mtimeNs).toBe(sourceIndexBefore.mtimeNs);
    expect(await gitStdout(result.manifest.native_repository.path, "rev-parse", "HEAD")).toBe(
      baseSha
    );
    expect(
      await readFile(join(result.manifest.native_repository.path, "tracked.txt"), "utf8")
    ).toBe("base\n");
    await expect(
      readFile(join(result.manifest.native_repository.path, "uncommitted.txt"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    const projectedConfig = await readFile(
      join(result.manifest.native_repository.path, ".git", "config"),
      "utf8"
    );
    expect(projectedConfig).not.toContain(sourceRoot);
    expect(projectedConfig).not.toMatch(/\[remote "origin"\]/u);
    expect(
      await gitStdout(
        result.manifest.native_repository.path,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads"
      )
    ).toBe("");
    await expect(
      readFile(
        join(result.manifest.native_repository.path, ".git", "objects", "info", "alternates"),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });

    const target: WorktreeTarget = {
      repositoryId: request.repository.id,
      hostId: request.native.host_id,
      gitRuntime: request.native.git_runtime,
      projectRoot: result.manifest.native_repository.path,
      worktreePath: join(result.manifest.native_worktree_root.path, "attempt-one"),
      branch: "agent/projection-integration",
      attemptId: "attempt-projection-integration",
      baseSha,
    };
    const allocation = await result.broker.create(target);
    expect(allocation).toMatchObject({
      ok: true,
      outcome: "created",
      observation: { headSha: baseSha },
    });
    expect(await readFile(join(target.worktreePath, "tracked.txt"), "utf8")).toBe("base\n");

    const serializedEvidence = JSON.stringify(result.commandEvidence);
    expect(serializedEvidence).not.toContain(sandbox);
    expect(serializedEvidence).not.toContain("stfc-mod");
    expect(result.commandEvidence.every((entry) => entry.outcome === "passed")).toBe(true);
  });

  it("reuses an exact immutable projection without cloning again", async () => {
    const request = makeRequest();
    const engine = new NativeWslProjectionEngine();
    const first = await engine.prepare(request);
    const second = await engine.prepare(request);

    expect(first.ok && first.outcome).toBe("prepared");
    expect(second.ok && second.outcome).toBe("reused");
    if (!first.ok || !second.ok) return;
    expect(second.manifest).toEqual(first.manifest);
    expect(second.commandEvidence.map((entry) => entry.action)).not.toContain("clone_nonlocal");
    expect(second.receipt.projection_digest).toBe(first.manifest.manifest_digest);
  });

  it("rejects dirty, mismatched-head, missing, non-commit, and wrong-remote sources before staging", async () => {
    await writeFile(join(sourceRoot, "dirty.txt"), "dirty\n", "utf8");
    const dirty = await new NativeWslProjectionEngine().prepare(
      makeRequest({ dirtyPolicy: "require_clean" })
    );
    expect(dirty).toMatchObject({ ok: false, reasonCode: "source_dirty" });

    await rm(join(sourceRoot, "dirty.txt"));
    await writeFile(join(sourceRoot, "tracked.txt"), "advance\n", "utf8");
    await git(sourceRoot, "commit", "-am", "advance");
    const headMismatch = await new NativeWslProjectionEngine().prepare(
      makeRequest({ headPolicy: "require_base" })
    );
    expect(headMismatch).toMatchObject({ ok: false, reasonCode: "source_head_mismatch" });

    const missingObject = await new NativeWslProjectionEngine().prepare(
      makeRequest({ baseSha: "0".repeat(40) })
    );
    expect(missingObject).toMatchObject({ ok: false, reasonCode: "source_object_missing" });

    await writeFile(join(sourceRoot, "not-a-commit.txt"), "blob object\n", "utf8");
    const blobObject = await gitStdout(sourceRoot, "hash-object", "-w", "not-a-commit.txt");
    const nonCommitObject = await new NativeWslProjectionEngine().prepare(
      makeRequest({ baseSha: blobObject })
    );
    expect(nonCommitObject).toMatchObject({
      ok: false,
      reasonCode: "source_object_not_commit",
    });

    const wrongRemote = await new NativeWslProjectionEngine().prepare(
      makeRequest({
        expectedRemoteHash: computeCanonicalHash("https://example.invalid/other/repo.git"),
      })
    );
    expect(wrongRemote).toMatchObject({
      ok: false,
      reasonCode: "repository_identity_mismatch",
    });

    for (const result of [dirty, headMismatch, missingObject, nonCommitObject, wrongRemote]) {
      const requestDigest = result.receipt.request_digest;
      expect(await pathExists(join(projectionRoot, nativeWslProjectionId(requestDigest)))).toBe(
        false
      );
    }
    expect(await readdir(join(projectionRoot, LOCK_DIRECTORY))).toEqual([]);
  });

  it("rejects source/native overlap before creating control state or changing a clean source", async () => {
    const statusBefore = await gitStdout(sourceRoot, "status", "--porcelain=v1");
    const entriesBefore = await readdir(sourceRoot);
    const valid = makeRequest();
    const { request_digest: _requestDigest, ...validBody } = valid;
    const overlappingBody = {
      ...validBody,
      native: {
        ...validBody.native,
        projection_root: sourceRoot,
      },
    };
    const overlappingRequest = {
      ...overlappingBody,
      request_digest: computeCanonicalHash({
        contract: "lexrunner.native-wsl-projection",
        hash_profile: NATIVE_WSL_PROJECTION_HASH_PROFILE,
        schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
        domain: "request",
        value: overlappingBody,
      }),
    } as NativeWslProjectionRequest;

    await expect(new NativeWslProjectionEngine().prepare(overlappingRequest)).rejects.toThrow(
      /must not overlap the mapped source repository/u
    );

    expect(await gitStdout(sourceRoot, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(await readdir(sourceRoot)).toEqual(entriesBefore);
    expect(entriesBefore).not.toContain(STAGING_DIRECTORY);
    expect(entriesBefore).not.toContain(LOCK_DIRECTORY);
    expect(entriesBefore).not.toContain(QUARANTINE_DIRECTORY);
  });

  it("isolates every Git step from hostile ambient Git object and config variables", async () => {
    const hostileEnvironment = {
      GIT_DIR: join(sandbox, "ambient-git-dir"),
      GIT_OBJECT_DIRECTORY: join(sandbox, "ambient-objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(sourceRoot, ".git", "objects"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: join(sandbox, "ambient-hooks"),
    } as const;
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(hostileEnvironment)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }

    let result;
    try {
      result = await new NativeWslProjectionEngine().prepare(makeRequest());
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(result).toMatchObject({ ok: true, outcome: "prepared" });
    if (!result.ok) return;
    await expect(
      readFile(
        join(result.manifest.native_repository.path, ".git", "objects", "info", "alternates"),
        "utf8"
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes exact-created staging when its owner marker write fails partway", async () => {
    let failedMarkerWrite = false;
    const stateWriter: NativeWslProjectionStateWriter = {
      writeExclusive: async (directory, file, content) => {
        const marker = file === OWNER_FILE ? (JSON.parse(content) as { kind?: string }) : {};
        if (marker.kind === "projection_staging") {
          failedMarkerWrite = true;
          await writeFile(join(directory.procPath, file), "{", { encoding: "utf8", flag: "wx" });
          throw new Error("simulated owner marker sync failure");
        }
        await writeFile(join(directory.procPath, file), content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      },
    };
    const request = makeRequest();
    const projectionId = nativeWslProjectionId(request.request_digest);

    const result = await new NativeWslProjectionEngine({ stateWriter }).prepare(request);

    expect(failedMarkerWrite).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      reasonCode: "operation_failed",
    });
    expect(await readdir(join(projectionRoot, STAGING_DIRECTORY))).toEqual([]);
    expect(await readdir(join(projectionRoot, QUARANTINE_DIRECTORY))).toEqual([]);
    expect(await readdir(join(projectionRoot, LOCK_DIRECTORY))).toEqual([]);
    expect(await pathExists(join(projectionRoot, projectionId))).toBe(false);
    expect(await pathExists(join(worktreeRoot, projectionId))).toBe(false);
  });

  it("fails closed when the mapped source directory is replaced at command preflight", async () => {
    const delegate = new ExecaCommandRunner();
    let replaced = false;
    const runner: CommandRunner = {
      run: async (command) => {
        if (!replaced && hasArgSequence(command, ["rev-parse", "--show-toplevel"])) {
          replaced = true;
          await rename(sourceRoot, `${sourceRoot}-original`);
          await mkdir(sourceRoot);
        }
        return delegate.run(command);
      },
    };

    const result = await new NativeWslProjectionEngine({ runner }).prepare(makeRequest());

    expect(replaced).toBe(true);
    expect(result).toMatchObject({ ok: false, reasonCode: "source_replaced" });
    expect(
      await pathExists(join(projectionRoot, nativeWslProjectionId(result.receipt.request_digest)))
    ).toBe(false);
  });

  it("serializes the same projection request with an identity-anchored lease", async () => {
    const delegate = new ExecaCommandRunner();
    let announceClone!: () => void;
    let releaseClone!: () => void;
    const cloneStarted = new Promise<void>((resolve) => {
      announceClone = resolve;
    });
    const cloneReleased = new Promise<void>((resolve) => {
      releaseClone = resolve;
    });
    let blocked = false;
    const runner: CommandRunner = {
      run: async (command) => {
        if (!blocked && command.args.includes("clone")) {
          blocked = true;
          announceClone();
          await cloneReleased;
        }
        return delegate.run(command);
      },
    };
    const engine = new NativeWslProjectionEngine({ runner });
    const request = makeRequest();

    const firstPending = engine.prepare(request);
    await cloneStarted;
    const concurrent = await engine.prepare(request);
    releaseClone();
    const first = await firstPending;

    expect(concurrent).toMatchObject({
      ok: false,
      outcome: "rejected",
      reasonCode: "concurrent_request",
    });
    expect(first).toMatchObject({ ok: true, outcome: "prepared" });
    expect(await readdir(join(projectionRoot, LOCK_DIRECTORY))).toEqual([]);
  });

  it("recovers owned interrupted staging before preparing", async () => {
    const request = makeRequest();
    const projectionId = nativeWslProjectionId(request.request_digest);
    const token = "1234567890abcdef";
    const component = `${projectionId}-${token}`;
    const projectionStage = join(projectionRoot, STAGING_DIRECTORY, component);
    const allocationStage = join(worktreeRoot, STAGING_DIRECTORY, component);
    await mkdir(projectionStage, { recursive: true });
    await mkdir(allocationStage, { recursive: true });
    await writeOwner(projectionStage, {
      kind: "projection_staging",
      projectionId,
      requestDigest: request.request_digest,
      token,
    });
    await writeOwner(allocationStage, {
      kind: "allocation_staging",
      projectionId,
      requestDigest: request.request_digest,
      token,
    });
    await writeFile(join(projectionStage, "partial"), "interrupted\n", "utf8");

    const result = await new NativeWslProjectionEngine().prepare(request);

    expect(result).toMatchObject({
      ok: true,
      outcome: "prepared",
      recoveredReason: "staging_interrupted",
    });
    expect(await pathExists(projectionStage)).toBe(false);
    expect(await pathExists(allocationStage)).toBe(false);
  });

  it("reconciles a crash after repository publication without retaining a second source", async () => {
    const request = makeRequest();
    const engine = new NativeWslProjectionEngine();
    const first = await engine.prepare(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const projectionId = first.manifest.projection_id;
    const marker = JSON.parse(
      await readFile(join(first.manifest.native_worktree_root.path, OWNER_FILE), "utf8")
    ) as { token: string };
    const component = `${projectionId}-${marker.token}`;
    const allocationStage = join(worktreeRoot, STAGING_DIRECTORY, component);
    const projectionStage = join(projectionRoot, STAGING_DIRECTORY, component);
    await rename(first.manifest.native_worktree_root.path, allocationStage);
    await mkdir(projectionStage);
    await writeOwner(projectionStage, {
      kind: "projection_staging",
      projectionId,
      requestDigest: request.request_digest,
      token: marker.token,
    });

    const recovered = await engine.prepare(request);

    expect(recovered).toMatchObject({
      ok: true,
      outcome: "prepared",
      recoveredReason: "native_state_stale",
    });
    expect(await pathExists(projectionStage)).toBe(false);
    expect(await pathExists(allocationStage)).toBe(false);
    expect((await readdir(join(projectionRoot, QUARANTINE_DIRECTORY))).length).toBeGreaterThan(0);
  });

  it("quarantines stale selected state and reprovisions the exact request", async () => {
    const request = makeRequest();
    const engine = new NativeWslProjectionEngine();
    const first = await engine.prepare(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await writeFile(join(first.manifest.native_repository.path, "tampered.txt"), "tampered\n");

    const recovered = await engine.prepare(request);

    expect(recovered).toMatchObject({
      ok: true,
      outcome: "prepared",
      recoveredReason: "native_state_stale",
    });
    if (!recovered.ok) return;
    expect(await gitStdout(recovered.manifest.native_repository.path, "rev-parse", "HEAD")).toBe(
      baseSha
    );
    await expect(
      readFile(join(recovered.manifest.native_repository.path, "tampered.txt"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(projectionRoot, QUARANTINE_DIRECTORY))).length).toBeGreaterThan(0);
    expect((await readdir(join(worktreeRoot, QUARANTINE_DIRECTORY))).length).toBeGreaterThan(0);
  });

  it("quarantines an invalid publication without selecting or overwriting it", async () => {
    const request = makeRequest();
    const projectionId = nativeWslProjectionId(request.request_digest);
    const invalidRepository = join(projectionRoot, projectionId);
    const invalidAllocation = join(worktreeRoot, projectionId);
    await mkdir(invalidRepository);
    await mkdir(invalidAllocation);
    await writeFile(join(invalidRepository, "sentinel"), "ambiguous\n", "utf8");
    await writeFile(join(invalidAllocation, "sentinel"), "ambiguous\n", "utf8");

    const result = await new NativeWslProjectionEngine().prepare(request);

    expect(result).toMatchObject({
      ok: false,
      outcome: "quarantined",
      reasonCode: "native_state_conflict",
    });
    expect(await pathExists(invalidRepository)).toBe(false);
    expect(await pathExists(invalidAllocation)).toBe(false);
    expect((await readdir(join(projectionRoot, QUARANTINE_DIRECTORY))).length).toBe(1);
    expect((await readdir(join(worktreeRoot, QUARANTINE_DIRECTORY))).length).toBe(1);
  });

  it("quarantines ambiguous rollback residue and never publishes a failed projection", async () => {
    const delegate = new ExecaCommandRunner();
    let tampered = false;
    const runner: CommandRunner = {
      run: async (command) => {
        if (!tampered && hasArgSequence(command, ["checkout", "--detach"])) {
          tampered = true;
          const repositoryPath = realpathSync(command.cwd);
          const projectionStage = dirname(repositoryPath);
          const marker = JSON.parse(
            await readFile(join(projectionStage, OWNER_FILE), "utf8")
          ) as Record<string, unknown>;
          marker.token = "ffffffffffffffff";
          await writeFile(join(projectionStage, OWNER_FILE), `${JSON.stringify(marker)}\n`);
          return commandFailure("simulated checkout failure");
        }
        return delegate.run(command);
      },
    };
    const request = makeRequest();
    const projectionId = nativeWslProjectionId(request.request_digest);

    const result = await new NativeWslProjectionEngine({ runner }).prepare(request);

    expect(tampered).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      outcome: "quarantined",
      reasonCode: "cleanup_failed_quarantined",
    });
    expect(await pathExists(join(projectionRoot, projectionId))).toBe(false);
    expect(await pathExists(join(worktreeRoot, projectionId))).toBe(false);
    expect(await readdir(join(projectionRoot, STAGING_DIRECTORY))).toEqual([]);
    expect((await readdir(join(projectionRoot, QUARANTINE_DIRECTORY))).length).toBe(1);
    expect(await readdir(join(projectionRoot, LOCK_DIRECTORY))).toEqual([]);
  });

  function makeRequest(
    overrides: {
      baseSha?: string;
      dirtyPolicy?: "require_clean" | "committed_base_only";
      headPolicy?: "observe" | "require_base";
      expectedRemoteHash?: string;
    } = {}
  ): NativeWslProjectionRequest {
    return createNativeWslProjectionRequest({
      schema_version: "1.0.0",
      request_id: "stfc-wl-006",
      repository: {
        id: "stfc-mod",
        expected_remote_hash: overrides.expectedRemoteHash ?? computeCanonicalHash(REMOTE_URL),
      },
      source: {
        windows_runtime: "windows-git",
        windows_repository_path: WINDOWS_SOURCE,
        wsl_distribution: "Ubuntu",
        wsl_git_runtime: "wsl-ubuntu-git",
        wsl_repository_path: sourceRoot,
        head_policy: overrides.headPolicy ?? "observe",
        dirty_policy: overrides.dirtyPolicy ?? "committed_base_only",
      },
      native: {
        host_id: "wsl-ubuntu-host",
        git_runtime: "wsl-ubuntu-git",
        projection_root: projectionRoot,
        worktree_root: worktreeRoot,
      },
      base_sha: overrides.baseSha ?? baseSha,
    });
  }
});

async function writeOwner(
  directory: string,
  input: {
    kind: "projection_staging" | "allocation_staging";
    projectionId: string;
    requestDigest: string;
    token: string;
  }
): Promise<void> {
  await writeFile(
    join(directory, OWNER_FILE),
    `${JSON.stringify({
      schemaVersion: 1,
      ...input,
      pid: DEAD_PROCESS_ID,
      createdAt: "2026-07-29T00:00:00.000Z",
    })}\n`,
    "utf8"
  );
}

function commandFailure(message: string): CommandResult {
  return {
    ok: false,
    kind: "nonzero_exit",
    exitCode: 1,
    stdout: "",
    stderr: "",
    durationMs: 0,
    message,
  };
}

function hasArgSequence(command: CommandRequest, sequence: readonly string[]): boolean {
  const joined = command.args.join("\0");
  return joined.includes(sequence.join("\0"));
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, {
    cwd,
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

async function gitStdout(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa("git", args, {
    cwd,
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  return result.stdout.trim();
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") return true;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    try {
      await readdir(candidate);
      return true;
    } catch (nestedError) {
      if ((nestedError as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw nestedError;
    }
  }
}
