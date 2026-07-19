import { Buffer } from "node:buffer";

import { ExecutionEnvelope_v1 } from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type {
  ControllerLease,
  ControllerLeaseCredential,
  CoordinationStore,
  JsonValue,
} from "../store/coordination-store.js";
import type {
  AttemptRecord,
  LaunchEnvelopeBindingRecord,
  LaunchEnvelopeBindingStore,
  ReconcileIncompleteLaunchInput,
  TaskPacketBindingStore,
  TaskPacketBindingRecord,
  WorkspaceLifecycleLeaseRecord,
  WorkspaceLifecycleStore,
  WorkspaceMutationFailureReason,
  WorkspaceMutationResult,
  WorkspaceObservation,
} from "../store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import type {
  AllocateWorkspaceInput,
  WorkspaceMutationStep,
} from "../workspaces/workspace-coordinator.js";
import { WorkspaceCoordinator } from "../workspaces/workspace-coordinator.js";
import { parseRunState, type RunState } from "./types.js";

const MAX_REASON_BYTES = 1_024;

export interface StartAttemptInput {
  runId: string;
  initialRunState: RunState;
  controller: {
    controllerId: string;
    leaseId: string;
    now: string;
    ttlMs: number;
  };
  attempt: {
    attemptId: string;
    workItemId: string;
    workItemRevision: number;
    packetId: string;
    packetHash: string;
    baseSha: string;
  };
  workspace: Omit<
    AllocateWorkspaceInput["reservation"],
    | "attemptId"
    | "workItemId"
    | "workItemRevision"
    | "packetId"
    | "packetHash"
    | "baseSha"
    | "expectedAttemptRevision"
  > & { ttlMs: number };
  mutations: {
    createAttempt: WorkspaceMutationStep;
    reserveWorkspace: WorkspaceMutationStep;
    activateWorkspace: WorkspaceMutationStep;
    resumeWorkspace: WorkspaceMutationStep;
    quarantineWorkspace: WorkspaceMutationStep;
    authorizeLaunch: WorkspaceMutationStep;
  };
  broker?: AllocateWorkspaceInput["broker"];
}

export type LifecyclePhase =
  "controller" | "attempt_create" | "workspace_allocate" | "workspace_resume" | "launch_authorize";

export type LifecycleFailureReason =
  | "controller_held"
  | "store_rejected"
  | "workspace_rejected"
  | "identity_mismatch"
  | "inactive_workspace"
  | "stale_authority"
  | "expired_workspace"
  | "reconciliation_required";

export interface AgentWorkLifecycleSuccess {
  ok: true;
  outcome: "launch_authorized";
  controllerLease: ControllerLease;
  run: BoundedRunStatus;
  attempt: BoundedAttemptStatus;
  workspace: BoundedWorkspaceStatus;
  idempotentReplay: boolean;
}

export interface AgentWorkLifecycleFailure {
  ok: false;
  phase: LifecyclePhase;
  reason: LifecycleFailureReason;
  reconciliationRequired: boolean;
  status?: AgentWorkStatus;
  storeReason?: WorkspaceMutationFailureReason;
}

export type AgentWorkLifecycleResult = AgentWorkLifecycleSuccess | AgentWorkLifecycleFailure;

export interface BoundedRunStatus {
  runId: string;
  revision: number;
  state: string | null;
  updatedAt: string | null;
  controller: {
    controllerId: string;
    leaseId: string;
    fencingToken: number;
    expiresAt: string;
  } | null;
}

