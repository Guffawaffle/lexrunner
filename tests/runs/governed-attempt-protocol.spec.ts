import { describe, expect, it } from "vitest";

import {
  DelegatedAuthorityGrant_v1,
  DelegationDecisionReceipt_v1,
  DelegationInvocationRequest_v1,
  DelegationOffer_v1,
  WorkerSessionDelegationBinding_v1,
  authorizeDelegationInvocation,
  computeAuthorityGrantHash,
  createDelegationDecisionReceipt,
  createDelegationProtocolState,
  evaluateDelegatedAuthorityContainment,
  parseWorkerDelegationDecision,
  recordDelegationDecision,
  type DelegatedAuthorityGrant_v1 as AuthorityGrant,
  type DelegationOffer_v1 as DelegationOffer,
  type DelegationProtocolState_v1 as DelegationState,
} from "../../src/runs/governed-attempt-protocol.js";

const HASH = {
  task: `sha256:${"1".repeat(64)}`,
  requirements: `sha256:${"2".repeat(64)}`,
  grant: `sha256:${"3".repeat(64)}`,
  transcript: `sha256:${"4".repeat(64)}`,
  provider: `sha256:${"5".repeat(64)}`,
  environment: `sha256:${"6".repeat(64)}`,
  workspace: `sha256:${"7".repeat(64)}`,
  scopeRead: `sha256:${"8".repeat(64)}`,
  scopeWrite: `sha256:${"9".repeat(64)}`,
} as const;

describe("governed Delegation decisions", () => {
  it("treats bare NO as a complete refusal and preserves an optional volunteered reason", () => {
    expect(parseWorkerDelegationDecision("NO")).toEqual({ decision: "decline" });
    expect(parseWorkerDelegationDecision({ decision: "NO" })).toEqual({ decision: "decline" });
    expect(
      parseWorkerDelegationDecision({ decision: "NO", reason: "I am not willing to do that." })
    ).toEqual({ decision: "decline", reason: "I am not willing to do that." });

    expect(() => parseWorkerDelegationDecision({ decision: "NO", reason: "" })).toThrow();
    expect(() =>
      parseWorkerDelegationDecision({ decision: "NO", summary: "not required" })
    ).toThrow();
  });

  it("creates a decline receipt without a task receipt, summary, or result identity", () => {
    const receipt = decisionReceipt("NO", "decision-no");
    expect(receipt).toMatchObject({ decision: "decline", decision_receipt_id: "decision-no" });
    expect(receipt).not.toHaveProperty("reason");
    expect(receipt).not.toHaveProperty("summary");
    expect(receipt).not.toHaveProperty("final_head_sha");
    expect(receipt).not.toHaveProperty("patch_hash");
  });

  it("latches a pre-authorization decline and rejects every later decision", () => {
    const offered = createDelegationProtocolState(offer());
    const declined = recordDelegationDecision(offered, decisionReceipt("NO", "decision-no"));
    expect(declined).toMatchObject({
      recorded: true,
      state: { status: "declined" },
      idempotentReplay: false,
    });
    if (!declined.recorded) throw new Error("expected decline to record");

    expect(
      recordDelegationDecision(declined.state, decisionReceipt("ACCEPT", "decision-late-accept"))
    ).toEqual({ recorded: false, reason: "delegation_declined" });
    expect(authorizeDelegationInvocation(declined.state, invocation())).toEqual({
      authorized: false,
      reason: "delegation_declined",
    });
  });

  it("allows exact acceptance replay but rejects a conflicting acceptance", () => {
    const state = acceptedState();
    const exact = state.acceptance;
    if (!exact) throw new Error("expected acceptance receipt");
    expect(recordDelegationDecision(state, exact)).toMatchObject({
      recorded: true,
      idempotentReplay: true,
    });

    const conflicting = DelegationDecisionReceipt_v1.parse({
      ...exact,
      decision_receipt_id: "different-acceptance",
    });
    expect(recordDelegationDecision(state, conflicting)).toEqual({
      recorded: false,
      reason: "decision_conflict",
    });
  });

  it("binds every invocation to the accepted offer, grant, thread, and transcript start", () => {
    const state = acceptedState();
    expect(authorizeDelegationInvocation(state, invocation())).toMatchObject({ authorized: true });

    for (const altered of [
      { worker_thread_id: "other-thread" },
      { transcript_start_hash: HASH.provider },
      { authority_grant_hash: HASH.environment },
      { offer_hash: HASH.workspace },
    ]) {
      expect(
        authorizeDelegationInvocation(
          state,
          DelegationInvocationRequest_v1.parse({ ...invocation(), ...altered })
        )
      ).toEqual({ authorized: false, reason: "binding_mismatch" });
    }
  });

  it("makes mid-run refusal terminal before a resume can reach the executor", () => {
    const accepted = acceptedState();
    expect(authorizeDelegationInvocation(accepted, invocation())).toMatchObject({
      authorized: true,
    });

    const declined = recordDelegationDecision(
      accepted,
      decisionReceipt({ decision: "NO", reason: "Stopping here." }, "decision-midrun")
    );
    if (!declined.recorded) throw new Error("expected mid-run refusal to record");
    expect(declined.state).toMatchObject({
      status: "declined",
      acceptance: { decision: "accept" },
      decline: { decision: "decline", reason: "Stopping here." },
    });
    expect(
      authorizeDelegationInvocation(
        declined.state,
        DelegationInvocationRequest_v1.parse({ ...invocation(), phase: "resume" })
      )
    ).toEqual({ authorized: false, reason: "delegation_declined" });
  });

  it("rejects a decision receipt bound to an altered thread or transcript", () => {
    const state = createDelegationProtocolState(offer());
    for (const altered of [
      { worker_thread_id: "other-thread" },
      { transcript_start_hash: HASH.provider },
      { offer_hash: HASH.environment },
    ]) {
      const receipt = DelegationDecisionReceipt_v1.parse({
        ...decisionReceipt("NO", "decision-altered"),
        ...altered,
      });
      expect(recordDelegationDecision(state, receipt)).toEqual({
        recorded: false,
        reason: "binding_mismatch",
      });
    }
  });

  it("requires WorkerSession creation to carry the Delegation authorization binding", () => {
    expect(
      WorkerSessionDelegationBinding_v1.parse({
        schema_version: "1.0.0",
        session_id: "session-1",
        delegation_id: "delegation-1",
        attempt_id: "attempt-1",
        worker_thread_id: "thread-1",
        offer_hash: HASH.task,
        authority_grant_hash: HASH.grant,
        authorization_binding_hash: HASH.environment,
        bound_at: "2026-08-09T08:00:02Z",
      })
    ).toMatchObject({ delegation_id: "delegation-1" });
  });
});

