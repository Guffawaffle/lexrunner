import {
  AttemptAuthorization_v1,
  AttemptExecutorEvent_v1,
  AttemptExecutorHandle_v1,
  GovernedAttemptResult_v1,
  type AttemptAuthorization_v1 as AttemptAuthorization,
  type AttemptExecutor,
  type AttemptExecutorEvent_v1 as AttemptExecutorEvent,
  type GovernedAttemptResult_v1 as GovernedAttemptResult,
} from "./governed-attempt-executor.js";
import {
  DelegationInvocationRequest_v1,
  createDelegationDecisionReceipt,
  type DelegationInvocationRequest_v1 as DelegationInvocationRequest,
} from "./governed-attempt-protocol.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type { GovernedAttemptEvidenceCapture } from "./governed-attempt-evidence.js";
import {
  ProtectedEvidenceReservationRequest_v1,
  type ProtectedEvidenceReservationRequest_v1 as ProtectedEvidenceReservationRequest,
} from "../store/protected-evidence-store.js";
import {
  GovernedAttemptVerificationContext_v1,
  type GovernedAttemptVerificationContext_v1 as GovernedAttemptVerificationContext,
} from "./governed-attempt-verification.js";

type GovernedOperationStore = GovernedAttemptOperationStore & GovernedDelegationStore;

export interface StartGovernedAttemptOperationInput {
  operationMutationId: string;
  authorizationMutationId: string;
  authorization: AttemptAuthorization;
  invocation: DelegationInvocationRequest;
  prompt: Uint8Array;
  outputSchema: unknown;
  evidence?: GovernedAttemptEvidenceCapture;
  evidenceReservation?: ProtectedEvidenceReservationRequest;
  verificationContext?: GovernedAttemptVerificationContext;
  now: string;
}

export type StartGovernedAttemptOperationResult =
  | {
      started: true;
      operationId: string;
      idempotentReplay: boolean;
    }
  | {
      started: false;
      reason:
        | "delegation_not_found"
        | "delegation_not_accepted"
        | "binding_mismatch"
        | "authorization_denied"
        | "executor_mismatch"
        | "store_rejected";
    };

export type ObserveGovernedAttemptOperationResult =
  | {
      terminal: true;
      operationId: string;
      status: "declined" | "completed" | "failed" | "cancelled" | "lost";
      result?: GovernedAttemptResult;
    }
  | {
      terminal: false;
      operationId: string;
      reason:
        | "not_found"
        | "store_rejected"
        | "acceptance_latch_failed"
        | "work_authorization_failed"
        | "continuation_failed"
        | "decline_latch_failed"
        | "observation_aborted";
    };

/**
 * Event-driven coordinator for one provider operation. Waiting is delegated to
 * the executor's async event stream; no timer or heartbeat polling is required.
 */
