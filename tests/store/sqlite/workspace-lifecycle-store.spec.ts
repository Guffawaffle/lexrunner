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

  it("constrains new categorical rows and fails closed on corrupt legacy values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-lifecycle-domain-read-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const writable = new SqliteWorkspaceLifecycleStore(path);
    const acquired = await writable.acquireControllerLease({
      runId: "domain-run",
      controllerId: "domain-controller",
      leaseId: "domain-controller-lease",
      now: "2026-07-11T12:00:00.000Z",
      ttlMs: 60_000,
      initialState: {},
    });
    if (!acquired.acquired) throw new Error("controller setup failed");
    const controller = {
      runId: acquired.lease.runId,
      controllerId: acquired.lease.controllerId,
      leaseId: acquired.lease.leaseId,
      fencingToken: acquired.lease.fencingToken,
    };
    const createInput = {
      runId: "domain-run",
      controller,
      expectedRunRevision: 0,
      mutationId: "domain-create",
      now: "2026-07-11T12:00:01.000Z",
      attemptId: "domain-attempt",
      workItemId: "domain-work",
      workItemRevision: 1,
      packetId: "domain-packet",
      packetHash: `sha256:${"b".repeat(64)}`,
      baseSha: "a".repeat(40),
    };
    await writable.createAttempt(createInput);
    await writable.close();

    const database = new Database(path);
    database.pragma("foreign_keys = OFF");
    database.exec(`
      INSERT INTO workspace_leases (
        leaseId, runId, runRevision, workItemId, workItemRevision, packetId, packetHash,
        attemptId, revision, controllerId, controllerLeaseId, fencingToken, repositoryId,
        hostId, gitRuntime, projectRoot, branch, worktreePath, baseSha, status, acquiredAt,
        heartbeatAt, expiresAt
      ) VALUES (
        'domain-lease', 'domain-run', 0, 'domain-work', 1, 'domain-packet',
        'sha256:${"b".repeat(64)}', 'domain-attempt', 0, 'domain-controller',
        'domain-controller-lease', 1, 'owner/repo', 'host', 'git', '/repo', 'agent/domain',
        '/trees/domain', '${"a".repeat(40)}', 'reserved', '2026-07-11T12:00:01.000Z',
        '2026-07-11T12:00:01.000Z', '2026-07-11T12:01:00.000Z'
      );
      INSERT INTO worker_sessions (
        sessionId, revision, runId, attemptId, packetId, packetHash, workspaceLeaseId,
        workspaceLeaseRevision, executionEnvelopeId, executionEnvelopeHash, hostId,
        workerRuntime, gitRuntime, backend, workerId, status, startedAt, heartbeatAt
      ) VALUES (
        'domain-session', 0, 'domain-run', 'domain-attempt', 'domain-packet',
        'sha256:${"b".repeat(64)}', 'domain-lease', 0, 'domain-envelope',
        'sha256:${"c".repeat(64)}', 'host', 'future-runtime', 'git', 'external',
        'domain-worker', 'starting', '2026-07-11T12:00:02.000Z',
        '2026-07-11T12:00:02.000Z'
      );
      INSERT INTO worker_session_events (
        runId, attemptId, sessionId, mutationId, sequence, attemptRevision,
        workspaceLeaseRevision, sessionRevision, controllerId, controllerLeaseId,
        fencingToken, type, payloadJson, createdAt
      ) VALUES (
        'domain-run', 'domain-attempt', 'domain-session', 'domain-worker-event', 1, 0, 0, 0,
        'domain-controller', 'domain-controller-lease', 1, 'worker_session_attached', '{}',
        '2026-07-11T12:00:02.000Z'
      );
      INSERT INTO attempt_receipts (
        receiptId, receiptHash, receiptJson, runId, workItemId, workItemRevision, attemptId,
        packetId, packetHash, workspaceLeaseId, workspaceLeaseRevision, workerSessionId,
        workerSessionRevision, workerRuntime, observedBaseSha, outcome, disposition, submittedAt,
        recordedAt, controllerId, controllerLeaseId, fencingToken, resultingAttemptRevision,
        resultingAttemptStatus
      ) VALUES (
        'domain-receipt', 'sha256:${"d".repeat(64)}', '{}', 'domain-run', 'domain-work', 1,
        'domain-attempt', 'domain-packet', 'sha256:${"b".repeat(64)}', 'domain-lease', 0,
        'domain-session', 0, 'future-runtime', '${"a".repeat(40)}', 'completed',
        'retained_late', '2026-07-11T12:00:03.000Z', '2026-07-11T12:00:03.000Z',
        'domain-controller', 'domain-controller-lease', 1, 0, 'prepared'
      );
      INSERT INTO attempt_receipt_events (
        runId, attemptId, receiptId, receiptHash, mutationId, sequence, attemptRevision,
        workspaceLeaseRevision, workerSessionRevision, controllerId, controllerLeaseId,
        fencingToken, type, disposition, outcome, createdAt
      ) VALUES (
        'domain-run', 'domain-attempt', 'domain-receipt', 'sha256:${"d".repeat(64)}',
        'domain-receipt-event', 1, 0, 0, 0, 'domain-controller', 'domain-controller-lease', 1,
        'attempt_receipt_retained_late', 'retained_late', 'completed',
        '2026-07-11T12:00:03.000Z'
      );
    `);

    for (const statement of [
      `UPDATE attempts SET status = 'invented' WHERE attemptId = 'domain-attempt'`,
      `UPDATE workspace_leases SET status = 'invented' WHERE leaseId = 'domain-lease'`,
      `UPDATE workspace_leases SET cleanupDisposition = 'invented' WHERE leaseId = 'domain-lease'`,
      `UPDATE worker_sessions SET backend = 'invented' WHERE sessionId = 'domain-session'`,
      `UPDATE worker_sessions SET status = 'invented' WHERE sessionId = 'domain-session'`,
      `UPDATE workspace_lifecycle_events SET type = 'invented' WHERE mutationId = 'domain-create'`,
      `UPDATE worker_session_events SET type = 'invented' WHERE mutationId = 'domain-worker-event'`,
      `UPDATE attempt_receipts SET outcome = 'invented' WHERE receiptId = 'domain-receipt'`,
      `UPDATE attempt_receipts SET disposition = 'invented' WHERE receiptId = 'domain-receipt'`,
      `UPDATE attempt_receipts SET resultingAttemptStatus = 'invented' WHERE receiptId = 'domain-receipt'`,
      `UPDATE attempt_receipt_events SET type = 'invented' WHERE mutationId = 'domain-receipt-event'`,
      `UPDATE attempt_receipt_events SET disposition = 'invented' WHERE mutationId = 'domain-receipt-event'`,
      `UPDATE attempt_receipt_events SET outcome = 'invented' WHERE mutationId = 'domain-receipt-event'`,
    ]) {
      expect(() => database.exec(statement)).toThrow(/CHECK constraint failed/);
    }

    const mutationRow = database
      .prepare(
        `SELECT resultJson FROM workspace_lifecycle_mutations
         WHERE runId = 'domain-run' AND mutationId = 'domain-create'`
      )
      .get() as { resultJson: string };
    const mutationResult = JSON.parse(mutationRow.resultJson) as {
      attempt: { status: string };
    };
    mutationResult.attempt.status = "invented";
    database
      .prepare(
        `UPDATE workspace_lifecycle_mutations SET resultJson = ?
         WHERE runId = 'domain-run' AND mutationId = 'domain-create'`
      )
      .run(JSON.stringify(mutationResult));
    database.close();

    const replayStore = new SqliteWorkspaceLifecycleStore(path);
    try {
      await expect(replayStore.createAttempt(createInput)).resolves.toMatchObject({
        updated: false,
        reason: "evidence_mismatch",
      });
    } finally {
      await replayStore.close();
    }

    const corrupter = new Database(path);
    corrupter.pragma("ignore_check_constraints = ON");
    corrupter.exec(`
      UPDATE attempts SET status = 'invented' WHERE attemptId = 'domain-attempt';
      UPDATE workspace_leases SET status = 'invented' WHERE leaseId = 'domain-lease';
      UPDATE worker_sessions SET backend = 'invented' WHERE sessionId = 'domain-session';
      UPDATE workspace_lifecycle_events SET type = 'invented' WHERE mutationId = 'domain-create';
      UPDATE worker_session_events SET type = 'invented' WHERE mutationId = 'domain-worker-event';
      UPDATE attempt_receipts SET outcome = 'invented' WHERE receiptId = 'domain-receipt';
      UPDATE attempt_receipt_events SET type = 'invented' WHERE mutationId = 'domain-receipt-event';
    `);
    corrupter.close();

    const corrupted = new SqliteWorkspaceLifecycleStore(path, { readOnly: true });
    try {
      await expect(corrupted.getAttempt("domain-attempt")).resolves.toBeNull();
      await expect(corrupted.getWorkspaceLease("domain-lease")).resolves.toBeNull();
      await expect(corrupted.getWorkerSession("domain-session")).resolves.toBeNull();
      await expect(corrupted.getAttemptReceipt("domain-receipt")).resolves.toBeNull();
      await expect(corrupted.listWorkspaceLifecycleEvents("domain-run")).rejects.toThrow(
        "Invalid durable categorical value"
      );
      await expect(corrupted.listWorkerSessionEvents("domain-run")).rejects.toThrow(
        "Invalid durable categorical value"
      );
      await expect(corrupted.listAttemptReceiptEvents("domain-run")).rejects.toThrow(
        "Invalid durable categorical value"
      );
    } finally {
      await corrupted.close();
    }

    const mutationStore = new SqliteWorkspaceLifecycleStore(path);
    try {
      await expect(
        mutationStore.transitionAttempt({
          runId: "domain-run",
          controller,
          expectedRunRevision: 0,
          mutationId: "domain-transition",
          now: "2026-07-11T12:00:04.000Z",
          attemptId: "domain-attempt",
          expectedAttemptRevision: 0,
          status: "cancelled",
        })
      ).resolves.toMatchObject({ updated: false, reason: "not_found" });
    } finally {
      await mutationStore.close();
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
