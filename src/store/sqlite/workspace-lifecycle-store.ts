import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import { AgentTaskPacket_v1, AgentTaskReceipt_v2 } from "../../schemas/agent-work.js";
import { calculateExpiry, cloneJsonValue, parseInstant } from "../coordination-store.js";
import type { JsonValue } from "../coordination-store.js";
import type {
  AcquireWorkspaceInput,
  AttachWorkerSessionInput,
  AttemptRecord,
  AttemptReceiptEvent,
  AttemptReceiptEventType,
  AttemptReceiptFailureReason,
  AttemptReceiptRecord,
  AttemptReceiptSubmissionResult,
  BindLaunchEnvelopeInput,
  CreateAttemptInput,
  EndWorkerSessionInput,
  HeartbeatWorkerSessionInput,
  LaunchEnvelopeBindingRecord,
  LaunchEnvelopeBindingResult,
  LaunchEnvelopeBindingStore,
  TaskPacketBindingRecord,
  TaskPacketBindingStore,
  HeartbeatWorkspaceInput,
  QuarantineWorkspaceInput,
  ReconcileWorkspaceInput,
  ReleaseWorkspaceInput,
  SubmitAttemptReceiptInput,
  TransitionAttemptInput,
  WorkspaceIdentity,
  WorkspaceLifecycleLeaseRecord,
  WorkspaceLifecycleEvent,
  WorkspaceLifecycleEventType,
  WorkspaceLifecycleStore,
  WorkspaceMutationFailureReason,
  WorkspaceMutationResult,
  WorkspaceObservation,
  WorkerSessionEvent,
  WorkerSessionEventType,
  WorkerSessionMutationFailureReason,
  WorkerSessionMutationResult,
  WorkerSessionRecord,
  WorkerSessionStore,
} from "../workspace-lifecycle-store.js";
import {
  SqliteCoordinationStore,
  type SqliteCoordinationStoreOptions,
} from "./coordination-store.js";

type MutationInput =
  | CreateAttemptInput
  | TransitionAttemptInput
  | AcquireWorkspaceInput
  | HeartbeatWorkspaceInput
  | ReleaseWorkspaceInput
  | ReconcileWorkspaceInput
  | QuarantineWorkspaceInput;
type Success = Extract<WorkspaceMutationResult, { updated: true }>;
type JsonRecord = { [key: string]: JsonValue };

// Kept inline because published bundles do not necessarily contain standalone SQL assets.
// The source migration remains the reviewable/canonical deployment artifact.
const INLINE_WORKSPACE_MIGRATION = `
CREATE TABLE IF NOT EXISTS attempts (
 attemptId TEXT PRIMARY KEY, runId TEXT NOT NULL, runRevision INTEGER NOT NULL CHECK(runRevision>=0),
 workItemId TEXT NOT NULL,
 workItemRevision INTEGER NOT NULL CHECK(workItemRevision>=0), packetId TEXT NOT NULL,
 packetHash TEXT NOT NULL, baseSha TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 status TEXT NOT NULL, receiptId TEXT, verificationId TEXT, workspaceLeaseId TEXT,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, completedAt TEXT,
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_live_work_item ON attempts(runId,workItemId)
 WHERE status IN ('prepared','leased','launching','running','receipt_submitted','verifying','verified');
CREATE TABLE IF NOT EXISTS workspace_leases (
 leaseId TEXT PRIMARY KEY, runId TEXT NOT NULL, runRevision INTEGER NOT NULL CHECK(runRevision>=0),
 workItemId TEXT NOT NULL,
 workItemRevision INTEGER NOT NULL CHECK(workItemRevision>=0), packetId TEXT NOT NULL,
 packetHash TEXT NOT NULL, attemptId TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), controllerId TEXT NOT NULL,
 controllerLeaseId TEXT NOT NULL, fencingToken INTEGER NOT NULL CHECK(fencingToken>0),
 repositoryId TEXT NOT NULL, hostId TEXT NOT NULL, gitRuntime TEXT NOT NULL, projectRoot TEXT NOT NULL,
 branch TEXT NOT NULL, worktreePath TEXT NOT NULL, baseSha TEXT NOT NULL, status TEXT NOT NULL,
 acquiredAt TEXT NOT NULL, heartbeatAt TEXT NOT NULL, expiresAt TEXT NOT NULL, releasedAt TEXT,
 cleanupDisposition TEXT, lastObservationJson TEXT,
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_leases_live_branch ON workspace_leases(repositoryId,branch)
 WHERE status IN ('reserved','active');
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_leases_live_worktree ON workspace_leases(hostId,gitRuntime,worktreePath)
 WHERE status IN ('reserved','active');
CREATE INDEX IF NOT EXISTS idx_workspace_leases_expiry ON workspace_leases(expiresAt)
 WHERE status IN ('reserved','active');
CREATE TABLE IF NOT EXISTS workspace_lifecycle_events (
 runId TEXT NOT NULL, attemptId TEXT NOT NULL, mutationId TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0), attemptRevision INTEGER NOT NULL CHECK(attemptRevision>=0),
 workspaceLeaseRevision INTEGER, controllerId TEXT NOT NULL, controllerLeaseId TEXT NOT NULL,
 fencingToken INTEGER NOT NULL CHECK(fencingToken>0), type TEXT NOT NULL, payloadJson TEXT NOT NULL,
 createdAt TEXT NOT NULL, PRIMARY KEY(runId,mutationId), UNIQUE(runId,sequence),
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS workspace_lifecycle_mutations (
 runId TEXT NOT NULL, mutationId TEXT NOT NULL, fingerprint TEXT NOT NULL, resultJson TEXT NOT NULL,
 PRIMARY KEY(runId,mutationId), FOREIGN KEY(runId,mutationId)
 REFERENCES workspace_lifecycle_events(runId,mutationId) ON DELETE CASCADE);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(2,'attempt-workspace-lifecycle',datetime('now'));
CREATE TABLE IF NOT EXISTS worker_sessions (
 sessionId TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 runId TEXT NOT NULL, attemptId TEXT NOT NULL, packetId TEXT NOT NULL, packetHash TEXT NOT NULL,
 workspaceLeaseId TEXT NOT NULL, workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision>=0),
 executionEnvelopeId TEXT NOT NULL, executionEnvelopeHash TEXT NOT NULL,
 hostId TEXT NOT NULL, workerRuntime TEXT NOT NULL,
 gitRuntime TEXT NOT NULL, backend TEXT NOT NULL, workerId TEXT NOT NULL, model TEXT,
 status TEXT NOT NULL, startedAt TEXT NOT NULL, heartbeatAt TEXT NOT NULL, endedAt TEXT,
 exitReason TEXT, exitCode INTEGER, exitSummary TEXT,
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
 FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS launch_envelope_bindings (
 attemptId TEXT PRIMARY KEY, runId TEXT NOT NULL, workspaceLeaseId TEXT NOT NULL,
 attemptRevision INTEGER NOT NULL CHECK(attemptRevision>=0),
 workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision>=0),
 authorizationMutationId TEXT NOT NULL, envelopeId TEXT NOT NULL UNIQUE,
 envelopeHash TEXT NOT NULL, envelopeJson TEXT NOT NULL, controllerId TEXT NOT NULL,
 controllerLeaseId TEXT NOT NULL, fencingToken INTEGER NOT NULL CHECK(fencingToken>0),
 createdAt TEXT NOT NULL,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
 FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
 FOREIGN KEY(runId,authorizationMutationId)
 REFERENCES workspace_lifecycle_events(runId,mutationId) ON DELETE RESTRICT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_sessions_one_nonterminal_attempt ON worker_sessions(attemptId)
 WHERE status IN ('starting','running','awaiting_human');
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_sessions_one_live_native_identity
 ON worker_sessions(hostId,backend,workerId)
 WHERE status IN ('starting','running','awaiting_human');
CREATE TABLE IF NOT EXISTS worker_session_events (
 runId TEXT NOT NULL, attemptId TEXT NOT NULL, sessionId TEXT NOT NULL, mutationId TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0), attemptRevision INTEGER NOT NULL CHECK(attemptRevision>=0),
 workspaceLeaseRevision INTEGER NOT NULL CHECK(workspaceLeaseRevision>=0),
 sessionRevision INTEGER NOT NULL CHECK(sessionRevision>=0), controllerId TEXT NOT NULL,
 controllerLeaseId TEXT NOT NULL, fencingToken INTEGER NOT NULL CHECK(fencingToken>0),
 type TEXT NOT NULL, payloadJson TEXT NOT NULL, createdAt TEXT NOT NULL,
 PRIMARY KEY(runId,mutationId), UNIQUE(runId,sequence),
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
 FOREIGN KEY(sessionId) REFERENCES worker_sessions(sessionId) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS worker_session_mutations (
 runId TEXT NOT NULL, mutationId TEXT NOT NULL, fingerprint TEXT NOT NULL, resultJson TEXT NOT NULL,
 PRIMARY KEY(runId,mutationId), FOREIGN KEY(runId,mutationId)
 REFERENCES worker_session_events(runId,mutationId) ON DELETE CASCADE);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(3,'worker-session-lifecycle',datetime('now'));
CREATE TABLE IF NOT EXISTS attempt_receipts (
 receiptId TEXT PRIMARY KEY, receiptHash TEXT NOT NULL UNIQUE, receiptJson TEXT NOT NULL,
 runId TEXT NOT NULL, workItemId TEXT NOT NULL, workItemRevision INTEGER NOT NULL,
 attemptId TEXT NOT NULL UNIQUE, packetId TEXT NOT NULL, packetHash TEXT NOT NULL,
 workspaceLeaseId TEXT NOT NULL, workspaceLeaseRevision INTEGER NOT NULL,
 workerSessionId TEXT NOT NULL, workerSessionRevision INTEGER NOT NULL, workerRuntime TEXT NOT NULL,
 observedBaseSha TEXT NOT NULL, finalHeadSha TEXT, patchHash TEXT, outcome TEXT NOT NULL,
 disposition TEXT NOT NULL, submittedAt TEXT NOT NULL, recordedAt TEXT NOT NULL,
 controllerId TEXT NOT NULL, controllerLeaseId TEXT NOT NULL, fencingToken INTEGER NOT NULL,
 resultingAttemptRevision INTEGER NOT NULL, resultingAttemptStatus TEXT NOT NULL,
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE,
 FOREIGN KEY(workspaceLeaseId) REFERENCES workspace_leases(leaseId) ON DELETE RESTRICT,
 FOREIGN KEY(workerSessionId) REFERENCES worker_sessions(sessionId) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS attempt_receipt_events (
 runId TEXT NOT NULL, attemptId TEXT NOT NULL, receiptId TEXT NOT NULL, receiptHash TEXT NOT NULL,
 mutationId TEXT NOT NULL, sequence INTEGER NOT NULL, attemptRevision INTEGER NOT NULL,
 workspaceLeaseRevision INTEGER NOT NULL, workerSessionRevision INTEGER NOT NULL,
 controllerId TEXT NOT NULL, controllerLeaseId TEXT NOT NULL, fencingToken INTEGER NOT NULL,
 type TEXT NOT NULL, disposition TEXT NOT NULL, outcome TEXT NOT NULL, createdAt TEXT NOT NULL,
 PRIMARY KEY(runId,mutationId), UNIQUE(runId,sequence),
 FOREIGN KEY(receiptId) REFERENCES attempt_receipts(receiptId) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS attempt_receipt_mutations (
 runId TEXT NOT NULL, mutationId TEXT NOT NULL, fingerprint TEXT NOT NULL, resultJson TEXT NOT NULL,
 PRIMARY KEY(runId,mutationId), FOREIGN KEY(runId,mutationId)
 REFERENCES attempt_receipt_events(runId,mutationId) ON DELETE CASCADE);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(4,'attempt-receipt-persistence',datetime('now'));
CREATE TABLE IF NOT EXISTS task_packet_bindings (
 attemptId TEXT PRIMARY KEY, runId TEXT NOT NULL, workItemId TEXT NOT NULL,
 workItemRevision INTEGER NOT NULL CHECK(workItemRevision>=0), packetId TEXT NOT NULL,
 packetHash TEXT NOT NULL, packetJson TEXT NOT NULL, createdAt TEXT NOT NULL,
 FOREIGN KEY(runId) REFERENCES run_coordination(runId) ON DELETE CASCADE,
 FOREIGN KEY(attemptId) REFERENCES attempts(attemptId) ON DELETE CASCADE);
INSERT OR IGNORE INTO coordination_schema_migrations(version,name,appliedAt)
 VALUES(5,'task-packet-snapshot-persistence',datetime('now'));
`;

