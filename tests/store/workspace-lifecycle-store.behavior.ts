import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ControllerLease,
  ControllerLeaseCredential,
} from "../../src/store/coordination-store.js";
import type {
  WorkspaceLifecycleStore,
  WorkspaceObservation,
} from "../../src/store/workspace-lifecycle-store.js";
import { toAttemptContract } from "../../src/store/workspace-lifecycle-store.js";

export interface WorkspaceLifecycleHarness extends WorkspaceLifecycleStore {
  acquireControllerLease(input: {
    runId: string;
    controllerId: string;
    leaseId: string;
    now: string;
    ttlMs: number;
    initialState: Record<string, never>;
  }): Promise<{ acquired: true; lease: ControllerLease } | { acquired: false }>;
  compareAndSetRunState(input: {
    runId: string;
    controllerId: string;
    leaseId: string;
    fencingToken: number;
    expectedRevision: number;
    mutationId: string;
    state: Record<string, string>;
    event: { type: string; payload: Record<string, string> };
    now: string;
  }): Promise<{ updated: boolean }>;
  close(): Promise<void>;
}

export interface WorkspaceLifecycleHarnessFactory {
  name: string;
  create(): Promise<WorkspaceLifecycleHarness>;
}

const T0 = "2026-07-11T12:00:00.000Z";
const T1 = "2026-07-11T12:00:01.000Z";
const T2 = "2026-07-11T12:00:02.000Z";
const T3 = "2026-07-11T12:00:03.000Z";
const T_LATE = "2026-07-11T12:00:11.000Z";

const identity = {
  repositoryId: "repo-1",
  hostId: "host-1",
  gitRuntime: "wsl-git",
  projectRoot: "/srv/repo",
  branch: "agent/work-1",
  worktreePath: "/srv/worktrees/work-1",
  attemptId: "attempt-1",
};

function observation(overrides: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
  return {
    ...identity,
    exists: true,
    registered: true,
    headSha: "a".repeat(40),
    cleanliness: "clean",
    ...overrides,
  };
}