export interface BoundedAttemptStatus {
  attemptId: string;
  revision: number;
  status: AttemptRecord["status"];
  workItemId: string;
  workItemRevision: number;
  packetId: string;
  packetHash: string;
  baseSha: string;
  workspaceLeaseId: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface BoundedWorkspaceStatus {
  leaseId: string;
  revision: number;
  status: WorkspaceLifecycleLeaseRecord["status"];
  repositoryId: string;
  hostId: string;
  gitRuntime: string;
  branch: string;
  worktreePath: string;
  baseSha: string;
  heartbeatAt: string;
  expiresAt: string;
  cleanupDisposition: WorkspaceLifecycleLeaseRecord["cleanupDisposition"] | null;
  observation: {
    exists: boolean;
    registered: boolean;
    headSha: string | null;
    cleanliness: WorkspaceObservation["cleanliness"];
    dirtyPathCount: number;
    reason: string | null;
  } | null;
}

export interface AgentWorkStatus {
  run: BoundedRunStatus | null;
  attempt: BoundedAttemptStatus | null;
  workspace: BoundedWorkspaceStatus | null;
  launch: BoundedLaunchStatus | null;
}

export interface BoundedLaunchStatus {
  state:
    | "not_authorized"
    | "binding_missing"
    | "binding_stale"
    | "bound"
    | "failed_closed"
    | "inconsistent";
  reconciliationRequired: boolean;
}

export type AgentWorkLaunchReconciliationResult =
  | {
      ok: true;
      outcome: "binding_present" | "launch_failed";
      status: AgentWorkStatus;
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      reason: "store_rejected";
      reconciliationRequired: true;
      status: AgentWorkStatus;
      storeReason: WorkspaceMutationFailureReason;
    };

/** Shared, adapter-neutral Stage 2 application service. */
export class AgentWorkLifecycleService {
  constructor(
    private readonly coordinationStore: CoordinationStore,
    private readonly workspaceStore: WorkspaceLifecycleStore &
      LaunchEnvelopeBindingStore &
      TaskPacketBindingStore,
    private readonly workspaceCoordinator: WorkspaceCoordinator
  ) {}

  async startAttempt(input: StartAttemptInput): Promise<AgentWorkLifecycleResult> {
    try {
      return await this.startAttemptUnsafe(input);
    } catch {
      return this.failure(input, "controller", "reconciliation_required", true);
    }
  }

