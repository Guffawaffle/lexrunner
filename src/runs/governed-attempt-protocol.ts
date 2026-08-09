import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";
import { WorkerAdapterAuthorityDimension } from "./agent-work-worker-runtime.js";

export const GOVERNED_ATTEMPT_PROTOCOL_VERSION = "1.0.0" as const;

const boundedId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });
const optionalRefusalReason = z.string().min(1).max(4_096).optional();

export const DelegatedAuthorityCapability_v1 = z
  .object({
    dimension: WorkerAdapterAuthorityDimension,
    capability_id: boundedId,
    scope_hash: SHA256Hash,
  })
  .strict();
export type DelegatedAuthorityCapability_v1 = z.infer<typeof DelegatedAuthorityCapability_v1>;

const AuthorityGrantIssuer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator"), principal_id: boundedId }).strict(),
  z.object({ kind: z.literal("delegation"), delegation_id: boundedId }).strict(),
]);

/**
 * Immutable capability grant. Scope details live in protected authority state;
 * this coordination-safe contract carries only opaque identities and hashes.
 */
export const DelegatedAuthorityGrant_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    grant_id: boundedId,
    attempt_id: boundedId,
    delegation_id: boundedId,
    issuer: AuthorityGrantIssuer,
    parent_grant_hash: SHA256Hash.optional(),
    capabilities: z.array(DelegatedAuthorityCapability_v1).max(32),
    issued_at: instant,
    not_before: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine((grant, context) => {
    const capabilityIds = grant.capabilities.map((capability) => capability.capability_id);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "capability_id values must be unique within a grant",
      });
    }
    if ((grant.issuer.kind === "delegation") !== (grant.parent_grant_hash !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["parent_grant_hash"],
        message: "delegated grants require exactly one parent grant hash",
      });
    }
    requireTimeOrder(grant.issued_at, grant.not_before, "not_before", context);
    requireTimeOrder(grant.not_before, grant.expires_at, "expires_at", context, false);
  });
export type DelegatedAuthorityGrant_v1 = z.infer<typeof DelegatedAuthorityGrant_v1>;

export type AuthorityContainmentFailureReason =
  | "invalid_parent_grant"
  | "invalid_child_grant"
  | "issuer_mismatch"
  | "parent_hash_mismatch"
  | "attempt_mismatch"
  | "delegation_reuse"
  | "validity_expansion"
  | "capability_expansion";

export type AuthorityContainmentResult =
  | { contained: true; grantHash: string }
  | { contained: false; reason: AuthorityContainmentFailureReason };

/** A delegated worker can preserve or remove exact capabilities, never invent or widen them. */
export function evaluateDelegatedAuthorityContainment(
  parentCandidate: unknown,
  childCandidate: unknown
): AuthorityContainmentResult {
  const parentResult = DelegatedAuthorityGrant_v1.safeParse(parentCandidate);
  if (!parentResult.success) return { contained: false, reason: "invalid_parent_grant" };
  const childResult = DelegatedAuthorityGrant_v1.safeParse(childCandidate);
  if (!childResult.success) return { contained: false, reason: "invalid_child_grant" };

  const parent = parentResult.data;
  const child = childResult.data;
  if (child.issuer.kind !== "delegation" || child.issuer.delegation_id !== parent.delegation_id) {
    return { contained: false, reason: "issuer_mismatch" };
  }
  if (child.parent_grant_hash !== computeAuthorityGrantHash(parent)) {
    return { contained: false, reason: "parent_hash_mismatch" };
  }
  if (child.attempt_id !== parent.attempt_id) {
    return { contained: false, reason: "attempt_mismatch" };
  }
  if (child.delegation_id === parent.delegation_id) {
    return { contained: false, reason: "delegation_reuse" };
  }
  if (
    Date.parse(child.not_before) < Date.parse(parent.not_before) ||
    Date.parse(child.expires_at) > Date.parse(parent.expires_at)
  ) {
    return { contained: false, reason: "validity_expansion" };
  }

  const parentCapabilities = new Set(
    parent.capabilities.map((capability) => computeCanonicalHash(capability))
  );
  if (
    child.capabilities.some(
      (capability) => !parentCapabilities.has(computeCanonicalHash(capability))
    )
  ) {
    return { contained: false, reason: "capability_expansion" };
  }
  return { contained: true, grantHash: computeAuthorityGrantHash(child) };
}

