import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ATTEMPT_AWAITABLE_CONTRACT_VERSION,
  AttemptAwaitableTerminalResult_v1,
  ExternalAwaitableDescriptor_v1,
} from "../../src/runs/attempt-awaitable-contract.js";
import { createAgentTaskPacket } from "../../src/schemas/agent-work.js";
import { createNativeExecutionPathMapping } from "../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import type { ControllerLeaseCredential } from "../../src/store/coordination-store.js";
import type { AttemptAwaitableStore } from "../../src/store/attempt-awaitable-store.js";
import { InMemoryAttemptAwaitableStore } from "../../src/store/inmemory/attempt-awaitable-store.js";
import { SqliteAttemptAwaitableStore } from "../../src/store/sqlite/attempt-awaitable-store.js";
import type {
  LaunchEnvelopeBindingStore,
  WorkerSessionStore,
  WorkspaceLifecycleStore,
} from "../../src/store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";

const T0 = "2026-08-12T12:00:00.000Z";
const T1 = "2026-08-12T12:00:01.000Z";
const T2 = "2026-08-12T12:00:02.000Z";
const T3 = "2026-08-12T12:00:03.000Z";
const T4 = "2026-08-12T12:00:04.000Z";
const directories: string[] = [];

type Harness = AttemptAwaitableStore &
  WorkspaceLifecycleStore &
  LaunchEnvelopeBindingStore &
  WorkerSessionStore & {
    acquireControllerLease(input: {
      runId: string;
      controllerId: string;
      leaseId: string;
      now: string;
      ttlMs: number;
      initialState: Record<string, never>;
    }): Promise<
      | {
          acquired: true;
          lease: {
            runId: string;
            controllerId: string;
            leaseId: string;
            fencingToken: number;
          };
        }
      | { acquired: false }
    >;
    close(): Promise<void>;
  };

const factories: Array<{ name: string; create(): Promise<Harness> }> = [
  {
    name: "in-memory",
    async create() {
      return new InMemoryAttemptAwaitableStore();
    },
  },
  {
    name: "SQLite",
    async create() {
      const directory = await mkdtemp(join(tmpdir(), "lexrunner-awaitable-store-"));
      directories.push(directory);
      return new SqliteAttemptAwaitableStore(join(directory, "store.db"));
    },
  },
];

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