function credential(lease: ControllerLease): ControllerLeaseCredential {
  return {
    runId: lease.runId,
    controllerId: lease.controllerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}

export function runWorkspaceLifecycleStoreBehaviorTests(
  factory: WorkspaceLifecycleHarnessFactory
): void {
  describe(`${factory.name} workspace lifecycle behavior`, () => {
    let store: WorkspaceLifecycleHarness;
    let controller: ControllerLeaseCredential;

    beforeEach(async () => {
      store = await factory.create();
      const acquired = await store.acquireControllerLease({
        runId: "run-1",
        controllerId: "controller-1",
        leaseId: "controller-lease-1",
        now: T0,
        ttlMs: 10_000,
        initialState: {},
      });
      if (!acquired.acquired) throw new Error("controller setup failed");
      controller = credential(acquired.lease);
    });

    afterEach(async () => store.close());

    async function createAttempt(attemptId = "attempt-1", workItemId = "work-1") {
      return store.createAttempt({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: `create-${attemptId}`,
        now: T0,
        attemptId,
        workItemId,
        workItemRevision: 7,
        packetId: "packet-1",
        packetHash: `sha256:${"b".repeat(64)}`,
        baseSha: "a".repeat(40),
      });
    }

    async function acquire(overrides: Record<string, unknown> = {}) {
      return store.acquireWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "acquire-1",
        now: T1,
        workspaceLeaseId: "workspace-lease-1",
        workItemId: "work-1",
        baseSha: "a".repeat(40),
        expectedAttemptRevision: 0,
        ttlMs: 5_000,
        ...identity,
        ...overrides,
      });
    }

    it("durably creates an attempt before reserving a workspace", async () => {
      const created = await createAttempt();
      expect(created).toMatchObject({
        updated: true,
        attempt: {
          status: "prepared",
          revision: 0,
          workItemRevision: 7,
          packetId: "packet-1",
          baseSha: "a".repeat(40),
          workspaceLeaseId: null,
          receiptId: null,
          verificationId: null,
        },
        workspaceLease: null,
        event: { type: "attempt_created", sequence: 1 },
      });
      if (!created.updated) throw new Error("attempt creation failed");
      expect(() => toAttemptContract(created.attempt)).not.toThrow();

      const reserved = await acquire();
      expect(reserved).toMatchObject({
        updated: true,
        attempt: { status: "leased", revision: 1 },
        workspaceLease: {
          status: "reserved",
          revision: 0,
          runRevision: 0,
          hostId: "host-1",
          workItemRevision: 7,
          packetId: "packet-1",
          packetHash: `sha256:${"b".repeat(64)}`,
        },
        event: { type: "workspace_acquired", sequence: 2 },
      });
      if (!reserved.updated) throw new Error("workspace reservation failed");
      expect(() => toAttemptContract(reserved.attempt)).not.toThrow();
    });

    it("allows a prepared attempt to be cancelled but not to skip into later terminal states", async () => {
      await createAttempt();
      for (const status of ["blocked", "launch_failed", "quarantined"] as const) {
        await expect(
          store.transitionAttempt({
            runId: "run-1",
            controller,
            expectedRunRevision: 0,
            mutationId: `prepared-${status}`,
            now: T1,
            attemptId: "attempt-1",
            expectedAttemptRevision: 0,
            status,
          })
        ).resolves.toMatchObject({ updated: false, reason: "invalid_attempt_transition" });
      }
      const cancelled = await store.transitionAttempt({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "prepared-cancelled",
        now: T1,
        attemptId: "attempt-1",
        expectedAttemptRevision: 0,
        status: "cancelled",
      });
      expect(cancelled).toMatchObject({
        updated: true,
        attempt: { status: "cancelled", revision: 1, completedAt: T1 },
      });
      if (!cancelled.updated) throw new Error("attempt cancellation failed");
      expect(() => toAttemptContract(cancelled.attempt)).not.toThrow();
    });

    it("authenticates every mutation against the authoritative controller fence", async () => {
      await expect(
        store.createAttempt({
          runId: "run-1",
          controller: { ...controller, fencingToken: controller.fencingToken + 1 },
          expectedRunRevision: 0,
          mutationId: "forged",
          now: T0,
          attemptId: "attempt-forged",
          workItemId: "work-forged",
          workItemRevision: 1,
          packetId: "packet-forged",
          packetHash: `sha256:${"c".repeat(64)}`,
          baseSha: "a".repeat(40),
        })
      ).resolves.toEqual({ updated: false, reason: "stale_fence" });
      expect(await store.getAttempt("attempt-forged")).toBeNull();
      expect(await store.listWorkspaceLifecycleEvents("run-1")).toEqual([]);
    });

    it("binds attempt creation to the expected canonical Run revision", async () => {
      await expect(
        store.createAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 1,
          mutationId: "stale-run",
          now: T0,
          attemptId: "attempt-stale",
          workItemId: "work-stale",
          workItemRevision: 1,
          packetId: "packet-stale",
          packetHash: `sha256:${"c".repeat(64)}`,
          baseSha: "a".repeat(40),
        })
      ).resolves.toEqual({
        updated: false,
        reason: "stale_run_revision",
        currentRunRevision: 0,
      });
      expect(await store.getAttempt("attempt-stale")).toBeNull();
    });

    it("rejects a stale expected Run revision after an authoritative Run CAS", async () => {
      await createAttempt();
      await expect(
        store.compareAndSetRunState({
          ...controller,
          expectedRevision: 0,
          mutationId: "advance-run",
          state: { phase: "planning" },
          event: { type: "run_advanced", payload: { phase: "planning" } },
          now: T1,
        })
      ).resolves.toMatchObject({ updated: true });

      await expect(acquire()).resolves.toEqual({
        updated: false,
        reason: "stale_run_revision",
        currentRunRevision: 1,
      });
      await expect(store.getWorkspaceLease("workspace-lease-1")).resolves.toBeNull();
    });

    it("makes exact mutation retries idempotent and rejects mutation-id conflicts", async () => {
      const first = await createAttempt();
      const retry = await createAttempt();
      expect(first.updated && first.idempotentReplay).toBe(false);
      expect(retry.updated && retry.idempotentReplay).toBe(true);
      expect(await store.listWorkspaceLifecycleEvents("run-1")).toHaveLength(1);

      await expect(
        store.createAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "create-attempt-1",
          now: T0,
          attemptId: "different",
          workItemId: "different",
          workItemRevision: 1,
          packetId: "different",
          packetHash: `sha256:${"d".repeat(64)}`,
          baseSha: "a".repeat(40),
        })
      ).resolves.toEqual({ updated: false, reason: "mutation_conflict" });
    });

    it("enforces live attempt, branch, and worktree uniqueness", async () => {
      await createAttempt();
      await acquire();
      await expect(createAttempt("attempt-2", "work-1")).resolves.toMatchObject({
        updated: false,
        reason: "live_attempt_conflict",
      });

      await createAttempt("attempt-2", "work-2");
      await expect(
        acquire({
          mutationId: "acquire-branch-conflict",
          attemptId: "attempt-2",
          workItemId: "work-2",
          workspaceLeaseId: "workspace-lease-2",
        })
      ).resolves.toMatchObject({ updated: false, reason: "branch_conflict" });
      await expect(
        acquire({
          mutationId: "acquire-tree-conflict",
          attemptId: "attempt-2",
          workItemId: "work-2",
          workspaceLeaseId: "workspace-lease-2",
          branch: "agent/work-2",
        })
      ).resolves.toMatchObject({ updated: false, reason: "worktree_conflict" });
      await expect(
        acquire({
          mutationId: "acquire-cross-repo-tree-conflict",
          attemptId: "attempt-2",
          workItemId: "work-2",
          workspaceLeaseId: "workspace-lease-2",
          repositoryId: "repo-2",
          branch: "agent/work-2",
        })
      ).resolves.toMatchObject({ updated: false, reason: "worktree_conflict" });
    });

    it("activates a reservation from observed registration and rejects stale revisions", async () => {
      await createAttempt();
      await acquire();
      const heartbeat = await store.heartbeatWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "heartbeat-1",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        ttlMs: 10_000,
        observation: observation({ cleanliness: "dirty", dirtyPaths: ["src/a.ts"] }),
      });
      expect(heartbeat).toMatchObject({
        updated: true,
        attempt: { revision: 2 },
        workspaceLease: {
          status: "active",
          revision: 1,
          lastObservation: { cleanliness: "dirty" },
        },
      });
      await expect(
        store.heartbeatWorkspace({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "heartbeat-stale",
          now: T3,
          attemptId: "attempt-1",
          workspaceLeaseId: "workspace-lease-1",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 1,
          ttlMs: 10_000,
          observation: observation(),
        })
      ).resolves.toMatchObject({ updated: false, reason: "stale_attempt_revision" });
    });

    it("replays an exact heartbeat idempotently and conflicts on changed retry input", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const heartbeat = {
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "heartbeat-retry",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        ttlMs: 10_000,
        observation: observation(),
      };

      const first = await store.heartbeatWorkspace(heartbeat);
      const retry = await store.heartbeatWorkspace(heartbeat);
      expect(first).toMatchObject({ updated: true, idempotentReplay: false });
      expect(retry).toEqual({ ...first, idempotentReplay: true });
      await expect(
        store.heartbeatWorkspace({
          ...heartbeat,
          observation: observation({ cleanliness: "dirty", dirtyPaths: ["changed.ts"] }),
        })
      ).resolves.toEqual({ updated: false, reason: "mutation_conflict" });
      await expect(store.listWorkspaceLifecycleEvents("run-1")).resolves.toHaveLength(3);
    });

    it("rejects an already-existing dirty workspace instead of implicitly adopting it", async () => {
      await createAttempt();
      await expect(
        acquire({
          observation: observation({ cleanliness: "dirty", dirtyPaths: ["unfinished.ts"] }),
        })
      ).resolves.toMatchObject({ updated: false, reason: "dirty_workspace" });
      await expect(store.getAttempt("attempt-1")).resolves.toMatchObject({
        revision: 0,
        status: "prepared",
        workspaceLeaseId: null,
      });
      await expect(store.getWorkspaceLease("workspace-lease-1")).resolves.toBeNull();
      await expect(store.listWorkspaceLifecycleEvents("run-1")).resolves.toHaveLength(1);
    });

    it("requires explicit reconciliation after a workspace lease expires", async () => {
      await createAttempt();
      await acquire({ ttlMs: 500, observation: observation() });
      await expect(
        store.heartbeatWorkspace({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "expired-heartbeat",
          now: T2,
          attemptId: "attempt-1",
          workspaceLeaseId: "workspace-lease-1",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          ttlMs: 10_000,
          observation: observation(),
        })
      ).resolves.toMatchObject({ updated: false, reason: "workspace_expired" });

      const reconciled = await store.reconcileWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "resume-expired",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        action: "resume",
        ttlMs: 10_000,
        observation: observation(),
      });
      expect(reconciled).toMatchObject({
        updated: true,
        workspaceLease: { status: "active", revision: 1, heartbeatAt: T2 },
        event: { type: "workspace_reconciled", payload: { action: "resume" } },
      });
    });

    it("requires explicit reconciliation when a new controller takes over", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const takeover = await store.acquireControllerLease({
        runId: "run-1",
        controllerId: "controller-2",
        leaseId: "controller-lease-2",
        now: T_LATE,
        ttlMs: 10_000,
        initialState: {},
      });
      if (!takeover.acquired) throw new Error("controller takeover failed");
      const replacement = credential(takeover.lease);

      const smuggledHeartbeat = {
        runId: "run-1",
        controller: replacement,
        expectedRunRevision: 0,
        mutationId: "takeover-smuggled-heartbeat",
        now: T_LATE,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        ttlMs: 10_000,
        observation: observation(),
        action: "resume",
      } as Parameters<WorkspaceLifecycleStore["heartbeatWorkspace"]>[0];
      await expect(store.heartbeatWorkspace(smuggledHeartbeat)).resolves.toMatchObject({
        updated: false,
        reason: "stale_fence",
      });

      await expect(
        store.heartbeatWorkspace({
          runId: "run-1",
          controller: replacement,
          expectedRunRevision: 0,
          mutationId: "takeover-heartbeat",
          now: T_LATE,
          attemptId: "attempt-1",
          workspaceLeaseId: "workspace-lease-1",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          ttlMs: 10_000,
          observation: observation(),
        })
      ).resolves.toMatchObject({ updated: false, reason: "stale_fence" });

      await expect(
        store.reconcileWorkspace({
          runId: "run-1",
          controller: replacement,
          expectedRunRevision: 0,
          mutationId: "takeover-reconcile",
          now: T_LATE,
          attemptId: "attempt-1",
          workspaceLeaseId: "workspace-lease-1",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          action: "resume",
          ttlMs: 10_000,
          observation: observation(),
        })
      ).resolves.toMatchObject({
        updated: true,
        workspaceLease: {
          controllerId: "controller-2",
          controllerLeaseId: "controller-lease-2",
          fencingToken: replacement.fencingToken,
        },
      });
    });

    it("quarantines an expired dirty workspace instead of resuming it", async () => {
      await createAttempt();
      await acquire({ ttlMs: 500, observation: observation() });
      const result = await store.reconcileWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "resume-expired-dirty",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        action: "resume",
        ttlMs: 10_000,
        observation: observation({ cleanliness: "dirty", dirtyPaths: ["unfinished.ts"] }),
      });
      expect(result).toMatchObject({
        updated: true,
        attempt: { status: "quarantined" },
        workspaceLease: { status: "quarantined", cleanupDisposition: "preserved" },
        event: { type: "workspace_quarantined", payload: { reason: "dirty_workspace" } },
      });
    });

    it("atomically quarantines dirty release and identity mismatch observations", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const result = await store.releaseWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "unsafe-release",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        disposition: "discarded",
        observation: observation({ cleanliness: "dirty", dirtyPaths: ["important.txt"] }),
      });
      expect(result).toMatchObject({
        updated: true,
        attempt: { status: "quarantined", revision: 2, completedAt: T2 },
        workspaceLease: {
          status: "quarantined",
          revision: 1,
          cleanupDisposition: "preserved",
        },
        event: { type: "workspace_quarantined", payload: { reason: "dirty_workspace" } },
      });
      if (!result.updated) throw new Error("workspace quarantine failed");
      expect(() => toAttemptContract(result.attempt)).not.toThrow();
      expect(await store.listWorkspaceLifecycleEvents("run-1")).toHaveLength(3);
    });

    it("quarantines an observed branch identity mismatch instead of adopting it", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const result = await store.heartbeatWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "mismatched-heartbeat",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        ttlMs: 10_000,
        observation: observation({ branch: "somebody-elses-branch" }),
      });
      expect(result).toMatchObject({
        updated: true,
        attempt: { status: "quarantined" },
        workspaceLease: { status: "quarantined" },
        event: { type: "workspace_quarantined", payload: { reason: "identity_mismatch" } },
      });
    });

    it("quarantines a missing worktree registration observation", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const result = await store.heartbeatWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "unregistered-heartbeat",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        ttlMs: 10_000,
        observation: observation({ registered: false, reason: "git worktree list missing" }),
      });
      expect(result).toMatchObject({
        updated: true,
        workspaceLease: { status: "quarantined", cleanupDisposition: "preserved" },
        event: { type: "workspace_quarantined", payload: { reason: "identity_mismatch" } },
      });
    });

    it("rejects backward heartbeats and illegal attempt transitions", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      await expect(
        store.heartbeatWorkspace({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "backward-heartbeat",
          now: T0,
          attemptId: "attempt-1",
          workspaceLeaseId: "workspace-lease-1",
          expectedAttemptRevision: 1,
          expectedWorkspaceLeaseRevision: 0,
          ttlMs: 10_000,
          observation: observation(),
        })
      ).resolves.toMatchObject({ updated: false, reason: "invalid_time" });
      await expect(
        store.transitionAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "skip-verification",
          now: T2,
          attemptId: "attempt-1",
          expectedAttemptRevision: 1,
          status: "accepted",
        })
      ).resolves.toMatchObject({ updated: false, reason: "invalid_attempt_transition" });
      await store.transitionAttempt({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "launch-for-backward-evidence",
        now: T2,
        attemptId: "attempt-1",
        expectedAttemptRevision: 1,
        status: "launching",
      });
      await store.transitionAttempt({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "run-for-backward-evidence",
        now: T2,
        attemptId: "attempt-1",
        expectedAttemptRevision: 2,
        status: "running",
      });
      await expect(
        store.transitionAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "backward-and-missing-evidence",
          now: T0,
          attemptId: "attempt-1",
          expectedAttemptRevision: 3,
          status: "receipt_submitted",
        })
      ).resolves.toMatchObject({ updated: false, reason: "invalid_time" });
      expect(await store.listWorkspaceLifecycleEvents("run-1")).toHaveLength(4);
    });

    it("binds receipt and verification evidence before terminal acceptance", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const transition = async (
        mutationId: string,
        expectedAttemptRevision: number,
        status: "launching" | "running" | "receipt_submitted" | "verifying" | "verified",
        evidence: { receiptId?: string; verificationId?: string } = {}
      ) =>
        store.transitionAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId,
          now: T2,
          attemptId: "attempt-1",
          expectedAttemptRevision,
          status,
          ...evidence,
        });

      expect(await transition("launch", 1, "launching")).toMatchObject({ updated: true });
      expect(await transition("run", 2, "running")).toMatchObject({ updated: true });
      expect(await transition("receipt-missing", 3, "receipt_submitted")).toMatchObject({
        updated: false,
        reason: "evidence_mismatch",
      });
      expect(
        await transition("receipt", 3, "receipt_submitted", { receiptId: "receipt-1" })
      ).toMatchObject({ updated: true, attempt: { receiptId: "receipt-1" } });
      expect(await transition("verify", 4, "verifying")).toMatchObject({ updated: true });
      expect(await transition("verified-missing", 5, "verified")).toMatchObject({
        updated: false,
        reason: "evidence_mismatch",
      });
      expect(
        await transition("verified", 5, "verified", { verificationId: "verification-1" })
      ).toMatchObject({
        updated: true,
        attempt: { receiptId: "receipt-1", verificationId: "verification-1" },
      });
    });

    it("releases a clean matching workspace with one authoritative event", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const released = await store.releaseWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "release-1",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        disposition: "integrated",
        observation: observation(),
      });
      expect(released).toMatchObject({
        updated: true,
        workspaceLease: {
          status: "released",
          cleanupDisposition: "integrated",
          revision: 1,
        },
        event: { type: "workspace_released", sequence: 3 },
      });
      expect(await store.listWorkspaceLifecycleEvents("run-1")).toHaveLength(3);
    });

    it("preserves dirty abandoned work but releases only clean matching work", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      const preserved = await store.reconcileWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "preserve-1",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        action: "preserve",
        observation: observation({ cleanliness: "dirty" }),
      });
      expect(preserved).toMatchObject({
        updated: true,
        workspaceLease: { status: "preserved", cleanupDisposition: "preserved" },
      });
    });

    it("does not launch an attempt after its workspace was released or preserved", async () => {
      await createAttempt();
      await acquire({ observation: observation() });
      await store.releaseWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "release-before-launch",
        now: T2,
        attemptId: "attempt-1",
        workspaceLeaseId: "workspace-lease-1",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        disposition: "discarded",
        observation: observation(),
      });
      await expect(
        store.transitionAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "launch-after-release",
          now: T3,
          attemptId: "attempt-1",
          expectedAttemptRevision: 2,
          status: "launching",
        })
      ).resolves.toMatchObject({ updated: false, reason: "workspace_not_active" });

      await createAttempt("attempt-2", "work-2");
      await acquire({
        mutationId: "acquire-2",
        attemptId: "attempt-2",
        workItemId: "work-2",
        workspaceLeaseId: "workspace-lease-2",
        branch: "agent/work-2",
        worktreePath: "/srv/worktrees/work-2",
        observation: observation({
          attemptId: "attempt-2",
          branch: "agent/work-2",
          worktreePath: "/srv/worktrees/work-2",
        }),
      });
      await store.reconcileWorkspace({
        runId: "run-1",
        controller,
        expectedRunRevision: 0,
        mutationId: "preserve-before-launch",
        now: T2,
        attemptId: "attempt-2",
        workspaceLeaseId: "workspace-lease-2",
        expectedAttemptRevision: 1,
        expectedWorkspaceLeaseRevision: 0,
        action: "preserve",
        observation: observation({
          attemptId: "attempt-2",
          branch: "agent/work-2",
          worktreePath: "/srv/worktrees/work-2",
          cleanliness: "dirty",
        }),
      });
      await expect(
        store.transitionAttempt({
          runId: "run-1",
          controller,
          expectedRunRevision: 0,
          mutationId: "launch-after-preserve",
          now: T3,
          attemptId: "attempt-2",
          expectedAttemptRevision: 2,
          status: "launching",
        })
      ).resolves.toMatchObject({ updated: false, reason: "workspace_not_active" });
    });
  });
}
