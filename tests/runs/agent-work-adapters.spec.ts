import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3-multiple-ciphers";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  AttemptPrepareRequestSchema,
  AttemptStartRequestSchema,
  createAttemptLifecycleHandlers,
} from "../../src/runs/agent-work-adapters.js";
import { createNativeWslProjectionRequest } from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { SqliteWorkspaceLifecycleStore } from "../../src/store/sqlite/workspace-lifecycle-store.js";
import { NativeWslProjectionEngine } from "../../src/workspaces/native-wsl-projection-engine.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("attempt lifecycle adapter handlers", () => {
  it("prepares a canonically bound assisted launch bundle and replays it stably", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    const handlers = createAttemptLifecycleHandlers();

    const first = await handlers.prepare(request);
    const replay = await handlers.prepare(request);

    expect(first).toMatchObject({
      ok: true,
      result: {
        ok: true,
        outcome: "launch_bundle_ready",
        lifecycle: {
          outcome: "launch_authorized",
          attempt: { status: "launching" },
          workspace: { status: "active" },
        },
        packet: {
          packet_id: "packet-assisted",
          run_id: "run-adapter",
          work_item: { work_item_id: "work-assisted", revision: 3 },
          attempt_id: "attempt-assisted",
          objective: "Prepare one assisted launch bundle",
        },
        envelope: {
          envelope_id: "envelope-assisted",
          run_id: "run-adapter",
          attempt_id: "attempt-assisted",
          branch: "lexrunner/attempt-assisted",
          runtime: { host_id: "host-adapter", worker_runtime: "codex-native" },
          path_mappings: [{ mapping_kind: "native_linux" }],
        },
      },
    });
    if (!first.ok || !first.result.ok || !replay.ok || !replay.result.ok) {
      throw new Error("expected launch bundle success");
    }
    expect(first.result.packet.packet_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.result.envelope.packet_hash).toBe(first.result.packet.packet_hash);
    expect(first.result.envelope.workspace_lease_revision).toBe(
      first.result.lifecycle.workspace.revision
    );
    expect(first.result.envelope.paths).toEqual({
      project_root: request.envelope.projectRoot,
      execution_root: request.envelope.executionRoot,
      allocation_root: request.runtime.worktreeRoot,
      worktree_root: request.attempt.workspace.worktreePath,
    });
    expect(first.result.envelope.path_mappings[0]).toMatchObject({
      repository_id: request.runtime.repositoryId,
      base_sha: request.identity.baseSha,
      native_host_id: request.runtime.hostId,
      git_runtime: request.runtime.gitRuntime,
      roots: {
        native_repository: { path: request.runtime.repositoryRoot },
        native_allocation_root: { path: request.runtime.worktreeRoot },
        native_worktree: { path: request.attempt.workspace.worktreePath },
      },
    });
    expect(replay.result.packet).toEqual(first.result.packet);
    expect(replay.result.envelope).toEqual(first.result.envelope);
    await expect(
      handlers.status({
        databasePath: request.runtime.databasePath,
        runId: request.identity.runId,
        attemptId: request.identity.attemptId,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: { launch: { state: "bound", reconciliationRequired: false } },
    });
  });

  it("emits one source-to-native mapping only from the current selection authority", async () => {
    const root = await sandbox();
    const { request, selection } = await projectedPrepareFixture(root);

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        envelope: {
          path_mappings: [
            {
              projection_id: selection.manifest.projection_id,
              repository_id: request.runtime.repositoryId,
              base_sha: request.identity.baseSha,
              native_host_id: request.runtime.hostId,
              request_digest: selection.manifest.request_digest,
              projection_digest: selection.manifest.manifest_digest,
              projection_mapping_digest: selection.manifest.path_mapping.mapping_digest,
              roots: {
                windows_source: {
                  path: selection.manifest.path_mapping.roots.windows_source.path,
                },
                wsl_source: {
                  path: selection.manifest.path_mapping.roots.wsl_source.path,
                },
                native_repository: { path: request.runtime.repositoryRoot },
                native_allocation_root: { path: request.runtime.worktreeRoot },
                native_worktree: { path: request.attempt.workspace.worktreePath },
              },
            },
          ],
        },
      },
    });
  });

  it("rejects caller-supplied projection evidence in place of an authority reference", async () => {
    const root = await sandbox();
    const { request, selection } = await projectedPrepareFixture(root);

    expect(
      AttemptPrepareRequestSchema.safeParse({
        ...request,
        envelope: {
          ...request.envelope,
          projection: {
            manifest: selection.manifest,
            receipt: selection.receipt,
          },
        },
      }).success
    ).toBe(false);
  });

  it("reports a durable launch binding as stale after controller authority changes", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    const handlers = createAttemptLifecycleHandlers();

    await expect(handlers.prepare(request)).resolves.toMatchObject({
      ok: true,
      result: { ok: true, outcome: "launch_bundle_ready" },
    });

    const store = new SqliteWorkspaceLifecycleStore(request.runtime.databasePath);
    try {
      await expect(
        store.acquireControllerLease({
          runId: request.identity.runId,
          controllerId: "replacement-controller",
          leaseId: "replacement-controller-lease",
          now: "2026-07-12T12:01:01.000Z",
          ttlMs: 60_000,
          initialState: {},
        })
      ).resolves.toMatchObject({ acquired: true });
    } finally {
      await store.close();
    }

    await expect(
      handlers.status({
        databasePath: request.runtime.databasePath,
        runId: request.identity.runId,
        attemptId: request.identity.attemptId,
      })
    ).resolves.toMatchObject({
      ok: true,
      result: { launch: { state: "binding_stale", reconciliationRequired: true } },
    });
  });

  it("rolls back the launch envelope when packet snapshot persistence fails", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    const seeded = new SqliteWorkspaceLifecycleStore(request.runtime.databasePath);
    await seeded.close();
    const database = new Database(request.runtime.databasePath);
    try {
      database.exec(`
        CREATE TRIGGER reject_task_packet_snapshot
        BEFORE INSERT ON task_packet_bindings
        BEGIN
          SELECT RAISE(ABORT, 'forced packet snapshot failure');
        END;
      `);
    } finally {
      database.close();
    }

    await expect(createAttemptLifecycleHandlers().prepare(request)).resolves.toMatchObject({
      ok: false,
      error: { code: "operation_failed" },
    });

    const verification = new Database(request.runtime.databasePath);
    try {
      expect(
        verification.prepare(`SELECT COUNT(*) AS count FROM launch_envelope_bindings`).get()
      ).toEqual({ count: 0 });
      expect(
        verification.prepare(`SELECT COUNT(*) AS count FROM task_packet_bindings`).get()
      ).toEqual({ count: 0 });
    } finally {
      verification.close();
    }
  });

  it("rejects launch bindings before opening SQLite or Git", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    request.workItem.repository.id = "another/repository";

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input",
        issues: [{ path: "workItem.repository.id", message: "must match runtime.repositoryId" }],
      },
    });
    await expect(access(request.runtime.databasePath)).rejects.toThrow();
    await expect(access(request.attempt.workspace.worktreePath)).rejects.toThrow();
  });

  it("rejects machine-local paths in the portable packet before mutation", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    request.packet.instructions = ["Read /home/operator/secret.txt"];

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", issues: [{ path: "packet.instructions.0" }] },
    });
    await expect(access(request.runtime.databasePath)).rejects.toThrow();
  });

  it("rejects traversal and duplicate check identities before mutation", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    request.packet.verification = [
      {
        id: "test",
        argv: ["npm", "test"],
        cwd_rel: "src/../../outside",
        expected_exit_codes: [0],
      },
      { id: "test", argv: ["npm", "run", "lint"], expected_exit_codes: [0] },
    ];

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    if (result.ok) throw new Error("expected invalid launch policy");
    expect(result.error.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["packet.verification.0.cwd_rel"])
    );
    await expect(access(request.runtime.databasePath)).rejects.toThrow();
  });

  it("refuses to replay a bundle after the authorized worktree becomes dirty", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    const handlers = createAttemptLifecycleHandlers();
    await expect(handlers.prepare(request)).resolves.toMatchObject({
      ok: true,
      result: { ok: true, outcome: "launch_bundle_ready" },
    });
    await writeFile(join(request.attempt.workspace.worktreePath, "dirty.txt"), "dirty\n", "utf8");

    const replay = await handlers.prepare(request);

    expect(replay).toMatchObject({
      ok: false,
      error: {
        code: "operation_failed",
        message: "Launch workspace observation is not safe for handoff",
      },
    });
  });

  it("rejects an envelope timestamp beyond lease authority before mutation", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    request.envelope.createdAt = "2026-07-12T12:02:00.000Z";

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    if (result.ok) throw new Error("expected expired envelope rejection");
    expect(result.error.issues.map((issue) => issue.path)).toContain("envelope.createdAt");
    await expect(access(request.runtime.databasePath)).rejects.toThrow();
  });

  it("does not emit a bundle through an in-worktree symlink escape", async () => {
    const root = await sandbox();
    const request = await prepareFixture(root);
    request.envelope.projectRoot = join(request.attempt.workspace.worktreePath, "escape");
    request.envelope.executionRoot = request.envelope.projectRoot;

    const result = await createAttemptLifecycleHandlers().prepare(request);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "operation_failed",
        message: "envelope.projectRoot must resolve within its authorized root",
      },
    });
  });

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
        launch: { state: "binding_missing", reconciliationRequired: true },
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
  await mkdir(join(repositoryRoot, "..project"));
  await mkdir(join(root, "outside"));
  await writeFile(join(repositoryRoot, "tracked.txt"), "base\n", "utf8");
  await writeFile(join(repositoryRoot, "..project", "app.txt"), "app\n", "utf8");
  await symlink(join(root, "outside"), join(repositoryRoot, "escape"), "dir");
  await git(repositoryRoot, "add", "tracked.txt", "..project/app.txt", "escape");
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