for (const factory of factories) {
  describe(`${factory.name} Attempt awaitable store`, () => {
    it("atomically latches a terminal result and delivers its stable completion", async () => {
      const store = await factory.create();
      try {
        await createLiveAttempt(store);
        const registered = await store.registerAttemptAwaitable({
          awaitableId: "awaitable-1",
          attemptId: "attempt-1",
          descriptor: descriptor(),
          deadlineAt: "2026-08-12T12:10:00.000Z",
          mutationId: "register-1",
          now: T0,
        });
        expect(registered).toMatchObject({ registered: true, idempotentReplay: false });
        const claim = await store.claimAttemptAwaitableObservation({
          awaitableId: "awaitable-1",
          expectedRevision: 0,
          observerId: "observer-1",
          leaseId: "lease-1",
          ttlMs: 30_000,
          mutationId: "claim-1",
          now: T1,
        });
        if (!claim.claimed) throw new Error(`claim failed: ${claim.reason}`);
        const completed = await store.completeAttemptAwaitable({
          awaitableId: "awaitable-1",
          expectedRevision: claim.record.revision,
          lease: credential(claim.lease),
          result: terminalResult("satisfied", T2),
          mutationId: "complete-1",
          now: T2,
        });
        expect(completed).toMatchObject({
          updated: true,
          record: {
            status: "satisfied",
            delivery: { status: "pending", attempt_count: 0 },
          },
        });
        if (!completed.updated || !completed.record.delivery) throw new Error("completion failed");
        expect(await store.listPendingAttemptAwaitableDeliveries()).toHaveLength(1);

        const begun = await store.beginAttemptAwaitableDelivery({
          awaitableId: "awaitable-1",
          expectedRevision: completed.record.revision,
          mutationId: "delivery-attempt-1",
          now: T3,
        });
        if (!begun.updated || !begun.record.delivery) throw new Error("delivery did not begin");
        const acknowledged = await store.acknowledgeAttemptAwaitableDelivery({
          awaitableId: "awaitable-1",
          expectedRevision: begun.record.revision,
          deliveryId: begun.record.delivery.delivery_id,
          completionHash: begun.record.delivery.completion_hash,
          mutationId: "delivery-ack-1",
          now: T4,
        });
        expect(acknowledged).toMatchObject({
          updated: true,
          record: { delivery: { status: "delivered", attempt_count: 1 } },
        });
        expect(await store.listPendingAttemptAwaitableDeliveries()).toHaveLength(0);
        expect(
          (await store.listAttemptAwaitableEvents("awaitable-1")).map((event) => event.type)
        ).toEqual([
          "awaitable_registered",
          "awaitable_observation_claimed",
          "awaitable_terminal_recorded",
          "awaitable_delivery_attempted",
          "awaitable_delivery_acknowledged",
        ]);
      } finally {
        await store.close();
      }
    });

    it("fences a stale observer after an expired lease is reclaimed", async () => {
      const store = await factory.create();
      try {
        await createLiveAttempt(store);
        await register(store, "awaitable-fenced");
        const first = await store.claimAttemptAwaitableObservation({
          awaitableId: "awaitable-fenced",
          expectedRevision: 0,
          observerId: "observer-1",
          leaseId: "lease-old",
          ttlMs: 1_000,
          mutationId: "claim-old",
          now: T1,
        });
        if (!first.claimed) throw new Error("first claim failed");
        expect(await store.listRecoverableAttemptAwaitables(T1)).toHaveLength(1);
        expect(await store.listRecoverableAttemptAwaitables(T2)).toHaveLength(1);
        const second = await store.claimAttemptAwaitableObservation({
          awaitableId: "awaitable-fenced",
          expectedRevision: first.record.revision,
          observerId: "observer-2",
          leaseId: "lease-new",
          ttlMs: 1_000,
          mutationId: "claim-new",
          now: T2,
        });
        if (!second.claimed) throw new Error("second claim failed");
        expect(second.lease.fencing_token).toBe(first.lease.fencing_token + 1);
        await expect(
          store.completeAttemptAwaitable({
            awaitableId: "awaitable-fenced",
            expectedRevision: second.record.revision,
            lease: credential(first.lease),
            result: terminalResult("satisfied", T3),
            mutationId: "stale-complete",
            now: T3,
          })
        ).resolves.toMatchObject({ updated: false, reason: "lease_mismatch" });
      } finally {
        await store.close();
      }
    });

    it("fails closed for a non-live target and credential-shaped descriptor fields", async () => {
      const store = await factory.create();
      try {
        await expect(
          store.registerAttemptAwaitable({
            awaitableId: "awaitable-orphan",
            attemptId: "missing-attempt",
            descriptor: descriptor(),
            deadlineAt: "2026-08-12T12:10:00.000Z",
            mutationId: "register-orphan",
            now: T0,
          })
        ).resolves.toEqual({ registered: false, reason: "attempt_not_live" });
        expect(() =>
          ExternalAwaitableDescriptor_v1.parse({
            ...descriptor(),
            subject: { ...descriptor().subject, token: "must-not-persist" },
          })
        ).toThrow();
        expect(() =>
          ExternalAwaitableDescriptor_v1.parse({
            ...descriptor(),
            condition: {
              type: "all-required-checks-terminal",
              requiredChecks: [{ source: "check-run", name: "Bearer must-not-persist" }],
            },
          })
        ).toThrow(/credential material/u);
        expect(() =>
          terminalResult("satisfied", T2, {
            ...requiredCheckEvidence("satisfied"),
            access_token: "must-not-persist",
          })
        ).toThrow();
        let deeplyNested: Record<string, unknown> = {};
        for (let depth = 0; depth < 30; depth += 1) deeplyNested = { nested: deeplyNested };
        expect(
          ExternalAwaitableDescriptor_v1.safeParse({
            ...descriptor(),
            subject: deeplyNested,
          }).success
        ).toBe(false);
      } finally {
        await store.close();
      }
    });

    it("rejects a terminal WorkerSession as a continuation target", async () => {
      const store = await factory.create();
      try {
        await createTerminalWorkerSession(store);
        await expect(
          store.registerAttemptAwaitable({
            awaitableId: "awaitable-terminal-session",
            attemptId: "attempt-1",
            workerSessionId: "worker-session-1",
            descriptor: descriptor(),
            deadlineAt: "2026-08-12T12:10:04.000Z",
            mutationId: "register-terminal-session",
            now: T4,
          })
        ).resolves.toEqual({ registered: false, reason: "target_mismatch" });
        await expect(store.getAttemptAwaitable("awaitable-terminal-session")).resolves.toBeNull();
      } finally {
        await store.close();
      }
    });

    it("does not partially register when the event mutation identity is invalid", async () => {
      const store = await factory.create();
      try {
        await createLiveAttempt(store);
        await expect(
          store.registerAttemptAwaitable({
            awaitableId: "awaitable-invalid-event",
            attemptId: "attempt-1",
            descriptor: descriptor(),
            deadlineAt: "2026-08-12T12:10:00.000Z",
            mutationId: "invalid mutation id",
            now: T0,
          })
        ).rejects.toThrow();
        await expect(store.getAttemptAwaitable("awaitable-invalid-event")).resolves.toBeNull();
      } finally {
        await store.close();
      }
    });

    it("can complete a maximum-length awaitable identity with bounded derived IDs", async () => {
      const store = await factory.create();
      try {
        await createLiveAttempt(store);
        const awaitableId = `a${"x".repeat(255)}`;
        await register(store, awaitableId);
        const claim = await store.claimAttemptAwaitableObservation({
          awaitableId,
          expectedRevision: 0,
          observerId: "observer-long-id",
          leaseId: "lease-long-id",
          ttlMs: 1_000,
          mutationId: "claim-long-id",
          now: T1,
        });
        if (!claim.claimed) throw new Error("claim failed");
        const completed = await store.completeAttemptAwaitable({
          awaitableId,
          expectedRevision: claim.record.revision,
          lease: credential(claim.lease),
          result: terminalResult("satisfied", T2),
          mutationId: "complete-long-id",
          now: T2,
        });
        expect(completed).toMatchObject({ updated: true });
        if (!completed.updated) throw new Error("completion failed");
        expect(completed.record.delivery?.delivery_id.length).toBeLessThanOrEqual(256);
      } finally {
        await store.close();
      }
    });
  });
}

