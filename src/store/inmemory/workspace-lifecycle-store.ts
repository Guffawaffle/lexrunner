import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import {
  AgentEngineVerification_v2,
  AgentTaskPacket_v1,
  AgentTaskReceipt_v2,
  validateAgentEngineVerificationV2PacketReferences,
  validateAgentTaskReceiptV2PacketReferences,
} from "../../schemas/agent-work.js";
import { calculateExpiry, cloneJsonValue, parseInstant } from "../coordination-store.js";
import {
  canTransitionAttempt,
  attemptStatusRequiresReceipt,
  attemptStatusRequiresVerification,
  isLiveAttemptStatus,
  isTerminalAttemptStatus,
  isTerminalWorkerSession,
  requiresDurableReceipt,
  requiresLiveWorkspace,
} from "../workspace-lifecycle-domains.js";
import type {
  FinishedWorkspaceLeaseStatus,
  WorkspaceCleanupDisposition,
} from "../workspace-lifecycle-domains.js";
import type {
  AcquireWorkspaceInput,
  ApplyAttemptAcceptanceInput,
  AttachWorkerSessionInput,
  AttemptRecord,
  AttemptReceiptEvent,
  AttemptReceiptEventType,
  AttemptReceiptFailureReason,
  AttemptReceiptRecord,
  AttemptReceiptSubmissionResult,
  AttemptVerificationEvent,
  AttemptVerificationEventType,
  AttemptVerificationFailureReason,
  AttemptVerificationAuthorizationRecord,
  AttemptVerificationBeginResult,
  AttemptVerificationRecord,
  AttemptVerificationStore,
  AttemptVerificationSubmissionResult,
  AttemptAcceptanceStore,
  BindLaunchEnvelopeInput,
  BeginAttemptVerificationInput,
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
  ReconcileIncompleteLaunchInput,
  ReconcileWorkspaceInput,
  ReleaseWorkspaceInput,
  SubmitAttemptReceiptInput,
  SubmitAttemptVerificationInput,
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
  WorkerAdapterBindingRecord,
  RecordWorkerAuthorityDecisionInput,
  WorkerAuthorityDecisionResult,
  WorkerAuthorityDecisionStore,
  WorkerAuthorityEventRecord,
} from "../workspace-lifecycle-store.js";
import {
  STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID,
  STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION,
} from "../workspace-lifecycle-store.js";
import { validateCanonicalEnvelope } from "../workspace-lifecycle-evidence.js";
import { InMemoryCoordinationStore } from "./coordination-store.js";

type MutationInput =
  | CreateAttemptInput
  | TransitionAttemptInput
  | ApplyAttemptAcceptanceInput
  | AcquireWorkspaceInput
  | HeartbeatWorkspaceInput
  | ReleaseWorkspaceInput
  | ReconcileWorkspaceInput
  | ReconcileIncompleteLaunchInput
  | QuarantineWorkspaceInput;

interface StoredMutation {
  fingerprint: string;
  result: Extract<WorkspaceMutationResult, { updated: true }>;
}

interface StoredWorkerMutation {
  fingerprint: string;
  result: Extract<WorkerSessionMutationResult, { updated: true }>;
}

interface StoredWorkerAuthorityMutation {
  fingerprint: string;
  event: WorkerAuthorityEventRecord;
}

interface StoredReceiptMutation {
  fingerprint: string;
  result: Extract<AttemptReceiptSubmissionResult, { submitted: true }>;
}

interface StoredVerificationMutation {
  fingerprint: string;
  result: Extract<AttemptVerificationSubmissionResult, { recorded: true }>;
}

interface StoredVerificationBeginMutation {
  fingerprint: string;
  result: Extract<AttemptVerificationBeginResult, { started: true }>;
}

/**
 * In-memory authoritative controller + workspace lifecycle store.
 *
 * Extending the coordination store is intentional: controller credential
 * validation and each attempt/lease/event mutation share one synchronous
 * critical section instead of becoming two independently canonical stores.
 */