export function computeAuthorityGrantHash(grant: DelegatedAuthorityGrant_v1): string {
  return computeCanonicalHash(DelegatedAuthorityGrant_v1.parse(grant));
}

/** The pre-corpus offer shown to exactly one selected worker thread. */
export const DelegationOffer_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    delegation_id: boundedId,
    attempt_id: boundedId,
    worker: z
      .object({
        provider_id: boundedId,
        worker_id: boundedId,
        thread_id: boundedId,
      })
      .strict(),
    task_offer_hash: SHA256Hash,
    requirements_hash: SHA256Hash,
    authority_grant_hash: SHA256Hash,
    transcript_start_hash: SHA256Hash,
    offered_at: instant,
  })
  .strict();
export type DelegationOffer_v1 = z.infer<typeof DelegationOffer_v1>;

export function computeDelegationOfferHash(offer: DelegationOffer_v1): string {
  return computeCanonicalHash(DelegationOffer_v1.parse(offer));
}

export const WorkerDelegationDecisionInput_v1 = z.union([
  z.literal("ACCEPT").transform(() => ({ decision: "accept" as const })),
  z.literal("NO").transform(() => ({ decision: "decline" as const })),
  z
    .object({ decision: z.literal("ACCEPT") })
    .strict()
    .transform(() => ({ decision: "accept" as const })),
  z
    .object({ decision: z.literal("NO"), reason: optionalRefusalReason })
    .strict()
    .transform((value) => ({
      decision: "decline" as const,
      ...(value.reason !== undefined ? { reason: value.reason } : {}),
    })),
]);
export type WorkerDelegationDecision = z.output<typeof WorkerDelegationDecisionInput_v1>;

export function parseWorkerDelegationDecision(input: unknown): WorkerDelegationDecision {
  return WorkerDelegationDecisionInput_v1.parse(input);
}

export const DelegationDecisionReceipt_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    decision_receipt_id: boundedId,
    delegation_id: boundedId,
    attempt_id: boundedId,
    offer_hash: SHA256Hash,
    worker_thread_id: boundedId,
    transcript_start_hash: SHA256Hash,
    decision: z.enum(["accept", "decline"]),
    reason: optionalRefusalReason,
    decided_at: instant,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.decision === "accept" && receipt.reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "acceptance cannot carry a refusal reason",
      });
    }
  });
export type DelegationDecisionReceipt_v1 = z.infer<typeof DelegationDecisionReceipt_v1>;

export function createDelegationDecisionReceipt(input: {
  offer: DelegationOffer_v1;
  decision: unknown;
  decisionReceiptId: string;
  decidedAt: string;
}): DelegationDecisionReceipt_v1 {
  const offer = DelegationOffer_v1.parse(input.offer);
  const decision = parseWorkerDelegationDecision(input.decision);
  return DelegationDecisionReceipt_v1.parse({
    schema_version: GOVERNED_ATTEMPT_PROTOCOL_VERSION,
    decision_receipt_id: input.decisionReceiptId,
    delegation_id: offer.delegation_id,
    attempt_id: offer.attempt_id,
    offer_hash: computeDelegationOfferHash(offer),
    worker_thread_id: offer.worker.thread_id,
    transcript_start_hash: offer.transcript_start_hash,
    decision: decision.decision,
    ...(decision.decision === "decline" && "reason" in decision && decision.reason !== undefined
      ? { reason: decision.reason }
      : {}),
    decided_at: input.decidedAt,
  });
}

export const DelegationProtocolStatus = z.enum(["offered", "accepted", "declined"]);
export type DelegationProtocolStatus = z.infer<typeof DelegationProtocolStatus>;

