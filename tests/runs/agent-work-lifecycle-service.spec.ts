import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  AgentWorkLifecycleService,
  type StartAttemptInput,
} from "../../src/runs/agent-work-lifecycle-service.js";
import type { RunState } from "../../src/runs/types.js";
import { InMemoryWorkspaceLifecycleStore } from "../../src/store/inmemory/workspace-lifecycle-store.js";
import type { ControllerLeaseCredential } from "../../src/store/coordination-store.js";
import type { WorkspaceObservation } from "../../src/store/workspace-lifecycle-store.js";
import type { GitWorktreeBroker } from "../../src/workspaces/git-worktree-broker.js";
import { WorkspaceCoordinator } from "../../src/workspaces/workspace-coordinator.js";

const T0 = "2026-07-11T20:00:00.000Z";
const T1 = "2026-07-11T20:00:01.000Z";
const T2 = "2026-07-11T20:00:02.000Z";
const T3 = "2026-07-11T20:00:03.000Z";
const T4 = "2026-07-11T20:00:04.000Z";
const T5 = "2026-07-11T20:00:05.000Z";
const T6 = "2026-07-11T20:00:06.000Z";

describe("AgentWorkLifecycleService", () => {
  it("owns the controller, attempt, active workspace, and launch sequence", async () => {
    const { store, broker, service } = ports();

    const result = await service.startAttempt(startInput());

    expect(result).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      run: { runId: "run-1", revision: 0, state: "planning" },
      attempt: { attemptId: "attempt-1", revision: 3, status: "launching" },
      workspace: { leaseId: "workspace-1", revision: 1, status: "active" },
    });
    expect(broker.create).toHaveBeenCalledOnce();
    expect((await store.listWorkspaceLifecycleEvents("run-1")).map((event) => event.type)).toEqual([
      "attempt_created",
      "workspace_acquired",
      "workspace_heartbeat",
      "attempt_transitioned",
    ]);
  });

  it("replays a completed start without repeating the Git side effect or events", async () => {
    const { store, broker, service } = ports();
    const input = startInput();
    await service.startAttempt(input);
    const before = await store.listWorkspaceLifecycleEvents("run-1");
    const transition = vi.spyOn(store, "transitionAttempt");

    const replay = await service.startAttempt(input);

    expect(replay).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      idempotentReplay: true,
      attempt: { status: "launching", revision: 3 },
    });
    expect(broker.create).toHaveBeenCalledOnce();
    expect(transition).not.toHaveBeenCalled();
    expect(await store.listWorkspaceLifecycleEvents("run-1")).toEqual(before);
  });

  it("rejects a launch replay event that is not bound to the exact Attempt", async () => {
    const { store, service } = ports();
    const input = startInput();
    const started = await service.startAttempt(input);
    if (!started.ok) throw new Error("expected initial launch");
    const events = await store.listWorkspaceLifecycleEvents("run-1");
    vi.spyOn(store, "listWorkspaceLifecycleEvents").mockResolvedValue(
      events.map((event) =>
        event.mutationId === input.mutations.authorizeLaunch.mutationId
          ? { ...event, attemptId: "attempt-collision", payload: { status: "running" } }
          : event
      )
    );

    const replay = await service.startAttempt(input);

    expect(replay).toMatchObject({
      ok: false,
      phase: "launch_authorize",
      reason: "reconciliation_required",
    });
  });

  it("does not steal an already-launched workspace during controller takeover", async () => {
    const { store, broker, service } = ports();
    const input = startInput();
    const started = await service.startAttempt(input);
    if (!started.ok) throw new Error("expected initial launch");
    const takeover: StartAttemptInput = {
      ...input,
      controller: {
        controllerId: "controller-2",
        leaseId: "controller-lease-2",
        now: "2026-07-11T20:01:01.000Z",
        ttlMs: 60_000,
      },
      mutations: {
        ...input.mutations,
        resumeWorkspace: {
          mutationId: "resume-after-launch",
          now: "2026-07-11T20:01:02.000Z",
        },
        authorizeLaunch: {
          mutationId: "authorize-after-launch",
          now: "2026-07-11T20:01:03.000Z",
        },
      },
    };

    const result = await service.startAttempt(takeover);

    expect(result).toMatchObject({
      ok: false,
      phase: "workspace_resume",
      reason: "reconciliation_required",
      status: { attempt: { status: "launching" } },
    });
    expect(broker.observe).not.toHaveBeenCalled();
    expect(await store.getWorkspaceLease("workspace-1")).toMatchObject({
      controllerId: "controller-1",
      controllerLeaseId: "controller-lease-1",
      fencingToken: 1,
    });
  });

  it("continues a crash-after-reserve retry through activation and launch", async () => {
    const { store, broker, service } = ports();
    const input = startInput();
    const acquired = await store.acquireControllerLease({
      runId: input.runId,
      ...input.controller,
      initialState: { schemaVersion: "1.0.0", run: input.initialRunState },
    });
    if (!acquired.acquired) throw new Error("expected controller lease");
    const controller = credential(acquired.lease);
    await store.createAttempt({
      runId: input.runId,
      expectedRunRevision: 0,
      controller,
      ...input.attempt,
      ...input.mutations.createAttempt,
    });
    await store.acquireWorkspace({
      runId: input.runId,
      expectedRunRevision: 0,
      controller,
      attemptId: input.attempt.attemptId,
      expectedAttemptRevision: 0,
      workspaceLeaseId: input.workspace.workspaceLeaseId,
      workItemId: input.attempt.workItemId,
      baseSha: input.attempt.baseSha,
      repositoryId: input.workspace.repositoryId,
      hostId: input.workspace.hostId,
      gitRuntime: input.workspace.gitRuntime,
      projectRoot: input.workspace.projectRoot,
      branch: input.workspace.branch,
      worktreePath: input.workspace.worktreePath,
      ttlMs: input.workspace.ttlMs,
      ...input.mutations.reserveWorkspace,
    });

    const result = await service.startAttempt(input);

    expect(result).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      attempt: { status: "launching" },
      workspace: { status: "active" },
    });
    expect(broker.create).toHaveBeenCalledOnce();
    expect((await store.listWorkspaceLifecycleEvents("run-1")).map((event) => event.type)).toEqual([
      "attempt_created",
      "workspace_acquired",
      "workspace_heartbeat",
      "attempt_transitioned",
    ]);
  });

  it("takes over an exact active leased workspace before authorizing launch", async () => {
    const { store, broker, service } = ports();
    const input = startInput();
    const acquired = await store.acquireControllerLease({
      runId: input.runId,
      ...input.controller,
      initialState: { schemaVersion: "1.0.0", run: input.initialRunState },
    });
    if (!acquired.acquired) throw new Error("expected controller lease");
    const controller = credential(acquired.lease);
    await store.createAttempt({
      runId: input.runId,
      expectedRunRevision: 0,
      controller,
      ...input.attempt,
      ...input.mutations.createAttempt,
    });
    const coordinator = new WorkspaceCoordinator(store, broker);
    await coordinator.allocate({
      runId: input.runId,
      expectedRunRevision: 0,
      controller,
      reservation: {
        ...input.workspace,
        ...input.attempt,
        expectedAttemptRevision: 0,
      },
      ttlMs: input.workspace.ttlMs,
      mutations: {
        reserve: input.mutations.reserveWorkspace,
        activate: input.mutations.activateWorkspace,
        quarantine: input.mutations.quarantineWorkspace,
      },
    });
    const takeover: StartAttemptInput = {
      ...input,
      controller: {
        controllerId: "controller-2",
        leaseId: "controller-lease-2",
        now: "2026-07-11T20:01:01.000Z",
        ttlMs: 60_000,
      },
      mutations: {
        ...input.mutations,
        resumeWorkspace: {
          mutationId: "resume-workspace-takeover",
          now: "2026-07-11T20:01:02.000Z",
        },
        authorizeLaunch: {
          mutationId: "authorize-launch-takeover",
          now: "2026-07-11T20:01:03.000Z",
        },
      },
    };

    const result = await service.startAttempt(takeover);

    expect(result).toMatchObject({
      ok: true,
      controllerLease: { controllerId: "controller-2", fencingToken: 2 },
      attempt: { status: "launching" },
      workspace: { status: "active" },
    });
    expect(broker.observe).toHaveBeenCalledOnce();
  });

  it("returns bounded JSON-safe status without leaking dirty path names", async () => {
    const { store, service } = ports();
    const input = startInput();
    const started = await service.startAttempt(input);
    if (!started.ok) throw new Error("expected start success");
    const controller = credential(started.controllerLease);
    const attempt = await store.getAttempt("attempt-1");
    const lease = await store.getWorkspaceLease("workspace-1");
    if (!attempt || !lease) throw new Error("expected durable records");
    await store.heartbeatWorkspace({
      runId: "run-1",
      expectedRunRevision: 0,
      controller,
      attemptId: attempt.attemptId,
      workspaceLeaseId: lease.leaseId,
      expectedAttemptRevision: attempt.revision,
      expectedWorkspaceLeaseRevision: lease.revision,
      ttlMs: 60_000,
      mutationId: "dirty-heartbeat",
      now: "2026-07-11T20:00:07.000Z",
      observation: observation({
        cleanliness: "dirty",
        dirtyPaths: Array.from({ length: 300 }, (_, index) => `secret-${index}`),
        reason: "é".repeat(2_000),
      }),
    });

    const status = await service.getStatus({ runId: "run-1", attemptId: "attempt-1" });

    expect(status.workspace?.observation).toMatchObject({
      cleanliness: "dirty",
      dirtyPathCount: 300,
    });
    expect(
      Buffer.byteLength(status.workspace?.observation?.reason ?? "", "utf8")
    ).toBeLessThanOrEqual(1_024);
    expect(JSON.stringify(status)).not.toContain("secret-0");
    expect(() => JSON.stringify(status)).not.toThrow();
  });

  it("rejects a retry whose requested workspace identity changed", async () => {
    const { service } = ports();
    const input = startInput();
    await service.startAttempt(input);

    const result = await service.startAttempt({
      ...input,
      workspace: { ...input.workspace, branch: "lexrunner/other-attempt" },
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "workspace_allocate",
      reason: "identity_mismatch",
      reconciliationRequired: true,
    });
  });

  it("converts thrown port failures into a discriminated bounded result", async () => {
    const { store, broker } = ports();
    vi.spyOn(store, "acquireControllerLease").mockRejectedValueOnce(
      new Error("database unavailable " + "x".repeat(5_000))
    );
    vi.spyOn(store, "getRunCoordination").mockRejectedValue(new Error("still unavailable"));
    const service = new AgentWorkLifecycleService(
      store,
      store,
      new WorkspaceCoordinator(store, broker)
    );

    const result = await service.startAttempt(startInput());

    expect(result).toEqual({
      ok: false,
      phase: "controller",
      reason: "reconciliation_required",
      reconciliationRequired: true,
      status: { run: null, attempt: null, workspace: null },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("does not combine an Attempt from another Run into status", async () => {
    const { store, service } = ports();
    const acquired = await store.acquireControllerLease({
      runId: "run-2",
      controllerId: "controller-2",
      leaseId: "controller-lease-2",
      now: T0,
      ttlMs: 60_000,
      initialState: { schemaVersion: "1.0.0", run: { ...runState(), runId: "run-2" } },
    });
    if (!acquired.acquired) throw new Error("expected controller lease");
    await store.createAttempt({
      runId: "run-2",
      expectedRunRevision: 0,
      controller: credential(acquired.lease),
      ...startInput().attempt,
      attemptId: "attempt-2",
      mutationId: "create-attempt-2",
      now: T1,
    });

    const status = await service.getStatus({ runId: "run-1", attemptId: "attempt-2" });

    expect(status).toEqual({ run: null, attempt: null, workspace: null });
  });
});

function ports() {
  const store = new InMemoryWorkspaceLifecycleStore();
  const broker: GitWorktreeBroker = {
    create: vi.fn(async () => ({
      ok: true as const,
      outcome: "created" as const,
      observation: observation(),
    })),
    observe: vi.fn(async () => ({ ok: true as const, observation: observation() })),
    remove: vi.fn(async () => ({
      ok: true as const,
      outcome: "removed" as const,
      observation: observation({ exists: false, registered: false }),
    })),
  };
  return {
    store,
    broker,
    service: new AgentWorkLifecycleService(store, store, new WorkspaceCoordinator(store, broker)),
  };
}

function startInput(): StartAttemptInput {
  return {
    runId: "run-1",
    initialRunState: runState(),
    controller: {
      controllerId: "controller-1",
      leaseId: "controller-lease-1",
      now: T0,
      ttlMs: 60_000,
    },
    attempt: {
      attemptId: "attempt-1",
      workItemId: "work-1",
      workItemRevision: 2,
      packetId: "packet-1",
      packetHash: "sha256:" + "a".repeat(64),
      baseSha: "a".repeat(40),
    },
    workspace: {
      workspaceLeaseId: "workspace-1",
      repositoryId: "repo-1",
      hostId: "host-1",
      gitRuntime: "linux",
      projectRoot: "/repo",
      branch: "lexrunner/attempt-1",
      worktreePath: "/worktrees/attempt-1",
      ttlMs: 60_000,
    },
    mutations: {
      createAttempt: { mutationId: "create-attempt", now: T1 },
      reserveWorkspace: { mutationId: "reserve-workspace", now: T2 },
      activateWorkspace: { mutationId: "activate-workspace", now: T3 },
      resumeWorkspace: { mutationId: "resume-workspace", now: T4 },
      quarantineWorkspace: { mutationId: "quarantine-workspace", now: T5 },
      authorizeLaunch: { mutationId: "authorize-launch", now: T6 },
    },
  };
}

function runState(): RunState {
  return {
    runId: "run-1",
    mode: "senior-dev",
    procedure: "agent-work",
    repo: "owner/repo",
    task: "test lifecycle",
    state: "planning",
    createdAt: T0,
    updatedAt: T0,
    completedSteps: [],
    currentStep: null,
    params: {},
    metadata: {},
  };
}

function observation(overrides: Partial<WorkspaceObservation> = {}): WorkspaceObservation {
  return {
    exists: true,
    registered: true,
    repositoryId: "repo-1",
    hostId: "host-1",
    gitRuntime: "linux",
    projectRoot: "/repo",
    branch: "lexrunner/attempt-1",
    worktreePath: "/worktrees/attempt-1",
    attemptId: "attempt-1",
    headSha: "a".repeat(40),
    cleanliness: "clean",
    ...overrides,
  };
}

function credential(lease: {
  runId: string;
  controllerId: string;
  leaseId: string;
  fencingToken: number;
}): ControllerLeaseCredential {
  return {
    runId: lease.runId,
    controllerId: lease.controllerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}
