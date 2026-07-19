import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AgentTaskReceiptOutcome as ContractReceiptOutcome,
  AttemptStatus as ContractAttemptStatus,
  VerificationOutcome as ContractVerificationOutcome,
  WorkerSessionBackend as ContractWorkerSessionBackend,
  WorkerSessionStatus as ContractWorkerSessionStatus,
  WorkspaceCleanupDisposition as ContractWorkspaceCleanupDisposition,
} from "../../src/schemas/agent-work.js";
import {
  ATTEMPT_TRANSITIONS,
  AgentTaskReceiptOutcome,
  AttemptReceiptFailureReason,
  AttemptReceiptDisposition,
  AttemptReceiptEventType,
  AttemptVerificationEventType,
  AttemptVerificationFailureReason,
  AttemptStatus,
  VerificationOutcome,
  EndWorkerSessionStatus,
  FinishedWorkspaceLeaseStatus,
  HeartbeatWorkerSessionStatus,
  ReleaseWorkspaceDisposition,
  WorkerSessionBackend,
  WorkerSessionEventType,
  WorkerSessionMutationFailureReason,
  WorkerSessionStatus,
  WorkerAuthorityDecision,
  WorkerAuthorityDimension,
  WorkerAuthorityEnforcement,
  WorkerAuthorityReason,
  WorkspaceCleanupDisposition,
  WorkspaceLifecycleEventType,
  WorkspaceLifecycleLeaseStatus,
  WorkspaceMutationFailureReason,
  WorkspaceObservation,
  WorkspaceObservationCleanliness,
  WorkspaceReconciliationAction,
  canTransitionAttempt,
} from "../../src/store/workspace-lifecycle-domains.js";

