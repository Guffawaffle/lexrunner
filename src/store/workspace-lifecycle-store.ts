import type { ControllerLeaseCredential, JsonValue } from "./coordination-store.js";
import { AGENT_WORK_CONTRACT_VERSION, Attempt_v1 } from "../schemas/agent-work.js";
import type { Attempt_v1 as AttemptContract_v1 } from "../schemas/agent-work.js";

/** Durable attempt state. Attempts exist before a workspace is allocated. */
export type AttemptStatus =
  | "prepared"
  | "leased"
  | "launching"
  | "running"
  | "receipt_submitted"
  | "verifying"
  | "verified"
  | "accepted"
  | "rejected"
  | "inconclusive"
  | "blocked"
  | "launch_failed"
  | "failed"
  | "cancelled"
  | "quarantined";

export interface AttemptRecord {
  attemptId: string;
  runId: string;
  runRevision: number;
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  baseSha: string;
  revision: number;
  status: AttemptStatus;
  workspaceLeaseId: string | null;
  receiptId: string | null;
  verificationId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type WorkspaceLifecycleLeaseStatus =
  | "reserved"
  | "active"
  | "released"
  | "preserved"
  | "abandoned"
  | "quarantined";

export type WorkspaceCleanupDisposition = "integrated" | "preserved" | "abandoned" | "discarded";

export interface WorkspaceIdentity {
  repositoryId: string;
  hostId: string;
  gitRuntime: string;
  projectRoot: string;
  branch: string;
  worktreePath: string;
  attemptId: string;
}

/** Facts observed by a Git adapter. The store never probes Git itself. */
export interface WorkspaceObservation {
  exists: boolean;
  registered: boolean;
  repositoryId: string | null;
  hostId: string;
  gitRuntime: string;
  projectRoot: string | null;
  branch: string | null;
  worktreePath: string;
  attemptId: string | null;
  headSha: string | null;
  cleanliness: "clean" | "dirty";
  dirtyPaths?: string[];
  reason?: string;
}

/**
 * Controller-local persistence for workspace ownership and reconciliation.
 * This is deliberately distinct from the portable `WorkspaceLease_v1`
 * protocol contract: the broker later combines this machine-local state with
 * the immutable scope and authority from the task packet.
 */
export interface WorkspaceLifecycleLeaseRecord extends WorkspaceIdentity {
  leaseId: string;
  runId: string;
  runRevision: number;
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  revision: number;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  baseSha: string;
  status: WorkspaceLifecycleLeaseStatus;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt?: string;
  cleanupDisposition?: WorkspaceCleanupDisposition;
  lastObservation?: WorkspaceObservation;
}

export type WorkspaceLifecycleEventType =
  | "attempt_created"
  | "attempt_transitioned"
  | "workspace_acquired"
  | "workspace_heartbeat"
  | "workspace_released"
  | "workspace_reconciled"
  | "workspace_quarantined";

export interface WorkspaceLifecycleEvent {
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
  payload: JsonValue;
  createdAt: string;
}

export type WorkerSessionBackend = "host-subagent" | "codex-cli" | "external";
export type WorkerSessionStatus =
  | "starting"
  | "running"
  | "awaiting_human"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

/** Durable identity and observed lifecycle for one native worker attached to an Attempt. */
export interface WorkerSessionRecord {
  sessionId: string;
  revision: number;
  runId: string;
  attemptId: string;
  packetId: string;
  packetHash: string;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  executionEnvelopeId: string;
  executionEnvelopeHash: string;
  hostId: string;
  workerRuntime: string;
  gitRuntime: string;
  backend: WorkerSessionBackend;
  workerId: string;
  model?: string;
  status: WorkerSessionStatus;
  startedAt: string;
  heartbeatAt: string;
  endedAt?: string;
  exitReason?: string;
  exitCode?: number;
  exitSummary?: string;
}

/** Immutable canonical envelope authorized for one launching Attempt. */
export interface LaunchEnvelopeBindingRecord {
  runId: string;
  attemptId: string;
  workspaceLeaseId: string;
  attemptRevision: number;
  workspaceLeaseRevision: number;
  authorizationMutationId: string;
  envelopeId: string;
  envelopeHash: string;
  envelopeJson: string;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  createdAt: string;
}

export type WorkerSessionEventType =
  | "worker_session_attached"
  | "worker_session_heartbeat"
  | "worker_session_ended";

export interface WorkerSessionEvent {
  runId: string;
  attemptId: string;
  sessionId: string;
  mutationId: string;
  sequence: number;
  attemptRevision: number;
  workspaceLeaseRevision: number;
  sessionRevision: number;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  type: WorkerSessionEventType;
  payload: JsonValue;
  createdAt: string;
}

interface AuthenticatedMutationInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
}

interface AuthenticatedWorkerMutationInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
}

export interface AttachWorkerSessionInput extends AuthenticatedWorkerMutationInput {
  sessionId: string;
  packetId: string;
  packetHash: string;
  executionEnvelopeId: string;
  executionEnvelopeHash: string;
  hostId: string;
  workerRuntime: string;
  gitRuntime: string;
  backend: WorkerSessionBackend;
  workerId: string;
  model?: string;
  startedAt: string;
}

export interface BindLaunchEnvelopeInput {
  runId: string;
  attemptId: string;
  workspaceLeaseId: string;
  expectedRunRevision: number;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  controller: ControllerLeaseCredential;
  authorizationMutationId: string;
  envelopeId: string;
  envelopeHash: string;
  envelopeJson: string;
  createdAt: string;
}

export type LaunchEnvelopeBindingResult =
  | { bound: true; binding: LaunchEnvelopeBindingRecord; idempotentReplay: boolean }
  | {
      bound: false;
      reason: WorkspaceMutationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentRunRevision?: number;
    };

export interface HeartbeatWorkerSessionInput extends AuthenticatedWorkerMutationInput {
  sessionId: string;
  expectedSessionRevision: number;
  status?: "running" | "awaiting_human";
}

export interface EndWorkerSessionInput extends AuthenticatedWorkerMutationInput {
  sessionId: string;
  expectedSessionRevision: number;
  status: "completed" | "failed" | "cancelled" | "lost";
  exitReason?: string;
  exitCode?: number;
  exitSummary?: string;
}

export type WorkerSessionMutationFailureReason =
  | WorkspaceMutationFailureReason
  | "stale_session_revision"
  | "worker_session_not_active"
  | "worker_session_conflict";

export type WorkerSessionMutationResult =
  | {
      updated: true;
      attempt: AttemptRecord;
      workerSession: WorkerSessionRecord;
      event: WorkerSessionEvent;
      idempotentReplay: boolean;
    }
  | {
      updated: false;
      reason: WorkerSessionMutationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

export interface CreateAttemptInput extends AuthenticatedMutationInput {
  attemptId: string;
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  baseSha: string;
}

export interface AcquireWorkspaceInput extends AuthenticatedMutationInput, WorkspaceIdentity {
  workspaceLeaseId: string;
  workItemId: string;
  baseSha: string;
  expectedAttemptRevision: number;
  ttlMs: number;
  observation?: WorkspaceObservation;
}

export interface TransitionAttemptInput extends AuthenticatedMutationInput {
  attemptId: string;
  expectedAttemptRevision: number;
  status: AttemptStatus;
  receiptId?: string;
  verificationId?: string;
  details?: JsonValue;
}

export interface HeartbeatWorkspaceInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  ttlMs: number;
  observation: WorkspaceObservation;
}

export interface ReleaseWorkspaceInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  disposition: "integrated" | "discarded";
  observation: WorkspaceObservation;
}

export interface ReconcileWorkspaceInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  action: "resume" | "release" | "preserve" | "abandon";
  ttlMs?: number;
  observation: WorkspaceObservation;
}

export interface QuarantineWorkspaceInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  reason: string;
  observation: WorkspaceObservation;
}

