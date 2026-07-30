import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NativeWslProjectionCleanupRequestJsonSchema,
  NativeWslProjectionPrepareRequestJsonSchema,
  NativeWslProjectionStatusRequestJsonSchema,
  createNativeWslProjectionLifecycleHandlers,
} from "../../src/runs/agent-work-projection-lifecycle.js";
import { createNativeWslProjectionRequest } from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";

const REMOTE_URL = "https://example.invalid/Guffawaffle/stfc-mod.git";

describe("native WSL projection lifecycle handlers", () => {
  let root: string;
  let sourceRoot: string;
  let projectionRoot: string;
  let worktreeRoot: string;
  let baseSha: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lexrunner-projection-lifecycle-"));
    sourceRoot = join(root, "mapped-source");
    projectionRoot = join(root, "native-projections");
    worktreeRoot = join(root, "native-worktrees");
    await Promise.all([mkdir(sourceRoot), mkdir(projectionRoot), mkdir(worktreeRoot)]);
    await git(sourceRoot, "init", "-b", "main");
    await git(sourceRoot, "config", "user.name", "Projection Lifecycle");
    await git(sourceRoot, "config", "user.email", "projection@example.invalid");
    await git(sourceRoot, "config", "commit.gpgsign", "false");
    await writeFile(join(sourceRoot, "tracked.txt"), "base\n");
    await git(sourceRoot, "add", "tracked.txt");
    await git(sourceRoot, "commit", "-m", "initial");
    baseSha = (await execa("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })).stdout.trim();
    await git(sourceRoot, "remote", "add", "origin", REMOTE_URL);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("publishes closed shared schemas with explicit mutation authority", () => {
    expect(NativeWslProjectionPrepareRequestJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["request", "mutation"],
      properties: {
        request: { additionalProperties: false },
        mutation: {
          additionalProperties: false,
          required: ["authorized"],
        },
      },
    });
    expect(NativeWslProjectionStatusRequestJsonSchema).toMatchObject({
      additionalProperties: false,
      required: ["request"],
    });
    expect(NativeWslProjectionCleanupRequestJsonSchema).toMatchObject({
      additionalProperties: false,
      required: ["request", "mutation"],
    });
  });

  it("keeps status read-only and rejects implicit mutation authority", async () => {
    const request = projectionRequest();
    const handlers = createNativeWslProjectionLifecycleHandlers();
    const before = {
      projection: await readdir(projectionRoot),
      worktree: await readdir(worktreeRoot),
    };

    await expect(handlers.status({ request })).resolves.toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.status",
        state: "absent",
        nextActions: ["prepare_projection"],
      },
    });
    await expect(handlers.prepare({ request })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        issues: [{ path: "mutation", message: expect.any(String) }],
      },
    });
    await expect(handlers.cleanup({ request })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        issues: [{ path: "mutation", message: expect.any(String) }],
      },
    });
    expect(await readdir(projectionRoot)).toEqual(before.projection);
    expect(await readdir(worktreeRoot)).toEqual(before.worktree);
  });

  it("prepares, replays, reports, and cleans through one privacy-bounded seam", async () => {
    const request = projectionRequest();
    const handlers = createNativeWslProjectionLifecycleHandlers();
    const mutation = { authorized: true as const, reason: "WL-006 dogfood" };

    const prepared = await handlers.prepare({ request, mutation });
    const replay = await handlers.prepare({ request, mutation });
    const status = await handlers.status({ request });
    const quarantine = await handlers.quarantine({ request });
    const cleaned = await handlers.cleanup({ request, mutation });
    const cleanupReplay = await handlers.cleanup({ request, mutation });

    expect(prepared).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.prepare",
        outcome: "prepared",
        state: "ready",
        reasonCode: "projection_prepared",
        selectionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        nextActions: ["prepare_attempt"],
      },
    });
    expect(replay).toMatchObject({
      ok: true,
      result: {
        outcome: "reused",
        reasonCode: "projection_reused",
      },
    });
    expect(status).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.status",
        state: "ready",
        activeWorktreeCount: 0,
        nextActions: ["prepare_attempt"],
      },
    });
    expect(quarantine).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.quarantine.inspect",
        quarantine: {
          repository: { count: 0 },
          allocation: { count: 0 },
        },
      },
    });
    expect(cleaned).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.cleanup",
        outcome: "cleaned",
        reasonCode: "cleanup_complete",
      },
    });
    expect(cleanupReplay).toMatchObject({
      ok: true,
      result: {
        outcome: "absent",
        reasonCode: "projection_absent",
      },
    });
    for (const result of [prepared, replay, status, quarantine, cleaned, cleanupReplay]) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain("D:\\dev\\stfc-mod");
    }
  });

  it("bounds diagnostics and rejects unknown or oversized public input", async () => {
    const handlers = createNativeWslProjectionLifecycleHandlers();
    await expect(
      handlers.status({ request: projectionRequest(), unexpected: true })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input", issues: [{ path: "", message: expect.any(String) }] },
    });
    await expect(handlers.status({ request: "x".repeat(300_000) })).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Invalid projection lifecycle input",
        issues: [{ path: "", message: "input exceeds 262144 bytes" }],
      },
    });
  });

  it("does not echo machine-local paths from operation failures", async () => {
    const privatePath = join(root, "operator-private", "projection");
    const failed = createNativeWslProjectionLifecycleHandlers({
      async prepare() {
        throw new Error(`failed at ${privatePath}`);
      },
      async inspect() {
        throw new Error(`failed at ${privatePath}`);
      },
      async cleanup() {
        throw new Error(`failed at ${privatePath}`);
      },
    });

    const result = await failed.status({ request: projectionRequest() });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "operation_failed",
        message: "Projection lifecycle operation failed",
      },
    });
    expect(JSON.stringify(result)).not.toContain(privatePath);
  });

  function projectionRequest() {
    return createNativeWslProjectionRequest({
      schema_version: "1.0.0",
      request_id: "stfc-wl-006",
      repository: {
        id: "stfc-mod",
        expected_remote_hash: computeCanonicalHash(REMOTE_URL),
      },
      source: {
        windows_runtime: "windows-git",
        windows_repository_path: "D:\\dev\\stfc-mod",
        wsl_distribution: "Ubuntu",
        wsl_git_runtime: "wsl-ubuntu-git",
        wsl_repository_path: sourceRoot,
        head_policy: "observe",
        dirty_policy: "committed_base_only",
      },
      native: {
        host_id: "wsl-ubuntu-host",
        git_runtime: "wsl-ubuntu-git",
        projection_root: projectionRoot,
        worktree_root: worktreeRoot,
      },
      base_sha: baseSha,
    });
  }
});

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
