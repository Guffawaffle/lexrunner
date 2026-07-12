import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import { calculateExpiry, cloneJsonValue, parseInstant } from "../coordination-store.js";
import type { JsonValue } from "../coordination-store.js";
import type {
  AcquireWorkspaceInput,
  AttemptRecord,
  CreateAttemptInput,
  HeartbeatWorkspaceInput,
  QuarantineWorkspaceInput,
  ReconcileWorkspaceInput,
  ReleaseWorkspaceInput,
  TransitionAttemptInput,
  WorkspaceIdentity,
  WorkspaceLifecycleLeaseRecord,
  WorkspaceLifecycleEvent,
  WorkspaceLifecycleEventType,
  WorkspaceLifecycleStore,
  WorkspaceMutationFailureReason,
  WorkspaceMutationResult,
  WorkspaceObservation,
} from "../workspace-lifecycle-store.js";
import { SqliteCoordinationStore } from "./coordination-store.js";

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
  implements WorkspaceLifecycleStore
{
  constructor(dbPath: string) {
    super(dbPath);
    this.applyWorkspaceMigration();
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

  private bumpAttempt(id: string, now: string): void {
    this.db
      .prepare(`UPDATE attempts SET revision = revision + 1, updatedAt = ? WHERE attemptId = ?`)
      .run(now, id);
  }

  private applyWorkspaceMigration(): void {
    let sql = INLINE_WORKSPACE_MIGRATION;
    try {
      const path = fileURLToPath(
        new URL("./migrations/002-attempt-workspace-lifecycle.sql", import.meta.url)
      );
      sql = readFileSync(path, "utf8");
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