  private async startAttemptUnsafe(input: StartAttemptInput): Promise<AgentWorkLifecycleResult> {
    const initialRunState = parseRunState(input.initialRunState);
    if (initialRunState.runId !== input.runId) {
      throw new TypeError("initialRunState.runId must match runId");
    }
    const acquired = await this.coordinationStore.acquireControllerLease({
      runId: input.runId,
      ...input.controller,
      initialState: canonicalRun(initialRunState),
    });
    if (!acquired.acquired) {
      return this.failure(input, "controller", "controller_held", false);
    }
    const controller = credential(acquired.lease);
    const runRevision = acquired.record.revision;

    let attempt = await this.workspaceStore.getAttempt(input.attempt.attemptId);
    let created: WorkspaceMutationResult | null = null;
    if (!attempt) {
      created = await this.workspaceStore.createAttempt({
        runId: input.runId,
        expectedRunRevision: runRevision,
        controller,
        ...input.attempt,
        ...input.mutations.createAttempt,
      });
      attempt = await this.workspaceStore.getAttempt(input.attempt.attemptId);
    }
    if (!attempt || !sameAttemptIdentity(attempt, input, runRevision)) {
      return this.failure(input, "attempt_create", "identity_mismatch", true);
    }
    if (created && !created.updated) {
      return this.failure(input, "attempt_create", "store_rejected", false, created);
    }

    let lease = attempt.workspaceLeaseId
      ? await this.workspaceStore.getWorkspaceLease(attempt.workspaceLeaseId)
      : null;
    let replayed = created?.idempotentReplay ?? false;

    if (
      attempt.status === "prepared" ||
      (attempt.status === "leased" &&
        lease?.status === "reserved" &&
        controlledBy(lease, controller))
    ) {
      const allocated = await this.workspaceCoordinator.allocate({
        runId: input.runId,
        expectedRunRevision: runRevision,
        controller,
        reservation: {
          ...input.workspace,
          attemptId: input.attempt.attemptId,
          workItemId: input.attempt.workItemId,
          baseSha: input.attempt.baseSha,
          expectedAttemptRevision: 0,
          workspaceLeaseId: input.workspace.workspaceLeaseId,
        },
        ttlMs: input.workspace.ttlMs,
        mutations: {
          reserve: input.mutations.reserveWorkspace,
          activate: input.mutations.activateWorkspace,
          quarantine: input.mutations.quarantineWorkspace,
        },
        ...(input.broker ? { broker: input.broker } : {}),
      });
      if (!allocated.ok) {
        return this.failure(input, "workspace_allocate", "workspace_rejected", true);
      }
      replayed ||= allocated.idempotentReplay;
      attempt = await this.workspaceStore.getAttempt(input.attempt.attemptId);
      lease = attempt?.workspaceLeaseId
        ? await this.workspaceStore.getWorkspaceLease(attempt.workspaceLeaseId)
        : null;
    }

    if (!attempt || !lease || !bound(attempt, lease)) {
      return this.failure(input, "workspace_allocate", "reconciliation_required", true);
    }
    if (!sameLeaseIdentity(lease, attempt, input)) {
      return this.failure(input, "workspace_allocate", "identity_mismatch", true);
    }
    if (!controlledBy(lease, controller)) {
      if (attempt.status !== "leased") {
        return this.failure(input, "workspace_resume", "reconciliation_required", true);
      }
      const resumed = await this.workspaceCoordinator.resume({
        runId: input.runId,
        expectedRunRevision: runRevision,
        controller,
        attemptId: attempt.attemptId,
        workspaceLeaseId: lease.leaseId,
        expectedAttemptRevision: attempt.revision,
        expectedWorkspaceLeaseRevision: lease.revision,
        ttlMs: input.workspace.ttlMs,
        mutation: input.mutations.resumeWorkspace,
        ...(input.broker ? { broker: input.broker } : {}),
      });
      if (!resumed.ok) return this.failure(input, "workspace_resume", "workspace_rejected", true);
      replayed ||= resumed.idempotentReplay;
      attempt = await this.workspaceStore.getAttempt(input.attempt.attemptId);
      lease = attempt?.workspaceLeaseId
        ? await this.workspaceStore.getWorkspaceLease(attempt.workspaceLeaseId)
        : null;
    }

    if (!attempt || !lease || !bound(attempt, lease) || !sameLeaseIdentity(lease, attempt, input)) {
      return this.failure(input, "launch_authorize", "reconciliation_required", true);
    }
    if (lease.status !== "active") {
      return this.failure(input, "launch_authorize", "inactive_workspace", false);
    }
    if (!controlledBy(lease, controller)) {
      return this.failure(input, "launch_authorize", "stale_authority", true);
    }
    if (Date.parse(lease.expiresAt) <= Date.parse(input.mutations.authorizeLaunch.now)) {
      return this.failure(input, "launch_authorize", "expired_workspace", true);
    }

    if (attempt.status === "launching") {
      const launchEvent = (
        await this.workspaceStore.listWorkspaceLifecycleEvents(input.runId)
      ).find((event) => event.mutationId === input.mutations.authorizeLaunch.mutationId);
      if (
        launchEvent?.type === "attempt_transitioned" &&
        launchEvent.attemptId === attempt.attemptId &&
        object(launchEvent.payload)?.status === "launching" &&
        launchEvent.attemptRevision > 0 &&
        launchEvent.attemptRevision <= attempt.revision &&
        launchEvent.createdAt === input.mutations.authorizeLaunch.now &&
        launchEvent.controllerId === controller.controllerId &&
        launchEvent.controllerLeaseId === controller.leaseId &&
        launchEvent.fencingToken === controller.fencingToken
      ) {
        const status = await this.getStatus({ runId: input.runId, attemptId: attempt.attemptId });
        if (status.run && status.attempt && status.workspace) {
          return {
            ok: true,
            outcome: "launch_authorized",
            controllerLease: boundedControllerLease(acquired.lease),
            run: status.run,
            attempt: status.attempt,
            workspace: status.workspace,
            idempotentReplay: true,
          };
        }
      }
      return this.failure(input, "launch_authorize", "reconciliation_required", true);
    }
    if (attempt.status !== "leased") {
      return this.failure(input, "launch_authorize", "reconciliation_required", true);
    }

    const authorized = await this.workspaceStore.transitionAttempt({
      runId: input.runId,
      expectedRunRevision: runRevision,
      controller,
      attemptId: attempt.attemptId,
      expectedAttemptRevision: attempt.revision,
      status: "launching",
      ...input.mutations.authorizeLaunch,
    });
    const currentAttempt = await this.workspaceStore.getAttempt(attempt.attemptId);
    const currentLease = currentAttempt?.workspaceLeaseId
      ? await this.workspaceStore.getWorkspaceLease(currentAttempt.workspaceLeaseId)
      : null;
    if (
      !authorized.updated ||
      !currentAttempt ||
      currentAttempt.status !== "launching" ||
      !currentLease ||
      currentLease.status !== "active" ||
      !bound(currentAttempt, currentLease) ||
      !controlledBy(currentLease, controller)
    ) {
      return this.failure(input, "launch_authorize", "store_rejected", true, authorized);
    }
    const status = await this.getStatus({ runId: input.runId, attemptId: attempt.attemptId });
    if (!status.run || !status.attempt || !status.workspace) {
      return {
        ok: false,
        phase: "launch_authorize",
        reason: "reconciliation_required",
        reconciliationRequired: true,
        status,
      };
    }
    return {
      ok: true,
      outcome: "launch_authorized",
      controllerLease: boundedControllerLease(acquired.lease),
      run: status.run,
      attempt: status.attempt,
      workspace: status.workspace,
      idempotentReplay: replayed || authorized.idempotentReplay,
    };
  }