export type WorkspaceMutationFailureReason =
  | "not_found"
  | "no_active_lease"
  | "lease_mismatch"
  | "stale_fence"
  | "lease_expired"
  | "stale_run_revision"
  | "workspace_expired"
  | "invalid_time"
  | "stale_attempt_revision"
  | "stale_workspace_revision"
  | "attempt_not_live"
  | "workspace_not_active"
  | "live_attempt_conflict"
  | "branch_conflict"
  | "worktree_conflict"
  | "identity_mismatch"
  | "dirty_workspace"
  | "mutation_conflict"
  | "invalid_reconciliation"
  | "invalid_attempt_transition"
  | "evidence_mismatch";

export type WorkspaceMutationResult =
  | {
      updated: true;
      attempt: AttemptRecord;
      workspaceLease: WorkspaceLifecycleLeaseRecord | null;
      event: WorkspaceLifecycleEvent;
      idempotentReplay: boolean;
    }
  | {
      updated: false;
      reason: WorkspaceMutationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentRunRevision?: number;
    };

export interface WorkspaceLifecycleStore {
  createAttempt(input: CreateAttemptInput): Promise<WorkspaceMutationResult>;
  transitionAttempt(input: TransitionAttemptInput): Promise<WorkspaceMutationResult>;
  acquireWorkspace(input: AcquireWorkspaceInput): Promise<WorkspaceMutationResult>;
  heartbeatWorkspace(input: HeartbeatWorkspaceInput): Promise<WorkspaceMutationResult>;
  releaseWorkspace(input: ReleaseWorkspaceInput): Promise<WorkspaceMutationResult>;
  reconcileWorkspace(input: ReconcileWorkspaceInput): Promise<WorkspaceMutationResult>;
  quarantineWorkspace(input: QuarantineWorkspaceInput): Promise<WorkspaceMutationResult>;
  getAttempt(attemptId: string): Promise<AttemptRecord | null>;
  getWorkspaceLease(leaseId: string): Promise<WorkspaceLifecycleLeaseRecord | null>;
  listWorkspaceLifecycleEvents(runId: string): Promise<WorkspaceLifecycleEvent[]>;
}

/** Additive binding port for Stage 3 launch envelopes. */
export interface LaunchEnvelopeBindingStore {
  bindLaunchEnvelope(input: BindLaunchEnvelopeInput): Promise<LaunchEnvelopeBindingResult>;
  getLaunchEnvelopeBinding(attemptId: string): Promise<LaunchEnvelopeBindingRecord | null>;
}

/** Additive Stage 3 persistence port; kept separate from the Stage 1 workspace contract. */
export interface WorkerSessionStore {
  attachWorkerSession(input: AttachWorkerSessionInput): Promise<WorkerSessionMutationResult>;
  heartbeatWorkerSession(input: HeartbeatWorkerSessionInput): Promise<WorkerSessionMutationResult>;
  endWorkerSession(input: EndWorkerSessionInput): Promise<WorkerSessionMutationResult>;
  getWorkerSession(sessionId: string): Promise<WorkerSessionRecord | null>;
  getWorkerSessionForAttempt(attemptId: string): Promise<WorkerSessionRecord | null>;
  listWorkerSessionEvents(runId: string): Promise<WorkerSessionEvent[]>;
}

/**
 * Convert the store's camel-case persistence model at the protocol boundary.
 * Parsing here ensures every returned Attempt remains valid under the public
 * strict contract instead of allowing the two representations to drift.
 */
export function toAttemptContract(record: AttemptRecord): AttemptContract_v1 {
  return Attempt_v1.parse({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    attempt_id: record.attemptId,
    revision: record.revision,
    run_id: record.runId,
    run_revision: record.runRevision,
    work_item_id: record.workItemId,
    work_item_revision: record.workItemRevision,
    packet_id: record.packetId,
    packet_hash: record.packetHash,
    base_sha: record.baseSha,
    ...(record.workspaceLeaseId ? { workspace_lease_id: record.workspaceLeaseId } : {}),
    ...(record.receiptId ? { receipt_id: record.receiptId } : {}),
    ...(record.verificationId ? { verification_id: record.verificationId } : {}),
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    ...(record.completedAt ? { completed_at: record.completedAt } : {}),
  });
}
