import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { createAgentTaskPacket } from "../../../src/schemas/agent-work.js";
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
      const packet = createAgentTaskPacket({
        schema_version: "1.0.0",
        packet_id: "worker-race-packet",
        run_id: "worker-race-run",
        work_item: { work_item_id: "worker-race-work", revision: 1 },
        attempt_id: "worker-race-attempt",
        repository: { id: "repo", base_sha: "a".repeat(40) },
        objective: "Race worker attachment",
        acceptance_criteria: [],
        instructions: [],
        scope: {
          read_globs: [],
          write_globs: [],
          deny_globs: [],
          cross_repo_allowed: false,
        },
        authority: {
          edit: false,
          git_write: false,
          github_write: false,
          external_runtime: false,
          secrets: false,
          signing: false,
          release: false,
        },
        verification: [],
        budget: {},
        created_at: "2026-07-11T12:00:00.000Z",
      });
      const packetJson = canonicalJSONStringify(packet);
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
        packetHash: packet.packet_hash,
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
        packet_hash: packet.packet_hash,
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
        packetJson,
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
          packetHash: packet.packet_hash,
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
      const winning = results.find((result) => result.updated);
      if (!winning?.updated) throw new Error("expected a winning worker session");
      await first.endWorkerSession({
        runId: "worker-race-run",
        controller,
        expectedRunRevision: 0,
        mutationId: "end-worker-race",
        now: "2026-07-11T12:00:04.000Z",
        attemptId: "worker-race-attempt",
        workspaceLeaseId: "worker-race-lease",
        expectedAttemptRevision: 3,
        expectedWorkspaceLeaseRevision: 0,
        sessionId: winning.workerSession.sessionId,
        expectedSessionRevision: 0,
        status: "completed",
      });
      const submit = (store: SqliteWorkspaceLifecycleStore, suffix: string) =>
        store.submitAttemptReceipt({
          runId: "worker-race-run",
          expectedRunRevision: 0,
          controller,
          mutationId: `submit-race-${suffix}`,
          now: "2026-07-11T12:00:05.000Z",
          attemptId: "worker-race-attempt",
          expectedAttemptRevision: 3,
          workspaceLeaseId: "worker-race-lease",
          expectedWorkspaceLeaseRevision: 0,
          workerSessionId: winning.workerSession.sessionId,
          expectedWorkerSessionRevision: 1,
          receipt: {
            schema_version: "2.0.0",
            receipt_id: `race-receipt-${suffix}`,
            run_id: "worker-race-run",
            work_item_id: "worker-race-work",
            work_item_revision: 1,
            attempt_id: "worker-race-attempt",
            packet_id: "worker-race-packet",
            packet_hash: packet.packet_hash,
            workspace_lease_id: "worker-race-lease",
            workspace_lease_revision: 0,
            worker_runtime: "native",
            worker_session_id: winning.workerSession.sessionId,
            observed_base_sha: "a".repeat(40),
            patch_hash: `sha256:${suffix === "a" ? "c".repeat(64) : "d".repeat(64)}`,
            outcome: "completed",
            exit_reason: "completed",
            summary: `Competing receipt ${suffix}`,
            files_touched: ["src/result.ts"],
            commits: [],
            acceptance_criteria_addressed: [],
            claimed_checks: [],
            assumptions: [],
            blockers: [],
            human_action_request_ids: [],
            cost: {},
            worker_started_at: "2026-07-11T12:00:02.500Z",
            worker_completed_at: "2026-07-11T12:00:04.000Z",
            submitted_at: "2026-07-11T12:00:04.500Z",
          },
        });
      const receiptResults = await Promise.all([submit(first, "a"), submit(second, "b")]);
      expect(receiptResults.filter((result) => result.submitted)).toHaveLength(1);
      expect(receiptResults.find((result) => !result.submitted)).toMatchObject({
        submitted: false,
        reason: "stale_attempt_revision",
      });
      await expect(second.listAttemptReceiptEvents("worker-race-run")).resolves.toHaveLength(1);
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

  it("reads pre-receipt-schema databases as an empty receipt lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-receipt-legacy-read-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const writable = new SqliteWorkspaceLifecycleStore(path);
    await writable.close();
    const database = new Database(path);
    database.exec(`
      DROP TABLE attempt_receipt_mutations;
      DROP TABLE attempt_receipt_events;
      DROP TABLE attempt_receipts;
      DELETE FROM coordination_schema_migrations WHERE version = 4;
    `);
    database.close();

    const legacy = new SqliteWorkspaceLifecycleStore(path, { readOnly: true });
    try {
      await expect(legacy.getAttemptReceipt("missing")).resolves.toBeNull();
      await expect(legacy.getAttemptReceiptForAttempt("missing")).resolves.toBeNull();
      await expect(legacy.getAttemptReceiptByHash(`sha256:${"0".repeat(64)}`)).resolves.toBeNull();
      await expect(legacy.listAttemptReceiptEvents("missing")).resolves.toEqual([]);
    } finally {
      await legacy.close();
    }
  });

  it("reads pre-packet-snapshot databases without creating a snapshot table", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-packet-legacy-read-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const writable = new SqliteWorkspaceLifecycleStore(path);
    await writable.close();
    const database = new Database(path);
    database.exec(`
      DROP TABLE task_packet_bindings;
      DELETE FROM coordination_schema_migrations WHERE version = 5;
    `);
    database.close();

    const legacy = new SqliteWorkspaceLifecycleStore(path, { readOnly: true });
    try {
      await expect(legacy.getTaskPacketBinding("missing")).resolves.toBeNull();
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