describe("SQLite Attempt awaitable restart recovery", () => {
  it("recovers expired observation authority and a pending completion after reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-awaitable-restart-"));
    directories.push(directory);
    const path = join(directory, "store.db");
    const first = new SqliteAttemptAwaitableStore(path);
    await createLiveAttempt(first);
    await register(first, "awaitable-restart");
    const old = await first.claimAttemptAwaitableObservation({
      awaitableId: "awaitable-restart",
      expectedRevision: 0,
      observerId: "observer-old",
      leaseId: "lease-old",
      ttlMs: 1_000,
      mutationId: "claim-old",
      now: T1,
    });
    if (!old.claimed) throw new Error("old claim failed");
    await first.close();

    const second = new SqliteAttemptAwaitableStore(path);
    expect(await second.listRecoverableAttemptAwaitables(T2)).toHaveLength(1);
    const recovered = await second.claimAttemptAwaitableObservation({
      awaitableId: "awaitable-restart",
      expectedRevision: old.record.revision,
      observerId: "observer-new",
      leaseId: "lease-new",
      ttlMs: 1_000,
      mutationId: "claim-new",
      now: T2,
    });
    if (!recovered.claimed) throw new Error("recovery claim failed");
    const completed = await second.completeAttemptAwaitable({
      awaitableId: "awaitable-restart",
      expectedRevision: recovered.record.revision,
      lease: credential(recovered.lease),
      result: terminalResult("satisfied", T3),
      mutationId: "complete-new",
      now: T3,
    });
    expect(completed).toMatchObject({ updated: true });
    await second.close();

    const third = new SqliteAttemptAwaitableStore(path);
    expect(await third.listPendingAttemptAwaitableDeliveries()).toMatchObject([
      { awaitable_id: "awaitable-restart", delivery: { status: "pending" } },
    ]);
    await third.close();
  });
});

