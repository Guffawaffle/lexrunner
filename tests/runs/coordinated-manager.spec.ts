import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcedureStateMachine } from "../../src/procedures/stateMachine.js";
import {
  CoordinatedRunManager,
  FileRunProjection,
  InvalidProcedureTransitionError,
  type RunProjection,
} from "../../src/runs/coordinated-manager.js";
import { getIndexPath, getRunStatePath, readIndex } from "../../src/runs/storage.js";
import type { RunState } from "../../src/runs/types.js";
import { InMemoryCoordinationStore } from "../../src/store/inmemory/coordination-store.js";
import { SqliteCoordinationStore } from "../../src/store/sqlite/coordination-store.js";

const T0 = "2026-07-11T12:00:00.000Z";
const T1 = "2026-07-11T12:00:01.000Z";
const T_EXPIRED = "2026-07-11T12:00:11.000Z";

const procedure = new ProcedureStateMachine({
  schemaVersion: "1.0.0",
  id: "test-procedure",
  name: "Test procedure",
  description: "A focused coordinated-run test procedure",
  states: ["planning", "working", "completed"],
  initialState: "planning",
  transitions: {
    planning: { START: "working" },
    working: { COMPLETE: "completed" },
    completed: {},
  },
});

function runState(runId = "run-1"): RunState {
  return {
    runId,
    mode: "senior-dev",
    procedure: procedure.id,
    repo: "owner/repo",
    task: "exercise fenced mutations",
    state: "planning",
    createdAt: T0,
    updatedAt: T0,
    completedSteps: [],
    currentStep: null,
    params: {},
    metadata: {},
  };
}

function resolver(id: string) {
  return Promise.resolve(id === procedure.id ? procedure : null);
}

function credential(acquired: Awaited<ReturnType<CoordinatedRunManager["acquireController"]>>) {
  if (!acquired.acquired) throw new Error("expected lease acquisition");
  return {
    runId: acquired.lease.runId,
    controllerId: acquired.lease.controllerId,
    leaseId: acquired.lease.leaseId,
    fencingToken: acquired.lease.fencingToken,
  };
}

