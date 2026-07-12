import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { computeCanonicalHash } from "../../../src/schemas/task-contract.js";
import { SqliteWorkspaceLifecycleStore } from "../../../src/store/sqlite/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../../../src/util/canonicalJson.js";
import { runWorkspaceLifecycleStoreBehaviorTests } from "../workspace-lifecycle-store.behavior.js";

const directories: string[] = [];

runWorkspaceLifecycleStoreBehaviorTests({
  name: "SQLite",
  async create() {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-workspace-store-"));
    directories.push(directory);
    return new SqliteWorkspaceLifecycleStore(join(directory, "store.db"));
  },
});

describe("SQLite workspace lifecycle concurrency", () => {
  it("serializes competing worker attachments across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-worker-attach-race-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const first = new SqliteWorkspaceLifecycleStore(path);
    const second = new SqliteWorkspaceLifecycleStore(path);
    try {
      const acquired = await first.acquireControllerLease({
        runId: "worker-race-run",
        controllerId: "controller",
        leaseId: "controller-lease",
        now: "2026-07-11T12:00:00.000Z",
        ttlMs: 10_000,
        initialState: {},
      });
      if (!acquired.acquired) throw new Error("controller setup failed");
      const controller = {
        runId: acquired.lease.runId,
        controllerId: acquired.lease.controllerId,
        leaseId: acquired.lease.leaseId,
        fencingToken: acquired.lease.fencingToken,
      };
      await first.createAttempt({
        runId: "worker-race-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "create-worker-race",
        now: "2026-07-11T12:00:00.000Z",
        attemptId: "worker-race-attempt",
        workItemId: "worker-race-work",
        workItemRevision: 1,
        packetId: "worker-race-packet",
        packetHash: `sha256:${"b".repeat(64)}`,
        baseSha: "a".repeat(40),
      });
      const identity = {
        repositoryId: "repo",
        hostId: "host",
        gitRuntime: "git",
        projectRoot: "/repo",
        branch: "agent/worker-race",
        worktreePath: "/trees/worker-race",
        attemptId: "worker-race-attempt",
      };
      await first.acquireWorkspace({
        runId: "worker-race-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "acquire-worker-race",
        now: "2026-07-11T12:00:01.000Z",
        workspaceLeaseId: "worker-race-lease",
        workItemId: "worker-race-work",
        baseSha: "a".repeat(40),
        expectedAttemptRevision: 0,
        ttlMs: 8_000,
        observation: {
          ...identity,
          exists: true,
          registered: true,
          headSha: "a".repeat(40),
          cleanliness: "clean",
        },
        ...identity,
      });
      await first.transitionAttempt({
        runId: "worker-race-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "launch-worker-race",
        now: "2026-07-11T12:00:02.000Z",
        attemptId: "worker-race-attempt",
        expectedAttemptRevision: 1,
        status: "launching",
      });
      const envelope = {
        envelope_id: "worker-race-envelope",
        run_id: "worker-race-run",
        attempt_id: "worker-race-attempt",
        packet_id: "worker-race-packet",
        packet_hash: `sha256:${"b".repeat(64)}`,
        workspace_lease_id: "worker-race-lease",
        workspace_lease_revision: 0,
        expected_head_sha: "a".repeat(40),
        branch: "agent/worker-race",
        runtime: { host_id: "host", git_runtime: "git", worker_runtime: "native" },
        paths: { worktree_root: "/trees/worker-race" },
        created_at: "2026-07-11T12:00:02.250Z",
      };
      const envelopeJson = canonicalJSONStringify(envelope);
      const envelopeHash = computeCanonicalHash(envelope);
      await first.bindLaunchEnvelope({
        runId: "worker-race-run",
        attemptId: "worker-race-attempt",
        workspaceLeaseId: "worker-race-lease",
        expectedRunRevision: 0,
        expectedAttemptRevision: 2,
        expectedWorkspaceLeaseRevision: 0,
        controller,
        authorizationMutationId: "launch-worker-race",
        envelopeId: "worker-race-envelope",
        envelopeHash,
        envelopeJson,
        createdAt: "2026-07-11T12:00:02.250Z",
      });
      const attach = (store: SqliteWorkspaceLifecycleStore, suffix: string) =>
        store.attachWorkerSession({
          runId: "worker-race-run",
          controller,
          expectedRunRevision: 0,
          mutationId: `attach-worker-${suffix}`,
          now: "2026-07-11T12:00:03.000Z",
          attemptId: "worker-race-attempt",
          workspaceLeaseId: "worker-race-lease",
          expectedAttemptRevision: 2,
          expectedWorkspaceLeaseRevision: 0,
          sessionId: `session-${suffix}`,
          packetId: "worker-race-packet",
          packetHash: `sha256:${"b".repeat(64)}`,
          executionEnvelopeId: "worker-race-envelope",
          executionEnvelopeHash: envelopeHash,
          hostId: "host",
          workerRuntime: "native",
          gitRuntime: "git",
          backend: "host-subagent",
          workerId: `native-${suffix}`,
          startedAt: "2026-07-11T12:00:02.500Z",
        });
      const results = await Promise.all([attach(first, "a"), attach(second, "b")]);
      expect(results.filter((result) => result.updated)).toHaveLength(1);
      expect(results.find((result) => !result.updated)).toMatchObject({
        updated: false,
        reason: "stale_attempt_revision",
      });
      await expect(second.listWorkerSessionEvents("worker-race-run")).resolves.toHaveLength(1);
      await expect(second.getWorkerSessionForAttempt("worker-race-attempt")).resolves.toMatchObject(
        {
          status: "running",
          workerRuntime: "native",
        }
      );
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("reads pre-worker-schema databases as an empty worker lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-worker-legacy-read-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const writable = new SqliteWorkspaceLifecycleStore(path);
    await writable.close();
    const database = new Database(path);
    database.exec(`
      DROP TABLE worker_session_mutations;
      DROP TABLE worker_session_events;
      DROP TABLE worker_sessions;
      DROP TABLE launch_envelope_bindings;
      DELETE FROM coordination_schema_migrations WHERE version = 3;
    `);
    database.close();

    const legacy = new SqliteWorkspaceLifecycleStore(path, { readOnly: true });
    try {
      await expect(legacy.getWorkerSession("missing")).resolves.toBeNull();
      await expect(legacy.getWorkerSessionForAttempt("missing")).resolves.toBeNull();
      await expect(legacy.listWorkerSessionEvents("missing")).resolves.toEqual([]);
      await expect(legacy.getLaunchEnvelopeBinding("missing")).resolves.toBeNull();
    } finally {
      await legacy.close();
    }
  });

  it("serializes conflicting workspace reservations across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-workspace-race-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const first = new SqliteWorkspaceLifecycleStore(path);
    const second = new SqliteWorkspaceLifecycleStore(path);
    try {
      const acquired = await first.acquireControllerLease({
        runId: "race-run",
        controllerId: "controller",
        leaseId: "controller-lease",
        now: "2026-07-11T12:00:00.000Z",
        ttlMs: 10_000,
        initialState: {},
      });
      if (!acquired.acquired) throw new Error("controller setup failed");
      const controller = {
        runId: acquired.lease.runId,
        controllerId: acquired.lease.controllerId,
        leaseId: acquired.lease.leaseId,
        fencingToken: acquired.lease.fencingToken,
      };
      for (const [store, attemptId, workItemId] of [
        [first, "attempt-a", "work-a"],
        [second, "attempt-b", "work-b"],
      ] as const) {
        await store.createAttempt({
          runId: "race-run",
          controller,
          expectedRunRevision: 0,
          mutationId: `create-${attemptId}`,
          now: "2026-07-11T12:00:00.000Z",
          attemptId,
          workItemId,
          workItemRevision: 1,
          packetId: `packet-${attemptId}`,
          packetHash: `sha256:${"b".repeat(64)}`,
          baseSha: "a".repeat(40),
        });
      }
      const reserve = (
        store: SqliteWorkspaceLifecycleStore,
        attemptId: string,
        workItemId: string
      ) =>
        store.acquireWorkspace({
          runId: "race-run",
          controller,
          expectedRunRevision: 0,
          mutationId: `reserve-${attemptId}`,
          now: "2026-07-11T12:00:01.000Z",
          attemptId,
          workItemId,
          workItemRevision: 1,
          packetId: `packet-${attemptId}`,
          packetHash: `sha256:${"b".repeat(64)}`,
          workspaceLeaseId: `lease-${attemptId}`,
          expectedAttemptRevision: 0,
          ttlMs: 5_000,
          repositoryId: "repo",
          hostId: "host",
          gitRuntime: "git",
          projectRoot: "/repo",
          branch: "agent/shared",
          worktreePath: `/trees/${attemptId}`,
          baseSha: "a".repeat(40),
        } as Parameters<SqliteWorkspaceLifecycleStore["acquireWorkspace"]>[0]);
      const results = await Promise.all([
        reserve(first, "attempt-a", "work-a"),
        reserve(second, "attempt-b", "work-b"),
      ]);
      expect(results.filter((result) => result.updated)).toHaveLength(1);
      expect(results.find((result) => !result.updated)).toMatchObject({
        reason: "branch_conflict",
      });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("serializes release and reconciliation finalization across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-workspace-finalize-race-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const first = new SqliteWorkspaceLifecycleStore(path);
    const second = new SqliteWorkspaceLifecycleStore(path);
    try {
      const acquired = await first.acquireControllerLease({
        runId: "finalize-run",
        controllerId: "controller",
        leaseId: "controller-lease",
        now: "2026-07-11T12:00:00.000Z",
        ttlMs: 10_000,
        initialState: {},
      });
      if (!acquired.acquired) throw new Error("controller setup failed");
      const controller = {
        runId: acquired.lease.runId,
        controllerId: acquired.lease.controllerId,
        leaseId: acquired.lease.leaseId,
        fencingToken: acquired.lease.fencingToken,
      };
      await first.createAttempt({
        runId: "finalize-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "create-finalize-attempt",
        now: "2026-07-11T12:00:00.000Z",
        attemptId: "finalize-attempt",
        workItemId: "finalize-work",
        workItemRevision: 1,
        packetId: "finalize-packet",
        packetHash: `sha256:${"b".repeat(64)}`,
        baseSha: "a".repeat(40),
      });
      const identity = {
        repositoryId: "repo",
        hostId: "host",
        gitRuntime: "git",
        projectRoot: "/repo",
        branch: "agent/finalize",
        worktreePath: "/trees/finalize",
        attemptId: "finalize-attempt",
      };
      const observation = {
        ...identity,
        exists: true,
        registered: true,
        headSha: "a".repeat(40),
        cleanliness: "clean" as const,
      };
      await first.acquireWorkspace({
        runId: "finalize-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "acquire-finalize-workspace",
        now: "2026-07-11T12:00:01.000Z",
        workspaceLeaseId: "finalize-workspace-lease",
        workItemId: "finalize-work",
        baseSha: "a".repeat(40),
        expectedAttemptRevision: 0,
        ttlMs: 5_000,
        observation,
        ...identity,
      });

      const results = await Promise.all([
        first.releaseWorkspace({
          runId: "finalize-run",
          controller,
          expectedRunRevision: 0,
          mutationId: "finalize-release",
          now: "2026-07-11T12:00:02.000Z",
          attemptId: "finalize-attempt",
          workspaceLeaseId: "finalize-workspace-lease",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          disposition: "discarded",
          observation,
        }),
        second.reconcileWorkspace({
          runId: "finalize-run",
          controller,
          expectedRunRevision: 0,
          mutationId: "finalize-preserve",
          now: "2026-07-11T12:00:02.000Z",
          attemptId: "finalize-attempt",
          workspaceLeaseId: "finalize-workspace-lease",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          action: "preserve",
          observation,
        }),
      ]);
      expect(results.filter((result) => result.updated)).toHaveLength(1);
      expect(results.find((result) => !result.updated)).toMatchObject({
        reason: "stale_attempt_revision",
      });
      const events = await second.listWorkspaceLifecycleEvents("finalize-run");
      expect(events).toHaveLength(3);
      expect(
        events.filter((event) =>
          ["workspace_released", "workspace_reconciled"].includes(event.type)
        )
      ).toHaveLength(1);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
