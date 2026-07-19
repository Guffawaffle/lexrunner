import type { ControllerLeaseCredential, JsonValue } from "./coordination-store.js";
import { AGENT_WORK_CONTRACT_VERSION, Attempt_v1 } from "../schemas/agent-work.js";
import type { Attempt_v1 as AttemptContract_v1 } from "../schemas/agent-work.js";
import type {
  AgentEngineVerification_v2,
  AgentTaskReceipt_v2,
  EngineVerificationTrustGapReason_v2,
} from "../schemas/agent-work.js";
import type {
  AgentTaskReceiptOutcome,
  AttemptReceiptFailureReason,
  AttemptReceiptDisposition,
  AttemptReceiptEventType,
  AttemptVerificationEventType,
  AttemptVerificationFailureReason,
  AttemptStatus,
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
  VerificationOutcome,
  WorkspaceCleanupDisposition,
  WorkspaceLifecycleEventType,
  WorkspaceLifecycleLeaseStatus,
  WorkspaceMutationFailureReason,
  WorkspaceObservation,
  WorkspaceReconciliationAction,
} from "./workspace-lifecycle-domains.js";

export type {
  AgentTaskReceiptOutcome,
  AttemptReceiptFailureReason,
  AttemptReceiptDisposition,
  AttemptReceiptEventType,
  AttemptVerificationEventType,
  AttemptVerificationFailureReason,
  AttemptStatus,
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
  VerificationOutcome,
  WorkspaceCleanupDisposition,
  WorkspaceLifecycleEventType,
  WorkspaceLifecycleLeaseStatus,
  WorkspaceMutationFailureReason,
  WorkspaceObservation,
  WorkspaceReconciliationAction,
} from "./workspace-lifecycle-domains.js";

/** Durable attempt state. Attempts exist before a workspace is allocated. */
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