describe("workspace lifecycle categorical domains", () => {
  it("reuses canonical contract enums instead of hand-copying them", () => {
    expect(AttemptStatus).toBe(ContractAttemptStatus);
    expect(WorkerSessionBackend).toBe(ContractWorkerSessionBackend);
    expect(WorkerSessionStatus).toBe(ContractWorkerSessionStatus);
    expect(WorkspaceCleanupDisposition).toBe(ContractWorkspaceCleanupDisposition);
    expect(AgentTaskReceiptOutcome).toBe(ContractReceiptOutcome);
    expect(VerificationOutcome).toBe(ContractVerificationOutcome);
  });

  it("defines an exhaustive transition entry for every Attempt status", () => {
    expect(Object.keys(ATTEMPT_TRANSITIONS).sort()).toEqual([...AttemptStatus.options].sort());
    for (const [from, targets] of Object.entries(ATTEMPT_TRANSITIONS)) {
      expect(AttemptStatus.safeParse(from).success).toBe(true);
      for (const target of targets) {
        expect(AttemptStatus.safeParse(target).success).toBe(true);
        expect(canTransitionAttempt(AttemptStatus.parse(from), AttemptStatus.parse(target))).toBe(
          true
        );
      }
    }
  });

  it("validates store-local closed domains while retaining open runtime identifiers", () => {
    expect(WorkspaceLifecycleLeaseStatus.safeParse("invented").success).toBe(false);
    expect(WorkspaceLifecycleEventType.safeParse("invented").success).toBe(false);
    expect(WorkerSessionEventType.safeParse("invented").success).toBe(false);
    expect(AttemptReceiptDisposition.safeParse("invented").success).toBe(false);
    expect(AttemptReceiptEventType.safeParse("invented").success).toBe(false);
    expect(WorkspaceMutationFailureReason.safeParse("invented").success).toBe(false);
    expect(WorkerSessionMutationFailureReason.safeParse("receipt_conflict").success).toBe(false);
    expect(AttemptReceiptFailureReason.safeParse("worker_session_conflict").success).toBe(false);
    for (const reason of WorkspaceMutationFailureReason.options) {
      expect(WorkerSessionMutationFailureReason.safeParse(reason).success).toBe(true);
      expect(AttemptReceiptFailureReason.safeParse(reason).success).toBe(true);
    }
    expect(WorkspaceObservationCleanliness.safeParse("unknown").success).toBe(false);
    expect(ReleaseWorkspaceDisposition.safeParse("preserved").success).toBe(false);
    expect(WorkspaceReconciliationAction.safeParse("invented").success).toBe(false);
    expect(HeartbeatWorkerSessionStatus.safeParse("starting").success).toBe(false);
    expect(EndWorkerSessionStatus.safeParse("running").success).toBe(false);
    expect(FinishedWorkspaceLeaseStatus.safeParse("active").success).toBe(false);
    expect(
      WorkspaceObservation.safeParse({
        exists: true,
        registered: true,
        repositoryId: "owner/repo",
        hostId: "host",
        gitRuntime: "future-runtime-v9",
        projectRoot: "/repo",
        branch: "agent/work",
        worktreePath: "/trees/work",
        attemptId: "attempt",
        headSha: "a".repeat(40),
        cleanliness: "clean",
      }).success
    ).toBe(true);
  });

  it("keeps standalone migration constraints aligned with every closed domain", () => {
    const workspace = readFileSync(
      "src/store/sqlite/migrations/002-attempt-workspace-lifecycle.sql",
      "utf8"
    );
    const worker = readFileSync(
      "src/store/sqlite/migrations/003-worker-session-lifecycle.sql",
      "utf8"
    );
    const receipt = readFileSync(
      "src/store/sqlite/migrations/004-attempt-receipt-persistence.sql",
      "utf8"
    );
    const verification = readFileSync(
      "src/store/sqlite/migrations/006-attempt-engine-verification-persistence.sql",
      "utf8"
    );
    const authority = readFileSync(
      "src/store/sqlite/migrations/007-worker-authority-events.sql",
      "utf8"
    );

    expectTableContains(workspace, "attempts", AttemptStatus.options);
    expectTableContains(workspace, "workspace_leases", WorkspaceLifecycleLeaseStatus.options);
    expectTableContains(workspace, "workspace_leases", WorkspaceCleanupDisposition.options);
    expectTableContains(
      workspace,
      "workspace_lifecycle_events",
      WorkspaceLifecycleEventType.options
    );
    expectTableContains(worker, "worker_sessions", WorkerSessionBackend.options);
    expectTableContains(worker, "worker_sessions", WorkerSessionStatus.options);
    expectTableContains(worker, "worker_session_events", WorkerSessionEventType.options);
    expectTableContains(receipt, "attempt_receipts", AgentTaskReceiptOutcome.options);
    expectTableContains(receipt, "attempt_receipts", AttemptReceiptDisposition.options);
    expectTableContains(receipt, "attempt_receipts", AttemptStatus.options);
    expectTableContains(receipt, "attempt_receipt_events", AttemptReceiptEventType.options);
    expectTableContains(receipt, "attempt_receipt_events", AttemptReceiptDisposition.options);
    expectTableContains(receipt, "attempt_receipt_events", AgentTaskReceiptOutcome.options);
    expectTableContains(verification, "attempt_verifications", VerificationOutcome.options);
    expectTableContains(verification, "attempt_verifications", AttemptStatus.options);
    expectTableContains(
      verification,
      "attempt_verification_events",
      AttemptVerificationEventType.options
    );
    expectTableContains(verification, "attempt_verification_events", VerificationOutcome.options);
    expectTableContains(verification, "attempt_verification_events", AttemptStatus.options);
    expectTableContains(authority, "worker_authority_events", WorkerAuthorityDimension.options);
    expectTableContains(authority, "worker_authority_events", WorkerAuthorityDecision.options);
    expectTableContains(authority, "worker_authority_events", WorkerAuthorityEnforcement.options);
    expectTableContains(authority, "worker_authority_events", WorkerAuthorityReason.options);
  });

  it("keeps verification failure reasons within the workspace mutation namespace", () => {
    expect(AttemptVerificationFailureReason.options).toEqual(
      expect.arrayContaining(WorkspaceMutationFailureReason.options)
    );
  });
});

function expectTableContains(sql: string, table: string, values: readonly string[]): void {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("CREATE ", start + 1);
  const definition = sql.slice(start, end === -1 ? undefined : end);
  for (const value of values) expect(definition).toContain(`'${value}'`);
}