interface AttemptRow extends Omit<AttemptRecord, "workspaceLeaseId"> {
  workspaceLeaseId: string | null;
}

interface LeaseRow {
  leaseId: string;
  runId: string;
  runRevision: number;
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  attemptId: string;
  revision: number;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  repositoryId: string;
  hostId: string;
  gitRuntime: string;
  projectRoot: string;
  branch: string;
  worktreePath: string;
  baseSha: string;
  status: WorkspaceLifecycleLeaseRecord["status"];
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  cleanupDisposition: WorkspaceLifecycleLeaseRecord["cleanupDisposition"] | null;
  lastObservationJson: string | null;
}

interface EventRow {
  runId: string;
  attemptId: string;
  mutationId: string;
  sequence: number;
  attemptRevision: number;
  workspaceLeaseRevision: number | null;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  type: WorkspaceLifecycleEventType;
  payloadJson: string;
  createdAt: string;
}

interface WorkerSessionRow extends Omit<
  WorkerSessionRecord,
  "model" | "endedAt" | "exitReason" | "exitCode" | "exitSummary"
> {
  model: string | null;
  endedAt: string | null;
  exitReason: string | null;
  exitCode: number | null;
  exitSummary: string | null;
}

interface WorkerEventRow extends Omit<WorkerSessionEvent, "payload"> {
  payloadJson: string;
}

interface AttemptReceiptRow extends Omit<AttemptReceiptRecord, "finalHeadSha" | "patchHash"> {
  finalHeadSha: string | null;
  patchHash: string | null;
}

interface AttemptReceiptEventRow extends AttemptReceiptEvent {}

const LIVE_ATTEMPTS = new Set<AttemptRecord["status"]>([
  "prepared",
  "leased",
  "launching",
  "running",
  "receipt_submitted",
  "verifying",
  "verified",
]);

const TERMINAL_ATTEMPTS = new Set<AttemptRecord["status"]>([
  "accepted",
  "rejected",
  "inconclusive",
  "blocked",
  "launch_failed",
  "failed",
  "cancelled",
  "quarantined",
]);

const TRANSITIONS: Record<AttemptRecord["status"], AttemptRecord["status"][]> = {
  prepared: ["cancelled"],
  leased: ["launching", "cancelled", "quarantined"],
  launching: ["running", "launch_failed", "failed", "cancelled", "quarantined"],
  running: ["receipt_submitted", "blocked", "failed", "cancelled", "quarantined"],
  receipt_submitted: ["verifying", "quarantined"],
  verifying: ["verified", "rejected", "inconclusive", "failed", "quarantined"],
  verified: ["accepted", "rejected", "inconclusive", "quarantined"],
  accepted: [],
  rejected: [],
  inconclusive: [],
  blocked: [],
  launch_failed: [],
  failed: [],
  cancelled: [],
  quarantined: [],
};

