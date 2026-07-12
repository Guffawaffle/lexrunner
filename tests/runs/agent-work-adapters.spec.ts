import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  AttemptStartRequestSchema,
  createAttemptLifecycleHandlers,
} from "../../src/runs/agent-work-adapters.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("attempt lifecycle adapter handlers", () => {
  it("rejects runtime identity mismatch before opening SQLite", async () => {
    const root = await sandbox();
    const request = await fixture(root);
    request.attempt.workspace.hostId = "another-host";

    const result = await createAttemptLifecycleHandlers().start(request);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Invalid attempt lifecycle input",
        issues: [
          { path: "attempt.workspace.hostId", message: "must match the configured runtime" },
        ],
      },
    });
    await expect(access(request.runtime.databasePath)).rejects.toThrow();
  });

  it("does not create a database while reading missing status", async () => {
    const root = await sandbox();
    const databasePath = join(root, "missing.db");

    const result = await createAttemptLifecycleHandlers().status({
      databasePath,
      runId: "run-missing",
      attemptId: "attempt-missing",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", issues: [{ path: "databasePath" }] },
    });
    await expect(access(databasePath)).rejects.toThrow();
  });

  it("runs start and status through the same bounded shared seam", async () => {
    const root = await sandbox();
    const request = await fixture(root);
    const handlers = createAttemptLifecycleHandlers();

    const started = await handlers.start(request);
    const status = await handlers.status({
      databasePath: request.runtime.databasePath,
      runId: request.attempt.runId,
      attemptId: request.attempt.attempt.attemptId,
    });

    expect(started).toMatchObject({
      ok: true,
      result: {
        ok: true,
        outcome: "launch_authorized",
        attempt: { status: "launching" },
        workspace: { status: "active" },
      },
    });
    expect(status).toMatchObject({
      ok: true,
      result: {
        run: { runId: "run-adapter" },
        attempt: { attemptId: "attempt-adapter", status: "launching" },
        workspace: { leaseId: "lease-adapter", status: "active" },
      },
    });
  });

  it("bounds non-JSON and oversized requests without throwing", async () => {
    const handlers = createAttemptLifecycleHandlers();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(handlers.start(circular)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input", issues: [{ message: "input must be JSON-safe" }] },
    });
    await expect(
      handlers.status({ databasePath: "/tmp/test.db", runId: "x".repeat(300_000), attemptId: "a" })
    ).resolves.toMatchObject({
      ok: false,
      error: { issues: [{ message: "input exceeds 262144 bytes" }] },
    });
  });

  it("keeps caller-supplied mutation IDs and timestamps in the parsed contract", async () => {
    const root = await sandbox();
    const request = await fixture(root);
    expect(AttemptStartRequestSchema.parse(request).attempt.mutations).toEqual(
      request.attempt.mutations
    );
  });

  it("closes the store after a lifecycle failure", async () => {
    const root = await sandbox();
    const request = await fixture(root);
    request.attempt.initialRunState.runId = "wrong-run";
    const handlers = createAttemptLifecycleHandlers();

    const failed = await handlers.start(request);
    const reopened = await handlers.status({
      databasePath: request.runtime.databasePath,
      runId: request.attempt.runId,
      attemptId: request.attempt.attempt.attemptId,
    });

    expect(failed).toMatchObject({
      ok: true,
      result: { ok: false, reason: "reconciliation_required" },
    });
    expect(reopened).toMatchObject({ ok: true, result: { run: null, attempt: null } });
  });
});

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-attempt-adapter-"));
  roots.push(root);
  return root;
}

async function fixture(root: string) {
  const repositoryRoot = join(root, "repository");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(repositoryRoot);
  await mkdir(worktreeRoot);
  await git(repositoryRoot, "init", "-b", "main");
  await git(repositoryRoot, "config", "user.name", "LexRunner Test");
  await git(repositoryRoot, "config", "user.email", "test@example.invalid");
  await git(repositoryRoot, "config", "commit.gpgsign", "false");
  await writeFile(join(repositoryRoot, "tracked.txt"), "base\n", "utf8");
  await git(repositoryRoot, "add", "tracked.txt");
  await git(repositoryRoot, "commit", "-m", "initial");
  const baseSha = (
    await execa("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  const at = (second: number) => `2026-07-12T12:00:0${second}.000Z`;
  return {
    runtime: {
      databasePath: join(root, "lifecycle.db"),
      repositoryId: "repo-adapter",
      repositoryRoot,
      worktreeRoot,
      hostId: "host-adapter",
      gitRuntime: "git-test",
      pathComparison: "case-sensitive" as const,
    },
    attempt: {
      runId: "run-adapter",
      initialRunState: {
        runId: "run-adapter",
        mode: "agent",
        procedure: "agent-work",
        repo: "owner/repo",
        state: "planning",
        createdAt: at(0),
        updatedAt: at(0),
        completedSteps: [],
        currentStep: null,
        params: {},
        metadata: {},
      },
      controller: {
        controllerId: "controller",
        leaseId: "controller-lease",
        now: at(0),
        ttlMs: 60_000,
      },
      attempt: {
        attemptId: "attempt-adapter",
        workItemId: "work-adapter",
        workItemRevision: 1,
        packetId: "packet-adapter",
        packetHash: `sha256:${"b".repeat(64)}`,
        baseSha,
      },
      workspace: {
        workspaceLeaseId: "lease-adapter",
        repositoryId: "repo-adapter",
        hostId: "host-adapter",
        gitRuntime: "git-test",
        projectRoot: repositoryRoot,
        branch: "lexrunner/attempt-adapter",
        worktreePath: join(worktreeRoot, "attempt-adapter"),
        ttlMs: 60_000,
      },
      mutations: {
        createAttempt: { mutationId: "create", now: at(1) },
        reserveWorkspace: { mutationId: "reserve", now: at(2) },
        activateWorkspace: { mutationId: "activate", now: at(3) },
        resumeWorkspace: { mutationId: "resume", now: at(4) },
        quarantineWorkspace: { mutationId: "quarantine", now: at(5) },
        authorizeLaunch: { mutationId: "authorize", now: at(6) },
      },
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}