export const DelegationProtocolState_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    offer: DelegationOffer_v1,
    offer_hash: SHA256Hash,
    status: DelegationProtocolStatus,
    acceptance: DelegationDecisionReceipt_v1.optional(),
    decline: DelegationDecisionReceipt_v1.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.offer_hash !== computeDelegationOfferHash(state.offer)) {
      context.addIssue({ code: "custom", path: ["offer_hash"], message: "offer hash mismatch" });
    }
    if (state.acceptance && state.acceptance.decision !== "accept") {
      context.addIssue({
        code: "custom",
        path: ["acceptance"],
        message: "acceptance must contain an accept decision",
      });
    }
    if (state.decline && state.decline.decision !== "decline") {
      context.addIssue({
        code: "custom",
        path: ["decline"],
        message: "decline must contain a decline decision",
      });
    }
    if (
      (state.status === "offered" &&
        (state.acceptance !== undefined || state.decline !== undefined)) ||
      (state.status === "accepted" &&
        (state.acceptance === undefined || state.decline !== undefined)) ||
      (state.status === "declined" && state.decline === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "decision receipts do not match delegation status",
      });
    }
    for (const [field, receipt] of [
      ["acceptance", state.acceptance],
      ["decline", state.decline],
    ] as const) {
      if (receipt && !decisionReceiptMatchesOffer(receipt, state.offer, state.offer_hash)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "decision receipt is not bound to the exact offer and worker thread",
        });
      }
    }
  });
export type DelegationProtocolState_v1 = z.infer<typeof DelegationProtocolState_v1>;

export function createDelegationProtocolState(
  offerCandidate: DelegationOffer_v1
): DelegationProtocolState_v1 {
  const offer = DelegationOffer_v1.parse(offerCandidate);
  return DelegationProtocolState_v1.parse({
    schema_version: GOVERNED_ATTEMPT_PROTOCOL_VERSION,
    offer,
    offer_hash: computeDelegationOfferHash(offer),
    status: "offered",
  });
}

export type RecordDelegationDecisionResult =
  | { recorded: true; state: DelegationProtocolState_v1; idempotentReplay: boolean }
  | {
      recorded: false;
      reason: "binding_mismatch" | "decision_conflict" | "delegation_declined";
    };

/**
 * Latch a worker decision. Decline is terminal per Delegation, including after
 * an earlier acceptance; no later acceptance or same-Delegation retry exists.
 */
export function recordDelegationDecision(
  stateCandidate: DelegationProtocolState_v1,
  receiptCandidate: DelegationDecisionReceipt_v1
): RecordDelegationDecisionResult {
  const state = DelegationProtocolState_v1.parse(stateCandidate);
  const receipt = DelegationDecisionReceipt_v1.parse(receiptCandidate);
  if (!decisionReceiptMatchesOffer(receipt, state.offer, state.offer_hash)) {
    return { recorded: false, reason: "binding_mismatch" };
  }
  if (state.status === "declined") {
    return { recorded: false, reason: "delegation_declined" };
  }
  if (receipt.decision === "accept") {
    if (state.status === "accepted") {
      return state.acceptance &&
        computeCanonicalHash(state.acceptance) === computeCanonicalHash(receipt)
        ? { recorded: true, state, idempotentReplay: true }
        : { recorded: false, reason: "decision_conflict" };
    }
    return {
      recorded: true,
      state: DelegationProtocolState_v1.parse({
        ...state,
        status: "accepted",
        acceptance: receipt,
      }),
      idempotentReplay: false,
    };
  }
  return {
    recorded: true,
    state: DelegationProtocolState_v1.parse({
      ...state,
      status: "declined",
      decline: receipt,
    }),
    idempotentReplay: false,
  };
}

export const DelegationInvocationRequest_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    delegation_id: boundedId,
    attempt_id: boundedId,
    offer_hash: SHA256Hash,
    authority_grant_hash: SHA256Hash,
    worker_thread_id: boundedId,
    transcript_start_hash: SHA256Hash,
    provider_attestation_hash: SHA256Hash,
    environment_attestation_hash: SHA256Hash,
    workspace_attestation_hash: SHA256Hash,
    phase: z.enum(["authorized_work", "resume"]),
  })
  .strict();
