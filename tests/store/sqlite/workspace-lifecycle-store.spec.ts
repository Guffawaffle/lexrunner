import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteWorkspaceLifecycleStore } from "../../../src/store/sqlite/workspace-lifecycle-store.js";
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