async function prepareFixture(root: string) {
  const started = await fixture(root);
  started.runtime.repositoryId = "owner/repo";
  return {
    runtime: started.runtime,
    workItem: {
      schema_version: "1.0.0" as const,
      work_item_id: "work-assisted",
      revision: 3,
      source: {
        kind: "github" as const,
        external_id: "753",
        revision: "issue-753-v1",
        url: "https://github.com/Guffawaffle/lexrunner/issues/753",
        captured_at: "2026-07-12T12:00:00.000Z",
      },
      repository: { id: "owner/repo", default_branch: "main" },
      title: "Prepare an assisted launch bundle",
      objective: "Prepare one assisted launch bundle",
      description: "Exercise the foreground-controller handoff seam.",
      acceptance_criteria: [{ id: "ac-1", text: "Packet and envelope are bound" }],
      constraints: ["Do not launch a worker"],
      labels: ["agent-work"],
      dependencies: [],
    },
    identity: {
      runId: started.attempt.runId,
      attemptId: "attempt-assisted",
      baseSha: started.attempt.attempt.baseSha,
    },
    packet: {
      packetId: "packet-assisted",
      instructions: ["Implement the bounded issue contract"],
      scope: {
        read_globs: ["src/**", "tests/**"],
        write_globs: ["src/**", "tests/**"],
        deny_globs: [".env"],
        cross_repo_allowed: false,
      },
      authority: {
        edit: true,
        git_write: true,
        github_write: false,
        external_runtime: false,
        secrets: false,
        signing: false,
        release: false,
      },
      verification: [{ id: "test", argv: ["npm", "test"], expected_exit_codes: [0] }],
      budget: { max_tokens: 20_000, max_tool_calls: 100, max_elapsed_ms: 3_600_000 },
      createdAt: "2026-07-12T12:00:00.000Z",
    },
    envelope: {
      envelopeId: "envelope-assisted",
      os: "linux" as const,
      architecture: "x64",
      workerRuntime: "codex-native",
      projectRoot: join(root, "worktrees", "attempt-assisted", "..project"),
      executionRoot: join(root, "worktrees", "attempt-assisted", "..project"),
      exposedEnvironmentKeys: ["PATH"],
      createdAt: "2026-07-12T12:00:07.000Z",
    },
    attempt: {
      initialRunState: started.attempt.initialRunState,
      controller: started.attempt.controller,
      workspace: {
        workspaceLeaseId: "lease-assisted",
        branch: "lexrunner/attempt-assisted",
        worktreePath: join(root, "worktrees", "attempt-assisted"),
        ttlMs: started.attempt.workspace.ttlMs,
      },
      mutations: started.attempt.mutations,
    },
  };
}

