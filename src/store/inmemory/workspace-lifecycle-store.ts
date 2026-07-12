import { canonicalJSONStringify } from "../../util/canonicalJson.js";
import { calculateExpiry, cloneJsonValue, parseInstant } from "../coordination-store.js";
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
import { InMemoryCoordinationStore } from "./coordination-store.js";

type MutationInput =
  | CreateAttemptInput
  | TransitionAttemptInput
  | AcquireWorkspaceInput
  | HeartbeatWorkspaceInput
  | ReleaseWorkspaceInput
  | ReconcileWorkspaceInput
  | QuarantineWorkspaceInput;

interface StoredMutation {
  fingerprint: string;
  result: Extract<WorkspaceMutationResult, { updated: true }>;
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
  implements WorkspaceLifecycleStore
{
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly workspaceLeases = new Map<string, WorkspaceLifecycleLeaseRecord>();
  private readonly lifecycleEvents = new Map<string, WorkspaceLifecycleEvent[]>();
  private readonly mutations = new Map<string, StoredMutation>();

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
      if (!canTransition(attempt!.status, input.status)) {
        return this.failure("invalid_attempt_transition", attempt!);
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
      attempt!.completedAt = TERMINAL_ATTEMPTS.has(input.status) ? now : null;
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
    status: "released" | "preserved" | "abandoned",
    disposition: "integrated" | "preserved" | "abandoned" | "discarded",
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
  return !TERMINAL_ATTEMPTS.has(attempt.status);
}

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

const legalAttemptTransitions: Record<AttemptRecord["status"], AttemptRecord["status"][]> = {
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

function canTransition(from: AttemptRecord["status"], to: AttemptRecord["status"]): boolean {
  return legalAttemptTransitions[from].includes(to);
}

function requiresLiveWorkspace(status: AttemptRecord["status"]): boolean {
  return !["prepared", "leased", "cancelled", "quarantined"].includes(status);
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

  if (
    ["receipt_submitted", "verifying", "verified", "accepted", "rejected", "inconclusive"].includes(
      input.status
    ) &&
    receiptId === null
  ) {
    return { bound: false };
  }
  if (
    ["verified", "accepted", "rejected", "inconclusive"].includes(input.status) &&
    verificationId === null
  ) {
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
