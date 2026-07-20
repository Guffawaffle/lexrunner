import { describe, expect, it } from "vitest";

import {
  evaluateStrictAgentWorkFanIn,
  type AgentWorkFanInEvidenceCandidate,
} from "../../src/agent-work-fanin-policy.js";

describe("strict agent-work fan-in policy", () => {
  it("selects the lexicographically first equivalent verified result deterministically", () => {
    const first = passing("attempt-a", "a");
    const second = passing("attempt-b", "a");

    const forward = evaluateStrictAgentWorkFanIn([first, second]);
    const reversed = evaluateStrictAgentWorkFanIn([second, first]);

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      outcome: "selected",
      selectedAttemptId: "attempt-a",
      conflicts: [],
      uncertainty: [],
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "selected",
          reason_codes: ["strict_verified_selection"],
        },
        {
          attempt_id: "attempt-b",
          conclusion: "equivalent",
          reason_codes: ["equivalent_verified_result"],
        },
      ],
    });
  });

  it("selects a passing result while retaining rejected verified evidence", () => {
    const failed = verified("attempt-a", "fail", {
      attempt_status: "rejected",
      artifact_refs: ["artifact://failed/check-log"],
    });
    const passed = passing("attempt-b", "b");

    const result = evaluateStrictAgentWorkFanIn([failed, passed]);

    expect(result).toMatchObject({
      outcome: "selected",
      selectedAttemptId: "attempt-b",
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "rejected",
          reason_codes: ["verification_fail"],
          artifact_refs: ["artifact://failed/check-log"],
        },
        { attempt_id: "attempt-b", conclusion: "selected" },
      ],
    });
  });

  it("escalates contradictory passing result identities without choosing a winner", () => {
    const result = evaluateStrictAgentWorkFanIn([
      passing("attempt-a", "a"),
      passing("attempt-b", "b"),
    ]);

    expect(result).toMatchObject({
      outcome: "escalated",
      conflicts: ["verified_result_divergence"],
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "unselected",
          reason_codes: ["verified_result_conflict"],
        },
        {
          attempt_id: "attempt-b",
          conclusion: "unselected",
          reason_codes: ["verified_result_conflict"],
        },
      ],
    });
    expect(result).not.toHaveProperty("selectedAttemptId");
  });

  it("escalates an incomplete evidence set and keeps the verified candidate unselected", () => {
    const result = evaluateStrictAgentWorkFanIn([
      passing("attempt-a", "a"),
      missingVerification("attempt-b"),
    ]);

    expect(result).toMatchObject({
      outcome: "escalated",
      conflicts: [],
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "unselected",
          reason_codes: ["fanout_evidence_incomplete"],
        },
        {
          attempt_id: "attempt-b",
          conclusion: "missing_evidence",
          reason_codes: ["verification_missing"],
        },
      ],
    });
  });

  it("escalates a passing verification that lacks a comparable result identity", () => {
    const result = evaluateStrictAgentWorkFanIn([
      verified("attempt-a", "pass"),
      passing("attempt-b", "b"),
    ]);

    expect(result).toMatchObject({
      outcome: "escalated",
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "missing_evidence",
          reason_codes: ["verified_result_identity_missing"],
        },
        {
          attempt_id: "attempt-b",
          conclusion: "unselected",
          reason_codes: ["fanout_evidence_incomplete"],
        },
      ],
    });
  });

  it("records no viable candidate only when complete engine evidence rejects every result", () => {
    const result = evaluateStrictAgentWorkFanIn([
      verified("attempt-a", "fail", { attempt_status: "rejected" }),
      verified("attempt-b", "inconclusive", { attempt_status: "inconclusive" }),
    ]);

    expect(result).toMatchObject({
      outcome: "no_viable_candidate",
      conflicts: [],
      candidates: [
        { attempt_id: "attempt-a", reason_codes: ["verification_fail"] },
        { attempt_id: "attempt-b", reason_codes: ["verification_inconclusive"] },
      ],
    });
  });

  it("does not accept a passing result with an unresolved trust gap", () => {
    const result = evaluateStrictAgentWorkFanIn([
      passing("attempt-a", "a", { trust_gap_count: 1, attempt_status: "rejected" }),
      verified("attempt-b", "fail", { attempt_status: "rejected" }),
    ]);

    expect(result).toMatchObject({
      outcome: "no_viable_candidate",
      candidates: [
        {
          attempt_id: "attempt-a",
          conclusion: "rejected",
          reason_codes: ["unresolved_trust_gap"],
        },
        {
          attempt_id: "attempt-b",
          conclusion: "rejected",
          reason_codes: ["verification_fail"],
        },
      ],
    });
    expect(result.uncertainty).toContain("At least one candidate retains an unresolved trust gap.");
  });
});

function passing(
  attemptId: string,
  identityCharacter: string,
  overrides: Partial<AgentWorkFanInEvidenceCandidate> = {}
): AgentWorkFanInEvidenceCandidate {
  return verified(attemptId, "pass", {
    verified_result_identity: hash(identityCharacter),
    ...overrides,
  });
}

function verified(
  attemptId: string,
  outcome: "pass" | "fail" | "inconclusive" | "infrastructure_error" | "cancelled",
  overrides: Partial<AgentWorkFanInEvidenceCandidate> = {}
): AgentWorkFanInEvidenceCandidate {
  return {
    attempt_id: attemptId,
    premise_id: `premise-${attemptId}`,
    attempt_status: "accepted",
    receipt_id: `receipt-${attemptId}`,
    receipt_hash: hash("c"),
    verification_id: `verification-${attemptId}`,
    verification_hash: hash("d"),
    verification_outcome: outcome,
    trust_gap_count: 0,
    artifact_refs: [],
    ...overrides,
  };
}

function missingVerification(attemptId: string): AgentWorkFanInEvidenceCandidate {
  return {
    attempt_id: attemptId,
    premise_id: `premise-${attemptId}`,
    attempt_status: "cancelled",
    trust_gap_count: 0,
    artifact_refs: ["artifact://cancelled/observation"],
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