function descriptor() {
  return ExternalAwaitableDescriptor_v1.parse({
    schemaVersion: "axf/awaitable/v1",
    kind: "github.required-checks",
    subject: { repository: "owner/repo", headSha: "a".repeat(40) },
    condition: {
      type: "all-required-checks-terminal",
      requiredChecks: [{ source: "check-run", name: "Windows" }],
    },
  });
}

function terminalResult(
  outcome: "satisfied" | "terminal-failed",
  observedAt: string,
  evidence: unknown = requiredCheckEvidence(outcome)
) {
  return AttemptAwaitableTerminalResult_v1.parse({
    schema_version: ATTEMPT_AWAITABLE_CONTRACT_VERSION,
    provider: "github.required-checks",
    outcome,
    source: "observer",
    observed_at: observedAt,
    observer_result: {
      schemaVersion: "axf/await-result/v1",
      provider: "github.required-checks",
      outcome,
      terminal: true,
      durability: "process-bound",
      authorityModel: "host-provided",
      underlyingCancellation: false,
      effectiveDeadlineMs: 60_000,
      observationCount: 1,
      evidence,
    },
  });
}

function requiredCheckEvidence(outcome: "satisfied" | "terminal-failed") {
  return {
    repository: "owner/repo",
    headSha: "a".repeat(40),
    pullRequestNumber: null,
    requiredChecks: [
      {
        source: "check-run",
        name: "Windows",
        appSlug: null,
        state: "completed",
        conclusion: outcome === "satisfied" ? "success" : "failure",
        terminal: true,
        successful: outcome === "satisfied",
      },
    ],
  };
}

async function register(store: AttemptAwaitableStore, awaitableId: string): Promise<void> {
  const result = await store.registerAttemptAwaitable({
    awaitableId,
    attemptId: "attempt-1",
    descriptor: descriptor(),
    deadlineAt: "2026-08-12T12:10:00.000Z",
    mutationId: `register:${computeCanonicalHash(awaitableId)}`,
    now: T0,
  });
  if (!result.registered) throw new Error(`registration failed: ${result.reason}`);
}

async function createLiveAttempt(store: Harness): Promise<ControllerLeaseCredential> {
  const acquired = await store.acquireControllerLease({
    runId: "run-1",
    controllerId: "controller-1",
    leaseId: "controller-lease-1",
    now: T0,
    ttlMs: 60_000,
    initialState: {},
  });
  if (!acquired.acquired) throw new Error("controller setup failed");
  const controller: ControllerLeaseCredential = acquired.lease;
  const packet = taskPacket();
  const created = await store.createAttempt({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "create-attempt-1",
    now: T0,
    attemptId: "attempt-1",
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: packet.packet_hash,
    baseSha: "a".repeat(40),
  });
  if (!created.updated) throw new Error(`attempt setup failed: ${created.reason}`);
  return controller;
}