/** SQLite attempt/workspace store sharing the authoritative controller transaction. */
export class SqliteWorkspaceLifecycleStore
  extends SqliteCoordinationStore
  implements
    WorkspaceLifecycleStore,
    LaunchEnvelopeBindingStore,
    TaskPacketBindingStore,
    WorkerSessionStore
{
  constructor(dbPath: string, options: SqliteCoordinationStoreOptions = {}) {
    super(dbPath, options);
    if (!options.readOnly) {
      try {
        this.applyWorkspaceMigration();
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }

  async createAttempt(input: CreateAttemptInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      if (this.attempt(input.attemptId)) return this.failure("live_attempt_conflict");
      const conflict = this.db
        .prepare(
          `SELECT 1 FROM attempts WHERE runId = ? AND workItemId = ?
           AND status IN ('prepared','leased','launching','running','receipt_submitted','verifying','verified')`
        )
        .get(input.runId, input.workItemId);
      if (conflict) return this.failure("live_attempt_conflict");
      const now = instant(input.now);
      this.db
        .prepare(
          `INSERT INTO attempts (attemptId, runId, runRevision, workItemId, workItemRevision, packetId,
           packetHash, baseSha, revision, status, workspaceLeaseId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'prepared', NULL, ?, ?)`
        )
        .run(
          input.attemptId,
          input.runId,
          input.expectedRunRevision,
          input.workItemId,
          input.workItemRevision,
          input.packetId,
          input.packetHash,
          input.baseSha,
          now,
          now
        );
      return this.record(input, this.requireAttempt(input.attemptId), null, "attempt_created", {
        workItemId: input.workItemId,
      });
    });
  }

  async transitionAttempt(input: TransitionAttemptInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempt(input.attemptId);
      const failure = this.validateAttempt(attempt, input.runId, input.expectedAttemptRevision);
      if (failure) return failure;
      if (!TRANSITIONS[attempt!.status].includes(input.status)) {
        return this.failure("invalid_attempt_transition", attempt!);
      }
      if (input.status === "receipt_submitted") {
        return this.failure("evidence_mismatch", attempt!);
      }
      if (input.receiptId !== undefined) {
        const durableReceipt = this.getReceiptForAttempt(attempt!.attemptId);
        if (
          !durableReceipt ||
          durableReceipt.receiptId !== input.receiptId ||
          attempt!.receiptId !== input.receiptId ||
          durableReceipt.attemptId !== attempt!.attemptId ||
          durableReceipt.disposition !== "verification_pending"
        ) {
          return this.failure("evidence_mismatch", attempt!);
        }
      }
      if (requiresDurableReceipt(input.status)) {
        const receipt = this.getReceiptForAttempt(attempt!.attemptId);
        if (
          !receipt ||
          receipt.receiptId !== attempt!.receiptId ||
          receipt.attemptId !== attempt!.attemptId ||
          receipt.disposition !== "verification_pending"
        ) {
          return this.failure("evidence_mismatch", attempt!);
        }
      }
      if (parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "updatedAt")) {
        return this.failure("invalid_time", attempt!);
      }
      if (requiresLiveWorkspace(input.status)) {
        const lease = attempt!.workspaceLeaseId ? this.lease(attempt!.workspaceLeaseId) : null;
        if (!lease || lease.status !== "active") {
          return this.failure("workspace_not_active", attempt!, lease ?? undefined);
        }
        if (
          lease.controllerId !== input.controller.controllerId ||
          lease.controllerLeaseId !== input.controller.leaseId ||
          lease.fencingToken !== input.controller.fencingToken
        ) {
          return this.failure("stale_fence", attempt!, lease);
        }
        if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
          return this.failure("workspace_expired", attempt!, lease);
        }
        if (input.status === "launching" && !isLaunchReadyWorkspace(lease)) {
          return this.failure("evidence_mismatch", attempt!, lease);
        }
      }
      const evidence = bindEvidence(attempt!, input);
      if (!evidence) return this.failure("evidence_mismatch", attempt!);
      this.db
        .prepare(
          `UPDATE attempts SET revision = revision + 1, status = ?, updatedAt = ?, completedAt = ?,
           receiptId = COALESCE(?, receiptId), verificationId = COALESCE(?, verificationId)
           WHERE attemptId = ?`
        )
        .run(
          input.status,
          instant(input.now),
          TERMINAL_ATTEMPTS.has(input.status) ? instant(input.now) : null,
          evidence.receiptId,
          evidence.verificationId,
          input.attemptId
        );
      const updated = this.requireAttempt(input.attemptId);
      const lease = updated.workspaceLeaseId ? this.lease(updated.workspaceLeaseId) : null;
      return this.record(input, updated, lease, "attempt_transitioned", {
        status: input.status,
        receiptId: updated.receiptId,
        verificationId: updated.verificationId,
        details: input.details ?? null,
      });
    });
  }

  async acquireWorkspace(input: AcquireWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempt(input.attemptId);
      const failure = this.validateAttempt(attempt, input.runId, input.expectedAttemptRevision);
      if (failure) return failure;
      if (parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "updatedAt"))
        return this.failure("invalid_time", attempt!);
      if (!validTtl(input.ttlMs)) return this.failure("invalid_time", attempt!);
      if (!LIVE_ATTEMPTS.has(attempt!.status)) return this.failure("attempt_not_live", attempt!);
      if (attempt!.workspaceLeaseId || this.lease(input.workspaceLeaseId))
        return this.failure("live_attempt_conflict", attempt!);
      if (attempt!.workItemId !== input.workItemId || attempt!.baseSha !== input.baseSha)
        return this.failure("identity_mismatch", attempt!);
      if (
        input.observation?.exists &&
        (!input.observation.registered || !sameIdentity(input, input.observation))
      )
        return this.failure("identity_mismatch", attempt!);
      if (input.observation?.exists && input.observation.cleanliness === "dirty")
        return this.failure("dirty_workspace", attempt!);
      const branch = this.db
        .prepare(
          `SELECT 1 FROM workspace_leases WHERE repositoryId = ? AND branch = ? AND status IN ('active','reserved')`
        )
        .get(input.repositoryId, input.branch);
      if (branch) return this.failure("branch_conflict", attempt!);
      const tree = this.db
        .prepare(
          `SELECT 1 FROM workspace_leases WHERE hostId = ? AND gitRuntime = ? AND worktreePath = ? AND status IN ('active','reserved')`
        )
        .get(input.hostId, input.gitRuntime, input.worktreePath);
      if (tree) return this.failure("worktree_conflict", attempt!);

      const now = instant(input.now);
      this.db
        .prepare(
          `INSERT INTO workspace_leases (leaseId, runId, runRevision, workItemId, workItemRevision,
           packetId, packetHash, attemptId, revision,
           controllerId, controllerLeaseId, fencingToken, repositoryId, hostId, gitRuntime,
           projectRoot, branch, worktreePath, baseSha, status, acquiredAt, heartbeatAt, expiresAt,
           lastObservationJson)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.workspaceLeaseId,
          input.runId,
          attempt!.runRevision,
          input.workItemId,
          attempt!.workItemRevision,
          attempt!.packetId,
          attempt!.packetHash,
          input.attemptId,
          input.controller.controllerId,
          input.controller.leaseId,
          input.controller.fencingToken,
          input.repositoryId,
          input.hostId,
          input.gitRuntime,
          input.projectRoot,
          input.branch,
          input.worktreePath,
          input.baseSha,
          input.observation?.exists && input.observation.registered ? "active" : "reserved",
          now,
          now,
          calculateExpiry(now, input.ttlMs),
          input.observation ? json(input.observation) : null
        );
      this.db
        .prepare(
          `UPDATE attempts SET workspaceLeaseId = ?, revision = revision + 1,
           status = 'leased', updatedAt = ? WHERE attemptId = ?`
        )
        .run(input.workspaceLeaseId, now, input.attemptId);
      const lease = this.requireLease(input.workspaceLeaseId);
      return this.record(input, this.requireAttempt(input.attemptId), lease, "workspace_acquired", {
        repositoryId: lease.repositoryId,
        branch: lease.branch,
        worktreePath: lease.worktreePath,
      });
    });
  }

  async heartbeatWorkspace(input: HeartbeatWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, false, (attempt, lease) => {
      if (!validTtl(input.ttlMs)) return this.failure("invalid_time", attempt, lease);
      if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now"))
        return this.failure("workspace_expired", attempt, lease);
      if (
        !sameIdentity(lease, input.observation) ||
        !input.observation.exists ||
        !input.observation.registered
      )
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      const now = instant(input.now);
      this.bumpAttempt(attempt.attemptId, now);
      this.db
        .prepare(
          `UPDATE workspace_leases SET revision = revision + 1, status = 'active', heartbeatAt = ?,
           expiresAt = ?, lastObservationJson = ? WHERE leaseId = ?`
        )
        .run(now, calculateExpiry(now, input.ttlMs), json(input.observation), lease.leaseId);
      return this.record(
        input,
        this.requireAttempt(attempt.attemptId),
        this.requireLease(lease.leaseId),
        "workspace_heartbeat",
        { cleanliness: input.observation.cleanliness, headSha: input.observation.headSha }
      );
    });
  }

  async releaseWorkspace(input: ReleaseWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, false, (attempt, lease) => {
      if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now"))
        return this.failure("workspace_expired", attempt, lease);
      if (
        !sameIdentity(lease, input.observation) ||
        !input.observation.exists ||
        !input.observation.registered
      )
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      if (input.observation.cleanliness === "dirty")
        return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
      return this.finish(
        input,
        attempt,
        lease,
        "released",
        input.disposition,
        "workspace_released"
      );
    });
  }

  async reconcileWorkspace(input: ReconcileWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, true, (attempt, lease) => {
      if (
        !sameIdentity(lease, input.observation) ||
        !input.observation.exists ||
        !input.observation.registered
      )
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      if (input.action === "resume") {
        if (input.observation.cleanliness === "dirty")
          return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
        if (!input.ttlMs || !validTtl(input.ttlMs))
          return this.failure("invalid_reconciliation", attempt, lease);
        const now = instant(input.now);
        this.bumpAttempt(attempt.attemptId, now);
        this.db
          .prepare(
            `UPDATE workspace_leases SET revision = revision + 1, status = 'active', controllerId = ?,
             controllerLeaseId = ?, fencingToken = ?, heartbeatAt = ?, expiresAt = ?,
             lastObservationJson = ? WHERE leaseId = ?`
          )
          .run(
            input.controller.controllerId,
            input.controller.leaseId,
            input.controller.fencingToken,
            now,
            calculateExpiry(now, input.ttlMs),
            json(input.observation),
            lease.leaseId
          );
        return this.record(
          input,
          this.requireAttempt(attempt.attemptId),
          this.requireLease(lease.leaseId),
          "workspace_reconciled",
          { action: "resume" }
        );
      }
      if (input.action === "preserve")
        return this.finish(input, attempt, lease, "preserved", "preserved", "workspace_reconciled");
      if (input.observation.cleanliness === "dirty")
        return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
      return this.finish(
        input,
        attempt,
        lease,
        input.action === "release" ? "released" : "abandoned",
        input.action === "release" ? "discarded" : "abandoned",
        "workspace_reconciled"
      );
    });
  }

  async quarantineWorkspace(input: QuarantineWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, false, (attempt, lease) =>
      this.quarantine(input, attempt, lease, input.reason, input.observation)
    );
  }

  async getAttempt(attemptId: string): Promise<AttemptRecord | null> {
    return this.attempt(attemptId);
  }

  async getWorkspaceLease(leaseId: string): Promise<WorkspaceLifecycleLeaseRecord | null> {
    return this.lease(leaseId);
  }

  async listWorkspaceLifecycleEvents(runId: string): Promise<WorkspaceLifecycleEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM workspace_lifecycle_events WHERE runId = ? ORDER BY sequence`)
      .all(runId) as EventRow[];
    return rows.map(toEvent);
  }

  async bindLaunchEnvelope(input: BindLaunchEnvelopeInput): Promise<LaunchEnvelopeBindingResult> {
    if (!Number.isFinite(Date.parse(input.createdAt)))
      return { bound: false, reason: "invalid_time" };
    if (input.controller.runId !== input.runId) return { bound: false, reason: "lease_mismatch" };
    return this.immediateTransaction(() => {
      const coordination = this.db
        .prepare(
          `SELECT revision, controllerId, leaseId, fencingToken, expiresAt
           FROM run_coordination WHERE runId = ?`
        )
        .get(input.runId) as
        | {
            revision: number;
            controllerId: string | null;
            leaseId: string | null;
            fencingToken: number;
            expiresAt: string | null;
          }
        | undefined;
      if (!coordination?.controllerId) return sqliteLaunchFailure("no_active_lease");
      if (coordination.fencingToken !== input.controller.fencingToken) {
        return sqliteLaunchFailure("stale_fence");
      }
      if (
        coordination.controllerId !== input.controller.controllerId ||
        coordination.leaseId !== input.controller.leaseId
      ) {
        return sqliteLaunchFailure("lease_mismatch");
      }
      if (coordination.revision !== input.expectedRunRevision) {
        return {
          ...sqliteLaunchFailure("stale_run_revision"),
          currentRunRevision: coordination.revision,
        };
      }
      if (
        parseInstant(coordination.expiresAt!, "expiresAt") <=
        parseInstant(input.createdAt, "createdAt")
      ) {
        return sqliteLaunchFailure("lease_expired");
      }
      const attempt = this.attempt(input.attemptId);
      const lease = this.lease(input.workspaceLeaseId);
      const existing = this.launchEnvelopeBinding(input.attemptId);
      if (existing) {
        return sameLaunchBinding(existing, input) &&
          sameTaskPacketBinding(this.taskPacketBinding(input.attemptId), input.packetJson, attempt)
          ? { bound: true, binding: existing, idempotentReplay: true }
          : sqliteLaunchFailure("mutation_conflict", attempt ?? undefined, lease ?? undefined);
      }
      const failure = sqliteLaunchBindingFailure(input, attempt, lease);
      if (failure) return failure;
      const envelopeIdConflict = this.db
        .prepare(`SELECT 1 FROM launch_envelope_bindings WHERE envelopeId = ?`)
        .get(input.envelopeId);
      if (envelopeIdConflict) {
        return sqliteLaunchFailure("mutation_conflict", attempt!, lease!);
      }
      const eventRow = this.db
        .prepare(`SELECT * FROM workspace_lifecycle_events WHERE runId = ? AND mutationId = ?`)
        .get(input.runId, input.authorizationMutationId) as EventRow | undefined;
      const event = eventRow ? toEvent(eventRow) : undefined;
      if (!isMatchingLaunchAuthorization(event, input)) {
        return sqliteLaunchFailure("evidence_mismatch", attempt!, lease!);
      }
      if (!validateCanonicalEnvelope(input, attempt!, lease!)) {
        return sqliteLaunchFailure("evidence_mismatch", attempt!, lease!);
      }
      // A packet snapshot is mandatory for every new binding.  The optional
      // input remains only so an already-persisted pre-snapshot envelope can
      // be replayed exactly during compatibility migration.
      if (
        input.packetJson === undefined ||
        !validateCanonicalTaskPacket(input.packetJson, attempt!)
      ) {
        return sqliteLaunchFailure("evidence_mismatch", attempt!, lease!);
      }
      const createdAt = instant(input.createdAt);
      this.db
        .prepare(
          `INSERT INTO launch_envelope_bindings (attemptId, runId, workspaceLeaseId,
           attemptRevision, workspaceLeaseRevision, authorizationMutationId, envelopeId,
           envelopeHash, envelopeJson, controllerId, controllerLeaseId, fencingToken, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.attemptId,
          input.runId,
          input.workspaceLeaseId,
          input.expectedAttemptRevision,
          input.expectedWorkspaceLeaseRevision,
          input.authorizationMutationId,
          input.envelopeId,
          input.envelopeHash,
          input.envelopeJson,
          input.controller.controllerId,
          input.controller.leaseId,
          input.controller.fencingToken,
          createdAt
        );
      this.db
        .prepare(
          `INSERT INTO task_packet_bindings (attemptId, runId, workItemId, workItemRevision,
           packetId, packetHash, packetJson, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.attemptId,
          input.runId,
          attempt!.workItemId,
          attempt!.workItemRevision,
          attempt!.packetId,
          attempt!.packetHash,
          input.packetJson,
          createdAt
        );
      return {
        bound: true,
        binding: this.requireLaunchEnvelopeBinding(input.attemptId),
        idempotentReplay: false,
      };
    });
  }

  async getLaunchEnvelopeBinding(attemptId: string): Promise<LaunchEnvelopeBindingRecord | null> {
    return this.hasTable("launch_envelope_bindings") ? this.launchEnvelopeBinding(attemptId) : null;
  }

  async getTaskPacketBinding(attemptId: string): Promise<TaskPacketBindingRecord | null> {
    if (!this.hasTable("task_packet_bindings")) return null;
    const binding = this.taskPacketBinding(attemptId);
    const attempt = this.attempt(attemptId);
    return binding && attempt && validateTaskPacketBinding(binding, attempt) ? binding : null;
  }

  async attachWorkerSession(input: AttachWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const existing = this.workerSessionForAttempt(input.attemptId, false);
      if (existing || this.workerSession(input.sessionId)) {
        return this.workerFailure("worker_session_conflict", attempt, lease, existing ?? undefined);
      }
      const nativeIdentityConflict = this.workerSessionForNativeIdentity(
        input.hostId,
        input.backend,
        input.workerId
      );
      if (nativeIdentityConflict) {
        return this.workerFailure(
          "worker_session_conflict",
          attempt,
          lease,
          nativeIdentityConflict
        );
      }
      if (attempt.status !== "launching") {
        return this.workerFailure("invalid_attempt_transition", attempt, lease);
      }
      if (input.packetId !== attempt.packetId || input.packetHash !== attempt.packetHash) {
        return this.workerFailure("identity_mismatch", attempt, lease);
      }
      const envelope = this.launchEnvelopeBinding(input.attemptId);
      if (
        !envelope ||
        envelope.envelopeId !== input.executionEnvelopeId ||
        envelope.envelopeHash !== input.executionEnvelopeHash
      ) {
        return this.workerFailure("identity_mismatch", attempt, lease);
      }
      if (boundWorkerRuntime(envelope) !== input.workerRuntime) {
        return this.workerFailure("identity_mismatch", attempt, lease);
      }
      if (input.hostId !== lease.hostId || input.gitRuntime !== lease.gitRuntime) {
        return this.workerFailure("identity_mismatch", attempt, lease);
      }
      if (!Number.isFinite(Date.parse(input.startedAt))) {
        return this.workerFailure("invalid_time", attempt, lease);
      }
      const now = instant(input.now);
      const startedAt = instant(input.startedAt);
      if (
        parseInstant(startedAt, "startedAt") <
          parseInstant(envelope.createdAt, "envelope.createdAt") ||
        parseInstant(startedAt, "startedAt") > parseInstant(now, "now")
      ) {
        return this.workerFailure("invalid_time", attempt, lease);
      }
      this.db
        .prepare(
          `INSERT INTO worker_sessions (sessionId, revision, runId, attemptId, packetId, packetHash,
           workspaceLeaseId, workspaceLeaseRevision, executionEnvelopeId, executionEnvelopeHash,
           hostId, workerRuntime,
           gitRuntime, backend, workerId, model, status, startedAt, heartbeatAt)
           VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`
        )
        .run(
          input.sessionId,
          input.runId,
          input.attemptId,
          input.packetId,
          input.packetHash,
          input.workspaceLeaseId,
          input.expectedWorkspaceLeaseRevision,
          input.executionEnvelopeId,
          input.executionEnvelopeHash,
          input.hostId,
          input.workerRuntime,
          input.gitRuntime,
          input.backend,
          input.workerId,
          input.model ?? null,
          startedAt,
          now
        );
      this.db
        .prepare(
          `UPDATE attempts SET revision = revision + 1, status = 'running', updatedAt = ?
           WHERE attemptId = ?`
        )
        .run(now, input.attemptId);
      const session = this.requireWorkerSession(input.sessionId);
      return this.recordWorker(
        input,
        this.requireAttempt(input.attemptId),
        lease,
        session,
        "worker_session_attached",
        {
          backend: session.backend,
          workerId: session.workerId,
          executionEnvelopeId: session.executionEnvelopeId,
        }
      );
    });
  }

  async heartbeatWorkerSession(
    input: HeartbeatWorkerSessionInput
  ): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const session = this.workerSession(input.sessionId);
      const failure = this.validateSession(session, input, attempt, lease);
      if (failure) return failure;
      const now = instant(input.now);
      if (parseInstant(now, "now") < parseInstant(session!.heartbeatAt, "heartbeatAt")) {
        return this.workerFailure("invalid_time", attempt, lease, session!);
      }
      this.db
        .prepare(
          `UPDATE worker_sessions SET revision = revision + 1, status = ?, heartbeatAt = ?
           WHERE sessionId = ?`
        )
        .run(input.status ?? session!.status, now, input.sessionId);
      return this.recordWorker(
        input,
        attempt,
        lease,
        this.requireWorkerSession(input.sessionId),
        "worker_session_heartbeat",
        { status: input.status ?? session!.status }
      );
    });
  }

  async endWorkerSession(input: EndWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const session = this.workerSession(input.sessionId);
      const failure = this.validateSession(session, input, attempt, lease);
      if (failure) return failure;
      if (!validExitMetadata(input)) {
        return this.workerFailure("evidence_mismatch", attempt, lease, session!);
      }
      const now = instant(input.now);
      if (parseInstant(now, "now") < parseInstant(session!.heartbeatAt, "heartbeatAt")) {
        return this.workerFailure("invalid_time", attempt, lease, session!);
      }
      this.db
        .prepare(
          `UPDATE worker_sessions SET revision = revision + 1, status = ?, heartbeatAt = ?, endedAt = ?,
           exitReason = ?, exitCode = ?, exitSummary = ? WHERE sessionId = ?`
        )
        .run(
          input.status,
          now,
          now,
          input.exitReason ?? null,
          input.exitCode ?? null,
          input.exitSummary ?? null,
          input.sessionId
        );
      if (input.status !== "completed") {
        this.db
          .prepare(
            `UPDATE attempts SET revision = revision + 1, status = ?, updatedAt = ?, completedAt = ?
             WHERE attemptId = ?`
          )
          .run(input.status === "cancelled" ? "cancelled" : "failed", now, now, input.attemptId);
      }
      return this.recordWorker(
        input,
        this.requireAttempt(input.attemptId),
        lease,
        this.requireWorkerSession(input.sessionId),
        "worker_session_ended",
        {
          status: input.status,
          exitReason: input.exitReason ?? null,
          exitCode: input.exitCode ?? null,
          exitSummary: input.exitSummary ?? null,
        }
      );
    });
  }

  async getWorkerSession(sessionId: string): Promise<WorkerSessionRecord | null> {
    return this.hasTable("worker_sessions") ? this.workerSession(sessionId) : null;
  }

  async getWorkerSessionForAttempt(attemptId: string): Promise<WorkerSessionRecord | null> {
    return this.hasTable("worker_sessions") ? this.workerSessionForAttempt(attemptId, false) : null;
  }

  async listWorkerSessionEvents(runId: string): Promise<WorkerSessionEvent[]> {
    if (!this.hasTable("worker_session_events")) return [];
    const rows = this.db
      .prepare(`SELECT * FROM worker_session_events WHERE runId = ? ORDER BY sequence`)
      .all(runId) as WorkerEventRow[];
    return rows.map(toWorkerEvent);
  }

  async submitAttemptReceipt(
    input: SubmitAttemptReceiptInput
  ): Promise<AttemptReceiptSubmissionResult> {
    if (!Number.isFinite(Date.parse(input.now))) return this.receiptFailure("invalid_time");
    if (input.controller.runId !== input.runId) return this.receiptFailure("lease_mismatch");
    const parsed = AgentTaskReceipt_v2.safeParse(input.receipt);
    if (!parsed.success) return this.receiptFailure("evidence_mismatch");
    const receiptJson = canonicalJSONStringify(parsed.data);
    const receiptHash = computeCanonicalHash(parsed.data);
    return this.immediateTransaction(() => {
      const coordination = this.db
        .prepare(
          `SELECT revision, controllerId, leaseId, fencingToken, expiresAt
           FROM run_coordination WHERE runId = ?`
        )
        .get(input.runId) as
        | {
            revision: number;
            controllerId: string | null;
            leaseId: string | null;
            fencingToken: number;
            expiresAt: string | null;
          }
        | undefined;
      if (!coordination?.controllerId) return this.receiptFailure("no_active_lease");
      if (coordination.fencingToken !== input.controller.fencingToken) {
        return this.receiptFailure("stale_fence");
      }
      if (
        coordination.controllerId !== input.controller.controllerId ||
        coordination.leaseId !== input.controller.leaseId
      ) {
        return this.receiptFailure("lease_mismatch");
      }
      if (coordination.revision !== input.expectedRunRevision) {
        return this.receiptFailure(
          "stale_run_revision",
          undefined,
          undefined,
          undefined,
          coordination.revision
        );
      }
      if (parseInstant(coordination.expiresAt!, "expiresAt") <= parseInstant(input.now, "now")) {
        return this.receiptFailure("lease_expired");
      }
      const fingerprint = canonicalJSONStringify(input as unknown as JsonValue);
      if (
        this.db
          .prepare(
            `SELECT 1 FROM workspace_lifecycle_mutations WHERE runId = ? AND mutationId = ?
             UNION ALL SELECT 1 FROM worker_session_mutations WHERE runId = ? AND mutationId = ?`
          )
          .get(input.runId, input.mutationId, input.runId, input.mutationId)
      ) {
        return this.receiptFailure("mutation_conflict");
      }
      const packetAttempt = this.attempt(input.attemptId);
      const packetBinding = this.hasTable("task_packet_bindings")
        ? this.taskPacketBinding(input.attemptId)
        : null;
      if (
        packetAttempt &&
        (!packetBinding || !validateTaskPacketBinding(packetBinding, packetAttempt))
      ) {
        return this.receiptFailure("evidence_mismatch", packetAttempt);
      }
      const prior = this.db
        .prepare(
          `SELECT fingerprint, resultJson FROM attempt_receipt_mutations
           WHERE runId = ? AND mutationId = ?`
        )
        .get(input.runId, input.mutationId) as
        | { fingerprint: string; resultJson: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) return this.receiptFailure("mutation_conflict");
        return {
          ...(JSON.parse(prior.resultJson) as Extract<
            AttemptReceiptSubmissionResult,
            { submitted: true }
          >),
          idempotentReplay: true,
        };
      }
      const hashReceipt = this.attemptReceiptByHash(receiptHash);
      if (hashReceipt) {
        if (
          hashReceipt.receiptJson !== receiptJson ||
          hashReceipt.runId !== input.runId ||
          hashReceipt.attemptId !== input.attemptId ||
          hashReceipt.workspaceLeaseId !== input.workspaceLeaseId ||
          hashReceipt.workerSessionId !== input.workerSessionId
        ) {
          return this.receiptFailure("receipt_conflict");
        }
        const attempt = this.requireAttempt(hashReceipt.attemptId);
        const lease = this.requireLease(hashReceipt.workspaceLeaseId);
        const session = this.requireWorkerSession(hashReceipt.workerSessionId);
        const committed = this.committedReceiptResult(hashReceipt);
        if (!committed) {
          throw new Error(
            `Attempt receipt '${hashReceipt.receiptId}' is missing its committed submission result`
          );
        }
        const replay = this.recordReceiptEvent(
          input,
          attempt,
          lease,
          session,
          hashReceipt,
          "attempt_receipt_replayed"
        );
        const result = {
          submitted: true as const,
          receipt: committed.receipt,
          attempt: committed.attempt,
          event: replay.event,
          idempotentReplay: true,
        };
        this.storeReceiptMutation(input, fingerprint, result);
        return result;
      }
      const result = this.submitNewReceipt(input, parsed.data, receiptJson, receiptHash);
      if (result.submitted) this.storeReceiptMutation(input, fingerprint, result);
      return result;
    });
  }

  async getAttemptReceipt(receiptId: string): Promise<AttemptReceiptRecord | null> {
    return this.hasTable("attempt_receipts") ? this.attemptReceipt(receiptId) : null;
  }

  async getAttemptReceiptForAttempt(attemptId: string): Promise<AttemptReceiptRecord | null> {
    if (!this.hasTable("attempt_receipts")) return null;
    const row = this.db
      .prepare(`SELECT * FROM attempt_receipts WHERE attemptId = ?`)
      .get(attemptId) as AttemptReceiptRow | undefined;
    return row ? toAttemptReceipt(row) : null;
  }

  async getAttemptReceiptByHash(receiptHash: string): Promise<AttemptReceiptRecord | null> {
    return this.hasTable("attempt_receipts") ? this.attemptReceiptByHash(receiptHash) : null;
  }

  async listAttemptReceiptEvents(runId: string): Promise<AttemptReceiptEvent[]> {
    if (!this.hasTable("attempt_receipt_events")) return [];
    const rows = this.db
      .prepare(`SELECT * FROM attempt_receipt_events WHERE runId = ? ORDER BY sequence`)
      .all(runId) as AttemptReceiptEventRow[];
    return rows.map(toAttemptReceiptEvent);
  }

  private submitNewReceipt(
    input: SubmitAttemptReceiptInput,
    claim: import("../../schemas/agent-work.js").AgentTaskReceipt_v2,
    receiptJson: string,
    receiptHash: string
  ): AttemptReceiptSubmissionResult {
    const attempt = this.attempt(input.attemptId);
    const lease = this.lease(input.workspaceLeaseId);
    const session = this.workerSession(input.workerSessionId);
    if (!attempt || attempt.runId !== input.runId || !lease || !session) {
      return this.receiptFailure(
        "not_found",
        attempt ?? undefined,
        lease ?? undefined,
        session ?? undefined
      );
    }
    if (attempt.revision !== input.expectedAttemptRevision) {
      return this.receiptFailure("stale_attempt_revision", attempt, lease, session);
    }
    if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
      return this.receiptFailure("stale_workspace_revision", attempt, lease, session);
    }
    if (session.revision !== input.expectedWorkerSessionRevision) {
      return this.receiptFailure("stale_session_revision", attempt, lease, session);
    }
    if (this.attemptReceipt(claim.receipt_id) || this.getReceiptForAttempt(input.attemptId)) {
      return this.receiptFailure("receipt_conflict", attempt, lease, session);
    }
    if (!validReceiptBinding(claim, input, attempt, lease, session)) {
      return this.receiptFailure("evidence_mismatch", attempt, lease, session);
    }
    if (
      !["completed", "failed", "cancelled", "lost"].includes(session.status) ||
      !session.endedAt
    ) {
      return this.receiptFailure("worker_session_not_active", attempt, lease, session);
    }
    const active =
      attempt.status === "running" &&
      session.status === "completed" &&
      lease.status === "active" &&
      lease.controllerId === input.controller.controllerId &&
      lease.controllerLeaseId === input.controller.leaseId &&
      lease.fencingToken === input.controller.fencingToken &&
      parseInstant(lease.expiresAt, "expiresAt") > parseInstant(input.now, "now");
    if (!active && attempt.status !== "running" && !isTerminalAttempt(attempt.status)) {
      return this.receiptFailure("invalid_attempt_transition", attempt, lease, session);
    }
    const disposition = active ? "verification_pending" : "retained_late";
    if (active) {
      const status: AttemptRecord["status"] =
        claim.outcome === "completed" ? "receipt_submitted" : claim.outcome;
      this.db
        .prepare(
          `UPDATE attempts SET revision = revision + 1, status = ?, receiptId = ?, updatedAt = ?,
           completedAt = ? WHERE attemptId = ?`
        )
        .run(
          status,
          claim.receipt_id,
          instant(input.now),
          status === "receipt_submitted" ? null : instant(input.now),
          input.attemptId
        );
    }
    const updatedAttempt = this.requireAttempt(input.attemptId);
    this.db
      .prepare(
        `INSERT INTO attempt_receipts (receiptId, receiptHash, receiptJson, runId, workItemId,
         workItemRevision, attemptId, packetId, packetHash, workspaceLeaseId,
         workspaceLeaseRevision, workerSessionId, workerSessionRevision, workerRuntime,
         observedBaseSha, finalHeadSha, patchHash, outcome, disposition, submittedAt, recordedAt,
         controllerId, controllerLeaseId, fencingToken, resultingAttemptRevision,
         resultingAttemptStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        claim.receipt_id,
        receiptHash,
        receiptJson,
        input.runId,
        claim.work_item_id,
        claim.work_item_revision,
        input.attemptId,
        claim.packet_id,
        claim.packet_hash,
        input.workspaceLeaseId,
        claim.workspace_lease_revision,
        input.workerSessionId,
        session.revision,
        claim.worker_runtime,
        claim.observed_base_sha,
        claim.final_head_sha ?? null,
        claim.patch_hash ?? null,
        claim.outcome,
        disposition,
        instant(claim.submitted_at),
        instant(input.now),
        input.controller.controllerId,
        input.controller.leaseId,
        input.controller.fencingToken,
        updatedAttempt.revision,
        updatedAttempt.status
      );
    const record = this.requireAttemptReceipt(claim.receipt_id);
    return this.recordReceiptEvent(
      input,
      updatedAttempt,
      lease,
      session,
      record,
      active ? "attempt_receipt_submitted" : "attempt_receipt_retained_late"
    );
  }

  private recordReceiptEvent(
    input: SubmitAttemptReceiptInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    session: WorkerSessionRecord,
    receipt: AttemptReceiptRecord,
    type: AttemptReceiptEventType
  ): Extract<AttemptReceiptSubmissionResult, { submitted: true }> {
    const sequence = (
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM attempt_receipt_events WHERE runId = ?`
        )
        .get(input.runId) as { value: number }
    ).value;
    this.db
      .prepare(
        `INSERT INTO attempt_receipt_events (runId, attemptId, receiptId, receiptHash, mutationId,
         sequence, attemptRevision, workspaceLeaseRevision, workerSessionRevision, controllerId,
         controllerLeaseId, fencingToken, type, disposition, outcome, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        attempt.attemptId,
        receipt.receiptId,
        receipt.receiptHash,
        input.mutationId,
        sequence,
        attempt.revision,
        lease.revision,
        session.revision,
        input.controller.controllerId,
        input.controller.leaseId,
        input.controller.fencingToken,
        type,
        receipt.disposition,
        receipt.outcome,
        instant(input.now)
      );
    const event = this.db
      .prepare(`SELECT * FROM attempt_receipt_events WHERE runId = ? AND mutationId = ?`)
      .get(input.runId, input.mutationId) as AttemptReceiptEventRow;
    return {
      submitted: true,
      receipt,
      attempt,
      event,
      idempotentReplay: false,
    };
  }

  private storeReceiptMutation(
    input: SubmitAttemptReceiptInput,
    fingerprint: string,
    result: Extract<AttemptReceiptSubmissionResult, { submitted: true }>
  ): void {
    this.db
      .prepare(
        `INSERT INTO attempt_receipt_mutations (runId, mutationId, fingerprint, resultJson)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.runId, input.mutationId, fingerprint, json(result));
  }

  private receiptFailure(
    reason: AttemptReceiptFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    session?: WorkerSessionRecord,
    currentRunRevision?: number
  ): AttemptReceiptSubmissionResult {
    return {
      submitted: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(session ? { currentSessionRevision: session.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private committedReceiptResult(
    receipt: AttemptReceiptRecord
  ): Extract<AttemptReceiptSubmissionResult, { submitted: true }> | null {
    const row = this.db
      .prepare(
        `SELECT mutation.resultJson FROM attempt_receipt_mutations AS mutation
         JOIN attempt_receipt_events AS event
           ON event.runId = mutation.runId AND event.mutationId = mutation.mutationId
         WHERE event.runId = ? AND event.receiptId = ?
           AND event.type IN ('attempt_receipt_submitted', 'attempt_receipt_retained_late')
         LIMIT 1`
      )
      .get(receipt.runId, receipt.receiptId) as { resultJson: string } | undefined;
    return row
      ? (JSON.parse(row.resultJson) as Extract<AttemptReceiptSubmissionResult, { submitted: true }>)
      : null;
  }

  private mutateWorker(
    input: AttachWorkerSessionInput | HeartbeatWorkerSessionInput | EndWorkerSessionInput,
    action: () => WorkerSessionMutationResult
  ): WorkerSessionMutationResult {
    if (!Number.isFinite(Date.parse(input.now))) return this.workerFailure("invalid_time");
    if (input.controller.runId !== input.runId) return this.workerFailure("lease_mismatch");
    return this.immediateTransaction(() => {
      const coordination = this.db
        .prepare(
          `SELECT revision, controllerId, leaseId, fencingToken, expiresAt
           FROM run_coordination WHERE runId = ?`
        )
        .get(input.runId) as
        | {
            revision: number;
            controllerId: string | null;
            leaseId: string | null;
            fencingToken: number;
            expiresAt: string | null;
          }
        | undefined;
      if (!coordination?.controllerId) return this.workerFailure("no_active_lease");
      if (coordination.fencingToken !== input.controller.fencingToken) {
        return this.workerFailure("stale_fence");
      }
      if (
        coordination.controllerId !== input.controller.controllerId ||
        coordination.leaseId !== input.controller.leaseId
      ) {
        return this.workerFailure("lease_mismatch");
      }
      if (coordination.revision !== input.expectedRunRevision) {
        return this.workerFailure(
          "stale_run_revision",
          undefined,
          undefined,
          undefined,
          coordination.revision
        );
      }
      if (parseInstant(coordination.expiresAt!, "expiresAt") <= parseInstant(input.now, "now")) {
        return this.workerFailure("lease_expired");
      }

      const fingerprint = canonicalJSONStringify(input as unknown as JsonValue);
      const workspaceClaim = this.db
        .prepare(
          `SELECT 1 FROM workspace_lifecycle_mutations WHERE runId = ? AND mutationId = ?
           UNION ALL SELECT 1 FROM attempt_receipt_mutations WHERE runId = ? AND mutationId = ?`
        )
        .get(input.runId, input.mutationId, input.runId, input.mutationId);
      if (workspaceClaim) return this.workerFailure("mutation_conflict");
      const prior = this.db
        .prepare(
          `SELECT fingerprint, resultJson FROM worker_session_mutations
           WHERE runId = ? AND mutationId = ?`
        )
        .get(input.runId, input.mutationId) as
        | { fingerprint: string; resultJson: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) return this.workerFailure("mutation_conflict");
        return {
          ...(JSON.parse(prior.resultJson) as Extract<
            WorkerSessionMutationResult,
            { updated: true }
          >),
          idempotentReplay: true,
        };
      }
      const result = action();
      if (result.updated) {
        this.db
          .prepare(
            `INSERT INTO worker_session_mutations (runId, mutationId, fingerprint, resultJson)
             VALUES (?, ?, ?, ?)`
          )
          .run(input.runId, input.mutationId, fingerprint, json(result));
      }
      return result;
    });
  }

  private validateWorkerBinding(
    input: AttachWorkerSessionInput | HeartbeatWorkerSessionInput | EndWorkerSessionInput
  ):
    | { valid: true; attempt: AttemptRecord; lease: WorkspaceLifecycleLeaseRecord }
    | { valid: false; failure: WorkerSessionMutationResult } {
    const attempt = this.attempt(input.attemptId);
    if (!attempt || attempt.runId !== input.runId) {
      return { valid: false, failure: this.workerFailure("not_found") };
    }
    const lease = this.lease(input.workspaceLeaseId);
    if (!lease || lease.attemptId !== attempt.attemptId) {
      return { valid: false, failure: this.workerFailure("not_found", attempt) };
    }
    if (attempt.revision !== input.expectedAttemptRevision) {
      return {
        valid: false,
        failure: this.workerFailure("stale_attempt_revision", attempt, lease),
      };
    }
    if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
      return {
        valid: false,
        failure: this.workerFailure("stale_workspace_revision", attempt, lease),
      };
    }
    if (lease.status !== "active") {
      return { valid: false, failure: this.workerFailure("workspace_not_active", attempt, lease) };
    }
    if (
      lease.controllerId !== input.controller.controllerId ||
      lease.controllerLeaseId !== input.controller.leaseId ||
      lease.fencingToken !== input.controller.fencingToken
    ) {
      return { valid: false, failure: this.workerFailure("stale_fence", attempt, lease) };
    }
    if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
      return { valid: false, failure: this.workerFailure("workspace_expired", attempt, lease) };
    }
    if (
      parseInstant(input.now, "now") < parseInstant(attempt.updatedAt, "attempt.updatedAt") ||
      parseInstant(input.now, "now") < parseInstant(lease.heartbeatAt, "lease.heartbeatAt")
    ) {
      return { valid: false, failure: this.workerFailure("invalid_time", attempt, lease) };
    }
    return { valid: true, attempt, lease };
  }

  private validateSession(
    session: WorkerSessionRecord | null,
    input: HeartbeatWorkerSessionInput | EndWorkerSessionInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord
  ): WorkerSessionMutationResult | null {
    if (attempt.status !== "running") {
      return this.workerFailure("invalid_attempt_transition", attempt, lease, session ?? undefined);
    }
    if (
      !session ||
      session.runId !== input.runId ||
      session.attemptId !== input.attemptId ||
      session.workspaceLeaseId !== input.workspaceLeaseId
    ) {
      return this.workerFailure("not_found", attempt, lease);
    }
    if (session.revision !== input.expectedSessionRevision) {
      return this.workerFailure("stale_session_revision", attempt, lease, session);
    }
    if (isTerminalWorkerSession(session.status)) {
      return this.workerFailure("worker_session_not_active", attempt, lease, session);
    }
    return null;
  }

  private recordWorker(
    input: AttachWorkerSessionInput | HeartbeatWorkerSessionInput | EndWorkerSessionInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    session: WorkerSessionRecord,
    type: WorkerSessionEventType,
    payload: JsonRecord
  ): WorkerSessionMutationResult {
    const sequence = (
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS value
           FROM worker_session_events WHERE runId = ?`
        )
        .get(input.runId) as { value: number }
    ).value;
    this.db
      .prepare(
        `INSERT INTO worker_session_events (runId, attemptId, sessionId, mutationId, sequence,
         attemptRevision, workspaceLeaseRevision, sessionRevision, controllerId,
         controllerLeaseId, fencingToken, type, payloadJson, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        attempt.attemptId,
        session.sessionId,
        input.mutationId,
        sequence,
        attempt.revision,
        lease.revision,
        session.revision,
        input.controller.controllerId,
        input.controller.leaseId,
        input.controller.fencingToken,
        type,
        json(payload),
        instant(input.now)
      );
    const event = toWorkerEvent(
      this.db
        .prepare(`SELECT * FROM worker_session_events WHERE runId = ? AND mutationId = ?`)
        .get(input.runId, input.mutationId) as WorkerEventRow
    );
    return { updated: true, attempt, workerSession: session, event, idempotentReplay: false };
  }

  private workerFailure(
    reason: WorkerSessionMutationFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    session?: WorkerSessionRecord,
    currentRunRevision?: number
  ): WorkerSessionMutationResult {
    return {
      updated: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(session ? { currentSessionRevision: session.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private mutate(
    input: MutationInput,
    action: () => WorkspaceMutationResult
  ): WorkspaceMutationResult {
    if (!Number.isFinite(Date.parse(input.now))) return this.failure("invalid_time");
    if (input.controller.runId !== input.runId) return this.failure("lease_mismatch");
    return this.immediateTransaction(() => {
      const coordination = this.db
        .prepare(
          `SELECT revision, controllerId, leaseId, fencingToken, expiresAt FROM run_coordination WHERE runId = ?`
        )
        .get(input.runId) as
        | {
            revision: number;
            controllerId: string | null;
            leaseId: string | null;
            fencingToken: number;
            expiresAt: string | null;
          }
        | undefined;
      if (!coordination?.controllerId) return this.failure("no_active_lease");
      if (coordination.fencingToken !== input.controller.fencingToken)
        return this.failure("stale_fence");
      if (
        coordination.controllerId !== input.controller.controllerId ||
        coordination.leaseId !== input.controller.leaseId
      )
        return this.failure("lease_mismatch");
      if (coordination.revision !== input.expectedRunRevision)
        return this.failure("stale_run_revision", undefined, undefined, coordination.revision);
      if (parseInstant(coordination.expiresAt!, "expiresAt") <= parseInstant(input.now, "now"))
        return this.failure("lease_expired");

      const fingerprint = canonicalJSONStringify(input as unknown as JsonValue);
      const workerClaim = this.db
        .prepare(
          `SELECT 1 FROM worker_session_mutations WHERE runId = ? AND mutationId = ?
           UNION ALL SELECT 1 FROM attempt_receipt_mutations WHERE runId = ? AND mutationId = ?`
        )
        .get(input.runId, input.mutationId, input.runId, input.mutationId);
      if (workerClaim) return this.failure("mutation_conflict");
      const prior = this.db
        .prepare(
          `SELECT fingerprint, resultJson FROM workspace_lifecycle_mutations WHERE runId = ? AND mutationId = ?`
        )
        .get(input.runId, input.mutationId) as
        | { fingerprint: string; resultJson: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint) return this.failure("mutation_conflict");
        return { ...(JSON.parse(prior.resultJson) as Success), idempotentReplay: true };
      }
      const result = action();
      if (result.updated) {
        this.db
          .prepare(
            `INSERT INTO workspace_lifecycle_mutations (runId, mutationId, fingerprint, resultJson) VALUES (?, ?, ?, ?)`
          )
          .run(input.runId, input.mutationId, fingerprint, json(result));
      }
      return result;
    });
  }

  private mutateWorkspace(
    input:
      | HeartbeatWorkspaceInput
      | ReleaseWorkspaceInput
      | ReconcileWorkspaceInput
      | QuarantineWorkspaceInput,
    allowFenceTakeover: boolean,
    action: (
      attempt: AttemptRecord,
      lease: WorkspaceLifecycleLeaseRecord
    ) => WorkspaceMutationResult
  ): WorkspaceMutationResult {
    return this.mutate(input, () => {
      const attempt = this.attempt(input.attemptId);
      const failure = this.validateAttempt(attempt, input.runId, input.expectedAttemptRevision);
      if (failure) return failure;
      const lease = this.lease(input.workspaceLeaseId);
      if (!lease || lease.attemptId !== attempt!.attemptId)
        return this.failure("not_found", attempt!);
      if (lease.revision !== input.expectedWorkspaceLeaseRevision)
        return this.failure("stale_workspace_revision", attempt!, lease);
      if (lease.status !== "active" && lease.status !== "reserved")
        return this.failure("workspace_not_active", attempt!, lease);
      if (
        input.controller.fencingToken !== lease.fencingToken ||
        input.controller.controllerId !== lease.controllerId ||
        input.controller.leaseId !== lease.controllerLeaseId
      ) {
        if (!allowFenceTakeover) return this.failure("stale_fence", attempt!, lease);
      }
      if (
        parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "attempt.updatedAt") ||
        parseInstant(input.now, "now") < parseInstant(lease.heartbeatAt, "lease.heartbeatAt")
      )
        return this.failure("invalid_time", attempt!, lease);
      return action(attempt!, lease);
    });
  }

  private validateAttempt(
    attempt: AttemptRecord | null,
    runId: string,
    revision: number
  ): WorkspaceMutationResult | null {
    if (!attempt || attempt.runId !== runId) return this.failure("not_found");
    if (attempt.revision !== revision) return this.failure("stale_attempt_revision", attempt);
    return null;
  }

  private finish(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    status: "released" | "preserved" | "abandoned",
    disposition: "integrated" | "preserved" | "abandoned" | "discarded",
    type: WorkspaceLifecycleEventType
  ): WorkspaceMutationResult {
    const now = instant(input.now);
    this.bumpAttempt(attempt.attemptId, now);
    const observation = "observation" in input ? input.observation : undefined;
    this.db
      .prepare(
        `UPDATE workspace_leases SET revision = revision + 1, status = ?, cleanupDisposition = ?,
         releasedAt = ?, lastObservationJson = COALESCE(?, lastObservationJson) WHERE leaseId = ?`
      )
      .run(status, disposition, now, observation ? json(observation) : null, lease.leaseId);
    return this.record(
      input,
      this.requireAttempt(attempt.attemptId),
      this.requireLease(lease.leaseId),
      type,
      { action: status, disposition }
    );
  }

  private quarantine(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    reason: string,
    observation: WorkspaceObservation
  ): WorkspaceMutationResult {
    const now = instant(input.now);
    this.db
      .prepare(
        `UPDATE attempts SET revision = revision + 1, status = 'quarantined', updatedAt = ?,
         completedAt = ? WHERE attemptId = ?`
      )
      .run(now, now, attempt.attemptId);
    this.db
      .prepare(
        `UPDATE workspace_leases SET revision = revision + 1, status = 'quarantined',
         cleanupDisposition = 'preserved', releasedAt = ?, lastObservationJson = ? WHERE leaseId = ?`
      )
      .run(now, json(observation), lease.leaseId);
    return this.record(
      input,
      this.requireAttempt(attempt.attemptId),
      this.requireLease(lease.leaseId),
      "workspace_quarantined",
      { reason }
    );
  }

  private record(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord | null,
    type: WorkspaceLifecycleEventType,
    payload: JsonRecord
  ): WorkspaceMutationResult {
    const sequence = (
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM workspace_lifecycle_events WHERE runId = ?`
        )
        .get(input.runId) as { value: number }
    ).value;
    this.db
      .prepare(
        `INSERT INTO workspace_lifecycle_events (runId, attemptId, mutationId, sequence,
         attemptRevision, workspaceLeaseRevision, controllerId, controllerLeaseId,
         fencingToken, type, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        attempt.attemptId,
        input.mutationId,
        sequence,
        attempt.revision,
        lease?.revision ?? null,
        input.controller.controllerId,
        input.controller.leaseId,
        input.controller.fencingToken,
        type,
        json(payload),
        instant(input.now)
      );
    const event = toEvent(
      this.db
        .prepare(`SELECT * FROM workspace_lifecycle_events WHERE runId = ? AND mutationId = ?`)
        .get(input.runId, input.mutationId) as EventRow
    );
    return { updated: true, attempt, workspaceLease: lease, event, idempotentReplay: false };
  }

  private failure(
    reason: WorkspaceMutationFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    currentRunRevision?: number
  ): WorkspaceMutationResult {
    return {
      updated: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private attempt(id: string): AttemptRecord | null {
    return (
      (this.db.prepare(`SELECT * FROM attempts WHERE attemptId = ?`).get(id) as
        | AttemptRow
        | undefined) ?? null
    );
  }

  private requireAttempt(id: string): AttemptRecord {
    const value = this.attempt(id);
    if (!value) throw new Error(`Attempt '${id}' disappeared`);
    return value;
  }

  private lease(id: string): WorkspaceLifecycleLeaseRecord | null {
    const row = this.db.prepare(`SELECT * FROM workspace_leases WHERE leaseId = ?`).get(id) as
      | LeaseRow
      | undefined;
    if (!row) return null;
    return {
      leaseId: row.leaseId,
      runId: row.runId,
      runRevision: row.runRevision,
      workItemId: row.workItemId,
      workItemRevision: row.workItemRevision,
      packetId: row.packetId,
      packetHash: row.packetHash,
      attemptId: row.attemptId,
      revision: row.revision,
      controllerId: row.controllerId,
      controllerLeaseId: row.controllerLeaseId,
      fencingToken: row.fencingToken,
      repositoryId: row.repositoryId,
      hostId: row.hostId,
      gitRuntime: row.gitRuntime,
      projectRoot: row.projectRoot,
      branch: row.branch,
      worktreePath: row.worktreePath,
      baseSha: row.baseSha,
      status: row.status,
      acquiredAt: row.acquiredAt,
      heartbeatAt: row.heartbeatAt,
      expiresAt: row.expiresAt,
      ...(row.releasedAt ? { releasedAt: row.releasedAt } : {}),
      ...(row.cleanupDisposition ? { cleanupDisposition: row.cleanupDisposition } : {}),
      ...(row.lastObservationJson
        ? { lastObservation: JSON.parse(row.lastObservationJson) as WorkspaceObservation }
        : {}),
    };
  }

  private requireLease(id: string): WorkspaceLifecycleLeaseRecord {
    const value = this.lease(id);
    if (!value) throw new Error(`Workspace lease '${id}' disappeared`);
    return value;
  }

  private workerSession(id: string): WorkerSessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM worker_sessions WHERE sessionId = ?`).get(id) as
      | WorkerSessionRow
      | undefined;
    return row ? toWorkerSession(row) : null;
  }

  private launchEnvelopeBinding(attemptId: string): LaunchEnvelopeBindingRecord | null {
    return (
      (this.db
        .prepare(`SELECT * FROM launch_envelope_bindings WHERE attemptId = ?`)
        .get(attemptId) as LaunchEnvelopeBindingRecord | undefined) ?? null
    );
  }

  private taskPacketBinding(attemptId: string): TaskPacketBindingRecord | null {
    return (
      (this.db.prepare(`SELECT * FROM task_packet_bindings WHERE attemptId = ?`).get(attemptId) as
        | TaskPacketBindingRecord
        | undefined) ?? null
    );
  }

  private attemptReceipt(receiptId: string): AttemptReceiptRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM attempt_receipts WHERE receiptId = ?`)
      .get(receiptId) as AttemptReceiptRow | undefined;
    return row ? toAttemptReceipt(row) : null;
  }

  private requireAttemptReceipt(receiptId: string): AttemptReceiptRecord {
    const receipt = this.attemptReceipt(receiptId);
    if (!receipt) throw new Error(`Attempt receipt '${receiptId}' disappeared`);
    return receipt;
  }

  private attemptReceiptByHash(receiptHash: string): AttemptReceiptRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM attempt_receipts WHERE receiptHash = ?`)
      .get(receiptHash) as AttemptReceiptRow | undefined;
    return row ? toAttemptReceipt(row) : null;
  }

  private getReceiptForAttempt(attemptId: string): AttemptReceiptRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM attempt_receipts WHERE attemptId = ?`)
      .get(attemptId) as AttemptReceiptRow | undefined;
    return row ? toAttemptReceipt(row) : null;
  }

  private requireLaunchEnvelopeBinding(attemptId: string): LaunchEnvelopeBindingRecord {
    const binding = this.launchEnvelopeBinding(attemptId);
    if (!binding) throw new Error(`Launch envelope binding for Attempt '${attemptId}' disappeared`);
    return binding;
  }

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    );
  }

  private requireWorkerSession(id: string): WorkerSessionRecord {
    const session = this.workerSession(id);
    if (!session) throw new Error(`Worker session '${id}' disappeared`);
    return session;
  }

  private workerSessionForAttempt(
    attemptId: string,
    nonterminalOnly: boolean
  ): WorkerSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM worker_sessions WHERE attemptId = ?
         ${nonterminalOnly ? "AND status IN ('starting','running','awaiting_human')" : ""}
         ORDER BY startedAt DESC, sessionId DESC LIMIT 1`
      )
      .get(attemptId) as WorkerSessionRow | undefined;
    return row ? toWorkerSession(row) : null;
  }

  private workerSessionForNativeIdentity(
    hostId: string,
    backend: WorkerSessionRecord["backend"],
    workerId: string
  ): WorkerSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM worker_sessions WHERE hostId = ? AND backend = ? AND workerId = ?
         AND status IN ('starting','running','awaiting_human') LIMIT 1`
      )
      .get(hostId, backend, workerId) as WorkerSessionRow | undefined;
    return row ? toWorkerSession(row) : null;
  }

  private bumpAttempt(id: string, now: string): void {
    this.db
      .prepare(`UPDATE attempts SET revision = revision + 1, updatedAt = ? WHERE attemptId = ?`)
      .run(now, id);
  }

  private applyWorkspaceMigration(): void {
    let sql = INLINE_WORKSPACE_MIGRATION;
    try {
      const workspacePath = fileURLToPath(
        new URL("./migrations/002-attempt-workspace-lifecycle.sql", import.meta.url)
      );
      const workerPath = fileURLToPath(
        new URL("./migrations/003-worker-session-lifecycle.sql", import.meta.url)
      );
      const receiptPath = fileURLToPath(
        new URL("./migrations/004-attempt-receipt-persistence.sql", import.meta.url)
      );
      const packetPath = fileURLToPath(
        new URL("./migrations/005-task-packet-snapshot-persistence.sql", import.meta.url)
      );
      sql = `${readFileSync(workspacePath, "utf8")}\n${readFileSync(workerPath, "utf8")}\n${readFileSync(receiptPath, "utf8")}\n${readFileSync(packetPath, "utf8")}`;
    } catch {
      // Published bundles use the equivalent inline migration above.
    }
    this.db.exec(sql);
  }
}