export class InMemoryWorkspaceLifecycleStore
  extends InMemoryCoordinationStore
  implements
    WorkspaceLifecycleStore,
    LaunchEnvelopeBindingStore,
    TaskPacketBindingStore,
    WorkerSessionStore,
    WorkerAuthorityDecisionStore,
    AttemptVerificationStore,
    AttemptAcceptanceStore
{
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly workspaceLeases = new Map<string, WorkspaceLifecycleLeaseRecord>();
  private readonly lifecycleEvents = new Map<string, WorkspaceLifecycleEvent[]>();
  private readonly mutations = new Map<string, StoredMutation>();
  private readonly workerSessions = new Map<string, WorkerSessionRecord>();
  private readonly workerAdapterBindings = new Map<string, WorkerAdapterBindingRecord>();
  private readonly workerSessionByAttempt = new Map<string, string>();
  private readonly workerEvents = new Map<string, WorkerSessionEvent[]>();
  private readonly workerMutations = new Map<string, StoredWorkerMutation>();
  private readonly workerAuthorityEvents = new Map<string, WorkerAuthorityEventRecord[]>();
  private readonly workerAuthorityMutations = new Map<string, StoredWorkerAuthorityMutation>();
  private readonly launchEnvelopeBindings = new Map<string, LaunchEnvelopeBindingRecord>();
  private readonly taskPacketBindings = new Map<string, TaskPacketBindingRecord>();
  private readonly attemptReceipts = new Map<string, AttemptReceiptRecord>();
  private readonly receiptByAttempt = new Map<string, string>();
  private readonly receiptByHash = new Map<string, string>();
  private readonly receiptEvents = new Map<string, AttemptReceiptEvent[]>();
  private readonly receiptMutations = new Map<string, StoredReceiptMutation>();
  private readonly attemptVerifications = new Map<string, AttemptVerificationRecord>();
  private readonly verificationAuthorizations = new Map<
    string,
    AttemptVerificationAuthorizationRecord
  >();
  private readonly verificationAuthorizationByAttempt = new Map<string, string>();
  private readonly verificationByAttempt = new Map<string, string>();
  private readonly verificationByHash = new Map<string, string>();
  private readonly verificationEvents = new Map<string, AttemptVerificationEvent[]>();
  private readonly verificationMutations = new Map<string, StoredVerificationMutation>();
  private readonly verificationBeginMutations = new Map<string, StoredVerificationBeginMutation>();

  async createAttempt(input: CreateAttemptInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      if (this.attempts.has(input.attemptId)) return this.failure("live_attempt_conflict");
      const conflict = [...this.attempts.values()].some(
        (attempt) =>
          attempt.runId === input.runId &&
          attempt.workItemId === input.workItemId &&
          isLiveAttempt(attempt)
      );
      if (conflict) return this.failure("live_attempt_conflict");

      const now = normalizeInstant(input.now);
      const attempt: AttemptRecord = {
        attemptId: input.attemptId,
        runId: input.runId,
        runRevision: input.expectedRunRevision,
        workItemId: input.workItemId,
        workItemRevision: input.workItemRevision,
        packetId: input.packetId,
        packetHash: input.packetHash,
        baseSha: input.baseSha,
        revision: 0,
        status: "prepared",
        workspaceLeaseId: null,
        receiptId: null,
        verificationId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      this.attempts.set(attempt.attemptId, attempt);
      return this.record(input, attempt, null, "attempt_created", {
        workItemId: input.workItemId,
      });
    });
  }

  async transitionAttempt(input: TransitionAttemptInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempts.get(input.attemptId);
      const revisionFailure = this.validateAttempt(
        attempt,
        input.runId,
        input.expectedAttemptRevision
      );
      if (revisionFailure) return revisionFailure;
      if (!canTransitionAttempt(attempt!.status, input.status)) {
        return this.failure("invalid_attempt_transition", attempt!);
      }
      if (
        (attempt!.status === "receipt_submitted" ||
          attempt!.status === "verifying" ||
          attempt!.status === "verified") &&
        input.status !== "quarantined"
      ) {
        return this.failure("evidence_mismatch", attempt!);
      }
      if (input.status === "receipt_submitted") {
        return this.failure("evidence_mismatch", attempt!);
      }
      if (input.receiptId !== undefined) {
        const durableReceiptId = this.receiptByAttempt.get(attempt!.attemptId);
        const receipt = this.attemptReceipts.get(input.receiptId);
        if (
          durableReceiptId !== input.receiptId ||
          attempt!.receiptId !== input.receiptId ||
          !receipt ||
          receipt.attemptId !== attempt!.attemptId ||
          receipt.disposition !== "verification_pending"
        ) {
          return this.failure("evidence_mismatch", attempt!);
        }
      }
      if (requiresDurableReceipt(input.status)) {
        const receiptId = this.receiptByAttempt.get(attempt!.attemptId);
        const receipt = receiptId ? this.attemptReceipts.get(receiptId) : undefined;
        if (
          !receiptId ||
          receiptId !== attempt!.receiptId ||
          !receipt ||
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
        const lease = attempt!.workspaceLeaseId
          ? this.workspaceLeases.get(attempt!.workspaceLeaseId)
          : undefined;
        if (!lease || lease.status !== "active") {
          return this.failure("workspace_not_active", attempt!, lease);
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
      const evidence = bindAttemptEvidence(attempt!, input);
      if (!evidence.bound) return this.failure("evidence_mismatch", attempt!);
      const now = normalizeInstant(input.now);
      attempt!.revision += 1;
      attempt!.status = input.status;
      attempt!.receiptId = evidence.receiptId;
      attempt!.verificationId = evidence.verificationId;
      attempt!.updatedAt = now;
      attempt!.completedAt = isTerminalAttemptStatus(input.status) ? now : null;
      const lease = attempt!.workspaceLeaseId
        ? (this.workspaceLeases.get(attempt!.workspaceLeaseId) ?? null)
        : null;
      return this.record(input, attempt!, lease, "attempt_transitioned", {
        status: input.status,
        receiptId: attempt!.receiptId,
        verificationId: attempt!.verificationId,
        details: input.details ?? null,
      });
    });
  }

  async acquireWorkspace(input: AcquireWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempts.get(input.attemptId);
      const revisionFailure = this.validateAttempt(
        attempt,
        input.runId,
        input.expectedAttemptRevision
      );
      if (revisionFailure) return revisionFailure;
      if (parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "updatedAt")) {
        return this.failure("invalid_time", attempt!);
      }
      if (!validTtl(input.ttlMs)) return this.failure("invalid_time", attempt!);
      if (!isLiveAttempt(attempt!)) return this.failure("attempt_not_live", attempt!);
      if (attempt!.workspaceLeaseId) return this.failure("live_attempt_conflict", attempt!);
      if (attempt!.workItemId !== input.workItemId || attempt!.baseSha !== input.baseSha) {
        return this.failure("identity_mismatch", attempt!);
      }
      if (
        input.observation?.exists &&
        (!input.observation.registered || !sameIdentity(input, input.observation))
      ) {
        return this.failure("identity_mismatch", attempt!);
      }
      if (input.observation?.exists && input.observation.cleanliness === "dirty") {
        return this.failure("dirty_workspace", attempt!);
      }
      if (this.workspaceLeases.has(input.workspaceLeaseId)) {
        return this.failure("live_attempt_conflict", attempt!);
      }
      for (const lease of this.workspaceLeases.values()) {
        if (lease.status !== "active" && lease.status !== "reserved") {
          continue;
        }
        if (lease.repositoryId === input.repositoryId && lease.branch === input.branch) {
          return this.failure("branch_conflict", attempt!);
        }
        if (
          lease.hostId === input.hostId &&
          lease.gitRuntime === input.gitRuntime &&
          lease.worktreePath === input.worktreePath
        ) {
          return this.failure("worktree_conflict", attempt!);
        }
      }

      const now = normalizeInstant(input.now);
      const lease: WorkspaceLifecycleLeaseRecord = {
        leaseId: input.workspaceLeaseId,
        attemptId: input.attemptId,
        runId: input.runId,
        runRevision: attempt!.runRevision,
        workItemId: input.workItemId,
        workItemRevision: attempt!.workItemRevision,
        packetId: attempt!.packetId,
        packetHash: attempt!.packetHash,
        revision: 0,
        controllerId: input.controller.controllerId,
        controllerLeaseId: input.controller.leaseId,
        fencingToken: input.controller.fencingToken,
        repositoryId: input.repositoryId,
        hostId: input.hostId,
        gitRuntime: input.gitRuntime,
        projectRoot: input.projectRoot,
        branch: input.branch,
        worktreePath: input.worktreePath,
        baseSha: input.baseSha,
        status: input.observation?.exists && input.observation.registered ? "active" : "reserved",
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: calculateExpiry(now, input.ttlMs),
        ...(input.observation ? { lastObservation: cloneObservation(input.observation) } : {}),
      };
      attempt!.workspaceLeaseId = input.workspaceLeaseId;
      attempt!.revision += 1;
      attempt!.status = "leased";
      attempt!.updatedAt = now;
      this.workspaceLeases.set(input.workspaceLeaseId, lease);
      return this.record(input, attempt!, lease, "workspace_acquired", {
        repositoryId: lease.repositoryId,
        branch: lease.branch,
        worktreePath: lease.worktreePath,
      });
    });
  }

  async heartbeatWorkspace(input: HeartbeatWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, false, (attempt, lease) => {
      if (!validTtl(input.ttlMs)) return this.failure("invalid_time", attempt, lease);
      if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
        return this.failure("workspace_expired", attempt, lease);
      }
      if (
        !sameIdentity(lease, input.observation) ||
        !input.observation.exists ||
        !input.observation.registered
      ) {
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      }
      const now = normalizeInstant(input.now);
      attempt.revision += 1;
      attempt.updatedAt = now;
      lease.revision += 1;
      lease.status = "active";
      lease.heartbeatAt = now;
      lease.expiresAt = calculateExpiry(now, input.ttlMs);
      lease.lastObservation = cloneObservation(input.observation);
      return this.record(input, attempt, lease, "workspace_heartbeat", {
        cleanliness: input.observation.cleanliness,
        headSha: input.observation.headSha,
      });
    });
  }

  async releaseWorkspace(input: ReleaseWorkspaceInput): Promise<WorkspaceMutationResult> {
    return this.mutateWorkspace(input, false, (attempt, lease) => {
      if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
        return this.failure("workspace_expired", attempt, lease);
      }
      if (
        !sameIdentity(lease, input.observation) ||
        !input.observation.exists ||
        !input.observation.registered
      ) {
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      }
      if (input.observation.cleanliness === "dirty") {
        return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
      }
      return this.finishLease(
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
      ) {
        return this.quarantine(input, attempt, lease, "identity_mismatch", input.observation);
      }
      if (input.action === "resume" && input.observation.cleanliness === "dirty") {
        return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
      }
      if (input.action === "resume") {
        if (!input.ttlMs || !validTtl(input.ttlMs)) {
          return this.failure("invalid_reconciliation", attempt, lease);
        }
        const now = normalizeInstant(input.now);
        attempt.revision += 1;
        attempt.updatedAt = now;
        lease.revision += 1;
        lease.status = "active";
        lease.controllerId = input.controller.controllerId;
        lease.controllerLeaseId = input.controller.leaseId;
        lease.fencingToken = input.controller.fencingToken;
        lease.heartbeatAt = now;
        lease.expiresAt = calculateExpiry(now, input.ttlMs);
        lease.lastObservation = cloneObservation(input.observation);
        return this.record(input, attempt, lease, "workspace_reconciled", { action: "resume" });
      }
      if (input.action === "preserve") {
        return this.finishLease(
          input,
          attempt,
          lease,
          "preserved",
          "preserved",
          "workspace_reconciled"
        );
      }
      if (input.observation.cleanliness === "dirty") {
        return this.quarantine(input, attempt, lease, "dirty_workspace", input.observation);
      }
      return this.finishLease(
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
    const attempt = this.attempts.get(attemptId);
    return attempt ? { ...attempt } : null;
  }

  async getWorkspaceLease(leaseId: string): Promise<WorkspaceLifecycleLeaseRecord | null> {
    const lease = this.workspaceLeases.get(leaseId);
    return lease ? cloneLease(lease) : null;
  }

  async listWorkspaceLifecycleEvents(runId: string): Promise<WorkspaceLifecycleEvent[]> {
    return (this.lifecycleEvents.get(runId) ?? []).map(cloneEvent);
  }

  async bindLaunchEnvelope(input: BindLaunchEnvelopeInput): Promise<LaunchEnvelopeBindingResult> {
    if (!Number.isFinite(Date.parse(input.createdAt)))
      return { bound: false, reason: "invalid_time" };
    if (input.controller.runId !== input.runId) return { bound: false, reason: "lease_mismatch" };
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.createdAt,
      input.expectedRunRevision,
      () => {
        const attempt = this.attempts.get(input.attemptId);
        const lease = this.workspaceLeases.get(input.workspaceLeaseId);
        const existing = this.launchEnvelopeBindings.get(input.attemptId);
        if (existing) {
          return sameLaunchBinding(existing, input) &&
            sameTaskPacketBinding(
              this.taskPacketBindings.get(input.attemptId),
              input.packetJson,
              attempt
            )
            ? { bound: true as const, binding: { ...existing }, idempotentReplay: true }
            : launchFailure("mutation_conflict", attempt, lease);
        }
        const failure = launchBindingFailure(input, attempt, lease);
        if (failure) return failure;
        if (
          [...this.launchEnvelopeBindings.values()].some(
            (binding) => binding.envelopeId === input.envelopeId
          )
        ) {
          return launchFailure("mutation_conflict", attempt, lease);
        }
        const event = (this.lifecycleEvents.get(input.runId) ?? []).find(
          (candidate) => candidate.mutationId === input.authorizationMutationId
        );
        if (!isMatchingLaunchAuthorization(event, input)) {
          return launchFailure("evidence_mismatch", attempt, lease);
        }
        const envelope = validateCanonicalEnvelope(input, attempt!, lease!);
        if (!envelope) return launchFailure("evidence_mismatch", attempt, lease);
        // A packet snapshot is mandatory for every new binding.  The optional
        // input remains only so an already-persisted pre-snapshot envelope can
        // be replayed exactly during compatibility migration.
        if (input.packetJson === undefined)
          return launchFailure("evidence_mismatch", attempt, lease);
        const packet = validateCanonicalTaskPacket(input.packetJson, attempt!);
        if (!packet) return launchFailure("evidence_mismatch", attempt, lease);
        const binding: LaunchEnvelopeBindingRecord = {
          runId: input.runId,
          attemptId: input.attemptId,
          workspaceLeaseId: input.workspaceLeaseId,
          attemptRevision: input.expectedAttemptRevision,
          workspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
          authorizationMutationId: input.authorizationMutationId,
          envelopeId: input.envelopeId,
          envelopeHash: input.envelopeHash,
          envelopeJson: input.envelopeJson,
          controllerId: input.controller.controllerId,
          controllerLeaseId: input.controller.leaseId,
          fencingToken: input.controller.fencingToken,
          createdAt: normalizeInstant(input.createdAt),
        };
        this.launchEnvelopeBindings.set(input.attemptId, binding);
        this.taskPacketBindings.set(input.attemptId, {
          runId: input.runId,
          attemptId: input.attemptId,
          workItemId: attempt!.workItemId,
          workItemRevision: attempt!.workItemRevision,
          packetId: attempt!.packetId,
          packetHash: attempt!.packetHash,
          packetJson: input.packetJson,
          createdAt: normalizeInstant(input.createdAt),
        });
        return { bound: true as const, binding: { ...binding }, idempotentReplay: false };
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : {
          bound: false,
          reason: authenticated.reason,
          ...(authenticated.currentRunRevision !== undefined
            ? { currentRunRevision: authenticated.currentRunRevision }
            : {}),
        };
  }

  async getLaunchEnvelopeBinding(attemptId: string): Promise<LaunchEnvelopeBindingRecord | null> {
    const binding = this.launchEnvelopeBindings.get(attemptId);
    return binding ? { ...binding } : null;
  }

  async reconcileIncompleteLaunch(
    input: ReconcileIncompleteLaunchInput
  ): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempts.get(input.attemptId);
      const attemptFailure = this.validateAttempt(
        attempt,
        input.runId,
        input.expectedAttemptRevision
      );
      if (attemptFailure) return attemptFailure;
      const lease = this.workspaceLeases.get(input.workspaceLeaseId);
      if (!lease || lease.attemptId !== attempt!.attemptId) {
        return this.failure("not_found", attempt!);
      }
      if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
        return this.failure("stale_workspace_revision", attempt!, lease);
      }
      if (attempt!.status !== "launching") {
        return this.failure("invalid_reconciliation", attempt!, lease);
      }
      if (lease.status !== "active") {
        return this.failure("workspace_not_active", attempt!, lease);
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
      if (
        this.launchEnvelopeBindings.has(input.attemptId) ||
        this.taskPacketBindings.has(input.attemptId) ||
        this.workerSessionByAttempt.has(input.attemptId)
      ) {
        return this.failure("evidence_mismatch", attempt!, lease);
      }
      const authorization = [...(this.lifecycleEvents.get(input.runId) ?? [])]
        .reverse()
        .find((event) => isLaunchAuthorizationForAttempt(event, attempt!, lease));
      if (!authorization) return this.failure("evidence_mismatch", attempt!, lease);
      if (parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "updatedAt")) {
        return this.failure("invalid_time", attempt!, lease);
      }
      const now = normalizeInstant(input.now);
      attempt!.revision += 1;
      attempt!.status = "launch_failed";
      attempt!.updatedAt = now;
      attempt!.completedAt = now;
      return this.record(input, attempt!, lease, "attempt_transitioned", {
        status: "launch_failed",
        receiptId: null,
        verificationId: null,
        details: {
          reconciliation: "missing_launch_envelope",
          authorizationMutationId: authorization.mutationId,
        },
      });
    });
  }

  async getTaskPacketBinding(attemptId: string): Promise<TaskPacketBindingRecord | null> {
    const binding = this.taskPacketBindings.get(attemptId);
    const attempt = this.attempts.get(attemptId);
    return binding && attempt && validateTaskPacketBinding(binding, attempt)
      ? { ...binding }
      : null;
  }

  async attachWorkerSession(input: AttachWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const existingId = this.workerSessionByAttempt.get(input.attemptId);
      const existing = existingId ? this.workerSessions.get(existingId) : undefined;
      if (existing) {
        return this.workerFailure("worker_session_conflict", attempt, lease, existing);
      }
      if (attempt.status !== "launching") {
        return this.workerFailure("invalid_attempt_transition", attempt, lease);
      }
      if (this.workerSessions.has(input.sessionId)) {
        return this.workerFailure("worker_session_conflict", attempt, lease, existing);
      }
      const nativeIdentityConflict = [...this.workerSessions.values()].find(
        (session) =>
          !isTerminalWorkerSession(session.status) &&
          session.hostId === input.hostId &&
          session.backend === input.backend &&
          session.workerId === input.workerId
      );
      if (nativeIdentityConflict) {
        return this.workerFailure(
          "worker_session_conflict",
          attempt,
          lease,
          nativeIdentityConflict
        );
      }
      if (input.packetId !== attempt.packetId || input.packetHash !== attempt.packetHash) {
        return this.workerFailure("identity_mismatch", attempt, lease);
      }
      const envelope = this.launchEnvelopeBindings.get(input.attemptId);
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
      if (input.adapter && !validWorkerAdapterBinding(input.adapter)) {
        return this.workerFailure("evidence_mismatch", attempt, lease);
      }
      const now = normalizeInstant(input.now);
      const startedAt = normalizeInstant(input.startedAt);
      if (
        parseInstant(startedAt, "startedAt") <
          parseInstant(envelope.createdAt, "envelope.createdAt") ||
        parseInstant(startedAt, "startedAt") > parseInstant(now, "now")
      ) {
        return this.workerFailure("invalid_time", attempt, lease);
      }
      const session: WorkerSessionRecord = {
        sessionId: input.sessionId,
        revision: 0,
        runId: input.runId,
        attemptId: input.attemptId,
        packetId: input.packetId,
        packetHash: input.packetHash,
        workspaceLeaseId: input.workspaceLeaseId,
        workspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
        executionEnvelopeId: input.executionEnvelopeId,
        executionEnvelopeHash: input.executionEnvelopeHash,
        hostId: input.hostId,
        workerRuntime: input.workerRuntime,
        gitRuntime: input.gitRuntime,
        backend: input.backend,
        workerId: input.workerId,
        ...(input.model ? { model: input.model } : {}),
        status: "running",
        startedAt,
        heartbeatAt: now,
      };
      attempt.revision += 1;
      attempt.status = "running";
      attempt.updatedAt = now;
      this.workerSessions.set(session.sessionId, session);
      if (input.adapter) {
        this.workerAdapterBindings.set(session.sessionId, {
          sessionId: session.sessionId,
          adapterId: input.adapter.adapterId,
          adapterVersion: input.adapter.adapterVersion,
          enforcementSummaryHash: input.adapter.enforcementSummaryHash,
          trustGapDimensions: [...input.adapter.trustGapDimensions],
          createdAt: now,
        });
      }
      this.workerSessionByAttempt.set(session.attemptId, session.sessionId);
      return this.recordWorker(input, attempt, lease, session, "worker_session_attached", {
        backend: session.backend,
        workerId: session.workerId,
        executionEnvelopeId: session.executionEnvelopeId,
        ...(input.adapter
          ? {
              adapter: {
                id: input.adapter.adapterId,
                version: input.adapter.adapterVersion,
                enforcementSummaryHash: input.adapter.enforcementSummaryHash,
                trustGapDimensions: input.adapter.trustGapDimensions,
              },
            }
          : {}),
      });
    });
  }

  async heartbeatWorkerSession(
    input: HeartbeatWorkerSessionInput
  ): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const session = this.workerSessions.get(input.sessionId);
      const failure = this.validateSession(session, input, attempt, lease);
      if (failure) return failure;
      const now = normalizeInstant(input.now);
      if (parseInstant(now, "now") < parseInstant(session!.heartbeatAt, "heartbeatAt")) {
        return this.workerFailure("invalid_time", attempt, lease, session);
      }
      session!.revision += 1;
      session!.status = input.status ?? session!.status;
      session!.heartbeatAt = now;
      return this.recordWorker(input, attempt, lease, session!, "worker_session_heartbeat", {
        status: session!.status,
      });
    });
  }

  async endWorkerSession(input: EndWorkerSessionInput): Promise<WorkerSessionMutationResult> {
    return this.mutateWorker(input, () => {
      const validated = this.validateWorkerBinding(input);
      if (!validated.valid) return validated.failure;
      const { attempt, lease } = validated;
      const session = this.workerSessions.get(input.sessionId);
      const failure = this.validateSession(session, input, attempt, lease);
      if (failure) return failure;
      if (!validExitMetadata(input)) {
        return this.workerFailure("evidence_mismatch", attempt, lease, session);
      }
      const now = normalizeInstant(input.now);
      if (parseInstant(now, "now") < parseInstant(session!.heartbeatAt, "heartbeatAt")) {
        return this.workerFailure("invalid_time", attempt, lease, session);
      }
      session!.revision += 1;
      session!.status = input.status;
      session!.heartbeatAt = now;
      session!.endedAt = now;
      if (input.exitReason !== undefined) session!.exitReason = input.exitReason;
      if (input.exitCode !== undefined) session!.exitCode = input.exitCode;
      if (input.exitSummary !== undefined) session!.exitSummary = input.exitSummary;
      if (input.status !== "completed") {
        attempt.revision += 1;
        attempt.status = input.status === "cancelled" ? "cancelled" : "failed";
        attempt.updatedAt = now;
        attempt.completedAt = now;
      }
      return this.recordWorker(input, attempt, lease, session!, "worker_session_ended", {
        status: input.status,
        exitReason: input.exitReason ?? null,
        exitCode: input.exitCode ?? null,
        exitSummary: input.exitSummary ?? null,
      });
    });
  }

  async getWorkerSession(sessionId: string): Promise<WorkerSessionRecord | null> {
    const session = this.workerSessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async getWorkerSessionForAttempt(attemptId: string): Promise<WorkerSessionRecord | null> {
    const sessionId = this.workerSessionByAttempt.get(attemptId);
    return sessionId ? this.getWorkerSession(sessionId) : null;
  }

  async getWorkerAdapterBinding(sessionId: string): Promise<WorkerAdapterBindingRecord | null> {
    const binding = this.workerAdapterBindings.get(sessionId);
    return binding ? { ...binding, trustGapDimensions: [...binding.trustGapDimensions] } : null;
  }

  async listWorkerSessionEvents(runId: string): Promise<WorkerSessionEvent[]> {
    return (this.workerEvents.get(runId) ?? []).map(cloneWorkerEvent);
  }

  async recordWorkerAuthorityDecision(
    input: RecordWorkerAuthorityDecisionInput
  ): Promise<WorkerAuthorityDecisionResult> {
    if (!Number.isFinite(Date.parse(input.now))) return this.authorityFailure("invalid_time");
    if (input.controller.runId !== input.runId) return this.authorityFailure("lease_mismatch");
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = authorityDecisionFingerprint(input);
        if (
          this.mutations.has(key) ||
          this.workerMutations.has(key) ||
          this.receiptMutations.has(key) ||
          this.verificationMutations.has(key) ||
          this.verificationBeginMutations.has(key)
        ) {
          return this.authorityFailure("mutation_conflict");
        }
        const prior = this.workerAuthorityMutations.get(key);
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { recorded: true as const, event: { ...prior.event }, idempotentReplay: true }
            : this.authorityFailure("mutation_conflict");
        }
        const attempt = this.attempts.get(input.attemptId);
        const lease = this.workspaceLeases.get(input.workspaceLeaseId);
        const session = this.workerSessions.get(input.workerSessionId);
        const packetBinding = this.taskPacketBindings.get(input.attemptId);
        if (!attempt || !lease || !session || !packetBinding) {
          return this.authorityFailure("not_found", attempt, lease, session);
        }
        if (attempt.revision !== input.expectedAttemptRevision) {
          return this.authorityFailure("stale_attempt_revision", attempt, lease, session);
        }
        if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
          return this.authorityFailure("stale_workspace_revision", attempt, lease, session);
        }
        if (session.revision !== input.expectedWorkerSessionRevision) {
          return this.authorityFailure("stale_session_revision", attempt, lease, session);
        }
        if (
          lease.status !== "active" ||
          lease.attemptId !== input.attemptId ||
          lease.controllerId !== input.controller.controllerId ||
          lease.controllerLeaseId !== input.controller.leaseId ||
          lease.fencingToken !== input.controller.fencingToken
        ) {
          return this.authorityFailure("stale_fence", attempt, lease, session);
        }
        if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
          return this.authorityFailure("workspace_expired", attempt, lease, session);
        }
        if (
          session.runId !== input.runId ||
          session.attemptId !== input.attemptId ||
          session.workspaceLeaseId !== input.workspaceLeaseId ||
          session.packetId !== attempt.packetId ||
          session.packetHash !== attempt.packetHash
        ) {
          return this.authorityFailure("identity_mismatch", attempt, lease, session);
        }
        let packet: AgentTaskPacket_v1;
        try {
          packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson) as unknown);
        } catch {
          return this.authorityFailure("evidence_mismatch", attempt, lease, session);
        }
        if (!validAuthorityDecision(input, packet.authority)) {
          return this.authorityFailure("evidence_mismatch", attempt, lease, session);
        }
        const events = this.workerAuthorityEvents.get(input.runId) ?? [];
        const event: WorkerAuthorityEventRecord = {
          runId: input.runId,
          attemptId: input.attemptId,
          workerSessionId: input.workerSessionId,
          mutationId: input.mutationId,
          sequence: events.length + 1,
          attemptRevision: attempt.revision,
          workspaceLeaseId: input.workspaceLeaseId,
          workspaceLeaseRevision: lease.revision,
          workerSessionRevision: session.revision,
          packetId: attempt.packetId,
          packetHash: attempt.packetHash,
          dimension: input.dimension,
          decision: input.decision,
          enforcement: input.enforcement,
          actionClass: input.actionClass,
          actionHash: input.actionHash,
          backendId: input.backendId,
          backendVersion: input.backendVersion,
          reason: input.reason,
          controllerId: input.controller.controllerId,
          controllerLeaseId: input.controller.leaseId,
          fencingToken: input.controller.fencingToken,
          createdAt: normalizeInstant(input.now),
        };
        events.push(event);
        this.workerAuthorityEvents.set(input.runId, events);
        this.workerAuthorityMutations.set(key, { fingerprint, event: { ...event } });
        return { recorded: true as const, event: { ...event }, idempotentReplay: false };
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.authorityFailure(
          authenticated.reason,
          undefined,
          undefined,
          undefined,
          authenticated.currentRunRevision
        );
  }

  async listWorkerAuthorityEvents(runId: string): Promise<WorkerAuthorityEventRecord[]> {
    return (this.workerAuthorityEvents.get(runId) ?? []).map((event) => ({ ...event }));
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
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = canonicalJSONStringify({
          ...input,
          receipt: parsed.data,
        } as unknown as JsonRecord);
        if (
          this.mutations.has(key) ||
          this.workerMutations.has(key) ||
          this.verificationMutations.has(key) ||
          this.verificationBeginMutations.has(key) ||
          this.workerAuthorityMutations.has(key)
        ) {
          return this.receiptFailure("mutation_conflict");
        }
        const packetAttempt = this.attempts.get(input.attemptId);
        const packetBinding = this.taskPacketBindings.get(input.attemptId);
        if (
          packetAttempt &&
          (!packetBinding || !validateTaskPacketBinding(packetBinding, packetAttempt))
        ) {
          return this.receiptFailure("evidence_mismatch", packetAttempt);
        }
        const prior = this.receiptMutations.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) return this.receiptFailure("mutation_conflict");
          return { ...cloneReceiptSuccess(prior.result), idempotentReplay: true };
        }
        const hashReceiptId = this.receiptByHash.get(receiptHash);
        if (hashReceiptId) {
          const existing = this.attemptReceipts.get(hashReceiptId)!;
          if (
            existing.receiptJson !== receiptJson ||
            existing.runId !== input.runId ||
            existing.attemptId !== input.attemptId ||
            existing.workspaceLeaseId !== input.workspaceLeaseId ||
            existing.workerSessionId !== input.workerSessionId
          ) {
            return this.receiptFailure("receipt_conflict");
          }
          const attempt = this.attempts.get(existing.attemptId);
          if (!attempt) return this.receiptFailure("not_found");
          const session = this.workerSessions.get(existing.workerSessionId);
          const lease = this.workspaceLeases.get(existing.workspaceLeaseId);
          if (!session || !lease) return this.receiptFailure("not_found", attempt);
          const committed = this.committedReceiptResult(existing.receiptId);
          if (!committed) {
            throw new Error(
              `Attempt receipt '${existing.receiptId}' is missing its committed submission result`
            );
          }
          const replay = this.recordReceiptEvent(
            input,
            attempt,
            lease,
            session,
            existing,
            "attempt_receipt_replayed"
          );
          const result = {
            submitted: true as const,
            receipt: { ...committed.receipt },
            attempt: { ...committed.attempt },
            event: replay.event,
            idempotentReplay: true,
          };
          this.receiptMutations.set(key, { fingerprint, result: cloneReceiptSuccess(result) });
          return result;
        }
        const result = this.submitNewReceipt(input, parsed.data, receiptJson, receiptHash);
        if (result.submitted) {
          this.receiptMutations.set(key, { fingerprint, result: cloneReceiptSuccess(result) });
        }
        return result;
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.receiptFailure(
          authenticated.reason,
          undefined,
          undefined,
          undefined,
          authenticated.currentRunRevision
        );
  }

  async getAttemptReceipt(receiptId: string): Promise<AttemptReceiptRecord | null> {
    const receipt = this.attemptReceipts.get(receiptId);
    return receipt ? { ...receipt } : null;
  }

  async getAttemptReceiptForAttempt(attemptId: string): Promise<AttemptReceiptRecord | null> {
    const receiptId = this.receiptByAttempt.get(attemptId);
    return receiptId ? this.getAttemptReceipt(receiptId) : null;
  }

  async getAttemptReceiptByHash(receiptHash: string): Promise<AttemptReceiptRecord | null> {
    const receiptId = this.receiptByHash.get(receiptHash);
    return receiptId ? this.getAttemptReceipt(receiptId) : null;
  }

  async listAttemptReceiptEvents(runId: string): Promise<AttemptReceiptEvent[]> {
    return (this.receiptEvents.get(runId) ?? []).map((event) => ({ ...event }));
  }

  async beginAttemptVerification(
    input: BeginAttemptVerificationInput
  ): Promise<AttemptVerificationBeginResult> {
    if (!Number.isFinite(Date.parse(input.now)))
      return this.verificationBeginFailure("invalid_time");
    if (input.controller.runId !== input.runId) {
      return this.verificationBeginFailure("lease_mismatch");
    }
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = canonicalJSONStringify(input as unknown as JsonRecord);
        if (
          this.mutations.has(key) ||
          this.workerMutations.has(key) ||
          this.receiptMutations.has(key) ||
          this.verificationMutations.has(key) ||
          this.workerAuthorityMutations.has(key)
        ) {
          return this.verificationBeginFailure("mutation_conflict");
        }
        const prior = this.verificationBeginMutations.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            return this.verificationBeginFailure("mutation_conflict");
          }
          return { ...cloneVerificationBeginSuccess(prior.result), idempotentReplay: true };
        }
        const attempt = this.attempts.get(input.attemptId);
        const lease = this.workspaceLeases.get(input.workspaceLeaseId);
        const session = this.workerSessions.get(input.workerSessionId);
        const receipt = this.attemptReceipts.get(input.receiptId);
        if (!attempt || attempt.runId !== input.runId || !lease || !session || !receipt) {
          return this.verificationBeginFailure("not_found", attempt, lease, session);
        }
        if (attempt.revision !== input.expectedAttemptRevision) {
          return this.verificationBeginFailure("stale_attempt_revision", attempt, lease, session);
        }
        if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
          return this.verificationBeginFailure("stale_workspace_revision", attempt, lease, session);
        }
        if (session.revision !== input.expectedWorkerSessionRevision) {
          return this.verificationBeginFailure("stale_session_revision", attempt, lease, session);
        }
        if (
          input.verificationId.length === 0 ||
          this.verificationAuthorizations.has(input.verificationId) ||
          this.verificationAuthorizationByAttempt.has(input.attemptId)
        ) {
          return this.verificationBeginFailure("verification_conflict", attempt, lease, session);
        }
        if (
          attempt.status !== "receipt_submitted" ||
          attempt.receiptId !== input.receiptId ||
          receipt.attemptId !== input.attemptId ||
          receipt.receiptHash !== input.receiptHash ||
          receipt.disposition !== "verification_pending"
        ) {
          return this.verificationBeginFailure(
            "invalid_attempt_transition",
            attempt,
            lease,
            session
          );
        }
        if (
          lease.status !== "active" ||
          lease.attemptId !== attempt.attemptId ||
          lease.controllerId !== input.controller.controllerId ||
          lease.controllerLeaseId !== input.controller.leaseId ||
          lease.fencingToken !== input.controller.fencingToken
        ) {
          return this.verificationBeginFailure("stale_fence", attempt, lease, session);
        }
        if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
          return this.verificationBeginFailure("workspace_expired", attempt, lease, session);
        }
        if (
          session.runId !== input.runId ||
          session.attemptId !== input.attemptId ||
          session.workspaceLeaseId !== input.workspaceLeaseId
        ) {
          return this.verificationBeginFailure("evidence_mismatch", attempt, lease, session);
        }
        const now = normalizeInstant(input.now);
        attempt.revision += 1;
        attempt.status = "verifying";
        attempt.updatedAt = now;
        attempt.completedAt = null;
        const authorization: AttemptVerificationAuthorizationRecord = {
          verificationId: input.verificationId,
          runId: input.runId,
          attemptId: input.attemptId,
          attemptRevision: attempt.revision,
          workspaceLeaseId: input.workspaceLeaseId,
          workspaceLeaseRevision: lease.revision,
          workerSessionId: input.workerSessionId,
          workerSessionRevision: session.revision,
          receiptId: input.receiptId,
          receiptHash: input.receiptHash,
          controllerId: input.controller.controllerId,
          controllerLeaseId: input.controller.leaseId,
          fencingToken: input.controller.fencingToken,
          startedAt: now,
        };
        this.verificationAuthorizations.set(authorization.verificationId, authorization);
        this.verificationAuthorizationByAttempt.set(
          authorization.attemptId,
          authorization.verificationId
        );
        const result = this.recordVerificationStartedEvent(
          input,
          attempt,
          lease,
          session,
          authorization
        );
        this.verificationBeginMutations.set(key, {
          fingerprint,
          result: cloneVerificationBeginSuccess(result),
        });
        return result;
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.verificationBeginFailure(
          authenticated.reason,
          undefined,
          undefined,
          undefined,
          authenticated.currentRunRevision
        );
  }

  async submitAttemptVerification(
    input: SubmitAttemptVerificationInput
  ): Promise<AttemptVerificationSubmissionResult> {
    if (!Number.isFinite(Date.parse(input.now))) return this.verificationFailure("invalid_time");
    if (input.controller.runId !== input.runId) {
      return this.verificationFailure("lease_mismatch");
    }
    const parsed = AgentEngineVerification_v2.safeParse(input.verification);
    if (!parsed.success) return this.verificationFailure("evidence_mismatch");
    const verificationJson = canonicalJSONStringify(parsed.data);
    if (Buffer.byteLength(verificationJson, "utf8") > 256 * 1_024) {
      return this.verificationFailure("evidence_mismatch");
    }
    const verificationHash = computeCanonicalHash(parsed.data);
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = canonicalJSONStringify({
          ...input,
          verification: parsed.data,
        } as unknown as JsonRecord);
        if (
          this.mutations.has(key) ||
          this.workerMutations.has(key) ||
          this.receiptMutations.has(key) ||
          this.verificationBeginMutations.has(key) ||
          this.workerAuthorityMutations.has(key)
        ) {
          return this.verificationFailure("mutation_conflict");
        }
        const prior = this.verificationMutations.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            return this.verificationFailure("mutation_conflict");
          }
          return { ...cloneVerificationSuccess(prior.result), idempotentReplay: true };
        }
        const existingId = this.verificationByHash.get(verificationHash);
        if (existingId) {
          const existing = this.attemptVerifications.get(existingId)!;
          if (
            existing.verificationJson !== verificationJson ||
            existing.runId !== input.runId ||
            existing.attemptId !== input.attemptId ||
            existing.workspaceLeaseId !== input.workspaceLeaseId ||
            existing.workerSessionId !== input.workerSessionId ||
            existing.receiptId !== input.receiptId
          ) {
            return this.verificationFailure("verification_conflict");
          }
          const committed = this.committedVerificationResult(existing.verificationId);
          const attempt = this.attempts.get(existing.attemptId);
          const lease = this.workspaceLeases.get(existing.workspaceLeaseId);
          const session = this.workerSessions.get(existing.workerSessionId);
          if (!committed || !attempt || !lease || !session) {
            return this.verificationFailure("not_found", attempt, lease, session);
          }
          const replay = this.recordVerificationEvent(
            input,
            attempt,
            lease,
            session,
            existing,
            "attempt_verification_replayed"
          );
          const result = {
            recorded: true as const,
            verification: cloneVerificationRecord(committed.verification),
            attempt: { ...committed.attempt },
            event: replay.event,
            idempotentReplay: true,
          };
          this.verificationMutations.set(key, {
            fingerprint,
            result: cloneVerificationSuccess(result),
          });
          return result;
        }
        const result = this.submitNewVerification(
          input,
          parsed.data,
          verificationJson,
          verificationHash
        );
        if (result.recorded) {
          this.verificationMutations.set(key, {
            fingerprint,
            result: cloneVerificationSuccess(result),
          });
        }
        return result;
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.verificationFailure(
          authenticated.reason,
          undefined,
          undefined,
          undefined,
          authenticated.currentRunRevision
        );
  }

  async getAttemptVerification(verificationId: string): Promise<AttemptVerificationRecord | null> {
    const verification = this.attemptVerifications.get(verificationId);
    return verification ? cloneVerificationRecord(verification) : null;
  }

  async getAttemptVerificationForAttempt(
    attemptId: string
  ): Promise<AttemptVerificationRecord | null> {
    const verificationId = this.verificationByAttempt.get(attemptId);
    return verificationId ? this.getAttemptVerification(verificationId) : null;
  }

  async getAttemptVerificationByHash(
    verificationHash: string
  ): Promise<AttemptVerificationRecord | null> {
    const verificationId = this.verificationByHash.get(verificationHash);
    return verificationId ? this.getAttemptVerification(verificationId) : null;
  }

  async listAttemptVerificationEvents(runId: string): Promise<AttemptVerificationEvent[]> {
    return (this.verificationEvents.get(runId) ?? []).map((event) => ({ ...event }));
  }

  async getAttemptVerificationAuthorization(
    verificationId: string
  ): Promise<AttemptVerificationAuthorizationRecord | null> {
    const authorization = this.verificationAuthorizations.get(verificationId);
    return authorization ? { ...authorization } : null;
  }

  async getAttemptVerificationAuthorizationForAttempt(
    attemptId: string
  ): Promise<AttemptVerificationAuthorizationRecord | null> {
    const verificationId = this.verificationAuthorizationByAttempt.get(attemptId);
    return verificationId ? this.getAttemptVerificationAuthorization(verificationId) : null;
  }

  async applyAttemptAcceptance(
    input: ApplyAttemptAcceptanceInput
  ): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempts.get(input.attemptId);
      const revisionFailure = this.validateAttempt(
        attempt,
        input.runId,
        input.expectedAttemptRevision
      );
      if (revisionFailure) return revisionFailure;
      const lease = this.workspaceLeases.get(input.workspaceLeaseId);
      const session = this.workerSessions.get(input.workerSessionId);
      const receipt = this.attemptReceipts.get(input.receiptId);
      const verification = this.attemptVerifications.get(input.verificationId);
      if (!lease || !session || !receipt || !verification) {
        return this.failure("not_found", attempt!);
      }
      if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
        return this.failure("stale_workspace_revision", attempt!, lease);
      }
      if (
        session.revision !== input.expectedWorkerSessionRevision ||
        session.runId !== input.runId ||
        session.attemptId !== input.attemptId ||
        session.workspaceLeaseId !== input.workspaceLeaseId ||
        receipt.attemptId !== input.attemptId ||
        receipt.receiptHash !== input.receiptHash ||
        verification.attemptId !== input.attemptId ||
        verification.verificationHash !== input.verificationHash ||
        verification.receiptId !== input.receiptId ||
        verification.receiptHash !== input.receiptHash
      ) {
        return this.failure("evidence_mismatch", attempt!, lease);
      }
      if (
        attempt!.status !== "verified" ||
        attempt!.receiptId !== input.receiptId ||
        attempt!.verificationId !== input.verificationId ||
        verification.outcome !== "pass"
      ) {
        return this.failure("invalid_attempt_transition", attempt!, lease);
      }
      if (
        lease.status !== "active" ||
        lease.attemptId !== attempt!.attemptId ||
        lease.controllerId !== input.controller.controllerId ||
        lease.controllerLeaseId !== input.controller.leaseId ||
        lease.fencingToken !== input.controller.fencingToken
      ) {
        return this.failure("stale_fence", attempt!, lease);
      }
      if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
        return this.failure("workspace_expired", attempt!, lease);
      }
      if (parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "updatedAt")) {
        return this.failure("invalid_time", attempt!, lease);
      }
      const reasonCodes = verification.trustGapReasons.map((reason) => `trust_gap:${reason}`);
      const status = reasonCodes.length === 0 ? "accepted" : "rejected";
      const now = normalizeInstant(input.now);
      attempt!.revision += 1;
      attempt!.status = status;
      attempt!.updatedAt = now;
      attempt!.completedAt = now;
      return this.record(input, attempt!, lease, "attempt_transitioned", {
        status,
        receiptId: input.receiptId,
        verificationId: input.verificationId,
        details: {
          policyId: STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID,
          policyVersion: STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION,
          decision: status,
          reasonCodes,
        },
      });
    });
  }

  private submitNewVerification(
    input: SubmitAttemptVerificationInput,
    evidence: import("../../schemas/agent-work.js").AgentEngineVerification_v2,
    verificationJson: string,
    verificationHash: string
  ): AttemptVerificationSubmissionResult {
    const attempt = this.attempts.get(input.attemptId);
    const lease = this.workspaceLeases.get(input.workspaceLeaseId);
    const session = this.workerSessions.get(input.workerSessionId);
    const receipt = this.attemptReceipts.get(input.receiptId);
    const authorization = this.verificationAuthorizations.get(evidence.verification_id);
    if (
      !attempt ||
      attempt.runId !== input.runId ||
      !lease ||
      !session ||
      !receipt ||
      !authorization
    ) {
      return this.verificationFailure("not_found", attempt, lease, session);
    }
    if (attempt.revision !== input.expectedAttemptRevision) {
      return this.verificationFailure("stale_attempt_revision", attempt, lease, session);
    }
    if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
      return this.verificationFailure("stale_workspace_revision", attempt, lease, session);
    }
    if (session.revision !== input.expectedWorkerSessionRevision) {
      return this.verificationFailure("stale_session_revision", attempt, lease, session);
    }
    if (
      this.attemptVerifications.has(evidence.verification_id) ||
      this.verificationByAttempt.has(input.attemptId)
    ) {
      return this.verificationFailure("verification_conflict", attempt, lease, session);
    }
    const packetBinding = this.taskPacketBindings.get(input.attemptId);
    const packet = packetBinding
      ? validateCanonicalTaskPacket(packetBinding.packetJson, attempt)
      : null;
    const parsedReceipt = parseStoredReceipt(receipt);
    if (
      !packet ||
      !parsedReceipt ||
      !validVerificationAuthorization(authorization, input, attempt, lease, session, receipt) ||
      !validateAgentEngineVerificationV2PacketReferences(packet, evidence).valid ||
      !validVerificationBinding(evidence, input, attempt, lease, session, receipt) ||
      !hasRequiredTrustGaps(
        evidence,
        parsedReceipt,
        (this.workerAuthorityEvents.get(input.runId) ?? []).some(
          (event) =>
            event.attemptId === input.attemptId &&
            event.workerSessionId === input.workerSessionId &&
            event.decision === "deviation"
        )
      )
    ) {
      return this.verificationFailure("evidence_mismatch", attempt, lease, session);
    }
    if (
      attempt.status !== "verifying" ||
      attempt.receiptId !== receipt.receiptId ||
      receipt.attemptId !== attempt.attemptId ||
      receipt.receiptHash !== input.receiptHash ||
      receipt.disposition !== "verification_pending"
    ) {
      return this.verificationFailure("invalid_attempt_transition", attempt, lease, session);
    }
    if (
      lease.status !== "active" ||
      lease.controllerId !== input.controller.controllerId ||
      lease.controllerLeaseId !== input.controller.leaseId ||
      lease.fencingToken !== input.controller.fencingToken
    ) {
      return this.verificationFailure("stale_fence", attempt, lease, session);
    }
    if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.now, "now")) {
      return this.verificationFailure("workspace_expired", attempt, lease, session);
    }
    if (
      parseInstant(evidence.started_at, "verification.started_at") <
        parseInstant(authorization.startedAt, "authorization.startedAt") ||
      parseInstant(evidence.completed_at, "verification.completed_at") >
        parseInstant(input.now, "now")
    ) {
      return this.verificationFailure("invalid_time", attempt, lease, session);
    }

    const status = verificationAttemptStatus(evidence.outcome);
    attempt.revision += 1;
    attempt.status = status;
    attempt.verificationId = evidence.verification_id;
    attempt.updatedAt = normalizeInstant(input.now);
    attempt.completedAt = isTerminalAttemptStatus(status) ? normalizeInstant(input.now) : null;
    const record: AttemptVerificationRecord = {
      verificationId: evidence.verification_id,
      verificationHash,
      verificationJson,
      runId: input.runId,
      workItemId: evidence.work_item_id,
      workItemRevision: evidence.work_item_revision,
      attemptId: input.attemptId,
      packetId: evidence.packet_id,
      packetHash: evidence.packet_hash,
      workspaceLeaseId: input.workspaceLeaseId,
      workspaceLeaseRevision: evidence.workspace_lease_revision,
      workerSessionId: input.workerSessionId,
      workerSessionRevision: evidence.worker_session_revision,
      receiptId: input.receiptId,
      receiptHash: input.receiptHash,
      observedBaseSha: evidence.observed_base_sha,
      ...(evidence.verified_head_sha ? { verifiedHeadSha: evidence.verified_head_sha } : {}),
      ...(evidence.verified_patch_hash ? { verifiedPatchHash: evidence.verified_patch_hash } : {}),
      workspaceObservationHash: evidence.workspace_observation_hash,
      outcome: evidence.outcome,
      trustGapReasons: [...evidence.trust_gap_reasons],
      verifierId: evidence.verifier_id,
      verifierVersion: evidence.verifier_version,
      startedAt: normalizeInstant(evidence.started_at),
      completedAt: normalizeInstant(evidence.completed_at),
      recordedAt: normalizeInstant(input.now),
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      resultingAttemptRevision: attempt.revision,
      resultingAttemptStatus: status,
    };
    this.attemptVerifications.set(record.verificationId, record);
    this.verificationByAttempt.set(record.attemptId, record.verificationId);
    this.verificationByHash.set(record.verificationHash, record.verificationId);
    return this.recordVerificationEvent(
      input,
      attempt,
      lease,
      session,
      record,
      "attempt_verification_recorded"
    );
  }

  private recordVerificationEvent(
    input: SubmitAttemptVerificationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    session: WorkerSessionRecord,
    verification: AttemptVerificationRecord,
    type: AttemptVerificationEventType
  ): Extract<AttemptVerificationSubmissionResult, { recorded: true }> {
    const events = this.verificationEvents.get(input.runId) ?? [];
    const event: AttemptVerificationEvent = {
      runId: input.runId,
      attemptId: attempt.attemptId,
      verificationId: verification.verificationId,
      verificationHash: verification.verificationHash,
      receiptId: verification.receiptId,
      receiptHash: verification.receiptHash,
      mutationId: input.mutationId,
      sequence: events.length + 1,
      attemptRevision: attempt.revision,
      workspaceLeaseRevision: lease.revision,
      workerSessionRevision: session.revision,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      type,
      outcome: verification.outcome,
      resultingAttemptStatus: verification.resultingAttemptStatus,
      createdAt: normalizeInstant(input.now),
    };
    events.push(event);
    this.verificationEvents.set(input.runId, events);
    return {
      recorded: true,
      verification: cloneVerificationRecord(verification),
      attempt: { ...attempt },
      event: { ...event },
      idempotentReplay: false,
    };
  }

  private recordVerificationStartedEvent(
    input: BeginAttemptVerificationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    session: WorkerSessionRecord,
    authorization: AttemptVerificationAuthorizationRecord
  ): Extract<AttemptVerificationBeginResult, { started: true }> {
    const events = this.verificationEvents.get(input.runId) ?? [];
    const event: AttemptVerificationEvent = {
      runId: input.runId,
      attemptId: attempt.attemptId,
      verificationId: authorization.verificationId,
      verificationHash: null,
      receiptId: authorization.receiptId,
      receiptHash: authorization.receiptHash,
      mutationId: input.mutationId,
      sequence: events.length + 1,
      attemptRevision: attempt.revision,
      workspaceLeaseRevision: lease.revision,
      workerSessionRevision: session.revision,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      type: "attempt_verification_started",
      outcome: null,
      resultingAttemptStatus: "verifying",
      createdAt: normalizeInstant(input.now),
    };
    events.push(event);
    this.verificationEvents.set(input.runId, events);
    return {
      started: true,
      authorization: { ...authorization },
      attempt: { ...attempt },
      event: { ...event },
      idempotentReplay: false,
    };
  }

  private verificationBeginFailure(
    reason: AttemptVerificationFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    session?: WorkerSessionRecord,
    currentRunRevision?: number
  ): AttemptVerificationBeginResult {
    return {
      started: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(session ? { currentSessionRevision: session.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private verificationFailure(
    reason: AttemptVerificationFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    session?: WorkerSessionRecord,
    currentRunRevision?: number
  ): AttemptVerificationSubmissionResult {
    return {
      recorded: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(session ? { currentSessionRevision: session.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private committedVerificationResult(
    verificationId: string
  ): Extract<AttemptVerificationSubmissionResult, { recorded: true }> | null {
    for (const { result } of this.verificationMutations.values()) {
      if (
        result.verification.verificationId === verificationId &&
        result.event.type !== "attempt_verification_replayed"
      ) {
        return cloneVerificationSuccess(result);
      }
    }
    return null;
  }

  private submitNewReceipt(
    input: SubmitAttemptReceiptInput,
    claim: import("../../schemas/agent-work.js").AgentTaskReceipt_v2,
    receiptJson: string,
    receiptHash: string
  ): AttemptReceiptSubmissionResult {
    const attempt = this.attempts.get(input.attemptId);
    const lease = this.workspaceLeases.get(input.workspaceLeaseId);
    const session = this.workerSessions.get(input.workerSessionId);
    if (!attempt || attempt.runId !== input.runId || !lease || !session) {
      return this.receiptFailure("not_found", attempt, lease, session);
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
    if (this.attemptReceipts.has(claim.receipt_id)) {
      return this.receiptFailure("receipt_conflict", attempt, lease, session);
    }
    if (this.receiptByAttempt.has(input.attemptId)) {
      return this.receiptFailure("receipt_conflict", attempt, lease, session);
    }
    const packetBinding = this.taskPacketBindings.get(input.attemptId);
    const packet = packetBinding
      ? validateCanonicalTaskPacket(packetBinding.packetJson, attempt)
      : null;
    if (!packet || !validateAgentTaskReceiptV2PacketReferences(packet, claim).valid) {
      return this.receiptFailure("evidence_mismatch", attempt, lease, session);
    }
    if (!validReceiptBinding(claim, input, attempt, lease, session)) {
      return this.receiptFailure("evidence_mismatch", attempt, lease, session);
    }
    const terminalWorker = isTerminalWorkerSession(session.status);
    if (!terminalWorker || !session.endedAt) {
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
    if (!active && attempt.status !== "running" && !isTerminalAttemptStatus(attempt.status)) {
      return this.receiptFailure("invalid_attempt_transition", attempt, lease, session);
    }
    const disposition = active ? "verification_pending" : "retained_late";
    if (active) {
      const nextStatus: AttemptRecord["status"] =
        claim.outcome === "completed" ? "receipt_submitted" : claim.outcome;
      attempt.revision += 1;
      attempt.status = nextStatus;
      attempt.receiptId = claim.receipt_id;
      attempt.updatedAt = normalizeInstant(input.now);
      attempt.completedAt = nextStatus === "receipt_submitted" ? null : normalizeInstant(input.now);
    }
    const record: AttemptReceiptRecord = {
      receiptId: claim.receipt_id,
      receiptHash,
      receiptJson,
      runId: input.runId,
      workItemId: claim.work_item_id,
      workItemRevision: claim.work_item_revision,
      attemptId: input.attemptId,
      packetId: claim.packet_id,
      packetHash: claim.packet_hash,
      workspaceLeaseId: input.workspaceLeaseId,
      workspaceLeaseRevision: claim.workspace_lease_revision,
      workerSessionId: input.workerSessionId,
      workerSessionRevision: session.revision,
      workerRuntime: claim.worker_runtime,
      observedBaseSha: claim.observed_base_sha,
      ...(claim.final_head_sha ? { finalHeadSha: claim.final_head_sha } : {}),
      ...(claim.patch_hash ? { patchHash: claim.patch_hash } : {}),
      outcome: claim.outcome,
      disposition,
      submittedAt: normalizeInstant(claim.submitted_at),
      recordedAt: normalizeInstant(input.now),
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      resultingAttemptRevision: attempt.revision,
      resultingAttemptStatus: attempt.status,
    };
    this.attemptReceipts.set(record.receiptId, record);
    this.receiptByAttempt.set(record.attemptId, record.receiptId);
    this.receiptByHash.set(record.receiptHash, record.receiptId);
    return this.recordReceiptEvent(
      input,
      attempt,
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
    const events = this.receiptEvents.get(input.runId) ?? [];
    const event: AttemptReceiptEvent = {
      runId: input.runId,
      attemptId: attempt.attemptId,
      receiptId: receipt.receiptId,
      receiptHash: receipt.receiptHash,
      mutationId: input.mutationId,
      sequence: events.length + 1,
      attemptRevision: attempt.revision,
      workspaceLeaseRevision: lease.revision,
      workerSessionRevision: session.revision,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      type,
      disposition: receipt.disposition,
      outcome: receipt.outcome,
      createdAt: normalizeInstant(input.now),
    };
    events.push(event);
    this.receiptEvents.set(input.runId, events);
    return {
      submitted: true,
      receipt: { ...receipt },
      attempt: { ...attempt },
      event: { ...event },
      idempotentReplay: false,
    };
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
    receiptId: string
  ): Extract<AttemptReceiptSubmissionResult, { submitted: true }> | null {
    for (const { result } of this.receiptMutations.values()) {
      if (
        result.receipt.receiptId === receiptId &&
        result.event.type !== "attempt_receipt_replayed"
      ) {
        return cloneReceiptSuccess(result);
      }
    }
    return null;
  }

  private async mutateWorker(
    input: AttachWorkerSessionInput | HeartbeatWorkerSessionInput | EndWorkerSessionInput,
    action: () => WorkerSessionMutationResult
  ): Promise<WorkerSessionMutationResult> {
    if (!Number.isFinite(Date.parse(input.now))) return this.workerFailure("invalid_time");
    if (input.controller.runId !== input.runId) return this.workerFailure("lease_mismatch");
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = canonicalJSONStringify(input as unknown as JsonRecord);
        if (
          this.mutations.has(key) ||
          this.receiptMutations.has(key) ||
          this.verificationMutations.has(key) ||
          this.verificationBeginMutations.has(key) ||
          this.workerAuthorityMutations.has(key)
        )
          return this.workerFailure("mutation_conflict");
        const prior = this.workerMutations.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) return this.workerFailure("mutation_conflict");
          return { ...cloneWorkerSuccess(prior.result), idempotentReplay: true };
        }
        const result = action();
        if (result.updated) {
          this.workerMutations.set(key, { fingerprint, result: cloneWorkerSuccess(result) });
        }
        return result;
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.workerFailure(
          authenticated.reason,
          undefined,
          undefined,
          undefined,
          authenticated.currentRunRevision
        );
  }

  private validateWorkerBinding(
    input: AttachWorkerSessionInput | HeartbeatWorkerSessionInput | EndWorkerSessionInput
  ):
    | { valid: true; attempt: AttemptRecord; lease: WorkspaceLifecycleLeaseRecord }
    | { valid: false; failure: WorkerSessionMutationResult } {
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt || attempt.runId !== input.runId) {
      return { valid: false, failure: this.workerFailure("not_found") };
    }
    const lease = this.workspaceLeases.get(input.workspaceLeaseId);
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
    session: WorkerSessionRecord | undefined,
    input: HeartbeatWorkerSessionInput | EndWorkerSessionInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord
  ): WorkerSessionMutationResult | null {
    if (attempt.status !== "running") {
      return this.workerFailure("invalid_attempt_transition", attempt, lease, session);
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
    const events = this.workerEvents.get(input.runId) ?? [];
    const event: WorkerSessionEvent = {
      runId: input.runId,
      attemptId: attempt.attemptId,
      sessionId: session.sessionId,
      mutationId: input.mutationId,
      sequence: events.length + 1,
      attemptRevision: attempt.revision,
      workspaceLeaseRevision: lease.revision,
      sessionRevision: session.revision,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      type,
      payload: cloneJsonValue(payload),
      createdAt: normalizeInstant(input.now),
    };
    events.push(event);
    this.workerEvents.set(input.runId, events);
    return {
      updated: true,
      attempt: { ...attempt },
      workerSession: { ...session },
      event: cloneWorkerEvent(event),
      idempotentReplay: false,
    };
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

  private authorityFailure(
    reason: WorkerSessionMutationFailureReason,
    attempt?: AttemptRecord,
    lease?: WorkspaceLifecycleLeaseRecord,
    session?: WorkerSessionRecord,
    currentRunRevision?: number
  ): WorkerAuthorityDecisionResult {
    return {
      recorded: false,
      reason,
      ...(attempt ? { currentAttemptRevision: attempt.revision } : {}),
      ...(lease ? { currentWorkspaceLeaseRevision: lease.revision } : {}),
      ...(session ? { currentSessionRevision: session.revision } : {}),
      ...(currentRunRevision !== undefined ? { currentRunRevision } : {}),
    };
  }

  private async mutate(
    input: MutationInput,
    action: () => WorkspaceMutationResult
  ): Promise<WorkspaceMutationResult> {
    if (!Number.isFinite(Date.parse(input.now))) return this.failure("invalid_time");
    if (input.controller.runId !== input.runId) return this.failure("lease_mismatch");
    const authenticated = this.withActiveControllerCredential(
      input.controller,
      input.now,
      input.expectedRunRevision,
      () => {
        const key = mutationKey(input.runId, input.mutationId);
        const fingerprint = canonicalJSONStringify(input as unknown as JsonRecord);
        if (
          this.workerMutations.has(key) ||
          this.receiptMutations.has(key) ||
          this.verificationMutations.has(key) ||
          this.verificationBeginMutations.has(key) ||
          this.workerAuthorityMutations.has(key)
        )
          return this.failure("mutation_conflict");
        const prior = this.mutations.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) return this.failure("mutation_conflict");
          return { ...cloneSuccess(prior.result), idempotentReplay: true };
        }
        const result = action();
        if (result.updated) this.mutations.set(key, { fingerprint, result: cloneSuccess(result) });
        return result;
      }
    );
    return authenticated.authenticated
      ? authenticated.value
      : this.failure(authenticated.reason, undefined, undefined, authenticated.currentRunRevision);
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
  ): Promise<WorkspaceMutationResult> {
    return this.mutate(input, () => {
      const attempt = this.attempts.get(input.attemptId);
      const attemptFailure = this.validateAttempt(
        attempt,
        input.runId,
        input.expectedAttemptRevision
      );
      if (attemptFailure) return attemptFailure;
      const lease = this.workspaceLeases.get(input.workspaceLeaseId);
      if (!lease || lease.attemptId !== attempt!.attemptId)
        return this.failure("not_found", attempt!);
      if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
        return this.failure("stale_workspace_revision", attempt!, lease);
      }
      if (lease.status !== "active" && lease.status !== "reserved") {
        return this.failure("workspace_not_active", attempt!, lease);
      }
      if (
        input.controller.fencingToken !== lease.fencingToken ||
        input.controller.controllerId !== lease.controllerId ||
        input.controller.leaseId !== lease.controllerLeaseId
      ) {
        if (!allowFenceTakeover) {
          return this.failure("stale_fence", attempt!, lease);
        }
      }
      if (
        parseInstant(input.now, "now") < parseInstant(attempt!.updatedAt, "attempt.updatedAt") ||
        parseInstant(input.now, "now") < parseInstant(lease.heartbeatAt, "lease.heartbeatAt")
      ) {
        return this.failure("invalid_time", attempt!, lease);
      }
      return action(attempt!, lease);
    });
  }

  private validateAttempt(
    attempt: AttemptRecord | undefined,
    runId: string,
    expectedRevision: number
  ): WorkspaceMutationResult | null {
    if (!attempt || attempt.runId !== runId) return this.failure("not_found");
    if (attempt.revision !== expectedRevision)
      return this.failure("stale_attempt_revision", attempt);
    return null;
  }

  private finishLease(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    status: FinishedWorkspaceLeaseStatus,
    disposition: WorkspaceCleanupDisposition,
    eventType: WorkspaceLifecycleEventType
  ): WorkspaceMutationResult {
    const now = normalizeInstant(input.now);
    attempt.revision += 1;
    attempt.updatedAt = now;
    lease.revision += 1;
    lease.status = status;
    lease.cleanupDisposition = disposition;
    lease.releasedAt = now;
    if ("observation" in input && input.observation) {
      lease.lastObservation = cloneObservation(input.observation);
    }
    return this.record(input, attempt, lease, eventType, { action: status, disposition });
  }

  private quarantine(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord,
    reason: string,
    observation: WorkspaceObservation
  ): WorkspaceMutationResult {
    const now = normalizeInstant(input.now);
    attempt.revision += 1;
    attempt.status = "quarantined";
    attempt.updatedAt = now;
    attempt.completedAt = now;
    lease.revision += 1;
    lease.status = "quarantined";
    lease.cleanupDisposition = "preserved";
    lease.releasedAt = now;
    lease.lastObservation = cloneObservation(observation);
    return this.record(input, attempt, lease, "workspace_quarantined", { reason });
  }

  private record(
    input: MutationInput,
    attempt: AttemptRecord,
    lease: WorkspaceLifecycleLeaseRecord | null,
    type: WorkspaceLifecycleEventType,
    payload: JsonRecord
  ): WorkspaceMutationResult {
    const events = this.lifecycleEvents.get(input.runId) ?? [];
    const event: WorkspaceLifecycleEvent = {
      runId: input.runId,
      attemptId: attempt.attemptId,
      mutationId: input.mutationId,
      sequence: events.length + 1,
      attemptRevision: attempt.revision,
      workspaceLeaseRevision: lease?.revision ?? null,
      controllerId: input.controller.controllerId,
      controllerLeaseId: input.controller.leaseId,
      fencingToken: input.controller.fencingToken,
      type,
      payload: cloneJsonValue(payload),
      createdAt: normalizeInstant(input.now),
    };
    events.push(event);
    this.lifecycleEvents.set(input.runId, events);
    return {
      updated: true,
      attempt: { ...attempt },
      workspaceLease: lease ? cloneLease(lease) : null,
      event: cloneEvent(event),
      idempotentReplay: false,
    };
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
}

type JsonRecord = { [key: string]: import("../coordination-store.js").JsonValue };

function normalizeInstant(value: string): string {
  return new Date(parseInstant(value, "now")).toISOString();
}

function mutationKey(runId: string, mutationId: string): string {
  return `${runId}\u0000${mutationId}`;
}

function isLiveAttempt(attempt: AttemptRecord): boolean {
  return isLiveAttemptStatus(attempt.status);
}

function validTtl(ttlMs: number): boolean {
  return Number.isSafeInteger(ttlMs) && ttlMs > 0;
}

function bindAttemptEvidence(
  attempt: AttemptRecord,
  input: TransitionAttemptInput
): { bound: true; receiptId: string | null; verificationId: string | null } | { bound: false } {
  let receiptId = attempt.receiptId;
  let verificationId = attempt.verificationId;

  if (input.receiptId !== undefined) {
    if (input.receiptId.length === 0 || (receiptId !== null && receiptId !== input.receiptId)) {
      return { bound: false };
    }
    receiptId = input.receiptId;
  }
  if (input.verificationId !== undefined) {
    if (
      input.verificationId.length === 0 ||
      (verificationId !== null && verificationId !== input.verificationId)
    ) {
      return { bound: false };
    }
    verificationId = input.verificationId;
  }

  if (attemptStatusRequiresReceipt(input.status) && receiptId === null) {
    return { bound: false };
  }
  if (attemptStatusRequiresVerification(input.status) && verificationId === null) {
    return { bound: false };
  }

  return { bound: true, receiptId, verificationId };
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

function cloneObservation(observation: WorkspaceObservation): WorkspaceObservation {
  return {
    ...observation,
    ...(observation.dirtyPaths ? { dirtyPaths: [...observation.dirtyPaths] } : {}),
  };
}

function cloneLease(lease: WorkspaceLifecycleLeaseRecord): WorkspaceLifecycleLeaseRecord {
  return {
    ...lease,
    lastObservation: lease.lastObservation && cloneObservation(lease.lastObservation),
  };
}

function cloneEvent(event: WorkspaceLifecycleEvent): WorkspaceLifecycleEvent {
  return { ...event, payload: cloneJsonValue(event.payload) };
}

function cloneSuccess(
  result: Extract<WorkspaceMutationResult, { updated: true }>
): Extract<WorkspaceMutationResult, { updated: true }> {
  return {
    ...result,
    attempt: { ...result.attempt },
    workspaceLease: result.workspaceLease ? cloneLease(result.workspaceLease) : null,
    event: cloneEvent(result.event),
  };
}

function cloneWorkerEvent(event: WorkerSessionEvent): WorkerSessionEvent {
  return { ...event, payload: cloneJsonValue(event.payload) };
}

function cloneWorkerSuccess(
  result: Extract<WorkerSessionMutationResult, { updated: true }>
): Extract<WorkerSessionMutationResult, { updated: true }> {
  return {
    ...result,
    attempt: { ...result.attempt },
    workerSession: { ...result.workerSession },
    event: cloneWorkerEvent(result.event),
  };
}

function validExitMetadata(input: EndWorkerSessionInput): boolean {
  return (
    (input.exitReason === undefined || Buffer.byteLength(input.exitReason, "utf8") <= 128) &&
    (input.exitSummary === undefined || Buffer.byteLength(input.exitSummary, "utf8") <= 4_096) &&
    (input.exitCode === undefined || Number.isSafeInteger(input.exitCode))
  );
}

function launchBindingFailure(
  input: BindLaunchEnvelopeInput,
  attempt: AttemptRecord | undefined,
  lease: WorkspaceLifecycleLeaseRecord | undefined
): LaunchEnvelopeBindingResult | null {
  if (
    !attempt ||
    attempt.runId !== input.runId ||
    !lease ||
    lease.attemptId !== attempt.attemptId
  ) {
    return launchFailure("not_found", attempt, lease);
  }
  if (attempt.revision !== input.expectedAttemptRevision) {
    return launchFailure("stale_attempt_revision", attempt, lease);
  }
  if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
    return launchFailure("stale_workspace_revision", attempt, lease);
  }
  if (attempt.status !== "launching") {
    return launchFailure("invalid_attempt_transition", attempt, lease);
  }
  if (lease.status !== "active") return launchFailure("workspace_not_active", attempt, lease);
  if (
    lease.controllerId !== input.controller.controllerId ||
    lease.controllerLeaseId !== input.controller.leaseId ||
    lease.fencingToken !== input.controller.fencingToken
  ) {
    return launchFailure("stale_fence", attempt, lease);
  }
  if (parseInstant(lease.expiresAt, "expiresAt") <= parseInstant(input.createdAt, "createdAt")) {
    return launchFailure("workspace_expired", attempt, lease);
  }
  return null;
}

function launchFailure(
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

function isLaunchAuthorizationForAttempt(
  event: WorkspaceLifecycleEvent,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord
): boolean {
  return (
    event.runId === attempt.runId &&
    event.attemptId === attempt.attemptId &&
    event.type === "attempt_transitioned" &&
    event.attemptRevision > 0 &&
    event.attemptRevision <= attempt.revision &&
    event.workspaceLeaseRevision !== null &&
    event.workspaceLeaseRevision <= lease.revision &&
    parseInstant(event.createdAt, "authorization.createdAt") <=
      parseInstant(attempt.updatedAt, "attempt.updatedAt") &&
    isJsonRecord(event.payload) &&
    event.payload.status === "launching"
  );
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
  existing: TaskPacketBindingRecord | undefined,
  packetJson: string | undefined,
  attempt: AttemptRecord | undefined
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
    existing.createdAt === normalizeInstant(input.createdAt)
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

function parseStoredReceipt(record: AttemptReceiptRecord): AgentTaskReceipt_v2 | null {
  try {
    const value = JSON.parse(record.receiptJson) as unknown;
    const parsed = AgentTaskReceipt_v2.safeParse(value);
    return parsed.success &&
      canonicalJSONStringify(parsed.data) === record.receiptJson &&
      computeCanonicalHash(parsed.data) === record.receiptHash
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function validVerificationBinding(
  verification: import("../../schemas/agent-work.js").AgentEngineVerification_v2,
  input: SubmitAttemptVerificationInput,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord,
  session: WorkerSessionRecord,
  receipt: AttemptReceiptRecord
): boolean {
  return (
    verification.run_id === input.runId &&
    verification.attempt_id === input.attemptId &&
    verification.work_item_id === attempt.workItemId &&
    verification.work_item_revision === attempt.workItemRevision &&
    verification.packet_id === attempt.packetId &&
    verification.packet_hash === attempt.packetHash &&
    verification.workspace_lease_id === input.workspaceLeaseId &&
    verification.workspace_lease_revision === lease.revision &&
    lease.attemptId === attempt.attemptId &&
    verification.worker_session_id === input.workerSessionId &&
    verification.worker_session_revision === session.revision &&
    session.runId === input.runId &&
    session.attemptId === input.attemptId &&
    session.workspaceLeaseId === input.workspaceLeaseId &&
    verification.receipt_id === input.receiptId &&
    verification.receipt_hash === input.receiptHash &&
    receipt.receiptId === input.receiptId &&
    receipt.receiptHash === input.receiptHash &&
    verification.observed_base_sha === attempt.baseSha.toLowerCase()
  );
}

function validVerificationAuthorization(
  authorization: AttemptVerificationAuthorizationRecord,
  input: SubmitAttemptVerificationInput,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord,
  session: WorkerSessionRecord,
  receipt: AttemptReceiptRecord
): boolean {
  return (
    authorization.runId === input.runId &&
    authorization.attemptId === input.attemptId &&
    authorization.attemptRevision === attempt.revision &&
    authorization.workspaceLeaseId === input.workspaceLeaseId &&
    authorization.workspaceLeaseRevision === lease.revision &&
    authorization.workerSessionId === input.workerSessionId &&
    authorization.workerSessionRevision === session.revision &&
    authorization.receiptId === input.receiptId &&
    authorization.receiptHash === input.receiptHash &&
    authorization.controllerId === input.controller.controllerId &&
    authorization.controllerLeaseId === input.controller.leaseId &&
    authorization.fencingToken === input.controller.fencingToken &&
    receipt.receiptId === authorization.receiptId
  );
}

function validAuthorityDecision(
  input: RecordWorkerAuthorityDecisionInput,
  authority: AgentTaskPacket_v1["authority"]
): boolean {
  if (
    input.actionClass.length === 0 ||
    input.actionClass.length > 128 ||
    input.backendId.length === 0 ||
    input.backendId.length > 128 ||
    input.backendVersion.length === 0 ||
    input.backendVersion.length > 128 ||
    !/^sha256:[a-f0-9]{64}$/.test(input.actionHash)
  ) {
    return false;
  }
  const granted = authority[input.dimension];
  if (input.decision === "allowed") {
    return granted && input.reason === "packet_granted" && input.enforcement !== "unenforced";
  }
  if (input.decision === "deviation") {
    return !granted && input.reason === "observed_after_execution";
  }
  return (
    (!granted && input.reason === "packet_denied" && input.enforcement !== "unenforced") ||
    (input.reason === "backend_unenforceable" && input.enforcement === "unenforced")
  );
}

function authorityDecisionFingerprint(input: RecordWorkerAuthorityDecisionInput): string {
  const { now: _observedAt, ...semanticInput } = input;
  return canonicalJSONStringify(semanticInput as unknown as JsonRecord);
}

function validWorkerAdapterBinding(
  input: NonNullable<AttachWorkerSessionInput["adapter"]>
): boolean {
  return (
    input.adapterId.length > 0 &&
    input.adapterId.length <= 128 &&
    input.adapterVersion.length > 0 &&
    input.adapterVersion.length <= 128 &&
    /^sha256:[0-9a-f]{64}$/u.test(input.enforcementSummaryHash) &&
    input.trustGapDimensions.length <= 16 &&
    new Set(input.trustGapDimensions).size === input.trustGapDimensions.length &&
    input.trustGapDimensions.every((value) => value.length > 0 && value.length <= 128)
  );
}

function hasRequiredTrustGaps(
  verification: import("../../schemas/agent-work.js").AgentEngineVerification_v2,
  receipt: AgentTaskReceipt_v2,
  authorityDeviation = false
): boolean {
  const required = new Set<
    import("../../schemas/agent-work.js").EngineVerificationTrustGapReason_v2
  >();
  if ((receipt.outcome === "completed") !== (verification.outcome === "pass")) {
    required.add("worker_outcome_disagrees");
  }
  if (
    receipt.final_head_sha !== undefined &&
    receipt.final_head_sha !== verification.verified_head_sha
  ) {
    required.add("head_identity_disagrees");
  }
  if (receipt.patch_hash !== undefined && receipt.patch_hash !== verification.verified_patch_hash) {
    required.add("patch_identity_disagrees");
  }
  const observedChecks = new Map(
    verification.checks
      .filter(({ source }) => source === "packet")
      .map((check) => [check.id, check.outcome] as const)
  );
  const claimAgrees = receipt.claimed_checks.every((claim) => {
    const observed = observedChecks.get(claim.id);
    return (
      observed === undefined ||
      (claim.outcome === "pass" && observed === "pass") ||
      (claim.outcome === "fail" && observed === "fail") ||
      (claim.outcome === "not_run" && observed !== "pass" && observed !== "fail")
    );
  });
  if (!claimAgrees) required.add("claimed_check_disagrees");
  if (authorityDeviation) required.add("authority_deviation");
  const declared = new Set(verification.trust_gap_reasons);
  return [...required].every((reason) => declared.has(reason));
}

function verificationAttemptStatus(
  outcome: import("../../schemas/agent-work.js").VerificationOutcome
): AttemptRecord["status"] {
  if (outcome === "pass") return "verified";
  if (outcome === "fail") return "rejected";
  return "inconclusive";
}

function cloneReceiptSuccess(
  result: Extract<AttemptReceiptSubmissionResult, { submitted: true }>
): Extract<AttemptReceiptSubmissionResult, { submitted: true }> {
  return {
    ...result,
    receipt: { ...result.receipt },
    attempt: { ...result.attempt },
    event: { ...result.event },
  };
}

function cloneVerificationRecord(record: AttemptVerificationRecord): AttemptVerificationRecord {
  return { ...record, trustGapReasons: [...record.trustGapReasons] };
}

function cloneVerificationSuccess(
  result: Extract<AttemptVerificationSubmissionResult, { recorded: true }>
): Extract<AttemptVerificationSubmissionResult, { recorded: true }> {
  return {
    ...result,
    verification: cloneVerificationRecord(result.verification),
    attempt: { ...result.attempt },
    event: { ...result.event },
  };
}

function cloneVerificationBeginSuccess(
  result: Extract<AttemptVerificationBeginResult, { started: true }>
): Extract<AttemptVerificationBeginResult, { started: true }> {
  return {
    ...result,
    authorization: { ...result.authorization },
    attempt: { ...result.attempt },
    event: { ...result.event },
  };
}
