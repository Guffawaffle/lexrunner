import {
  AgentEngineVerification_v2,
  AgentWorkFanInDecision_v1,
  AgentWorkFanoutPlan_v1,
  FanoutAttemptBinding_v1,
  computeFanInEvidenceSetHash,
  type AgentWorkFanoutPlan_v1 as FanoutPlan,
} from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type { ControllerLeaseCredential } from "../store/coordination-store.js";
import type {
  AgentWorkFanoutStore,
  AttemptReceiptStore,
  AttemptReceiptRecord,
  AttemptVerificationRecord,
  AttemptVerificationStore,
  FanInDecisionRecord,
  FanInDecisionMutationResult,
  FanoutPlanMutationResult,
  WorkspaceLifecycleStore,
} from "../store/workspace-lifecycle-store.js";
import { isTerminalAttemptStatus } from "../store/workspace-lifecycle-domains.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  evaluateStrictAgentWorkFanIn,
  type AgentWorkFanInEvidenceCandidate,
} from "../agent-work-fanin-policy.js";

export const STRICT_FANIN_POLICY_ID = "lexrunner.engine-fanin.strict" as const;
export const STRICT_FANIN_POLICY_VERSION = "1.0.0" as const;

type FanoutServiceStore = AgentWorkFanoutStore &
  WorkspaceLifecycleStore &
  AttemptReceiptStore &
  AttemptVerificationStore;

export interface CreateAgentWorkFanoutInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
  plan: FanoutPlan;
}

export interface DecideAgentWorkFanInInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  mutationId: string;
  now: string;
  fanoutId: string;
  decisionId: string;
  diagnostics?: boolean;
}

export type AgentWorkFanInResult =
  | {
      recorded: true;
      decisionId: string;
      outcome: "selected" | "escalated" | "no_viable_candidate";
      selectedAttemptId?: string;
      candidateCount: number;
      evidenceSetHash: string;
      idempotentReplay: boolean;
      diagnostics?: { conflicts: string[]; uncertainty: string[]; summary: string };
    }
  | {
      recorded: false;
      reason: Extract<FanInDecisionMutationResult, { recorded: false }>["reason"];
    };

/** Shared application boundary for bounded fanout declarations and deterministic engine fan-in. */
export class AgentWorkFanoutService {
  constructor(private readonly store: FanoutServiceStore) {}

  async create(input: CreateAgentWorkFanoutInput): Promise<FanoutPlanMutationResult> {
    const plan = AgentWorkFanoutPlan_v1.parse(input.plan);
    return this.store.createFanoutPlan({
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      controller: input.controller,
      mutationId: input.mutationId,
      now: input.now,
      plan,
    });
  }

  async binding(
    fanoutId: string,
    attemptId: string
  ): Promise<ReturnType<typeof FanoutAttemptBinding_v1.parse> | null> {
    const record = await this.store.getFanoutPlan(fanoutId);
    if (!record) return null;
    const plan = parsePlan(record.planJson, record.planHash);
    if (!plan) return null;
    const premise = plan.premises.find((candidate) => candidate.attempt_id === attemptId);
    if (!premise) return null;
    return FanoutAttemptBinding_v1.parse({
      schema_version: "1.0.0",
      fanout_id: plan.fanout_id,
      fanout_plan_hash: record.planHash,
      premise_id: premise.premise_id,
      premise_hash: computeCanonicalHash(premise),
      attempt_id: premise.attempt_id,
    });
  }

  async decide(input: DecideAgentWorkFanInInput): Promise<AgentWorkFanInResult> {
    const existing = await this.store.getFanInDecisionForFanout(input.fanoutId);
    if (existing) {
      if (existing.decisionId !== input.decisionId) {
        return { recorded: false, reason: "fanout_conflict" };
      }
      const parsed = parseDecision(existing);
      return parsed
        ? compactResult(parsed, true, input.diagnostics ?? false)
        : { recorded: false, reason: "fanout_evidence_mismatch" };
    }
    const record = await this.store.getFanoutPlan(input.fanoutId);
    if (!record || record.runId !== input.runId) {
      return { recorded: false, reason: "fanout_not_found" };
    }
    const plan = parsePlan(record.planJson, record.planHash);
    if (!plan) return { recorded: false, reason: "fanout_evidence_mismatch" };
    const bindings = await this.store.listFanoutAttemptBindings(plan.fanout_id);
    if (bindings.length !== plan.premises.length) {
      return { recorded: false, reason: "fanout_incomplete" };
    }

    const evidence: AgentWorkFanInEvidenceCandidate[] = [];
    for (const premise of plan.premises) {
      const binding = bindings.find(({ attemptId }) => attemptId === premise.attempt_id);
      const attempt = await this.store.getAttempt(premise.attempt_id);
      if (
        !binding ||
        binding.premiseId !== premise.premise_id ||
        !attempt ||
        !isTerminalAttemptStatus(attempt.status)
      ) {
        return { recorded: false, reason: "fanout_incomplete" };
      }
      const [receipt, verification] = await Promise.all([
        this.store.getAttemptReceiptForAttempt(attempt.attemptId),
        this.store.getAttemptVerificationForAttempt(attempt.attemptId),
      ]);
      const verified = verification ? verificationEvidence(verification, receipt) : null;
      if (verification && verified === null) {
        return { recorded: false, reason: "fanout_evidence_mismatch" };
      }
      evidence.push({
        attempt_id: attempt.attemptId,
        premise_id: premise.premise_id,
        attempt_status: attempt.status,
        ...(receipt ? { receipt_id: receipt.receiptId, receipt_hash: receipt.receiptHash } : {}),
        ...(verification
          ? {
              verification_id: verification.verificationId,
              verification_hash: verification.verificationHash,
              verification_outcome: verified?.outcome,
              ...(verified?.resultIdentity
                ? {
                    verified_result_identity: verified.resultIdentity,
                  }
                : {}),
            }
          : {}),
        trust_gap_count: verified?.trustGapCount ?? 0,
        artifact_refs: verified?.artifactRefs ?? [],
      });
    }

    const evaluation = evaluateStrictAgentWorkFanIn(evidence);
    const decision = AgentWorkFanInDecision_v1.parse({
      schema_version: "1.0.0",
      decision_id: input.decisionId,
      fanout_id: plan.fanout_id,
      fanout_plan_hash: record.planHash,
      run_id: plan.run_id,
      work_item_id: plan.work_item_id,
      work_item_revision: plan.work_item_revision,
      policy_id: STRICT_FANIN_POLICY_ID,
      policy_version: STRICT_FANIN_POLICY_VERSION,
      selection_criteria: plan.selection_criteria,
      decision: evaluation.outcome,
      ...(evaluation.selectedAttemptId
        ? { selected_attempt_id: evaluation.selectedAttemptId }
        : {}),
      candidates: evaluation.candidates,
      conflicts: evaluation.conflicts,
      uncertainty: evaluation.uncertainty,
      evidence_set_hash: computeFanInEvidenceSetHash(evaluation.candidates),
      summary: fanInSummary(evaluation.outcome, evaluation.candidates.length),
      created_at: input.now,
    });
    const committed = await this.store.commitFanInDecision({
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      controller: input.controller,
      mutationId: input.mutationId,
      now: input.now,
      decision,
    });
    return committed.recorded
      ? compactResult(decision, committed.idempotentReplay, input.diagnostics ?? false)
      : { recorded: false, reason: committed.reason };
  }
}