function instant(value: string): string {
  return new Date(parseInstant(value, "now")).toISOString();
}

function validTtl(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function requiresLiveWorkspace(status: AttemptRecord["status"]): boolean {
  return !["prepared", "leased", "cancelled", "quarantined"].includes(status);
}

function sameIdentity(expected: WorkspaceIdentity, observed: WorkspaceObservation): boolean {
  return (
    expected.repositoryId === observed.repositoryId &&
    expected.hostId === observed.hostId &&
    expected.gitRuntime === observed.gitRuntime &&
    expected.projectRoot === observed.projectRoot &&
    expected.branch === observed.branch &&
    expected.worktreePath === observed.worktreePath &&
    expected.attemptId === observed.attemptId
  );
}

function isLaunchReadyWorkspace(lease: WorkspaceLifecycleLeaseRecord): boolean {
  const observed = lease.lastObservation;
  return Boolean(
    observed &&
    observed.exists &&
    observed.registered &&
    sameIdentity(lease, observed) &&
    observed.cleanliness === "clean" &&
    observed.headSha === lease.baseSha &&
    observed.reason === undefined
  );
}

function bindEvidence(
  attempt: AttemptRecord,
  input: TransitionAttemptInput
): { receiptId: string | null; verificationId: string | null } | null {
  let receiptId = attempt.receiptId;
  let verificationId = attempt.verificationId;
  if (input.receiptId !== undefined) {
    if (input.receiptId.length === 0 || (receiptId !== null && receiptId !== input.receiptId))
      return null;
    receiptId = input.receiptId;
  }
  if (input.verificationId !== undefined) {
    if (
      input.verificationId.length === 0 ||
      (verificationId !== null && verificationId !== input.verificationId)
    )
      return null;
    verificationId = input.verificationId;
  }
  if (
    ["receipt_submitted", "verifying", "verified", "accepted", "rejected", "inconclusive"].includes(
      input.status
    ) &&
    receiptId === null
  )
    return null;
  if (
    ["verified", "accepted", "rejected", "inconclusive"].includes(input.status) &&
    verificationId === null
  )
    return null;
  return { receiptId, verificationId };
}

function json(value: unknown): string {
  return canonicalJSONStringify(cloneJsonValue(value as JsonValue));
}

function toEvent(row: EventRow): WorkspaceLifecycleEvent {
  return {
    runId: row.runId,
    attemptId: row.attemptId,
    mutationId: row.mutationId,
    sequence: row.sequence,
    attemptRevision: row.attemptRevision,
    workspaceLeaseRevision: row.workspaceLeaseRevision,
    controllerId: row.controllerId,
    controllerLeaseId: row.controllerLeaseId,
    fencingToken: row.fencingToken,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as JsonValue,
    createdAt: row.createdAt,
  };
}

function toWorkerSession(row: WorkerSessionRow): WorkerSessionRecord {
  return {
    sessionId: row.sessionId,
    revision: row.revision,
    runId: row.runId,
    attemptId: row.attemptId,
    packetId: row.packetId,
    packetHash: row.packetHash,
    workspaceLeaseId: row.workspaceLeaseId,
    workspaceLeaseRevision: row.workspaceLeaseRevision,
    executionEnvelopeId: row.executionEnvelopeId,
    executionEnvelopeHash: row.executionEnvelopeHash,
    hostId: row.hostId,
    workerRuntime: row.workerRuntime,
    gitRuntime: row.gitRuntime,
    backend: row.backend,
    workerId: row.workerId,
    ...(row.model ? { model: row.model } : {}),
    status: row.status,
    startedAt: row.startedAt,
    heartbeatAt: row.heartbeatAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.exitReason ? { exitReason: row.exitReason } : {}),
    ...(row.exitCode !== null ? { exitCode: row.exitCode } : {}),
    ...(row.exitSummary ? { exitSummary: row.exitSummary } : {}),
  };
}