async function projectedPrepareFixture(root: string) {
  const request = await prepareFixture(root);
  const projectionRoot = join(root, "native-projections");
  const worktreeRoot = join(root, "native-worktrees");
  const remote = "https://example.invalid/owner/repo.git";
  await Promise.all([mkdir(projectionRoot), mkdir(worktreeRoot)]);
  await git(request.runtime.repositoryRoot, "remote", "add", "origin", remote);
  const projectionRequest = createNativeWslProjectionRequest({
    schema_version: "1.0.0",
    request_id: "projection-request-assisted",
    repository: {
      id: request.runtime.repositoryId,
      expected_remote_hash: computeCanonicalHash(remote),
    },
    source: {
      windows_runtime: "windows:host-adapter",
      windows_repository_path: "D:\\dev\\lexrunner",
      wsl_distribution: "Ubuntu-24.04",
      wsl_git_runtime: "wsl:Ubuntu-24.04",
      wsl_repository_path: request.runtime.repositoryRoot,
      head_policy: "require_base",
      dirty_policy: "committed_base_only",
    },
    native: {
      host_id: request.runtime.hostId,
      git_runtime: request.runtime.gitRuntime,
      projection_root: projectionRoot,
      worktree_root: worktreeRoot,
    },
    base_sha: request.identity.baseSha,
  });
  const selection = await new NativeWslProjectionEngine().prepare(projectionRequest);
  if (!selection.ok) {
    throw new Error(`expected native projection: ${selection.reasonCode}`);
  }
  const worktreePath = join(selection.manifest.native_worktree_root.path, "attempt-assisted");
  request.runtime.repositoryRoot = selection.manifest.native_repository.path;
  request.runtime.worktreeRoot = selection.manifest.native_worktree_root.path;
  request.attempt.workspace.worktreePath = worktreePath;
  request.envelope.projectRoot = join(worktreePath, "..project");
  request.envelope.executionRoot = join(worktreePath, "..project");
  request.envelope.projection = {
    selectionDigest: selection.selection.selection_digest,
  };
  return { request, selection };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa("git", args, { cwd });
}