  async getStatus(input: { runId: string; attemptId?: string }): Promise<AgentWorkStatus> {
    try {
      return await readAgentWorkStatus(this.coordinationStore, this.workspaceStore, input);
    } catch {
      return { run: null, attempt: null, workspace: null, launch: null };
    }
  }

  /**
   * Resolve a stranded launch without inventing the missing envelope. A complete binding that won
   * the race is recoverable; otherwise the store atomically terminates the Attempt as launch_failed.
   */
  async reconcileIncompleteLaunch(
    input: ReconcileIncompleteLaunchInput
  ): Promise<AgentWorkLaunchReconciliationResult> {
    const result = await this.workspaceStore.reconcileIncompleteLaunch(input);
    const status = await this.getStatus({ runId: input.runId, attemptId: input.attemptId });
    if (result.updated) {
      return {
        ok: true,
        outcome: "launch_failed",
        status,
        idempotentReplay: result.idempotentReplay,
      };
    }
    if (
      status.launch?.state === "bound" &&
      status.run?.controller &&
      status.workspace &&
      Date.parse(status.run.controller.expiresAt) > Date.parse(input.now) &&
      Date.parse(status.workspace.expiresAt) > Date.parse(input.now)
    ) {
      return { ok: true, outcome: "binding_present", status, idempotentReplay: false };
    }
    return {
      ok: false,
      reason: "store_rejected",
      reconciliationRequired: true,
      status,
      storeReason: result.reason,
    };
  }