function parseDecision(record: FanInDecisionRecord): AgentWorkFanInDecision_v1 | null {
  try {
    const parsed = AgentWorkFanInDecision_v1.safeParse(JSON.parse(record.decisionJson) as unknown);
    return parsed.success &&
      parsed.data.decision_id === record.decisionId &&
      parsed.data.fanout_id === record.fanoutId &&
      canonicalJSONStringify(parsed.data) === record.decisionJson &&
      computeCanonicalHash(parsed.data) === record.decisionHash
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function parsePlan(planJson: string, planHash: string): FanoutPlan | null {
  try {
    const parsed = AgentWorkFanoutPlan_v1.safeParse(JSON.parse(planJson) as unknown);
    return parsed.success &&
      canonicalJSONStringify(parsed.data) === planJson &&
      computeCanonicalHash(parsed.data) === planHash
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function verificationEvidence(
  record: AttemptVerificationRecord,
  receipt: AttemptReceiptRecord | null
): {
  outcome: AttemptVerificationRecord["outcome"];
  resultIdentity?: string;
  trustGapCount: number;
  artifactRefs: string[];
} | null {
  try {
    const parsed = AgentEngineVerification_v2.safeParse(
      JSON.parse(record.verificationJson) as unknown
    );
    if (
      !parsed.success ||
      canonicalJSONStringify(parsed.data) !== record.verificationJson ||
      computeCanonicalHash(parsed.data) !== record.verificationHash ||
      parsed.data.verification_id !== record.verificationId ||
      parsed.data.attempt_id !== record.attemptId ||
      parsed.data.receipt_id !== record.receiptId ||
      parsed.data.receipt_hash !== record.receiptHash ||
      parsed.data.outcome !== record.outcome ||
      parsed.data.verified_patch_hash !== record.verifiedPatchHash ||
      parsed.data.verified_head_sha !== record.verifiedHeadSha ||
      canonicalJSONStringify(parsed.data.trust_gap_reasons) !==
        canonicalJSONStringify(record.trustGapReasons) ||
      receipt?.receiptId !== parsed.data.receipt_id ||
      receipt?.receiptHash !== parsed.data.receipt_hash
    ) {
      return null;
    }
    return {
      outcome: parsed.data.outcome,
      ...(parsed.data.verified_patch_hash || parsed.data.verified_head_sha
        ? { resultIdentity: parsed.data.verified_patch_hash ?? parsed.data.verified_head_sha }
        : {}),
      trustGapCount: parsed.data.trust_gap_reasons.length,
      artifactRefs: [
        ...new Set(parsed.data.checks.flatMap(({ artifact_refs }) => artifact_refs)),
      ].sort(),
    };
  } catch {
    return null;
  }
}

function fanInSummary(
  outcome: AgentWorkFanInDecision_v1["decision"],
  candidateCount: number
): string {
  if (outcome === "selected") {
    return `Strict engine fan-in selected one of ${candidateCount} bounded candidates.`;
  }
  if (outcome === "no_viable_candidate") {
    return `Strict engine fan-in found no viable candidate among ${candidateCount} attempts.`;
  }
  return `Strict engine fan-in escalated ${candidateCount} candidates for unresolved evidence.`;
}

function compactResult(
  decision: AgentWorkFanInDecision_v1,
  idempotentReplay: boolean,
  diagnostics: boolean
): AgentWorkFanInResult {
  return {
    recorded: true,
    decisionId: decision.decision_id,
    outcome: decision.decision,
    ...(decision.selected_attempt_id ? { selectedAttemptId: decision.selected_attempt_id } : {}),
    candidateCount: decision.candidates.length,
    evidenceSetHash: decision.evidence_set_hash,
    idempotentReplay,
    ...(diagnostics
      ? {
          diagnostics: {
            conflicts: decision.conflicts,
            uncertainty: decision.uncertainty,
            summary: decision.summary,
          },
        }
      : {}),
  };
}
