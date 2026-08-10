import {
  authorizeDelegationInvocationBinding,
  recordDelegationDecision,
} from "../../runs/governed-attempt-protocol.js";
import { computeCanonicalHash } from "../../schemas/task-contract.js";
import {
  GOVERNED_DELEGATION_STORE_VERSION,
  GovernedDelegationEvent_v1,
  GovernedDelegationRecord_v1,
  redactDelegationReason,
  type AuthorizeGovernedDelegationInvocationInput,
  type AuthorizeGovernedDelegationInvocationResult,
  type CreateGovernedDelegationInput,
  type CreateGovernedDelegationResult,
  type GovernedDelegationEvent_v1 as GovernedDelegationEvent,
  type GovernedDelegationRecord_v1 as GovernedDelegationRecord,
  type GovernedDelegationStore,
  type RecordGovernedDelegationDecisionInput,
  type RecordGovernedDelegationDecisionResult,
} from "../governed-delegation-store.js";
import { InMemoryWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";

/** Coordination test backend with the same reason-redaction and terminal-latch semantics as SQLite. */
export class InMemoryGovernedDelegationStore
  extends InMemoryWorkspaceLifecycleStore
  implements GovernedDelegationStore
{
  private readonly delegations = new Map<string, GovernedDelegationRecord>();
  private readonly delegationEvents = new Map<string, GovernedDelegationEvent[]>();

  async createDelegation(
    input: CreateGovernedDelegationInput
  ): Promise<CreateGovernedDelegationResult> {
    const now = normalizeInstant(input.now);
    const offer = structuredClone(input.offer);
    const fingerprint = computeCanonicalHash({ kind: "offer", offer });
    const replay = this.findMutation(offer.delegation_id, input.mutationId);
    if (replay) {
      if (replay.mutation_fingerprint !== fingerprint || replay.type !== "delegation_offered") {
        return { created: false, reason: "mutation_conflict" };
      }
      const record = this.requireRecord(offer.delegation_id);
      return {
        created: true,
        record: cloneRecord(record),
        event: cloneEvent(replay),
        idempotentReplay: true,
      };
    }

    const existing = this.delegations.get(offer.delegation_id);
    if (existing) {
      if (existing.offer_hash !== computeCanonicalHash(offer)) {
        return { created: false, reason: "delegation_conflict" };
      }
      const event = this.delegationEventsFor(offer.delegation_id)[0];
      if (!event) throw new Error("Governed Delegation is missing its offer event");
      return {
        created: true,
        record: cloneRecord(existing),
        event: cloneEvent(event),
        idempotentReplay: true,
      };
    }

    const state = {
      schema_version: "1.0.0" as const,
      offer,
      offer_hash: computeCanonicalHash(offer),
      status: "offered" as const,
    };
    const record = GovernedDelegationRecord_v1.parse({
      schema_version: GOVERNED_DELEGATION_STORE_VERSION,
      delegation_id: offer.delegation_id,
      attempt_id: offer.attempt_id,
      revision: 0,
      status: "offered",
      state,
      offer_hash: state.offer_hash,
      created_at: now,
      updated_at: now,
    });
    const event = this.appendEvent({
      schema_version: GOVERNED_DELEGATION_STORE_VERSION,
      delegation_id: offer.delegation_id,
      attempt_id: offer.attempt_id,
      sequence: 1,
      delegation_revision: 0,
      mutation_id: input.mutationId,
      mutation_fingerprint: fingerprint,
      type: "delegation_offered",
      created_at: now,
    });
    this.delegations.set(record.delegation_id, record);
    return {
      created: true,
      record: cloneRecord(record),
      event: cloneEvent(event),
      idempotentReplay: false,
    };
  }

  async recordDelegationDecision(
    input: RecordGovernedDelegationDecisionInput
  ): Promise<RecordGovernedDelegationDecisionResult> {
    const now = normalizeInstant(input.now);
    const receipt = structuredClone(input.receipt);
    const receiptHash = computeCanonicalHash(receipt);
    const fingerprint = computeCanonicalHash({
      kind: "decision",
      delegation_id: input.delegationId,
      expected_revision: input.expectedRevision,
      receipt_hash: receiptHash,
    });
    const replay = this.findMutation(input.delegationId, input.mutationId);
    if (replay) {
      if (
        replay.mutation_fingerprint !== fingerprint ||
        !["delegation_accepted", "delegation_declined"].includes(replay.type)
      ) {
        return { recorded: false, reason: "mutation_conflict" };
      }
      return {
        recorded: true,
        record: cloneRecord(this.requireRecord(input.delegationId)),
        event: cloneEvent(replay),
        decisionReceiptHash: replay.decision_receipt_hash!,
        idempotentReplay: true,
      };
    }

    const current = this.delegations.get(input.delegationId);
    if (!current) return { recorded: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { recorded: false, reason: "stale_revision" };
    }
    const decision = recordDelegationDecision(current.state, receipt);
    if (!decision.recorded) return { recorded: false, reason: decision.reason };

    const state = redactDelegationReason(decision.state);
    const record = GovernedDelegationRecord_v1.parse({
      ...current,
      revision: current.revision + 1,
      status: state.status,
      state,
      ...(receipt.decision === "accept"
        ? { acceptance_receipt_hash: receiptHash }
        : {
            decline_receipt_hash: receiptHash,
            decline_reason_present: receipt.reason !== undefined,
          }),
      updated_at: now,
    });
    const event = this.appendEvent({
      schema_version: GOVERNED_DELEGATION_STORE_VERSION,
      delegation_id: record.delegation_id,
      attempt_id: record.attempt_id,
      sequence: this.nextSequence(record.delegation_id),
      delegation_revision: record.revision,
      mutation_id: input.mutationId,
      mutation_fingerprint: fingerprint,
      type: receipt.decision === "accept" ? "delegation_accepted" : "delegation_declined",
      decision_receipt_hash: receiptHash,
      ...(receipt.decision === "decline"
        ? { decline_reason_present: receipt.reason !== undefined }
        : {}),
      created_at: now,
    });
    this.delegations.set(record.delegation_id, record);
    return {
      recorded: true,
      record: cloneRecord(record),
      event: cloneEvent(event),
      decisionReceiptHash: receiptHash,
      idempotentReplay: false,
    };
  }

  async authorizeDelegationInvocation(
    input: AuthorizeGovernedDelegationInvocationInput
  ): Promise<AuthorizeGovernedDelegationInvocationResult> {
    const now = normalizeInstant(input.now);
    const request = structuredClone(input.request);
    const fingerprint = computeCanonicalHash({
      kind: "authorize",
      delegation_id: input.delegationId,
      expected_revision: input.expectedRevision,
      request,
      ...(input.repositoryLifecycleGuard
        ? { repository_lifecycle_guard: input.repositoryLifecycleGuard }
        : {}),
    });
    const replay = this.findMutation(input.delegationId, input.mutationId);
    if (replay) {
      if (
        replay.mutation_fingerprint !== fingerprint ||
        !["delegation_invocation_authorized", "delegation_invocation_denied"].includes(replay.type)
      ) {
        return { authorized: false, reason: "mutation_conflict" };
      }
      const current = this.requireRecord(input.delegationId);
      if (current.status === "declined") {
        return { authorized: false, reason: "delegation_declined", record: cloneRecord(current) };
      }
      if (replay.type === "delegation_invocation_denied") {
        return {
          authorized: false,
          reason: replay.denial_reason!,
          record: cloneRecord(current),
          event: cloneEvent(replay),
          idempotentReplay: true,
        };
      }
      return {
        authorized: true,
        record: cloneRecord(current),
        event: cloneEvent(replay),
        authorizationBindingHash: replay.authorization_binding_hash!,
        idempotentReplay: true,
      };
    }

    const current = this.delegations.get(input.delegationId);
    if (!current) return { authorized: false, reason: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { authorized: false, reason: "stale_revision" };
    }
    const lifecycleAuthorized =
      !input.repositoryLifecycleGuard ||
      (await this.repositoryLifecycleMatches(
        current.attempt_id,
        input.repositoryLifecycleGuard,
        now
      ));
    const authorization = lifecycleAuthorized
      ? authorizeDelegationInvocationBinding(
          {
            status: current.status,
            offer: current.state.offer,
            offerHash: current.offer_hash,
            ...(current.acceptance_receipt_hash
              ? { acceptanceReceiptHash: current.acceptance_receipt_hash }
              : {}),
          },
          request
        )
      : ({ authorized: false, reason: "binding_mismatch" } as const);
    const event = this.appendEvent({
      schema_version: GOVERNED_DELEGATION_STORE_VERSION,
      delegation_id: current.delegation_id,
      attempt_id: current.attempt_id,
      sequence: this.nextSequence(current.delegation_id),
      delegation_revision: current.revision,
      mutation_id: input.mutationId,
      mutation_fingerprint: fingerprint,
      type: authorization.authorized
        ? "delegation_invocation_authorized"
        : "delegation_invocation_denied",
      ...(authorization.authorized
        ? { authorization_binding_hash: authorization.authorizationBindingHash }
        : { denial_reason: authorization.reason }),
      created_at: now,
    });
    if (!authorization.authorized) {
      return {
        authorized: false,
        reason: authorization.reason,
        record: cloneRecord(current),
        event: cloneEvent(event),
        idempotentReplay: false,
      };
    }
    return {
      authorized: true,
      record: cloneRecord(current),
      event: cloneEvent(event),
      authorizationBindingHash: authorization.authorizationBindingHash,
      idempotentReplay: false,
    };
  }

  async getDelegation(delegationId: string): Promise<GovernedDelegationRecord | null> {
    const record = this.delegations.get(delegationId);
    return record ? cloneRecord(record) : null;
  }

  async listDelegationEvents(delegationId: string): Promise<GovernedDelegationEvent[]> {
    return this.delegationEventsFor(delegationId).map(cloneEvent);
  }

  private async repositoryLifecycleMatches(
    attemptId: string,
    binding: AuthorizeGovernedDelegationInvocationInput["repositoryLifecycleGuard"] & {},
    now: string
  ): Promise<boolean> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt?.workspaceLeaseId) return false;
    const [lease, envelope, packet] = await Promise.all([
      this.getWorkspaceLease(attempt.workspaceLeaseId),
      this.getLaunchEnvelopeBinding(attemptId),
      this.getTaskPacketBinding(attemptId),
    ]);
    return Boolean(
      lease &&
      envelope &&
      packet &&
      attempt.status === "running" &&
      attempt.workspaceLeaseId === binding.workspace_lease_id &&
      attempt.packetHash === binding.task_packet_hash &&
      lease.status === "active" &&
      lease.revision >= binding.workspace_lease_revision &&
      lease.packetHash === binding.task_packet_hash &&
      Date.parse(lease.expiresAt) > Date.parse(now) &&
      envelope.workspaceLeaseId === binding.workspace_lease_id &&
      envelope.workspaceLeaseRevision === binding.workspace_lease_revision &&
      envelope.envelopeHash === binding.launch_envelope_hash &&
      packet.packetHash === binding.task_packet_hash
    );
  }

  private appendEvent(candidate: GovernedDelegationEvent): GovernedDelegationEvent {
    const event = GovernedDelegationEvent_v1.parse(candidate);
    const events = this.delegationEventsFor(event.delegation_id);
    if (events.some((entry) => entry.mutation_id === event.mutation_id)) {
      throw new Error("Duplicate governed Delegation mutation event");
    }
    events.push(event);
    this.delegationEvents.set(event.delegation_id, events);
    return event;
  }

  private findMutation(
    delegationId: string,
    mutationId: string
  ): GovernedDelegationEvent | undefined {
    return this.delegationEventsFor(delegationId).find((event) => event.mutation_id === mutationId);
  }

  private delegationEventsFor(delegationId: string): GovernedDelegationEvent[] {
    return this.delegationEvents.get(delegationId) ?? [];
  }

  private nextSequence(delegationId: string): number {
    return this.delegationEventsFor(delegationId).length + 1;
  }

  private requireRecord(delegationId: string): GovernedDelegationRecord {
    const record = this.delegations.get(delegationId);
    if (!record) throw new Error("Governed Delegation event is missing its record");
    return record;
  }
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid governed Delegation timestamp");
  return new Date(timestamp).toISOString();
}

function cloneRecord(record: GovernedDelegationRecord): GovernedDelegationRecord {
  return GovernedDelegationRecord_v1.parse(structuredClone(record));
}

function cloneEvent(event: GovernedDelegationEvent): GovernedDelegationEvent {
  return GovernedDelegationEvent_v1.parse(structuredClone(event));
}
