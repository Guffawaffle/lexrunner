import { computeCanonicalHash } from "../../schemas/task-contract.js";
import {
  GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
  GovernedAttemptOperationEvent_v1,
  GovernedAttemptOperationRecord_v1,
  operationStatusForEvent,
  type AppendGovernedAttemptOperationEventInput,
  type AppendGovernedAttemptOperationEventResult,
  type CreateGovernedAttemptOperationInput,
  type CreateGovernedAttemptOperationResult,
  type GovernedAttemptOperationEvent_v1 as GovernedAttemptOperationEvent,
  type GovernedAttemptOperationRecord_v1 as GovernedAttemptOperationRecord,
  type GovernedAttemptOperationStore,
  type RecordGovernedAttemptOperationResultInput,
  type RecordGovernedAttemptOperationResultResult,
  type RecordGovernedAttemptOperationVerificationInput,
  type RecordGovernedAttemptOperationVerificationResult,
} from "../governed-attempt-operation-store.js";
import { InMemoryGovernedDelegationStore } from "./governed-delegation-store.js";

export class InMemoryGovernedAttemptOperationStore
  extends InMemoryGovernedDelegationStore
  implements GovernedAttemptOperationStore
{
  private readonly operations = new Map<string, GovernedAttemptOperationRecord>();
  private readonly operationEvents = new Map<string, GovernedAttemptOperationEvent[]>();
  private readonly createMutations = new Map<
    string,
    { fingerprint: string; operationId: string }
  >();
  private readonly resultMutations = new Map<
    string,
    { fingerprint: string; operationId: string }
  >();
  private readonly operationVerificationMutations = new Map<
    string,
    { fingerprint: string; operationId: string }
  >();

  async createAttemptOperation(
    input: CreateGovernedAttemptOperationInput
  ): Promise<CreateGovernedAttemptOperationResult> {
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_create",
      handle: input.handle,
      authorization: input.authorization,
      ...(input.evidenceReservation ? { evidence_reservation: input.evidenceReservation } : {}),
      ...(input.evidenceDeclaration ? { evidence_declaration: input.evidenceDeclaration } : {}),
      ...(input.verificationContext ? { verification_context: input.verificationContext } : {}),
    });
    const replay = this.createMutations.get(input.mutationId);
    if (replay) {
      if (replay.operationId !== input.handle.operation_id || replay.fingerprint !== fingerprint) {
        return { created: false, reason: "mutation_conflict" };
      }
      const replayRecord = this.operations.get(input.handle.operation_id);
      if (!replayRecord) return { created: false, reason: "operation_conflict" };
      return { created: true, record: clone(replayRecord), idempotentReplay: true };
    }
    const existing = this.operations.get(input.handle.operation_id);
    if (existing) {
      if (
        computeCanonicalHash({
          kind: "operation_create",
          handle: existing.handle,
          authorization: existing.authorization,
          ...(existing.evidence_reservation
            ? { evidence_reservation: existing.evidence_reservation }
            : {}),
          ...(existing.evidence_declaration
            ? { evidence_declaration: existing.evidence_declaration }
            : {}),
          ...(existing.verification_context
            ? { verification_context: existing.verification_context }
            : {}),
        }) !== fingerprint
      ) {
        return { created: false, reason: "operation_conflict" };
      }
      return { created: true, record: clone(existing), idempotentReplay: true };
    }
    if (
      this.findEventMutation(input.mutationId) ||
      this.resultMutations.has(input.mutationId) ||
      this.operationVerificationMutations.has(input.mutationId)
    ) {
      return { created: false, reason: "mutation_conflict" };
    }
    const record = GovernedAttemptOperationRecord_v1.parse({
      schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
      operation_id: input.handle.operation_id,
      attempt_id: input.handle.attempt_id,
      delegation_id: input.handle.delegation_id,
      revision: 0,
      status: "running",
      handle: input.handle,
      authorization: input.authorization,
      ...(input.evidenceReservation ? { evidence_reservation: input.evidenceReservation } : {}),
      ...(input.evidenceDeclaration ? { evidence_declaration: input.evidenceDeclaration } : {}),
      ...(input.verificationContext ? { verification_context: input.verificationContext } : {}),
      last_event_sequence: 0,
      created_at: now,
      updated_at: now,
    });
    this.operations.set(record.operation_id, record);
    this.createMutations.set(input.mutationId, {
      fingerprint,
      operationId: record.operation_id,
    });
    return { created: true, record: clone(record), idempotentReplay: false };
  }

  async appendAttemptOperationEvent(
    input: AppendGovernedAttemptOperationEventInput
  ): Promise<AppendGovernedAttemptOperationEventResult> {
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_event",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      event: input.event,
    });
    const replay = this.findEventMutation(input.mutationId);
    if (replay) {
      if (
        replay.operation_id !== input.operationId ||
        replay.mutation_fingerprint !== fingerprint
      ) {
        return { appended: false, reason: "mutation_conflict" };
      }
      const replayRecord = this.operations.get(input.operationId);
      if (!replayRecord) return { appended: false, reason: "not_found" };
      return {
        appended: true,
        record: clone(replayRecord),
        event: clone(replay),
        idempotentReplay: true,
      };
    }
    const current = this.operations.get(input.operationId);
    if (!current) return { appended: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { appended: false, reason: "stale_revision" };
    }
    if (current.status !== "running") return { appended: false, reason: "terminal_latched" };
    if (input.event.sequence !== current.last_event_sequence + 1) {
      return { appended: false, reason: "sequence_mismatch" };
    }
    const status = operationStatusForEvent(input.event);
    const revision = current.revision + 1;
    const record = GovernedAttemptOperationRecord_v1.parse({
      ...current,
      revision,
      status,
      last_event_sequence: input.event.sequence,
      updated_at: now,
      ...(status === "running" ? {} : { terminal_at: now }),
    });
    const event = GovernedAttemptOperationEvent_v1.parse({
      schema_version: GOVERNED_ATTEMPT_OPERATION_STORE_VERSION,
      operation_id: record.operation_id,
      attempt_id: record.attempt_id,
      delegation_id: record.delegation_id,
      operation_revision: revision,
      mutation_id: input.mutationId,
      mutation_fingerprint: fingerprint,
      event: input.event,
      created_at: now,
    });
    this.operations.set(record.operation_id, record);
    const events = this.operationEvents.get(record.operation_id) ?? [];
    events.push(event);
    this.operationEvents.set(record.operation_id, events);
    return { appended: true, record: clone(record), event: clone(event), idempotentReplay: false };
  }

  async recordAttemptOperationResult(
    input: RecordGovernedAttemptOperationResultInput
  ): Promise<RecordGovernedAttemptOperationResultResult> {
    const now = normalizeInstant(input.now);
    const resultHash = computeCanonicalHash(input.result);
    const fingerprint = computeCanonicalHash({
      kind: "operation_result",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      result_hash: resultHash,
    });
    const replay = this.resultMutations.get(input.mutationId);
    if (replay) {
      if (replay.operationId !== input.operationId || replay.fingerprint !== fingerprint) {
        return { recorded: false, reason: "mutation_conflict" };
      }
      const replayRecord = this.operations.get(input.operationId);
      if (!replayRecord) return { recorded: false, reason: "not_found" };
      return { recorded: true, record: clone(replayRecord), idempotentReplay: true };
    }
    const current = this.operations.get(input.operationId);
    if (!current) return { recorded: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { recorded: false, reason: "stale_revision" };
    }
    if (current.status === "running") return { recorded: false, reason: "result_conflict" };
    if (
      input.result.attempt_id !== current.attempt_id ||
      input.result.delegation_id !== current.delegation_id ||
      input.result.authorization_binding_digest !== current.handle.authorization_binding_digest
    ) {
      return { recorded: false, reason: "binding_mismatch" };
    }
    if (current.result_hash && current.result_hash !== resultHash) {
      return { recorded: false, reason: "result_conflict" };
    }
    const record = GovernedAttemptOperationRecord_v1.parse({
      ...current,
      revision: current.revision + 1,
      result: input.result,
      result_hash: resultHash,
      updated_at: now,
    });
    this.operations.set(record.operation_id, record);
    this.resultMutations.set(input.mutationId, { fingerprint, operationId: input.operationId });
    return { recorded: true, record: clone(record), idempotentReplay: false };
  }

  async recordAttemptOperationVerification(
    input: RecordGovernedAttemptOperationVerificationInput
  ): Promise<RecordGovernedAttemptOperationVerificationResult> {
    const now = normalizeInstant(input.now);
    const fingerprint = computeCanonicalHash({
      kind: "operation_verification",
      operation_id: input.operationId,
      expected_revision: input.expectedRevision,
      receipt_hash: input.verification.receipt_hash,
    });
    const replay = this.operationVerificationMutations.get(input.mutationId);
    if (replay) {
      if (replay.operationId !== input.operationId || replay.fingerprint !== fingerprint) {
        return { recorded: false, reason: "mutation_conflict" };
      }
      const replayRecord = this.operations.get(input.operationId);
      if (!replayRecord) return { recorded: false, reason: "not_found" };
      return { recorded: true, record: clone(replayRecord), idempotentReplay: true };
    }
    const current = this.operations.get(input.operationId);
    if (!current) return { recorded: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { recorded: false, reason: "stale_revision" };
    }
    if (!current.result || !current.result_hash) {
      return { recorded: false, reason: "verification_conflict" };
    }
    if (
      input.verification.operation_id !== current.operation_id ||
      input.verification.operation_result_hash !== current.result_hash ||
      input.verification.authorization_binding_digest !== current.authorization.binding_digest ||
      input.verification.verification_context_hash !== current.verification_context?.context_hash ||
      input.verification.capture_id !== current.evidence_declaration?.capture_id
    ) {
      return { recorded: false, reason: "binding_mismatch" };
    }
    if (
      current.verification &&
      current.verification.receipt_hash !== input.verification.receipt_hash
    ) {
      return { recorded: false, reason: "verification_conflict" };
    }
    const record = GovernedAttemptOperationRecord_v1.parse({
      ...current,
      revision: current.revision + 1,
      verification: input.verification,
      updated_at: now,
    });
    this.operations.set(record.operation_id, record);
    this.operationVerificationMutations.set(input.mutationId, {
      fingerprint,
      operationId: input.operationId,
    });
    return { recorded: true, record: clone(record), idempotentReplay: false };
  }

  async getAttemptOperation(operationId: string): Promise<GovernedAttemptOperationRecord | null> {
    const record = this.operations.get(operationId);
    return record ? clone(record) : null;
  }

  async listRecoverableAttemptOperations(): Promise<GovernedAttemptOperationRecord[]> {
    return [...this.operations.values()]
      .filter(
        (record) =>
          record.status === "running" ||
          (record.status === "completed" &&
            (!record.result || (Boolean(record.verification_context) && !record.verification)))
      )
      .sort((left, right) =>
        left.created_at === right.created_at
          ? left.operation_id.localeCompare(right.operation_id)
          : left.created_at.localeCompare(right.created_at)
      )
      .map(clone);
  }

  async listAttemptOperationEvents(operationId: string): Promise<GovernedAttemptOperationEvent[]> {
    return (this.operationEvents.get(operationId) ?? []).map(clone);
  }

  private findEventMutation(mutationId: string): GovernedAttemptOperationEvent | undefined {
    for (const events of this.operationEvents.values()) {
      const event = events.find((candidate) => candidate.mutation_id === mutationId);
      if (event) return event;
    }
    return undefined;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid governed operation timestamp");
  return new Date(timestamp).toISOString();
}
