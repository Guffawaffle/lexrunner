import { z } from "zod";

import {
  DelegationDecisionReceipt_v1,
  DelegationInvocationRequest_v1,
  DelegationOffer_v1,
  DelegationProtocolState_v1,
  DelegationProtocolStatus,
  computeDelegationOfferHash,
  type DelegationDecisionReceipt_v1 as DelegationDecisionReceipt,
  type DelegationInvocationRequest_v1 as DelegationInvocationRequest,
  type DelegationOffer_v1 as DelegationOffer,
  type DelegationProtocolState_v1 as DelegationProtocolState,
} from "../runs/governed-attempt-protocol.js";
import type { GovernedRepositoryCorpusVerificationBinding_v1 } from "../runs/governed-attempt-verification.js";
import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";

export const GOVERNED_DELEGATION_STORE_VERSION = "1.0.0" as const;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });

/** Coordination-safe state: decision reasons are deliberately absent. */
export const GovernedDelegationRecord_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_DELEGATION_STORE_VERSION),
    delegation_id: opaqueId,
    attempt_id: opaqueId,
    revision: z.number().int().nonnegative(),
    status: DelegationProtocolStatus,
    state: DelegationProtocolState_v1,
    offer_hash: SHA256Hash,
    acceptance_receipt_hash: SHA256Hash.optional(),
    decline_receipt_hash: SHA256Hash.optional(),
    decline_reason_present: z.boolean().optional(),
    created_at: instant,
    updated_at: instant,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.delegation_id !== record.state.offer.delegation_id ||
      record.attempt_id !== record.state.offer.attempt_id ||
      record.status !== record.state.status ||
      record.offer_hash !== record.state.offer_hash ||
      record.offer_hash !== computeDelegationOfferHash(record.state.offer)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "coordination state is not bound to the exact Delegation offer",
      });
    }
    if (
      (record.state.acceptance !== undefined) !==
      (record.acceptance_receipt_hash !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptance_receipt_hash"],
        message: "acceptance state and receipt digest must appear together",
      });
    }
    if (
      record.state.acceptance &&
      record.acceptance_receipt_hash !== computeCanonicalHash(record.state.acceptance)
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptance_receipt_hash"],
        message: "acceptance receipt digest does not match coordination state",
      });
    }
    if ((record.state.decline !== undefined) !== (record.decline_receipt_hash !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["decline_receipt_hash"],
        message: "decline state and receipt digest must appear together",
      });
    }
    if ((record.state.decline !== undefined) !== (record.decline_reason_present !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["decline_reason_present"],
        message: "decline reason presence is recorded exactly for declined state",
      });
    }
    if (record.state.decline?.reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["state", "decline", "reason"],
        message: "raw refusal reasons must not enter coordination state",
      });
    }
    if (Date.parse(record.updated_at) < Date.parse(record.created_at)) {
      context.addIssue({
        code: "custom",
        path: ["updated_at"],
        message: "updated_at precedes created_at",
      });
    }
  });
export type GovernedDelegationRecord_v1 = z.infer<typeof GovernedDelegationRecord_v1>;

export const GovernedDelegationEventType = z.enum([
  "delegation_offered",
  "delegation_accepted",
  "delegation_declined",
  "delegation_invocation_authorized",
  "delegation_invocation_denied",
]);
export type GovernedDelegationEventType = z.infer<typeof GovernedDelegationEventType>;

export const GovernedDelegationEvent_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_DELEGATION_STORE_VERSION),
    delegation_id: opaqueId,
    attempt_id: opaqueId,
    sequence: z.number().int().positive(),
    delegation_revision: z.number().int().nonnegative(),
    mutation_id: opaqueId,
    mutation_fingerprint: SHA256Hash,
    type: GovernedDelegationEventType,
    decision_receipt_hash: SHA256Hash.optional(),
    decline_reason_present: z.boolean().optional(),
    authorization_binding_hash: SHA256Hash.optional(),
    denial_reason: z.enum(["not_accepted", "delegation_declined", "binding_mismatch"]).optional(),
    created_at: instant,
  })
  .strict()
  .superRefine((event, context) => {
    const decision = ["delegation_accepted", "delegation_declined"].includes(event.type);
    if (decision !== (event.decision_receipt_hash !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["decision_receipt_hash"],
        message: "decision events require exactly one decision receipt digest",
      });
    }
    if ((event.type === "delegation_declined") !== (event.decline_reason_present !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["decline_reason_present"],
        message: "decline events record only whether a reason was volunteered",
      });
    }
    if (
      (event.type === "delegation_invocation_authorized") !==
      (event.authorization_binding_hash !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["authorization_binding_hash"],
        message: "authorized invocation events require a binding digest",
      });
    }
    if ((event.type === "delegation_invocation_denied") !== (event.denial_reason !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["denial_reason"],
        message: "denied invocation events require a bounded denial reason",
      });
    }
  });