  private async failure(
    input: Pick<StartAttemptInput, "runId" | "attempt">,
    phase: LifecyclePhase,
    reason: LifecycleFailureReason,
    reconciliationRequired: boolean,
    storeResult?: WorkspaceMutationResult
  ): Promise<AgentWorkLifecycleFailure> {
    const status = await this.getStatus({ runId: input.runId, attemptId: input.attempt.attemptId });
    return {
      ok: false,
      phase,
      reason,
      reconciliationRequired,
      status,
      ...(!storeResult || storeResult.updated ? {} : { storeReason: storeResult.reason }),
    };
  }
}

/** Shared read-only projection for adapters that do not construct a Git coordinator. */
export async function readAgentWorkStatus(
  coordinationStore: CoordinationStore,
  workspaceStore: WorkspaceLifecycleStore & LaunchEnvelopeBindingStore & TaskPacketBindingStore,
  input: { runId: string; attemptId?: string }
): Promise<AgentWorkStatus> {
  const record = await coordinationStore.getRunCoordination(input.runId);
  const candidate = input.attemptId ? await workspaceStore.getAttempt(input.attemptId) : null;
  const attempt = candidate?.runId === input.runId ? candidate : null;
  const candidateLease = attempt?.workspaceLeaseId
    ? await workspaceStore.getWorkspaceLease(attempt.workspaceLeaseId)
    : null;
  const lease = attempt && candidateLease && bound(attempt, candidateLease) ? candidateLease : null;
  const envelope = attempt
    ? await workspaceStore.getLaunchEnvelopeBinding(attempt.attemptId)
    : null;
  const packet = attempt ? await workspaceStore.getTaskPacketBinding(attempt.attemptId) : null;
  return {
    run: record
      ? boundedRun(record.runId, record.revision, record.state, record.updatedAt, record.lease)
      : null,
    attempt: attempt ? boundedAttempt(attempt) : null,
    workspace: lease ? boundedWorkspace(lease) : null,
    launch: attempt ? boundedLaunch(attempt, lease, record?.lease ?? null, envelope, packet) : null,
  };
}

function boundedLaunch(
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord | null,
  controller: ControllerLease | null,
  envelope: LaunchEnvelopeBindingRecord | null,
  packet: TaskPacketBindingRecord | null
): BoundedLaunchStatus {
  if (envelope && packet && completeLaunchBinding(attempt, envelope, packet)) {
    if (
      attempt.status === "launching" &&
      (!lease ||
        !controller ||
        envelope.attemptRevision !== attempt.revision ||
        envelope.workspaceLeaseRevision !== lease.revision ||
        envelope.controllerId !== controller.controllerId ||
        envelope.controllerLeaseId !== controller.leaseId ||
        envelope.fencingToken !== controller.fencingToken ||
        lease.controllerId !== controller.controllerId ||
        lease.controllerLeaseId !== controller.leaseId ||
        lease.fencingToken !== controller.fencingToken)
    ) {
      return { state: "binding_stale", reconciliationRequired: true };
    }
    return { state: "bound", reconciliationRequired: false };
  }
  if (envelope || packet) return { state: "inconsistent", reconciliationRequired: true };
  if (attempt.status === "launching") {
    return { state: "binding_missing", reconciliationRequired: true };
  }
  if (attempt.status === "launch_failed") {
    return { state: "failed_closed", reconciliationRequired: false };
  }
  if (
    attempt.status === "prepared" ||
    attempt.status === "leased" ||
    attempt.status === "cancelled"
  ) {
    return { state: "not_authorized", reconciliationRequired: false };
  }
  return { state: "inconsistent", reconciliationRequired: true };
}

function completeLaunchBinding(
  attempt: AttemptRecord,
  binding: LaunchEnvelopeBindingRecord,
  packet: TaskPacketBindingRecord
): boolean {
  try {
    const value = JSON.parse(binding.envelopeJson) as unknown;
    const envelope = ExecutionEnvelope_v1.safeParse(value);
    return (
      envelope.success &&
      canonicalJSONStringify(value) === binding.envelopeJson &&
      computeCanonicalHash(value) === binding.envelopeHash &&
      binding.runId === attempt.runId &&
      binding.attemptId === attempt.attemptId &&
      binding.workspaceLeaseId === attempt.workspaceLeaseId &&
      binding.attemptRevision <= attempt.revision &&
      packet.runId === attempt.runId &&
      packet.attemptId === attempt.attemptId &&
      packet.packetId === attempt.packetId &&
      packet.packetHash === attempt.packetHash &&
      envelope.data.envelope_id === binding.envelopeId &&
      envelope.data.run_id === attempt.runId &&
      envelope.data.attempt_id === attempt.attemptId &&
      envelope.data.packet_id === attempt.packetId &&
      envelope.data.packet_hash === attempt.packetHash &&
      envelope.data.workspace_lease_id === attempt.workspaceLeaseId &&
      envelope.data.workspace_lease_revision === binding.workspaceLeaseRevision
    );
  } catch {
    return false;
  }
}

function canonicalRun(run: RunState): JsonValue {
  return JSON.parse(JSON.stringify({ schemaVersion: "1.0.0", run })) as JsonValue;
}

function credential(lease: ControllerLease): ControllerLeaseCredential {
  return {
    runId: lease.runId,
    controllerId: lease.controllerId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}

function sameAttemptIdentity(
  attempt: AttemptRecord,
  input: StartAttemptInput,
  runRevision: number
): boolean {
  const expected = input.attempt;
  return (
    attempt.runId === input.runId &&
    attempt.runRevision === runRevision &&
    attempt.attemptId === expected.attemptId &&
    attempt.workItemId === expected.workItemId &&
    attempt.workItemRevision === expected.workItemRevision &&
    attempt.packetId === expected.packetId &&
    attempt.packetHash === expected.packetHash &&
    attempt.baseSha === expected.baseSha
  );
}

function sameLeaseIdentity(
  lease: WorkspaceLifecycleLeaseRecord,
  attempt: AttemptRecord,
  input: StartAttemptInput
): boolean {
  return (
    bound(attempt, lease) &&
    lease.leaseId === input.workspace.workspaceLeaseId &&
    lease.runRevision === attempt.runRevision &&
    lease.workItemId === input.attempt.workItemId &&
    lease.workItemRevision === input.attempt.workItemRevision &&
    lease.packetId === input.attempt.packetId &&
    lease.packetHash === input.attempt.packetHash &&
    lease.baseSha === input.attempt.baseSha &&
    lease.repositoryId === input.workspace.repositoryId &&
    lease.hostId === input.workspace.hostId &&
    lease.gitRuntime === input.workspace.gitRuntime &&
    lease.projectRoot === input.workspace.projectRoot &&
    lease.branch === input.workspace.branch &&
    lease.worktreePath === input.workspace.worktreePath
  );
}

function bound(attempt: AttemptRecord, lease: WorkspaceLifecycleLeaseRecord): boolean {
  return (
    attempt.workspaceLeaseId === lease.leaseId &&
    attempt.attemptId === lease.attemptId &&
    attempt.runId === lease.runId
  );
}

function controlledBy(
  lease: WorkspaceLifecycleLeaseRecord,
  controller: ControllerLeaseCredential
): boolean {
  return (
    lease.controllerId === controller.controllerId &&
    lease.controllerLeaseId === controller.leaseId &&
    lease.fencingToken === controller.fencingToken
  );
}

function boundedRun(
  runId: string,
  revision: number,
  state: JsonValue,
  updatedAt: string,
  lease: ControllerLease | null
): BoundedRunStatus {
  const envelope = object(state);
  const run = envelope ? object(envelope.run) : null;
  return {
    runId: bounded(runId),
    revision,
    state: typeof run?.state === "string" ? bounded(run.state) : null,
    updatedAt: bounded(typeof run?.updatedAt === "string" ? run.updatedAt : updatedAt),
    controller: lease
      ? {
          controllerId: bounded(lease.controllerId),
          leaseId: bounded(lease.leaseId),
          fencingToken: lease.fencingToken,
          expiresAt: bounded(lease.expiresAt),
        }
      : null,
  };
}

function boundedAttempt(value: AttemptRecord): BoundedAttemptStatus {
  return {
    attemptId: bounded(value.attemptId),
    revision: value.revision,
    status: value.status,
    workItemId: bounded(value.workItemId),
    workItemRevision: value.workItemRevision,
    packetId: bounded(value.packetId),
    packetHash: bounded(value.packetHash),
    baseSha: bounded(value.baseSha),
    workspaceLeaseId: value.workspaceLeaseId ? bounded(value.workspaceLeaseId) : null,
    updatedAt: bounded(value.updatedAt),
    completedAt: value.completedAt ? bounded(value.completedAt) : null,
  };
}

function boundedWorkspace(value: WorkspaceLifecycleLeaseRecord): BoundedWorkspaceStatus {
  const observed = value.lastObservation;
  return {
    leaseId: bounded(value.leaseId),
    revision: value.revision,
    status: value.status,
    repositoryId: bounded(value.repositoryId),
    hostId: bounded(value.hostId),
    gitRuntime: bounded(value.gitRuntime),
    branch: bounded(value.branch),
    worktreePath: bounded(value.worktreePath),
    baseSha: bounded(value.baseSha),
    heartbeatAt: bounded(value.heartbeatAt),
    expiresAt: bounded(value.expiresAt),
    cleanupDisposition: value.cleanupDisposition ?? null,
    observation: observed
      ? {
          exists: observed.exists,
          registered: observed.registered,
          headSha: observed.headSha ? bounded(observed.headSha) : null,
          cleanliness: observed.cleanliness,
          dirtyPathCount: observed.dirtyPaths?.length ?? 0,
          reason: observed.reason ? bounded(observed.reason) : null,
        }
      : null,
  };
}

function object(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_REASON_BYTES) return value;
  let end = MAX_REASON_BYTES - 3;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}

function boundedControllerLease(lease: ControllerLease): ControllerLease {
  return {
    runId: bounded(lease.runId),
    controllerId: bounded(lease.controllerId),
    leaseId: bounded(lease.leaseId),
    fencingToken: lease.fencingToken,
    acquiredAt: bounded(lease.acquiredAt),
    renewedAt: bounded(lease.renewedAt),
    expiresAt: bounded(lease.expiresAt),
  };
}