describe("delegated authority containment", () => {
  it("allows an exact subset with a shorter validity window", () => {
    const parent = parentGrant();
    const child = childGrant(parent, {
      capabilities: [parent.capabilities[0]!],
      not_before: "2026-08-09T08:01:00Z",
      expires_at: "2026-08-09T08:30:00Z",
    });
    expect(evaluateDelegatedAuthorityContainment(parent, child)).toMatchObject({ contained: true });
  });

  it("rejects capability, validity, parent-hash, and cross-Attempt expansion", () => {
    const parent = parentGrant();
    const baseline = childGrant(parent);
    const cases: Array<[Partial<AuthorityGrant>, string]> = [
      [
        {
          capabilities: [
            ...baseline.capabilities,
            {
              dimension: "network",
              capability_id: "network-any",
              scope_hash: HASH.scopeWrite,
            },
          ],
        },
        "capability_expansion",
      ],
      [{ expires_at: "2026-08-09T10:00:01Z" }, "validity_expansion"],
      [{ parent_grant_hash: HASH.provider }, "parent_hash_mismatch"],
      [{ attempt_id: "other-attempt" }, "attempt_mismatch"],
    ];

    for (const [altered, reason] of cases) {
      const child = DelegatedAuthorityGrant_v1.parse({ ...baseline, ...altered });
      expect(evaluateDelegatedAuthorityContainment(parent, child)).toEqual({
        contained: false,
        reason,
      });
    }
  });
});

function offer(overrides: Partial<DelegationOffer> = {}): DelegationOffer {
  return DelegationOffer_v1.parse({
    schema_version: "1.0.0",
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    worker: {
      provider_id: "codex-linux",
      worker_id: "worker-1",
      thread_id: "thread-1",
    },
    task_offer_hash: HASH.task,
    requirements_hash: HASH.requirements,
    authority_grant_hash: HASH.grant,
    transcript_start_hash: HASH.transcript,
    offered_at: "2026-08-09T08:00:00Z",
    ...overrides,
  });
}

function decisionReceipt(decision: unknown, id: string) {
  return createDelegationDecisionReceipt({
    offer: offer(),
    decision,
    decisionReceiptId: id,
    decidedAt: "2026-08-09T08:00:01Z",
  });
}

function acceptedState(): DelegationState {
  const result = recordDelegationDecision(
    createDelegationProtocolState(offer()),
    decisionReceipt("ACCEPT", "decision-accept")
  );
  if (!result.recorded) throw new Error("expected acceptance to record");
  return result.state;
}

function invocation() {
  return DelegationInvocationRequest_v1.parse({
    schema_version: "1.0.0",
    delegation_id: "delegation-1",
    attempt_id: "attempt-1",
    offer_hash: createDelegationProtocolState(offer()).offer_hash,
    authority_grant_hash: HASH.grant,
    worker_thread_id: "thread-1",
    transcript_start_hash: HASH.transcript,
    provider_attestation_hash: HASH.provider,
    environment_attestation_hash: HASH.environment,
    workspace_attestation_hash: HASH.workspace,
    phase: "authorized_work",
  });
}

function parentGrant(): AuthorityGrant {
  return DelegatedAuthorityGrant_v1.parse({
    schema_version: "1.0.0",
    grant_id: "grant-parent",
    attempt_id: "attempt-1",
    delegation_id: "delegation-parent",
    issuer: { kind: "operator", principal_id: "operator-guff" },
    capabilities: [
      {
        dimension: "filesystem_read",
        capability_id: "read-synthetic-corpus",
        scope_hash: HASH.scopeRead,
      },
      {
        dimension: "filesystem_write",
        capability_id: "write-disposable-workspace",
        scope_hash: HASH.scopeWrite,
      },
    ],
    issued_at: "2026-08-09T08:00:00Z",
    not_before: "2026-08-09T08:00:00Z",
    expires_at: "2026-08-09T10:00:00Z",
  });
}

function childGrant(
  parent: AuthorityGrant,
  overrides: Partial<AuthorityGrant> = {}
): AuthorityGrant {
  return DelegatedAuthorityGrant_v1.parse({
    schema_version: "1.0.0",
    grant_id: "grant-child",
    attempt_id: parent.attempt_id,
    delegation_id: "delegation-child",
    issuer: { kind: "delegation", delegation_id: parent.delegation_id },
    parent_grant_hash: computeAuthorityGrantHash(parent),
    capabilities: parent.capabilities,
    issued_at: "2026-08-09T08:00:01Z",
    not_before: "2026-08-09T08:00:01Z",
    expires_at: "2026-08-09T09:00:00Z",
    ...overrides,
  });
}