function toWorkerEvent(row: WorkerEventRow): WorkerSessionEvent {
  return {
    runId: row.runId,
    attemptId: row.attemptId,
    sessionId: row.sessionId,
    mutationId: row.mutationId,
    sequence: row.sequence,
    attemptRevision: row.attemptRevision,
    workspaceLeaseRevision: row.workspaceLeaseRevision,
    sessionRevision: row.sessionRevision,
    controllerId: row.controllerId,
    controllerLeaseId: row.controllerLeaseId,
    fencingToken: row.fencingToken,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as JsonValue,
    createdAt: row.createdAt,
  };
}

function toAttemptReceipt(row: AttemptReceiptRow): AttemptReceiptRecord {
  return {
    receiptId: row.receiptId,
    receiptHash: row.receiptHash,
    receiptJson: row.receiptJson,
    runId: row.runId,
    workItemId: row.workItemId,
    workItemRevision: row.workItemRevision,
    attemptId: row.attemptId,
    packetId: row.packetId,
    packetHash: row.packetHash,
    workspaceLeaseId: row.workspaceLeaseId,
    workspaceLeaseRevision: row.workspaceLeaseRevision,
    workerSessionId: row.workerSessionId,
    workerSessionRevision: row.workerSessionRevision,
    workerRuntime: row.workerRuntime,
    observedBaseSha: row.observedBaseSha,
    ...(row.finalHeadSha ? { finalHeadSha: row.finalHeadSha } : {}),
    ...(row.patchHash ? { patchHash: row.patchHash } : {}),
    outcome: row.outcome,
    disposition: row.disposition,
    submittedAt: row.submittedAt,
    recordedAt: row.recordedAt,
    controllerId: row.controllerId,
    controllerLeaseId: row.controllerLeaseId,
    fencingToken: row.fencingToken,
    resultingAttemptRevision: row.resultingAttemptRevision,
    resultingAttemptStatus: row.resultingAttemptStatus,
  };
}

