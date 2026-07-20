import type { AgentWorkFanInDecision_v1 } from "./schemas/agent-work.js";

export type AgentWorkFanInEvidenceCandidate = Omit<
  AgentWorkFanInDecision_v1["candidates"][number],
  "conclusion" | "reason_codes"
>;

export interface StrictAgentWorkFanInEvaluation {
  outcome: AgentWorkFanInDecision_v1["decision"];
  selectedAttemptId?: string;
  candidates: AgentWorkFanInDecision_v1["candidates"];
  conflicts: string[];
  uncertainty: string[];
}

/** Pure strict-policy matrix shared by application and persistence boundaries. */
export function evaluateStrictAgentWorkFanIn(
  evidence: readonly AgentWorkFanInEvidenceCandidate[]
): StrictAgentWorkFanInEvaluation {
  const orderedEvidence = [...evidence].sort((left, right) =>
    left.attempt_id.localeCompare(right.attempt_id)
  );
  const strictPassing = orderedEvidence.filter(isStrictPassingCandidate);
  const identities = new Set(
    strictPassing.map(({ verified_result_identity }) => verified_result_identity)
  );
  const missingVerification = orderedEvidence.some(
    ({ verification_id }) => verification_id === undefined
  );
  const missingPassingIdentity = orderedEvidence.some(
    (candidate) =>
      candidate.verification_outcome === "pass" &&
      candidate.trust_gap_count === 0 &&
      candidate.verified_result_identity === undefined
  );
  const conflictingResults = identities.size > 1;
  const outcome: StrictAgentWorkFanInEvaluation["outcome"] =
    missingVerification || missingPassingIdentity || conflictingResults
      ? "escalated"
      : strictPassing.length === 0
        ? "no_viable_candidate"
        : "selected";
  const selectedAttemptId =
    outcome === "selected"
      ? strictPassing.map(({ attempt_id }) => attempt_id).sort()[0]
      : undefined;
  const candidates: AgentWorkFanInDecision_v1["candidates"] = orderedEvidence.map((candidate) => {
    const strictPass = isStrictPassingCandidate(candidate);
    if (outcome === "selected" && candidate.attempt_id === selectedAttemptId) {
      return {
        ...candidate,
        conclusion: "selected",
        reason_codes: ["strict_verified_selection"],
      };
    }
    if (outcome === "selected" && strictPass) {
      return {
        ...candidate,
        conclusion: "equivalent",
        reason_codes: ["equivalent_verified_result"],
      };
    }
    if (!candidate.verification_id) {
      return {
        ...candidate,
        conclusion: "missing_evidence",
        reason_codes: ["verification_missing"],
      };
    }
    if (
      candidate.verification_outcome === "pass" &&
      candidate.trust_gap_count === 0 &&
      candidate.verified_result_identity === undefined
    ) {
      return {
        ...candidate,
        conclusion: "missing_evidence",
        reason_codes: ["verified_result_identity_missing"],
      };
    }
    if (outcome === "escalated" && strictPass) {
      return {
        ...candidate,
        conclusion: "unselected",
        reason_codes: [
          conflictingResults ? "verified_result_conflict" : "fanout_evidence_incomplete",
        ],
      };
    }
    return {
      ...candidate,
      conclusion: "rejected",
      reason_codes:
        candidate.trust_gap_count > 0
          ? ["unresolved_trust_gap"]
          : [`verification_${candidate.verification_outcome ?? "missing"}`],
    };
  });
  return {
    outcome,
    ...(selectedAttemptId ? { selectedAttemptId } : {}),
    candidates,
    conflicts: conflictingResults ? ["verified_result_divergence"] : [],
    uncertainty: [
      ...(missingVerification ? ["At least one candidate lacks engine verification."] : []),
      ...(missingPassingIdentity
        ? ["At least one passing verification lacks a comparable result identity."]
        : []),
      ...(conflictingResults
        ? ["Passing engine evidence identifies contradictory result identities."]
        : []),
      ...(orderedEvidence.some(({ trust_gap_count }) => trust_gap_count > 0)
        ? ["At least one candidate retains an unresolved trust gap."]
        : []),
    ],
  };
}

function isStrictPassingCandidate(
  candidate: Pick<
    AgentWorkFanInDecision_v1["candidates"][number],
    "verification_outcome" | "trust_gap_count" | "verified_result_identity"
  >
): candidate is typeof candidate & { verified_result_identity: string } {
  return (
    candidate.verification_outcome === "pass" &&
    candidate.trust_gap_count === 0 &&
    candidate.verified_result_identity !== undefined
  );
}