describe("CoordinatedRunManager", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("rejects a stale expected revision without changing canonical state", async () => {
    const store = new InMemoryCoordinationStore();
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      projection: { project: async () => undefined },
    });
    const acquired = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });
    const lease = credential(acquired);

    const first = await manager.advance({
      ...lease,
      expectedRevision: 0,
      mutationId: "mutation-1",
      event: "START",
      now: T1,
    });
    expect(first.advanced).toBe(true);

    const stale = await manager.advance({
      ...lease,
      expectedRevision: 0,
      mutationId: "mutation-stale",
      event: "COMPLETE",
      now: "2026-07-11T12:00:02.000Z",
    });
    expect(stale).toEqual({
      advanced: false,
      reason: "stale_revision",
      currentRevision: 1,
    });
    expect((await manager.getCanonicalRun("run-1"))?.revision).toBe(1);
    expect((await manager.getCanonicalRun("run-1"))?.state).toMatchObject({
      schemaVersion: "1.0.0",
      run: { state: "working" },
    });
  });

  it("rejects a stale fence after an expired lease is taken over", async () => {
    const store = new InMemoryCoordinationStore();
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      projection: { project: async () => undefined },
    });
    const original = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });
    const replacement = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-b",
      leaseId: "lease-b",
      now: T_EXPIRED,
      ttlMs: 10_000,
      initialState: runState(),
    });
    expect(replacement.acquired && replacement.lease.fencingToken).toBe(2);

    const result = await manager.advance({
      ...credential(original),
      expectedRevision: 0,
      mutationId: "mutation-stale-fence",
      event: "START",
      now: "2026-07-11T12:00:12.000Z",
    });
    expect(result).toEqual({ advanced: false, reason: "stale_fence", currentRevision: 0 });
    expect((await manager.getCanonicalRun("run-1"))?.state).toMatchObject({
      run: { state: "planning" },
    });
  });

  it("rejects an invalid procedure event before attempting a CAS", async () => {
    const store = new InMemoryCoordinationStore();
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      projection: { project: async () => undefined },
    });
    const acquired = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });

    await expect(
      manager.advance({
        ...credential(acquired),
        expectedRevision: 0,
        mutationId: "mutation-invalid",
        event: "COMPLETE",
        now: T1,
      })
    ).rejects.toBeInstanceOf(InvalidProcedureTransitionError);
    expect((await manager.getCanonicalRun("run-1"))?.revision).toBe(0);
  });

  it("fails closed when canonical state is not a supported versioned envelope", async () => {
    const store = new InMemoryCoordinationStore();
    await store.acquireControllerLease({
      runId: "run-corrupt",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState("run-corrupt") as never,
    });
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
    });

    await expect(manager.getCanonicalRun("run-corrupt")).rejects.toThrow(
      "Invalid or unsupported coordinated run envelope"
    );
  });

  it("writes a successful CAS to the legacy run and index projections", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "lexrunner-coordinated-projection-"));
    cleanupPaths.push(baseDir);
    const store = new InMemoryCoordinationStore();
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      baseDir,
    });
    const acquired = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });

    const result = await manager.advance({
      ...credential(acquired),
      expectedRevision: 0,
      mutationId: "mutation-1",
      event: "START",
      now: T1,
    });

    expect(result.advanced && result.projection.status).toBe("written");
    expect(JSON.parse(readFileSync(getRunStatePath("run-1", baseDir), "utf8"))).toMatchObject({
      runId: "run-1",
      state: "working",
      updatedAt: T1,
    });
    expect(readIndex(baseDir).runs).toEqual([
      expect.objectContaining({ runId: "run-1", state: "working" }),
    ]);
  });

  it("keeps SQLite canonical when projection fails and rebuilds the projection later", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "lexrunner-coordinated-rebuild-"));
    cleanupPaths.push(baseDir);
    const databasePath = join(baseDir, "coordination.db");
    const store = new SqliteCoordinationStore(databasePath);
    let shouldFail = true;
    const fileProjection = new FileRunProjection(baseDir);
    const projection: RunProjection = {
      async project(run) {
        if (shouldFail) throw new Error("simulated projection outage");
        await fileProjection.project(run);
      },
    };
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      projection,
    });
    const acquired = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });

    const result = await manager.advance({
      ...credential(acquired),
      expectedRevision: 0,
      mutationId: "mutation-1",
      event: "START",
      now: T1,
    });
    expect(result.advanced).toBe(true);
    if (!result.advanced) throw new Error("expected advance");
    expect(result.projection.status).toBe("failed");
    expect((await store.getRunCoordination("run-1"))?.revision).toBe(1);
    expect((await store.getRunCoordination("run-1"))?.state).toMatchObject({
      run: { state: "working" },
    });

    shouldFail = false;
    await expect(manager.rebuildProjection("run-1")).resolves.toMatchObject({ rebuilt: true });
    expect(JSON.parse(readFileSync(getRunStatePath("run-1", baseDir), "utf8"))).toMatchObject({
      state: "working",
    });
    expect(readIndex(baseDir).runs[0]).toMatchObject({ runId: "run-1", state: "working" });

    // A lost/corruptible compatibility projection is reconstructible from SQLite.
    unlinkSync(getRunStatePath("run-1", baseDir));
    unlinkSync(getIndexPath(baseDir));
    await manager.rebuildProjection("run-1");
    expect(JSON.parse(readFileSync(getRunStatePath("run-1", baseDir), "utf8"))).toMatchObject({
      state: "working",
    });
    expect(readIndex(baseDir).runs[0]).toMatchObject({ runId: "run-1", state: "working" });
    await store.close();
  });

  it("replays the original mutation result after later revisions without regressing projection", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "lexrunner-coordinated-replay-"));
    cleanupPaths.push(baseDir);
    const store = new InMemoryCoordinationStore();
    const manager = new CoordinatedRunManager({
      coordinationStore: store,
      resolveProcedure: resolver,
      baseDir,
    });
    const acquired = await manager.acquireController({
      runId: "run-1",
      controllerId: "controller-a",
      leaseId: "lease-a",
      now: T0,
      ttlMs: 10_000,
      initialState: runState(),
    });
    const lease = credential(acquired);

    await manager.advance({
      ...lease,
      expectedRevision: 0,
      mutationId: "mutation-start",
      event: "START",
      now: T1,
    });
    await manager.advance({
      ...lease,
      expectedRevision: 1,
      mutationId: "mutation-complete",
      event: "COMPLETE",
      now: "2026-07-11T12:00:02.000Z",
    });

    const replay = await manager.advance({
      ...lease,
      expectedRevision: 0,
      mutationId: "mutation-start",
      event: "START",
      now: "2026-07-11T12:00:03.000Z",
    });
    expect(replay).toMatchObject({
      advanced: true,
      record: { revision: 1 },
      run: { state: "working" },
      projection: { status: "written" },
    });
    expect((await manager.getCanonicalRun("run-1"))?.revision).toBe(2);
    expect(JSON.parse(readFileSync(getRunStatePath("run-1", baseDir), "utf8"))).toMatchObject({
      state: "completed",
    });
  });
});
