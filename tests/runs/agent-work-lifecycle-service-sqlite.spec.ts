import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentWorkLifecycleService,
  type StartAttemptInput,
} from "../../src/runs/agent-work-lifecycle-service.js";
import type { ControllerLeaseCredential } from "../../src/store/coordination-store.js";
import { SqliteWorkspaceLifecycleStore } from "../../src/store/sqlite/workspace-lifecycle-store.js";
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
const T7 = "2026-07-11T20:00:07.000Z";

describe("AgentWorkLifecycleService SQLite integration", () => {
  let sandbox: string;
  let databasePath: string;
  let store: SqliteWorkspaceLifecycleStore;
  let broker: GitWorktreeBroker;
  let service: AgentWorkLifecycleService;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "lexrunner-agent-work-lifecycle-"));
    databasePath = join(sandbox, "lifecycle.db");
    ({ store, broker, service } = ports(databasePath));
  });

  afterEach(async () => {
    await store.close();
    await rm(sandbox, { recursive: true, force: true });
  });

  it("persists the complete start sequence and exactly replays it", async () => {
    const input = startInput();

    const started = await service.startAttempt(input);

    expect(started).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      attempt: { status: "launching", revision: 3 },
      workspace: { status: "active", revision: 1 },
    });
    const before = await store.listWorkspaceLifecycleEvents("run-1");
    expect(before.map((event) => [event.type, event.mutationId])).toEqual([
      ["attempt_created", "create-attempt"],
      ["workspace_acquired", "reserve-workspace"],
      ["workspace_heartbeat", "activate-workspace"],
      ["attempt_transitioned", "authorize-launch"],
    ]);
    expect(broker.create).toHaveBeenCalledOnce();

    const replayed = await service.startAttempt(input);

    expect(replayed).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      idempotentReplay: true,
      attempt: { status: "launching", revision: 3 },
    });
    expect(await store.listWorkspaceLifecycleEvents("run-1")).toEqual(before);
    expect(broker.create).toHaveBeenCalledOnce();
  });

  it("continues from a durable reservation without duplicating its event", async () => {
    const input = startInput();
    const controller = await acquireController(store, input);
    await createAttempt(store, input, controller);
    const reserved = await store.acquireWorkspace({
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
    expect(reserved).toMatchObject({
      updated: true,
      attempt: { status: "leased" },
      workspaceLease: { status: "reserved" },
    });

    const recovered = await service.startAttempt(input);

    expect(recovered).toMatchObject({
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

  it("requires a replacement controller to resume the clean workspace before launch", async () => {
    const original = startInput({ controllerTtlMs: 1_500 });
    const originalController = await acquireController(store, original);
    await createAttempt(store, original, originalController);
    const active = await store.acquireWorkspace({
      runId: original.runId,
      expectedRunRevision: 0,
      controller: originalController,
      attemptId: original.attempt.attemptId,
      expectedAttemptRevision: 0,
      workspaceLeaseId: original.workspace.workspaceLeaseId,
      workItemId: original.attempt.workItemId,
      baseSha: original.attempt.baseSha,
      repositoryId: original.workspace.repositoryId,
      hostId: original.workspace.hostId,
      gitRuntime: original.workspace.gitRuntime,
      projectRoot: original.workspace.projectRoot,
      branch: original.workspace.branch,
      worktreePath: original.workspace.worktreePath,
      ttlMs: 60_000,
      observation: observation(),
      mutationId: original.mutations.reserveWorkspace.mutationId,
      now: "2026-07-11T20:00:01.250Z",
    });
    expect(active).toMatchObject({ updated: true, workspaceLease: { status: "active" } });
    const takeover = startInput({
      controllerId: "controller-2",
      controllerLeaseId: "controller-lease-2",
      controllerNow: T2,
      mutationPrefix: "takeover-",
    });
    const replacement = await store.acquireControllerLease({
      runId: takeover.runId,
      ...takeover.controller,
      initialState: { schemaVersion: "1.0.0", run: takeover.initialRunState },
    });
    if (!replacement.acquired) throw new Error("replacement controller acquisition failed");
    await expect(
      store.transitionAttempt({
        runId: original.runId,
        expectedRunRevision: 0,
        controller: originalController,
        attemptId: original.attempt.attemptId,
        expectedAttemptRevision: 1,
        status: "launching",
        mutationId: "stale-controller-launch",
        now: "2026-07-11T20:00:02.500Z",
      })
    ).resolves.toMatchObject({ updated: false, reason: "stale_fence" });

    const resumed = await service.startAttempt(takeover);

    expect(resumed).toMatchObject({
      ok: true,
      outcome: "launch_authorized",
      controllerLease: { controllerId: "controller-2", fencingToken: 2 },
      attempt: { status: "launching" },
      workspace: { status: "active" },
    });
    expect(broker.create).not.toHaveBeenCalled();
    expect(broker.observe).toHaveBeenCalledOnce();
    expect((await store.listWorkspaceLifecycleEvents("run-1")).map((event) => event.type)).toEqual([
      "attempt_created",
      "workspace_acquired",
      "workspace_reconciled",
      "attempt_transitioned",
    ]);
  });

  it("reopens bounded status and keeps cross-run attempt reads isolated", async () => {
    const input = startInput();
    const started = await service.startAttempt(input);
    if (!started.ok) throw new Error("expected lifecycle start");
    const attempt = await store.getAttempt(input.attempt.attemptId);
    const lease = await store.getWorkspaceLease(input.workspace.workspaceLeaseId);
    if (!attempt || !lease) throw new Error("expected durable lifecycle records");
    await store.heartbeatWorkspace({
      runId: input.runId,
      expectedRunRevision: 0,
      controller: credential(started.controllerLease),
      attemptId: attempt.attemptId,
      workspaceLeaseId: lease.leaseId,
      expectedAttemptRevision: attempt.revision,
      expectedWorkspaceLeaseRevision: lease.revision,
      ttlMs: 60_000,
      mutationId: "dirty-heartbeat",
      now: T7,
      observation: observation({
        cleanliness: "dirty",
        dirtyPaths: Array.from({ length: 300 }, (_, index) => `private-${index}`),
        reason: "é".repeat(2_000),
      }),
    });
    await store.close();

    ({ store, broker, service } = ports(databasePath));
    const status = await service.getStatus({ runId: "run-1", attemptId: "attempt-1" });
    expect(status).toMatchObject({
      run: { runId: "run-1" },
      attempt: { attemptId: "attempt-1", status: "launching" },
      workspace: { observation: { dirtyPathCount: 300 } },
    });
    expect(
      Buffer.byteLength(status.workspace?.observation?.reason ?? "", "utf8")
    ).toBeLessThanOrEqual(1_024);
    expect(JSON.stringify(status)).not.toContain("private-0");

    const other = startInput({
      runId: "run-2",
      attemptId: "attempt-2",
      workItemId: "work-2",
      workspaceLeaseId: "workspace-2",
      controllerId: "controller-other",
      controllerLeaseId: "controller-lease-other",
      mutationPrefix: "other-",
    });
    const otherController = await acquireController(store, other);
    await createAttempt(store, other, otherController);

    const isolated = await service.getStatus({ runId: "run-1", attemptId: "attempt-2" });
    expect(isolated.run).toMatchObject({ runId: "run-1" });
    expect(isolated.attempt).toBeNull();
    expect(isolated.workspace).toBeNull();
  });
});

function ports(databasePath: string): {
  store: SqliteWorkspaceLifecycleStore;
  broker: GitWorktreeBroker;
  service: AgentWorkLifecycleService;
} {
  const store = new SqliteWorkspaceLifecycleStore(databasePath);
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

async function acquireController(
  store: SqliteWorkspaceLifecycleStore,
  input: StartAttemptInput
): Promise<ControllerLeaseCredential> {
  const result = await store.acquireControllerLease({
    runId: input.runId,
    ...input.controller,
    initialState: { schemaVersion: "1.0.0", run: input.initialRunState },
  });
  if (!result.acquired) throw new Error("controller acquisition failed");
  return credential(result.lease);
}

async function createAttempt(
  store: SqliteWorkspaceLifecycleStore,
  input: StartAttemptInput,
  controller: ControllerLeaseCredential
): Promise<void> {
  const result = await store.createAttempt({
    runId: input.runId,
    expectedRunRevision: 0,
    controller,
    ...input.attempt,
    ...input.mutations.createAttempt,
  });
  if (!result.updated) throw new Error(`attempt creation failed: ${result.reason}`);
}

interface StartOverrides {
  runId?: string;
  attemptId?: string;
  workItemId?: string;
  workspaceLeaseId?: string;
  controllerId?: string;
  controllerLeaseId?: string;
  controllerNow?: string;
  controllerTtlMs?: number;
  mutationPrefix?: string;
}

function startInput(overrides: StartOverrides = {}): StartAttemptInput {
  const runId = overrides.runId ?? "run-1";
  const attemptId = overrides.attemptId ?? "attempt-1";
  const prefix = overrides.mutationPrefix ?? "";
  return {
    runId,
    initialRunState: {
      runId,
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
    },
    controller: {
      controllerId: overrides.controllerId ?? "controller-1",
      leaseId: overrides.controllerLeaseId ?? "controller-lease-1",
      now: overrides.controllerNow ?? T0,
      ttlMs: overrides.controllerTtlMs ?? 60_000,
    },
    attempt: {
      attemptId,
      workItemId: overrides.workItemId ?? "work-1",
      workItemRevision: 2,
      packetId: `packet-${attemptId}`,
      packetHash: `sha256:${"a".repeat(64)}`,
      baseSha: "a".repeat(40),
    },
    workspace: {
      workspaceLeaseId: overrides.workspaceLeaseId ?? "workspace-1",
      repositoryId: "repo-1",
      hostId: "host-1",
      gitRuntime: "linux",
      projectRoot: "/repo",
      branch: "lexrunner/attempt-1",
      worktreePath: "/worktrees/attempt-1",
      ttlMs: 60_000,
    },
    mutations: {
      createAttempt: { mutationId: `${prefix}create-attempt`, now: T1 },
      reserveWorkspace: { mutationId: `${prefix}reserve-workspace`, now: T2 },
      activateWorkspace: { mutationId: `${prefix}activate-workspace`, now: T3 },
      resumeWorkspace: { mutationId: `${prefix}resume-workspace`, now: T3 },
      quarantineWorkspace: { mutationId: `${prefix}quarantine-workspace`, now: T4 },
      authorizeLaunch: { mutationId: `${prefix}authorize-launch`, now: T5 },
    },
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