export type GovernedDelegationEvent_v1 = z.infer<typeof GovernedDelegationEvent_v1>;

export interface CreateGovernedDelegationInput {
  mutationId: string;
  offer: DelegationOffer;
  now: string;
}

export interface RecordGovernedDelegationDecisionInput {
  mutationId: string;
  delegationId: string;
  expectedRevision: number;
  receipt: DelegationDecisionReceipt;
  now: string;
}

export interface AuthorizeGovernedDelegationInvocationInput {
  mutationId: string;
  delegationId: string;
  expectedRevision: number;
  request: DelegationInvocationRequest;
  repositoryLifecycleGuard?: GovernedRepositoryCorpusVerificationBinding_v1;
  now: string;
}

export type GovernedDelegationMutationFailureReason =
  | "not_found"
  | "delegation_conflict"
  | "mutation_conflict"
  | "stale_revision"
  | "binding_mismatch"
  | "decision_conflict"
  | "delegation_declined";

export type CreateGovernedDelegationResult =
  | {
      created: true;
      record: GovernedDelegationRecord_v1;
      event: GovernedDelegationEvent_v1;
      idempotentReplay: boolean;
    }
  | { created: false; reason: GovernedDelegationMutationFailureReason };

export type RecordGovernedDelegationDecisionResult =
  | {
      recorded: true;
      record: GovernedDelegationRecord_v1;
      event: GovernedDelegationEvent_v1;
      decisionReceiptHash: string;
      idempotentReplay: boolean;
    }
  | { recorded: false; reason: GovernedDelegationMutationFailureReason };

export type AuthorizeGovernedDelegationInvocationResult =
  | {
      authorized: true;
      record: GovernedDelegationRecord_v1;
      event: GovernedDelegationEvent_v1;
      authorizationBindingHash: string;
      idempotentReplay: boolean;
    }
  | {
      authorized: false;
      reason: GovernedDelegationMutationFailureReason | "not_accepted" | "binding_mismatch";
      record?: GovernedDelegationRecord_v1;
      event?: GovernedDelegationEvent_v1;
      idempotentReplay?: boolean;
    };

export interface GovernedDelegationStore {
  createDelegation(input: CreateGovernedDelegationInput): Promise<CreateGovernedDelegationResult>;
  recordDelegationDecision(
    input: RecordGovernedDelegationDecisionInput
  ): Promise<RecordGovernedDelegationDecisionResult>;
  authorizeDelegationInvocation(
    input: AuthorizeGovernedDelegationInvocationInput
  ): Promise<AuthorizeGovernedDelegationInvocationResult>;
  getDelegation(delegationId: string): Promise<GovernedDelegationRecord_v1 | null>;
  listDelegationEvents(delegationId: string): Promise<GovernedDelegationEvent_v1[]>;
}

export function parseDelegationOffer(candidate: unknown): DelegationOffer {
  return DelegationOffer_v1.parse(candidate);
}

export function parseDelegationDecisionReceipt(candidate: unknown): DelegationDecisionReceipt {
  return DelegationDecisionReceipt_v1.parse(candidate);
}

export function parseDelegationInvocationRequest(candidate: unknown): DelegationInvocationRequest {
  return DelegationInvocationRequest_v1.parse(candidate);
}

export function redactDelegationReason(state: DelegationProtocolState): DelegationProtocolState {
  if (!state.decline?.reason) return DelegationProtocolState_v1.parse(state);
  const { reason: _reason, ...decline } = state.decline;
  return DelegationProtocolState_v1.parse({ ...state, decline });
}
