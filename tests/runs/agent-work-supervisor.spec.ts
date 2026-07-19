import { describe, expect, it } from "vitest";

import type {
  AttemptRecord,
  WorkerSessionRecord,
  WorkspaceLifecycleLeaseRecord,
} from "../../src/store/workspace-lifecycle-store.js";
import {
  DEFAULT_HEADLESS_SUPERVISOR_CONFIG,
  planSupervisorAttempt,
  type SupervisorAttemptSnapshot,
} from "../../src/runs/agent-work-supervisor.js";

const config = {
  ...DEFAULT_HEADLESS_SUPERVISOR_CONFIG,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 8_000,
  maxAttemptsPerWorkItem: 3,
};

describe("headless supervisor reconciliation planner", () => {
  it.each([
    ["prepared", snapshot("prepared"), "await_workspace"],
    ["leased", snapshot("leased", { lease: lease() }), "await_launch"],
    ["launch interrupted", snapshot("launching", { lease: lease() }), "reconcile_launch"],
    [
      "launch ready",
      snapshot("launching", { lease: lease(), launch: launch(), packet: packet() }),
      "launch_worker",
    ],
    [
      "running",
      snapshot("running", { lease: lease(), session: session("running") }),
      "heartbeat_worker",
    ],
    [
      "completed observation",
      snapshot("running", { lease: lease(), session: session("completed") }),
      "collect_receipt",
    ],
    [
      "receipt submitted",
      snapshot("receipt_submitted", {
        lease: lease(),
        session: session("completed"),
        receipt: receipt(),
      }),
      "verify",
    ],
    [
      "verifying after restart",
      snapshot("verifying", {
        lease: lease(),
        session: session("completed"),
        receipt: receipt(),
      }),
      "verify",
    ],
    [
      "verified",
      snapshot("verified", {
        lease: lease(),
        session: session("completed"),
        receipt: receipt(),
        verification: verification(),
      }),
      "accept",
    ],
  ] as const)("maps the %s boundary to %s", (_name, state, expected) => {
    expect(planSupervisorAttempt(state, "2026-07-19T12:00:10.000Z", config).action).toBe(expected);
  });

  it("distinguishes heartbeat loss from an explicit cancellation", () => {
    const stale = snapshot("running", {
      lease: lease(),
      session: session("running", "2026-07-19T11:00:00.000Z"),
    });
    expect(planSupervisorAttempt(stale, "2026-07-19T12:00:10.000Z", config).action).toBe(
      "mark_worker_lost"
    );
    expect(planSupervisorAttempt(stale, "2026-07-19T12:00:10.000Z", config, true).action).toBe(
      "cancel_worker"
    );
    expect(
      planSupervisorAttempt(
        snapshot("leased", { lease: lease() }),
        "2026-07-19T12:00:10.000Z",
        config,
        true
      ).action
    ).toBe("cancel_attempt");
  });

  it("uses capped backoff, then requires a retry delta, then exhausts the attempt budget", () => {
    const failed = snapshot("failed", { attemptOrdinal: 2 });
    const duringBackoff = planSupervisorAttempt(failed, "2026-07-19T12:00:01.500Z", config);
    expect(duringBackoff).toMatchObject({
      action: "retry_backoff",
      nextEligibleAt: "2026-07-19T12:00:03.000Z",
    });
    expect(planSupervisorAttempt(failed, "2026-07-19T12:00:03.000Z", config)).toMatchObject({
      action: "await_retry_delta",
    });
    expect(
      planSupervisorAttempt(
        snapshot("failed", { attemptOrdinal: 3 }),
        "2026-07-19T12:00:30.000Z",
        config
      )
    ).toMatchObject({ action: "retry_exhausted" });
  });

  it("never schedules another attempt after accepted evidence", () => {
    expect(
      planSupervisorAttempt(
        snapshot("accepted", { attemptOrdinal: 1 }),
        "2026-07-19T12:00:30.000Z",
        config
      )
    ).toEqual({ attemptId: "attempt-1", action: "terminal", reason: "accepted" });
  });
});

function snapshot(
  status: AttemptRecord["status"],
  overrides: Partial<SupervisorAttemptSnapshot> = {}
): SupervisorAttemptSnapshot {
  return {
    attempt: attempt(status),
    lease: null,
    session: null,
    launch: null,
    packet: null,
    receipt: null,
    verification: null,
    attemptOrdinal: 1,
    ...overrides,
  };
}

function attempt(status: AttemptRecord["status"]): AttemptRecord {
  const terminal = [
    "accepted",
    "rejected",
    "inconclusive",
    "blocked",
    "launch_failed",
    "failed",
    "cancelled",
    "quarantined",
  ].includes(status);
  return {
    attemptId: "attempt-1",
    runId: "run-1",
    runRevision: 0,
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    baseSha: "a".repeat(40),
    revision: 2,
    status,
    workspaceLeaseId: status === "prepared" ? null : "lease-1",
    receiptId: ["receipt_submitted", "verifying", "verified", "accepted", "rejected"].includes(
      status
    )
      ? "receipt-1"
      : null,
    verificationId: ["verified", "accepted", "rejected"].includes(status) ? "verification-1" : null,
    createdAt: "2026-07-19T11:59:00.000Z",
    updatedAt: terminal ? "2026-07-19T12:00:01.000Z" : "2026-07-19T12:00:00.000Z",
    completedAt: terminal ? "2026-07-19T12:00:01.000Z" : null,
  };
}