export interface WorkspaceIdentity {
  repositoryId: string;
  hostId: string;
  gitRuntime: string;
  projectRoot: string;
  branch: string;
  worktreePath: string;
  attemptId: string;
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

/**
 * Immutable canonical AgentTaskPacket snapshot bound to the durable Attempt.
 *
 * The snapshot is written only as part of launch-envelope binding, so callers
 * cannot make a packet body appear after a worker has started.  It deliberately
 * retains the canonical JSON for later criterion/check reference validation;
 * consumers must parse it under AgentTaskPacket_v1 before acting on it.
 */
export interface TaskPacketBindingRecord {
  runId: string;
  attemptId: string;
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  packetJson: string;
  createdAt: string;
}

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

/** Redacted packet-authority decision made immediately before, or observed after, worker action. */
export interface WorkerAuthorityEventRecord {
  runId: string;
  attemptId: string;
  workerSessionId: string;
  mutationId: string;
  sequence: number;
  attemptRevision: number;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  workerSessionRevision: number;
  packetId: string;
  packetHash: string;
  dimension: WorkerAuthorityDimension;
  decision: WorkerAuthorityDecision;
  enforcement: WorkerAuthorityEnforcement;
  actionClass: string;
  actionHash: string;
  backendId: string;
  backendVersion: string;
  reason: WorkerAuthorityReason;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
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

export interface RecordWorkerAuthorityDecisionInput extends AuthenticatedMutationInput {
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  dimension: WorkerAuthorityDimension;
  decision: WorkerAuthorityDecision;
  enforcement: WorkerAuthorityEnforcement;
  actionClass: string;
  actionHash: string;
  backendId: string;
  backendVersion: string;
  reason: WorkerAuthorityReason;
}

export type WorkerAuthorityDecisionResult =
  | {
      recorded: true;
      event: WorkerAuthorityEventRecord;
      idempotentReplay: boolean;
    }
  | {
      recorded: false;
      reason: WorkerSessionMutationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

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
  /**
   * Required for every new launch-envelope binding. It remains optional in
   * the input type solely so callers can exactly replay an already-persisted
   * legacy envelope-only binding during compatibility migration; it must not
   * be omitted when creating a binding.
   */
  packetJson?: string;
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

export interface AttemptReceiptRecord {
  receiptId: string;
  receiptHash: string;
  receiptJson: string;
  runId: string;
  workItemId: string;
  workItemRevision: number;
  attemptId: string;
  packetId: string;
  packetHash: string;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  workerSessionId: string;
  workerSessionRevision: number;
  workerRuntime: string;
  observedBaseSha: string;
  finalHeadSha?: string;
  patchHash?: string;
  outcome: AgentTaskReceiptOutcome;
  disposition: AttemptReceiptDisposition;
  submittedAt: string;
  recordedAt: string;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  resultingAttemptRevision: number;
  resultingAttemptStatus: AttemptStatus;
}

export interface AttemptReceiptEvent {
  runId: string;
  attemptId: string;
  receiptId: string;
  receiptHash: string;
  mutationId: string;
  sequence: number;
  attemptRevision: number;
  workspaceLeaseRevision: number;
  workerSessionRevision: number;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  type: AttemptReceiptEventType;
  disposition: AttemptReceiptDisposition;
  outcome: AgentTaskReceiptOutcome;
  createdAt: string;
}

export interface SubmitAttemptReceiptInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  receipt: AgentTaskReceipt_v2;
}

export type AttemptReceiptSubmissionResult =
  | {
      submitted: true;
      receipt: AttemptReceiptRecord;
      attempt: AttemptRecord;
      event: AttemptReceiptEvent;
      idempotentReplay: boolean;
    }
  | {
      submitted: false;
      reason: AttemptReceiptFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

export interface AttemptVerificationRecord {
  verificationId: string;
  verificationHash: string;
  verificationJson: string;
  runId: string;
  workItemId: string;
  workItemRevision: number;
  attemptId: string;
  packetId: string;
  packetHash: string;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  workerSessionId: string;
  workerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
  observedBaseSha: string;
  verifiedHeadSha?: string;
  verifiedPatchHash?: string;
  workspaceObservationHash: string;
  outcome: VerificationOutcome;
  trustGapReasons: EngineVerificationTrustGapReason_v2[];
  verifierId: string;
  verifierVersion: string;
  startedAt: string;
  completedAt: string;
  recordedAt: string;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  resultingAttemptRevision: number;
  resultingAttemptStatus: AttemptStatus;
}

export interface AttemptVerificationAuthorizationRecord {
  verificationId: string;
  runId: string;
  attemptId: string;
  attemptRevision: number;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  workerSessionId: string;
  workerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  startedAt: string;
}

export interface AttemptVerificationEvent {
  runId: string;
  attemptId: string;
  verificationId: string;
  verificationHash: string | null;
  receiptId: string;
  receiptHash: string;
  mutationId: string;
  sequence: number;
  attemptRevision: number;
  workspaceLeaseRevision: number;
  workerSessionRevision: number;
  controllerId: string;
  controllerLeaseId: string;
  fencingToken: number;
  type: AttemptVerificationEventType;
  outcome: VerificationOutcome | null;
  resultingAttemptStatus: AttemptStatus;
  createdAt: string;
}

export interface SubmitAttemptVerificationInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
  verification: AgentEngineVerification_v2;
}

/** Built-in fail-closed policy used by the first public acceptance surface. */
export const STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID = "lexrunner.strict-pass" as const;
export const STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION = "1.0.0" as const;

export interface ApplyAttemptAcceptanceInput extends AuthenticatedMutationInput {
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
  verificationId: string;
  verificationHash: string;
}

export interface BeginAttemptVerificationInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
  verificationId: string;
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
}

export type AttemptVerificationBeginResult =
  | {
      started: true;
      authorization: AttemptVerificationAuthorizationRecord;
      attempt: AttemptRecord;
      event: AttemptVerificationEvent;
      idempotentReplay: boolean;
    }
  | {
      started: false;
      reason: AttemptVerificationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

export type AttemptVerificationSubmissionResult =
  | {
      recorded: true;
      verification: AttemptVerificationRecord;
      attempt: AttemptRecord;
      event: AttemptVerificationEvent;
      idempotentReplay: boolean;
    }
  | {
      recorded: false;
      reason: AttemptVerificationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

export interface HeartbeatWorkerSessionInput extends AuthenticatedWorkerMutationInput {
  sessionId: string;
  expectedSessionRevision: number;
  status?: HeartbeatWorkerSessionStatus;
}

export interface EndWorkerSessionInput extends AuthenticatedWorkerMutationInput {
  sessionId: string;
  expectedSessionRevision: number;
  status: EndWorkerSessionStatus;
  exitReason?: string;
  exitCode?: number;
  exitSummary?: string;
}

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
  disposition: ReleaseWorkspaceDisposition;
  observation: WorkspaceObservation;
}

export interface ReconcileWorkspaceInput extends AuthenticatedMutationInput {
  attemptId: string;
  workspaceLeaseId: string;
  expectedAttemptRevision: number;
  expectedWorkspaceLeaseRevision: number;
  action: WorkspaceReconciliationAction;
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

/** Read-only access to immutable task packet snapshots written during launch binding. */
export interface TaskPacketBindingStore {
  getTaskPacketBinding(attemptId: string): Promise<TaskPacketBindingRecord | null>;
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

/** Additive audit port for packet-bound worker authority decisions. */
export interface WorkerAuthorityDecisionStore {
  recordWorkerAuthorityDecision(
    input: RecordWorkerAuthorityDecisionInput
  ): Promise<WorkerAuthorityDecisionResult>;
  listWorkerAuthorityEvents(runId: string): Promise<WorkerAuthorityEventRecord[]>;
}

/** Additive immutable AgentTaskReceipt v2 persistence port. */
export interface AttemptReceiptStore {
  submitAttemptReceipt(input: SubmitAttemptReceiptInput): Promise<AttemptReceiptSubmissionResult>;
  getAttemptReceipt(receiptId: string): Promise<AttemptReceiptRecord | null>;
  getAttemptReceiptForAttempt(attemptId: string): Promise<AttemptReceiptRecord | null>;
  getAttemptReceiptByHash(receiptHash: string): Promise<AttemptReceiptRecord | null>;
  listAttemptReceiptEvents(runId: string): Promise<AttemptReceiptEvent[]>;
}

/** Additive immutable AgentEngineVerification v2 persistence port. */
export interface AttemptVerificationStore {
  beginAttemptVerification(
    input: BeginAttemptVerificationInput
  ): Promise<AttemptVerificationBeginResult>;
  submitAttemptVerification(
    input: SubmitAttemptVerificationInput
  ): Promise<AttemptVerificationSubmissionResult>;
  getAttemptVerification(verificationId: string): Promise<AttemptVerificationRecord | null>;
  getAttemptVerificationForAttempt(attemptId: string): Promise<AttemptVerificationRecord | null>;
  getAttemptVerificationByHash(verificationHash: string): Promise<AttemptVerificationRecord | null>;
  getAttemptVerificationAuthorization(
    verificationId: string
  ): Promise<AttemptVerificationAuthorizationRecord | null>;
  getAttemptVerificationAuthorizationForAttempt(
    attemptId: string
  ): Promise<AttemptVerificationAuthorizationRecord | null>;
  listAttemptVerificationEvents(runId: string): Promise<AttemptVerificationEvent[]>;
}

/** Policy-owned transition from verified evidence to an accepted or rejected Attempt. */
export interface AttemptAcceptanceStore {
  applyAttemptAcceptance(input: ApplyAttemptAcceptanceInput): Promise<WorkspaceMutationResult>;
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