function toAttemptReceiptEvent(row: AttemptReceiptEventRow): AttemptReceiptEvent {
  return {
    runId: row.runId,
    attemptId: row.attemptId,
    receiptId: row.receiptId,
    receiptHash: row.receiptHash,
    mutationId: row.mutationId,
    sequence: row.sequence,
    attemptRevision: row.attemptRevision,
    workspaceLeaseRevision: row.workspaceLeaseRevision,
    workerSessionRevision: row.workerSessionRevision,
    controllerId: row.controllerId,
    controllerLeaseId: row.controllerLeaseId,
    fencingToken: row.fencingToken,
    type: row.type,
    disposition: row.disposition,
    outcome: row.outcome,
    createdAt: row.createdAt,
  };
}

function isTerminalWorkerSession(status: WorkerSessionRecord["status"]): boolean {
  return ["completed", "failed", "cancelled", "lost"].includes(status);
}

function validExitMetadata(input: EndWorkerSessionInput): boolean {
  return (
    (input.exitReason === undefined || Buffer.byteLength(input.exitReason, "utf8") <= 128) &&
    (input.exitSummary === undefined || Buffer.byteLength(input.exitSummary, "utf8") <= 4_096) &&
    (input.exitCode === undefined || Number.isSafeInteger(input.exitCode))
  );
}