async function createTerminalWorkerSession(store: Harness): Promise<void> {
  const controller = await createLiveAttempt(store);
  const packet = taskPacket();
  const identity = {
    repositoryId: "repo-1",
    hostId: "host-1",
    gitRuntime: "wsl-git",
    projectRoot: "/srv/repo",
    branch: "agent/work-1",
    worktreePath: "/srv/worktrees/work-1",
    attemptId: "attempt-1",
  };
  const acquired = await store.acquireWorkspace({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "acquire-workspace-1",
    now: T1,
    workspaceLeaseId: "workspace-lease-1",
    workItemId: "work-1",
    baseSha: "a".repeat(40),
    expectedAttemptRevision: 0,
    ttlMs: 60_000,
    ...identity,
    observation: {
      ...identity,
      exists: true,
      registered: true,
      headSha: "a".repeat(40),
      cleanliness: "clean",
    },
  });
  if (!acquired.updated) throw new Error(`workspace setup failed: ${acquired.reason}`);
  const launching = await store.transitionAttempt({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "launch-attempt-1",
    now: T2,
    attemptId: "attempt-1",
    expectedAttemptRevision: 1,
    status: "launching",
  });
  if (!launching.updated) throw new Error(`launch setup failed: ${launching.reason}`);
  const envelope = {
    schema_version: "1.0.0" as const,
    envelope_id: "envelope-1",
    run_id: "run-1",
    attempt_id: "attempt-1",
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    workspace_lease_id: "workspace-lease-1",
    workspace_lease_revision: 0,
    expected_head_sha: "a".repeat(40),
    branch: "agent/work-1",
    runtime: {
      host_id: "host-1",
      os: "linux" as const,
      architecture: "x64",
      git_runtime: "wsl-git",
      worker_runtime: "codex-native",
    },
    paths: {
      project_root: "/srv/worktrees/work-1",
      execution_root: "/srv/worktrees/work-1",
      allocation_root: "/srv/worktrees",
      worktree_root: "/srv/worktrees/work-1",
    },
    path_mappings: [
      createNativeExecutionPathMapping({
        schema_version: "1.0.0",
        mapping_kind: "native_linux",
        repository_id: "repo-1",
        base_sha: "a".repeat(40),
        native_host_id: "host-1",
        git_runtime: "wsl-git",
        roots: {
          native_repository: verifiedRoot("/srv/repo", "11"),
          native_allocation_root: verifiedRoot("/srv/worktrees", "12"),
          native_worktree: verifiedRoot("/srv/worktrees/work-1", "13"),
        },
      }),
    ],
    exposed_environment_keys: [],
    created_at: T2,
  };
  const envelopeHash = computeCanonicalHash(envelope);
  const bound = await store.bindLaunchEnvelope({
    runId: "run-1",
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedRunRevision: 0,
    expectedAttemptRevision: 2,
    expectedWorkspaceLeaseRevision: 0,
    controller,
    authorizationMutationId: "launch-attempt-1",
    envelopeId: "envelope-1",
    envelopeHash,
    envelopeJson: canonicalJSONStringify(envelope),
    packetJson: canonicalJSONStringify(packet),
    createdAt: T2,
  });
  if (!bound.bound) throw new Error(`envelope setup failed: ${bound.reason}`);
  const attached = await store.attachWorkerSession({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "attach-worker-1",
    now: T3,
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedAttemptRevision: 2,
    expectedWorkspaceLeaseRevision: 0,
    sessionId: "worker-session-1",
    packetId: packet.packet_id,
    packetHash: packet.packet_hash,
    executionEnvelopeId: "envelope-1",
    executionEnvelopeHash: envelopeHash,
    hostId: "host-1",
    workerRuntime: "codex-native",
    gitRuntime: "wsl-git",
    backend: "host-subagent",
    workerId: "native-session-1",
    startedAt: T3,
  });
  if (!attached.updated) throw new Error(`worker setup failed: ${attached.reason}`);
  const ended = await store.endWorkerSession({
    runId: "run-1",
    controller,
    expectedRunRevision: 0,
    mutationId: "end-worker-1",
    now: T4,
    attemptId: "attempt-1",
    workspaceLeaseId: "workspace-lease-1",
    expectedAttemptRevision: 3,
    expectedWorkspaceLeaseRevision: 0,
    sessionId: "worker-session-1",
    expectedSessionRevision: 0,
    status: "completed",
    exitReason: "completed",
  });
  if (!ended.updated) throw new Error(`worker end failed: ${ended.reason}`);
}

function taskPacket() {
  return createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: "packet-1",
    run_id: "run-1",
    work_item: { work_item_id: "work-1", revision: 1 },
    attempt_id: "attempt-1",
    repository: { id: "repo-1", base_sha: "a".repeat(40) },
    objective: "Test a terminal continuation target",
    acceptance_criteria: [{ id: "criterion-1", text: "Target is validated" }],
    instructions: [],
    scope: { read_globs: ["src/**"], write_globs: [], deny_globs: [], cross_repo_allowed: false },
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
    created_at: T0,
  });
}

function verifiedRoot(path: string, inode: string) {
  return {
    runtime_id: "wsl-git",
    path,
    verification: "directory_identity" as const,
    directory_identity: { device: "1", inode },
  };
}

function credential(lease: { observer_id: string; lease_id: string; fencing_token: number }) {
  return {
    observerId: lease.observer_id,
    leaseId: lease.lease_id,
    fencingToken: lease.fencing_token,
  };
}