function lease(): WorkspaceLifecycleLeaseRecord {
  return {
    leaseId: "lease-1",
    runId: "run-1",
    runRevision: 0,
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    attemptId: "attempt-1",
    revision: 0,
    controllerId: "controller-1",
    controllerLeaseId: "controller-lease-1",
    fencingToken: 1,
    repositoryId: "owner/repo",
    hostId: "host-1",
    gitRuntime: "git",
    projectRoot: "/repo",
    branch: "agent/work-1",
    worktreePath: "/repo/worktree",
    baseSha: "a".repeat(40),
    status: "active",
    acquiredAt: "2026-07-19T11:59:00.000Z",
    heartbeatAt: "2026-07-19T12:00:00.000Z",
    expiresAt: "2026-07-19T13:00:00.000Z",
  };
}

function session(
  status: WorkerSessionRecord["status"],
  heartbeatAt = "2026-07-19T12:00:00.000Z"
): WorkerSessionRecord {
  return {
    sessionId: "session-1",
    revision: 0,
    runId: "run-1",
    attemptId: "attempt-1",
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    workspaceLeaseId: "lease-1",
    workspaceLeaseRevision: 0,
    executionEnvelopeId: "envelope-1",
    executionEnvelopeHash: `sha256:${"b".repeat(64)}`,
    hostId: "host-1",
    workerRuntime: "fixture",
    gitRuntime: "git",
    backend: "codex-cli",
    workerId: "worker-1",
    status,
    startedAt: "2026-07-19T11:59:30.000Z",
    heartbeatAt,
    ...(["completed", "failed", "cancelled", "lost"].includes(status)
      ? { endedAt: "2026-07-19T12:00:01.000Z" }
      : {}),
  };
}

function launch() {
  return {
    runId: "run-1",
    attemptId: "attempt-1",
    workspaceLeaseId: "lease-1",
    attemptRevision: 2,
    workspaceLeaseRevision: 0,
    authorizationMutationId: "launch-1",
    envelopeId: "envelope-1",
    envelopeHash: `sha256:${"b".repeat(64)}`,
    envelopeJson: "{}",
    controllerId: "controller-1",
    controllerLeaseId: "controller-lease-1",
    fencingToken: 1,
    createdAt: "2026-07-19T12:00:00.000Z",
  };
}

function packet() {
  return {
    runId: "run-1",
    attemptId: "attempt-1",
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    packetJson: "{}",
    createdAt: "2026-07-19T12:00:00.000Z",
  };
}

function receipt() {
  return {
    receiptId: "receipt-1",
    receiptHash: `sha256:${"c".repeat(64)}`,
    receiptJson: "{}",
    runId: "run-1",
    workItemId: "work-1",
    workItemRevision: 1,
    attemptId: "attempt-1",
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    workspaceLeaseId: "lease-1",
    workspaceLeaseRevision: 0,
    workerSessionId: "session-1",
    workerSessionRevision: 1,
    workerRuntime: "fixture",
    observedBaseSha: "a".repeat(40),
    patchHash: `sha256:${"d".repeat(64)}`,
    outcome: "completed" as const,
    disposition: "verification_pending" as const,
    submittedAt: "2026-07-19T12:00:02.000Z",
    recordedAt: "2026-07-19T12:00:02.000Z",
    controllerId: "controller-1",
    controllerLeaseId: "controller-lease-1",
    fencingToken: 1,
    resultingAttemptRevision: 3,
    resultingAttemptStatus: "receipt_submitted" as const,
  };
}

function verification() {
  return {
    verificationId: "verification-1",
    verificationHash: `sha256:${"e".repeat(64)}`,
    verificationJson: "{}",
    runId: "run-1",
    workItemId: "work-1",
    workItemRevision: 1,
    attemptId: "attempt-1",
    packetId: "packet-1",
    packetHash: `sha256:${"a".repeat(64)}`,
    workspaceLeaseId: "lease-1",
    workspaceLeaseRevision: 0,
    workerSessionId: "session-1",
    workerSessionRevision: 1,
    receiptId: "receipt-1",
    receiptHash: `sha256:${"c".repeat(64)}`,
    observedBaseSha: "a".repeat(40),
    verifiedPatchHash: `sha256:${"d".repeat(64)}`,
    workspaceObservationHash: `sha256:${"f".repeat(64)}`,
    outcome: "pass" as const,
    trustGapReasons: [],
    verifierId: "fixture",
    verifierVersion: "1",
    startedAt: "2026-07-19T12:00:03.000Z",
    completedAt: "2026-07-19T12:00:04.000Z",
    recordedAt: "2026-07-19T12:00:04.000Z",
    controllerId: "controller-1",
    controllerLeaseId: "controller-lease-1",
    fencingToken: 1,
    resultingAttemptRevision: 5,
    resultingAttemptStatus: "verified" as const,
  };
}