function sqliteLaunchBindingFailure(
  input: BindLaunchEnvelopeInput,
  attempt: AttemptRecord | null,
  lease: WorkspaceLifecycleLeaseRecord | null
): LaunchEnvelopeBindingResult | null {
  if (
    !attempt ||
    attempt.runId !== input.runId ||
    !lease ||
    lease.attemptId !== attempt.attemptId
  ) {
    return sqliteLaunchFailure("not_found", attempt ?? undefined, lease ?? undefined);
  }
  if (attempt.revision !== input.expectedAttemptRevision) {
    return sqliteLaunchFailure("stale_attempt_revision", attempt, lease);
  }
  if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
    return sqliteLaunchFailure("stale_workspace_revision", attempt, lease);
  }
  if (attempt.status !== "launching") {
    return sqliteLaunchFailure("invalid_attempt_transition", attempt, lease);
  }
  if (lease.status !== "active") {
    return sqliteLaunchFailure("workspace_not_active", attempt, lease);
  }
  if (
    lease.controllerId !== input.controller.controllerId ||
    lease.controllerLeaseId !== input.controller.leaseId ||
    lease.fencingToken !== input.controller.fencingToken
  ) {
    return sqliteLaunchFailure("stale_fence", attempt, lease);
  }
  if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.createdAt, "createdAt")) {
    return sqliteLaunchFailure("workspace_expired", attempt, lease);
  }
  return null;
}