export class GovernedAttemptOperationService {
  constructor(
    private readonly store: GovernedOperationStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async start(
    executor: AttemptExecutor,
    input: StartGovernedAttemptOperationInput
  ): Promise<StartGovernedAttemptOperationResult> {
    const authorization = AttemptAuthorization_v1.parse(input.authorization);
    const invocation = DelegationInvocationRequest_v1.parse(input.invocation);
    const delegation = await this.store.getDelegation(authorization.delegation_id);
    if (!delegation) return { started: false, reason: "delegation_not_found" };
    const offerLaunch = invocation.phase === "offer";
    if (
      (offerLaunch && delegation.status !== "offered") ||
      (!offerLaunch && (delegation.status !== "accepted" || !delegation.acceptance_receipt_hash))
    ) {
      return { started: false, reason: "delegation_not_accepted" };
    }
    if (
      delegation.attempt_id !== authorization.attempt_id ||
      invocation.attempt_id !== authorization.attempt_id ||
      invocation.delegation_id !== authorization.delegation_id ||
      invocation.provider_attestation_hash !== authorization.executor_attestation_hash ||
      invocation.environment_attestation_hash !== authorization.environment_attestation_hash ||
      invocation.workspace_attestation_hash !== authorization.workspace_attestation_hash ||
      delegation.state.offer.authority_grant_hash !== computeCanonicalHash(authorization.grant)
    ) {
      return { started: false, reason: "binding_mismatch" };
    }
    if (
      (input.evidence === undefined) !== (input.evidenceReservation === undefined) ||
      (input.evidence === undefined) !== (input.verificationContext === undefined)
    ) {
      return { started: false, reason: "binding_mismatch" };
    }
    let evidenceReservation: ProtectedEvidenceReservationRequest | undefined;
    let verificationContext: GovernedAttemptVerificationContext | undefined;
    if (input.evidence && input.evidenceReservation) {
      evidenceReservation = ProtectedEvidenceReservationRequest_v1.parse(input.evidenceReservation);
      verificationContext = GovernedAttemptVerificationContext_v1.parse(input.verificationContext);
      const reference = input.evidence.getReference();
      if (
        reference.status !== "open" ||
        reference.capture_id !== evidenceReservation.capture_id ||
        evidenceReservation.attempt_id !== authorization.attempt_id ||
        evidenceReservation.delegation_id !== authorization.delegation_id ||
        evidenceReservation.authorization_binding_digest !== authorization.binding_digest ||
        evidenceReservation.executor_binding_digest !== authorization.executor_attestation_hash ||
        evidenceReservation.environment_binding_digest !==
          authorization.environment_attestation_hash ||
        evidenceReservation.workspace_binding_digest !== authorization.workspace_attestation_hash ||
        reference.attempt_id !== authorization.attempt_id ||
        reference.delegation_id !== authorization.delegation_id ||
        reference.authorization_binding_digest !== authorization.binding_digest ||
        reference.executor_binding_digest !== authorization.executor_attestation_hash ||
        reference.environment_binding_digest !== authorization.environment_attestation_hash ||
        reference.workspace_binding_digest !== authorization.workspace_attestation_hash ||
        computeCanonicalHash(verificationContext.requirements) !==
          authorization.requirements_hash ||
        computeCanonicalHash(verificationContext.executor) !==
          authorization.executor_attestation_hash ||
        computeCanonicalHash(verificationContext.environment) !==
          authorization.environment_attestation_hash ||
        computeCanonicalHash(verificationContext.workspace) !==
          authorization.workspace_attestation_hash
      ) {
        return { started: false, reason: "binding_mismatch" };
      }
    }
    const permit = await this.store.authorizeDelegationInvocation({
      mutationId: input.authorizationMutationId,
      delegationId: authorization.delegation_id,
      expectedRevision: delegation.revision,
      request: invocation,
      now: input.now,
    });
    if (!permit.authorized) return { started: false, reason: "authorization_denied" };

    const handle = AttemptExecutorHandle_v1.parse(
      await executor.start({
        authorization,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        ...(input.evidence ? { evidence: input.evidence } : {}),
      })
    );
    if (
      handle.attempt_id !== authorization.attempt_id ||
      handle.delegation_id !== authorization.delegation_id ||
      handle.authorization_binding_digest !== authorization.binding_digest
    ) {
      await executor.cancel(handle).catch(() => undefined);
      return { started: false, reason: "executor_mismatch" };
    }
    const created = await this.store.createAttemptOperation({
      mutationId: input.operationMutationId,
      handle,
      authorization,
      ...(evidenceReservation
        ? {
            evidenceReservation,
            evidenceDeclaration: input.evidence!.getReference(),
            verificationContext: verificationContext!,
          }
        : {}),
      now: input.now,
    });
    if (!created.created) {
      await executor.cancel(handle).catch(() => undefined);
      return { started: false, reason: "store_rejected" };
    }
    return {
      started: true,
      operationId: handle.operation_id,
      idempotentReplay: created.idempotentReplay,
    };
  }

  async observeToTerminal(
    executor: AttemptExecutor,
    operationId: string,
    signal?: AbortSignal
  ): Promise<ObserveGovernedAttemptOperationResult> {
    let record = await this.store.getAttemptOperation(operationId);
    if (!record) return { terminal: false, operationId, reason: "not_found" };
    if (record.status !== "running") return this.terminalResult(record);

    const acceptedEvent = (await this.store.listAttemptOperationEvents(operationId))
      .map((entry) => entry.event)
      .find((event) => event.type === "accepted");
    if (acceptedEvent) {
      const continued = await this.continueAcceptedWork(executor, record, acceptedEvent);
      if (!continued) return this.cancel(executor, operationId);
    }

    for await (const candidate of executor.observe(record.handle, {
      afterSequence: record.last_event_sequence,
      ...(signal ? { signal } : {}),
    })) {
      const event = AttemptExecutorEvent_v1.parse(candidate);
      if (event.type === "accepted") {
        const latched = await this.latchAcceptance(record, event);
        if (!latched) {
          return this.cancel(executor, operationId);
        }
      }
      if (event.type === "declined") {
        const latched = await this.latchDecline(record, event);
        if (!latched) {
          return { terminal: false, operationId, reason: "decline_latch_failed" };
        }
      }
      const appended = await this.store.appendAttemptOperationEvent({
        mutationId: `${operationId}:event:${event.sequence}`,
        operationId,
        expectedRevision: record.revision,
        event,
        now: event.observed_at,
      });
      if (!appended.appended) {
        const current = await this.store.getAttemptOperation(operationId);
        if (current && current.status !== "running") return this.terminalResult(current);
        return { terminal: false, operationId, reason: "store_rejected" };
      }
      record = appended.record;
      if (event.type === "accepted") {
        const continued = await this.continueAcceptedWork(executor, record, event);
        if (!continued) return this.cancel(executor, operationId);
      }
      if (event.type === "declined") {
        await executor.cancel(record.handle).catch(() => undefined);
        await executor.release(record.handle).catch(() => undefined);
        return this.terminalResult(record);
      }
      if (["completed", "failed", "cancelled", "lost"].includes(event.type)) {
        if (event.type === "completed") {
          const result = GovernedAttemptResult_v1.parse(await executor.collect(record.handle));
          const persisted = await this.store.recordAttemptOperationResult({
            mutationId: `${operationId}:result`,
            operationId,
            expectedRevision: record.revision,
            result,
            now: this.now(),
          });
          if (!persisted.recorded) {
            return { terminal: false, operationId, reason: "store_rejected" };
          }
          record = persisted.record;
        }
        await executor.release(record.handle).catch(() => undefined);
        return this.terminalResult(record);
      }
    }

    if (signal?.aborted) {
      return { terminal: false, operationId, reason: "observation_aborted" };
    }
    const lost = AttemptExecutorEvent_v1.parse({
      schema_version: "1.0.0",
      type: "lost",
      sequence: record.last_event_sequence + 1,
      observed_at: this.now(),
      evidence_ref: computeCanonicalHash({
        kind: "executor_stream_ended_without_terminal_event",
        operation_id: operationId,
        after_sequence: record.last_event_sequence,
      }),
    });
    const appended = await this.store.appendAttemptOperationEvent({
      mutationId: `${operationId}:event:${lost.sequence}`,
      operationId,
      expectedRevision: record.revision,
      event: lost,
      now: lost.observed_at,
    });
    if (!appended.appended) {
      return { terminal: false, operationId, reason: "store_rejected" };
    }
    await executor.cancel(appended.record.handle).catch(() => undefined);
    await executor.release(appended.record.handle).catch(() => undefined);
    return this.terminalResult(appended.record);
  }

  async cancel(
    executor: AttemptExecutor,
    operationId: string
  ): Promise<ObserveGovernedAttemptOperationResult> {
    const record = await this.store.getAttemptOperation(operationId);
    if (!record) return { terminal: false, operationId, reason: "not_found" };
    if (record.status !== "running") return this.terminalResult(record);
    const event = AttemptExecutorEvent_v1.parse({
      schema_version: "1.0.0",
      type: "cancelled",
      sequence: record.last_event_sequence + 1,
      observed_at: this.now(),
      evidence_ref: computeCanonicalHash({
        kind: "operator_cancellation",
        operation_id: operationId,
      }),
    });
    const appended = await this.store.appendAttemptOperationEvent({
      mutationId: `${operationId}:event:${event.sequence}`,
      operationId,
      expectedRevision: record.revision,
      event,
      now: event.observed_at,
    });
    if (!appended.appended) return { terminal: false, operationId, reason: "store_rejected" };
    await executor.cancel(record.handle).catch(() => undefined);
    await executor.release(record.handle).catch(() => undefined);
    return this.terminalResult(appended.record);
  }

  async collectCompleted(
    executor: AttemptExecutor,
    operationId: string
  ): Promise<ObserveGovernedAttemptOperationResult> {
    let record = await this.store.getAttemptOperation(operationId);
    if (!record) return { terminal: false, operationId, reason: "not_found" };
    if (record.status !== "completed" || record.result) return this.terminalResult(record);
    const result = GovernedAttemptResult_v1.parse(await executor.collect(record.handle));
    const persisted = await this.store.recordAttemptOperationResult({
      mutationId: `${operationId}:result`,
      operationId,
      expectedRevision: record.revision,
      result,
      now: this.now(),
    });
    if (!persisted.recorded) {
      return { terminal: false, operationId, reason: "store_rejected" };
    }
    record = persisted.record;
    await executor.release(record.handle).catch(() => undefined);
    return this.terminalResult(record);
  }

  private async latchDecline(
    record: Awaited<ReturnType<GovernedAttemptOperationStore["getAttemptOperation"]>> & {},
    event: AttemptExecutorEvent
  ): Promise<boolean> {
    const delegation = await this.store.getDelegation(record.delegation_id);
    if (!delegation) return false;
    if (delegation.status === "declined") return true;
    if (delegation.status !== "accepted") return false;
    const receipt = createDelegationDecisionReceipt({
      offer: delegation.state.offer,
      decision: "NO",
      decisionReceiptId: `${record.operation_id}:decline:${event.sequence}`,
      decidedAt: event.observed_at,
    });
    const decided = await this.store.recordDelegationDecision({
      mutationId: `${record.operation_id}:decline:${event.sequence}`,
      delegationId: record.delegation_id,
      expectedRevision: delegation.revision,
      receipt,
      now: event.observed_at,
    });
    return decided.recorded || decided.reason === "delegation_declined";
  }

  private async latchAcceptance(
    record: Awaited<ReturnType<GovernedAttemptOperationStore["getAttemptOperation"]>> & {},
    event: AttemptExecutorEvent
  ): Promise<boolean> {
    const delegation = await this.store.getDelegation(record.delegation_id);
    if (!delegation) return false;
    if (delegation.status === "accepted") return true;
    if (delegation.status !== "offered") return false;
    const receipt = createDelegationDecisionReceipt({
      offer: delegation.state.offer,
      decision: "ACCEPT",
      decisionReceiptId: `${record.operation_id}:accept:${event.sequence}`,
      decidedAt: event.observed_at,
    });
    const decided = await this.store.recordDelegationDecision({
      mutationId: `${record.operation_id}:accept:${event.sequence}`,
      delegationId: record.delegation_id,
      expectedRevision: delegation.revision,
      receipt,
      now: event.observed_at,
    });
    if (decided.recorded) return true;
    return (await this.store.getDelegation(record.delegation_id))?.status === "accepted";
  }

  private async authorizeAcceptedWork(
    record: Awaited<ReturnType<GovernedAttemptOperationStore["getAttemptOperation"]>> & {},
    event: AttemptExecutorEvent
  ): Promise<boolean> {
    const delegation = await this.store.getDelegation(record.delegation_id);
    if (!delegation || delegation.status !== "accepted") return false;
    const offer = delegation.state.offer;
    const request = DelegationInvocationRequest_v1.parse({
      schema_version: "1.0.0",
      delegation_id: record.delegation_id,
      attempt_id: record.attempt_id,
      offer_hash: delegation.offer_hash,
      authority_grant_hash: offer.authority_grant_hash,
      worker_thread_id: offer.worker.thread_id,
      transcript_start_hash: offer.transcript_start_hash,
      provider_attestation_hash: record.authorization.executor_attestation_hash,
      environment_attestation_hash: record.authorization.environment_attestation_hash,
      workspace_attestation_hash: record.authorization.workspace_attestation_hash,
      phase: "authorized_work",
    });
    const authorized = await this.store.authorizeDelegationInvocation({
      mutationId: `${record.operation_id}:authorize-work:${event.sequence}`,
      delegationId: record.delegation_id,
      expectedRevision: delegation.revision,
      request,
      now: event.observed_at,
    });
    return authorized.authorized;
  }

  private async continueAcceptedWork(
    executor: AttemptExecutor,
    record: Awaited<ReturnType<GovernedAttemptOperationStore["getAttemptOperation"]>> & {},
    event: AttemptExecutorEvent
  ): Promise<boolean> {
    if (event.type !== "accepted") return false;
    if (!(await this.latchAcceptance(record, event))) return false;
    if (!(await this.authorizeAcceptedWork(record, event))) return false;
    if (!executor.continueAfterAcceptance) return false;
    try {
      await executor.continueAfterAcceptance(record.handle);
      return true;
    } catch {
      return false;
    }
  }

  private terminalResult(
    record: NonNullable<Awaited<ReturnType<GovernedAttemptOperationStore["getAttemptOperation"]>>>
  ): ObserveGovernedAttemptOperationResult {
    if (record.status === "running") {
      return { terminal: false, operationId: record.operation_id, reason: "store_rejected" };
    }
    return {
      terminal: true,
      operationId: record.operation_id,
      status: record.status,
      ...(record.result ? { result: record.result } : {}),
    };
  }
}