export type DelegationInvocationRequest_v1 = z.infer<typeof DelegationInvocationRequest_v1>;

export type DelegationInvocationAuthorization =
  | { authorized: true; authorizationBindingHash: string }
  | {
      authorized: false;
      reason: "not_accepted" | "delegation_declined" | "binding_mismatch";
    };

export interface DelegationAuthorizationBindingState {
  status: DelegationProtocolStatus;
  offer: DelegationOffer_v1;
  offerHash: string;
  acceptanceReceiptHash?: string;
}

/** Protocol guard usable by coordination stores that retain receipt digests, not raw reasons. */
export function authorizeDelegationInvocationBinding(
  state: DelegationAuthorizationBindingState,
  requestCandidate: DelegationInvocationRequest_v1
): DelegationInvocationAuthorization {
  const offer = DelegationOffer_v1.parse(state.offer);
  const request = DelegationInvocationRequest_v1.parse(requestCandidate);
  if (state.status === "declined") {
    return { authorized: false, reason: "delegation_declined" };
  }
  if (state.status !== "accepted" || state.acceptanceReceiptHash === undefined) {
    return { authorized: false, reason: "not_accepted" };
  }
  if (
    request.delegation_id !== offer.delegation_id ||
    request.attempt_id !== offer.attempt_id ||
    request.offer_hash !== state.offerHash ||
    request.authority_grant_hash !== offer.authority_grant_hash ||
    request.worker_thread_id !== offer.worker.thread_id ||
    request.transcript_start_hash !== offer.transcript_start_hash
  ) {
    return { authorized: false, reason: "binding_mismatch" };
  }
  return {
    authorized: true,
    authorizationBindingHash: computeCanonicalHash({
      request,
      acceptance_receipt_hash: state.acceptanceReceiptHash,
    }),
  };
}

/** Final coordinator-side guard that must run before every executor invocation or resume. */
export function authorizeDelegationInvocation(
  stateCandidate: DelegationProtocolState_v1,
  requestCandidate: DelegationInvocationRequest_v1
): DelegationInvocationAuthorization {
  const state = DelegationProtocolState_v1.parse(stateCandidate);
  return authorizeDelegationInvocationBinding(
    {
      status: state.status,
      offer: state.offer,
      offerHash: state.offer_hash,
      ...(state.acceptance
        ? { acceptanceReceiptHash: computeCanonicalHash(state.acceptance) }
        : {}),
    },
    requestCandidate
  );
}

/** Immutable bridge used when an accepted Delegation creates a WorkerSession. */
export const WorkerSessionDelegationBinding_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_PROTOCOL_VERSION),
    session_id: boundedId,
    delegation_id: boundedId,
    attempt_id: boundedId,
    worker_thread_id: boundedId,
    offer_hash: SHA256Hash,
    authority_grant_hash: SHA256Hash,
    authorization_binding_hash: SHA256Hash,
    bound_at: instant,
  })
  .strict();
export type WorkerSessionDelegationBinding_v1 = z.infer<typeof WorkerSessionDelegationBinding_v1>;

function decisionReceiptMatchesOffer(
  receipt: DelegationDecisionReceipt_v1,
  offer: DelegationOffer_v1,
  offerHash: string
): boolean {
  return (
    receipt.delegation_id === offer.delegation_id &&
    receipt.attempt_id === offer.attempt_id &&
    receipt.offer_hash === offerHash &&
    receipt.worker_thread_id === offer.worker.thread_id &&
    receipt.transcript_start_hash === offer.transcript_start_hash &&
    Date.parse(receipt.decided_at) >= Date.parse(offer.offered_at)
  );
}

function requireTimeOrder(
  earlier: string,
  later: string,
  path: string,
  context: z.RefinementCtx,
  equalAllowed = true
): void {
  const ordered = equalAllowed
    ? Date.parse(earlier) <= Date.parse(later)
    : Date.parse(earlier) < Date.parse(later);
  if (!ordered) {
    context.addIssue({ code: "custom", path: [path], message: `${path} is out of order` });
  }
}