function sqliteLaunchFailure(
  reason: WorkspaceMutationFailureReason,
  attempt?: AttemptRecord,
  lease?: WorkspaceLifecycleLeaseRecord
): LaunchEnvelopeBindingResult {
  return {
    bound: false,
    reason,
    ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
    ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
  };
}

function isMatchingLaunchAuthorization(
  event: WorkspaceLifecycleEvent | undefined,
  input: BindLaunchEnvelopeInput
): boolean {
  if (!event || !isJsonRecord(event.payload)) return false;
  return (
    event.runId === input.runId &&
    event.attemptId === input.attemptId &&
    event.type === "attempt_transitioned" &&
    event.attemptRevision === input.expectedAttemptRevision &&
    event.workspaceLeaseRevision === input.expectedWorkspaceLeaseRevision &&
    event.controllerId === input.controller.controllerId &&
    event.controllerLeaseId === input.controller.leaseId &&
    event.fencingToken === input.controller.fencingToken &&
    event.payload.status === "launching" &&
    parseInstant(event.createdAt, "authorization.createdAt") <=
      parseInstant(input.createdAt, "createdAt")
  );
}

function validateCanonicalEnvelope(
  input: BindLaunchEnvelopeInput,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord
): JsonRecord | null {
  if (Buffer.byteLength(input.envelopeJson, "utf8") > 256 * 1024) return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(input.envelopeJson);
  } catch {
    return null;
  }
  if (!isJsonRecord(envelope) || canonicalJSONStringify(envelope) !== input.envelopeJson)
    return null;
  if (input.envelopeHash !== computeCanonicalHash(envelope)) return null;
  const runtime = envelope.runtime;
  const paths = envelope.paths;
  if (!isJsonRecord(runtime) || !isJsonRecord(paths)) return null;
  return envelope.envelope_id === input.envelopeId &&
    envelope.run_id === input.runId &&
    envelope.attempt_id === input.attemptId &&
    envelope.packet_id === attempt.packetId &&
    envelope.packet_hash === attempt.packetHash &&
    envelope.workspace_lease_id === input.workspaceLeaseId &&
    envelope.workspace_lease_revision === input.expectedWorkspaceLeaseRevision &&
    envelope.expected_head_sha === attempt.baseSha &&
    envelope.branch === lease.branch &&
    envelope.created_at === input.createdAt &&
    runtime.host_id === lease.hostId &&
    runtime.git_runtime === lease.gitRuntime &&
    paths.worktree_root === lease.worktreePath
    ? envelope
    : null;
}

function validateCanonicalTaskPacket(
  packetJson: string,
  attempt: AttemptRecord
): AgentTaskPacket_v1 | null {
  if (Buffer.byteLength(packetJson, "utf8") > 256 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(packetJson);
  } catch {
    return null;
  }
  if (!isJsonRecord(value) || canonicalJSONStringify(value) !== packetJson) return null;
  const parsed = AgentTaskPacket_v1.safeParse(value);
  if (!parsed.success) return null;
  const packet = parsed.data;
  return packet.run_id === attempt.runId &&
    packet.attempt_id === attempt.attemptId &&
    packet.work_item.work_item_id === attempt.workItemId &&
    packet.work_item.revision === attempt.workItemRevision &&
    packet.packet_id === attempt.packetId &&
    packet.packet_hash === attempt.packetHash &&
    packet.repository.base_sha === attempt.baseSha
    ? packet
    : null;
}

function sameTaskPacketBinding(
  existing: TaskPacketBindingRecord | null,
  packetJson: string | undefined,
  attempt: AttemptRecord | null
): boolean {
  if (!attempt) return false;
  return existing
    ? packetJson !== undefined &&
        existing.packetJson === packetJson &&
        validateTaskPacketBinding(existing, attempt)
    : packetJson === undefined;
}

function validateTaskPacketBinding(
  binding: TaskPacketBindingRecord,
  attempt: AttemptRecord
): boolean {
  return (
    binding.runId === attempt.runId &&
    binding.attemptId === attempt.attemptId &&
    binding.workItemId === attempt.workItemId &&
    binding.workItemRevision === attempt.workItemRevision &&
    binding.packetId === attempt.packetId &&
    binding.packetHash === attempt.packetHash &&
    Number.isFinite(Date.parse(binding.createdAt)) &&
    validateCanonicalTaskPacket(binding.packetJson, attempt) !== null
  );
}

function sameLaunchBinding(
  existing: LaunchEnvelopeBindingRecord,
  input: BindLaunchEnvelopeInput
): boolean {
  return (
    existing.runId === input.runId &&
    existing.workspaceLeaseId === input.workspaceLeaseId &&
    existing.attemptRevision === input.expectedAttemptRevision &&
    existing.workspaceLeaseRevision === input.expectedWorkspaceLeaseRevision &&
    existing.authorizationMutationId === input.authorizationMutationId &&
    existing.envelopeId === input.envelopeId &&
    existing.envelopeHash === input.envelopeHash &&
    existing.envelopeJson === input.envelopeJson &&
    existing.controllerId === input.controller.controllerId &&
    existing.controllerLeaseId === input.controller.leaseId &&
    existing.fencingToken === input.controller.fencingToken &&
    existing.createdAt === instant(input.createdAt)
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundWorkerRuntime(binding: LaunchEnvelopeBindingRecord): string | null {
  try {
    const envelope = JSON.parse(binding.envelopeJson) as unknown;
    if (!isJsonRecord(envelope) || !isJsonRecord(envelope.runtime)) return null;
    return typeof envelope.runtime.worker_runtime === "string"
      ? envelope.runtime.worker_runtime
      : null;
  } catch {
    return null;
  }
}

function validReceiptBinding(
  receipt: import("../../schemas/agent-work.js").AgentTaskReceipt_v2,
  input: SubmitAttemptReceiptInput,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord,
  session: WorkerSessionRecord
): boolean {
  const started = parseInstant(receipt.worker_started_at, "worker_started_at");
  const completed = parseInstant(receipt.worker_completed_at, "worker_completed_at");
  return (
    receipt.run_id === input.runId &&
    receipt.attempt_id === input.attemptId &&
    receipt.work_item_id === attempt.workItemId &&
    receipt.work_item_revision === attempt.workItemRevision &&
    receipt.packet_id === attempt.packetId &&
    receipt.packet_hash === attempt.packetHash &&
    receipt.workspace_lease_id === input.workspaceLeaseId &&
    lease.attemptId === attempt.attemptId &&
    receipt.workspace_lease_revision === session.workspaceLeaseRevision &&
    receipt.worker_session_id === input.workerSessionId &&
    session.runId === input.runId &&
    session.attemptId === input.attemptId &&
    session.packetId === attempt.packetId &&
    session.packetHash === attempt.packetHash &&
    session.workspaceLeaseId === input.workspaceLeaseId &&
    receipt.worker_runtime === session.workerRuntime &&
    receipt.observed_base_sha === attempt.baseSha.toLowerCase() &&
    started >= parseInstant(session.startedAt, "session.startedAt") &&
    Boolean(session.endedAt) &&
    completed <= parseInstant(session.endedAt!, "session.endedAt") &&
    parseInstant(receipt.submitted_at, "submitted_at") <= parseInstant(input.now, "now")
  );
}

function isTerminalAttempt(status: AttemptRecord["status"]): boolean {
  return [
    "accepted",
    "rejected",
    "inconclusive",
    "blocked",
    "launch_failed",
    "failed",
    "cancelled",
    "quarantined",
  ].includes(status);
}

function requiresDurableReceipt(status: AttemptRecord["status"]): boolean {
  return ["verifying", "verified", "accepted", "rejected", "inconclusive"].includes(status);
}
