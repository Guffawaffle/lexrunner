import { computeCanonicalHash } from "../schemas/task-contract.js";
import {
  GovernedTaskSpec_v1,
  createGovernedTaskSpec,
  type GovernedTaskSpec_v1 as GovernedTaskSpec,
} from "./governed-task.js";

export const GOVERNED_CODE_REVIEW_PROFILE_ID = "code-review" as const;
export const GOVERNED_CODE_REVIEW_PROFILE_VERSION = "1.0.0" as const;
export const GOVERNED_CODE_REVIEW_VERIFIER_ID = "lexrunner.windows-host-verifier" as const;
export const GOVERNED_CODE_REVIEW_VERIFIER_VERSION = "1.0.0" as const;
export const GOVERNED_CODE_REVIEW_MAX_EVIDENCE_BYTES = 8 * 1_024 * 1_024;
export const GOVERNED_CODE_REVIEW_MAX_TOOL_CALLS = 100;

export const GOVERNED_CODE_REVIEW_INPUT_CONTRACT_HASH = computeCanonicalHash({
  schema_version: GOVERNED_CODE_REVIEW_PROFILE_VERSION,
  profile_id: GOVERNED_CODE_REVIEW_PROFILE_ID,
  fields: ["sealed_corpus_scope_hash", "prompt_hash", "output_contract_hash"],
  corpus_access: "read_only",
  refusal: "uncoerced_no",
});

export const GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "BLOCK"] },
    findings: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "file", "line", "message"],
        properties: {
          severity: { type: "string", enum: ["blocking", "advisory"] },
          file: { type: "string", minLength: 1, maxLength: 256 },
          line: { type: "integer", minimum: 1 },
          message: { type: "string", minLength: 1, maxLength: 2_048 },
        },
      },
    },
  },
} satisfies Record<string, unknown>);

export const GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH = computeCanonicalHash(
  GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA
);

export interface GovernedCodeReviewCorpusIdentity {
  repositoryId: string;
  baseObjectId: string;
  candidateObjectId: string;
  corpusHash: string;
  selectionHash: string;
}

export function computeGovernedCodeReviewCorpusScopeHash(
  identity: GovernedCodeReviewCorpusIdentity
): string {
  return computeCanonicalHash({
    kind: "governed-code-review-sealed-corpus",
    repository_id: identity.repositoryId,
    base_object_id: identity.baseObjectId,
    candidate_object_id: identity.candidateObjectId,
    corpus_hash: identity.corpusHash,
    selection_hash: identity.selectionHash,
  });
}

export function computeGovernedCodeReviewInputBindingHash(input: {
  promptHash: string;
  corpusScopeHash: string;
  outputContractHash?: string;
}): string {
  return computeCanonicalHash({
    schema_version: GOVERNED_CODE_REVIEW_PROFILE_VERSION,
    prompt_hash: input.promptHash,
    sealed_corpus_scope_hash: input.corpusScopeHash,
    output_contract_hash: input.outputContractHash ?? GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH,
  });
}

export interface CreateGovernedCodeReviewTaskInput {
  attemptId: string;
  delegationId: string;
  objectiveHash: string;
  authorizedModelProvider: string;
  promptHash: string;
  corpusScopeHash: string;
  maxDurationMs: number;
  maxOutputBytes: number;
  maxEvidenceBytes?: number;
  maxToolCalls?: number;
}

/** Review-specific semantics expressed entirely as one generic governed task profile. */
export function createGovernedCodeReviewTaskSpec(
  input: CreateGovernedCodeReviewTaskInput
): GovernedTaskSpec {
  return createGovernedTaskSpec({
    schema_version: "1.0.0",
    attempt_id: input.attemptId,
    delegation_id: input.delegationId,
    objective_hash: input.objectiveHash,
    authorized_model_provider: input.authorizedModelProvider,
    profile: {
      profile_id: GOVERNED_CODE_REVIEW_PROFILE_ID,
      profile_version: GOVERNED_CODE_REVIEW_PROFILE_VERSION,
      input_contract_hash: GOVERNED_CODE_REVIEW_INPUT_CONTRACT_HASH,
      output_contract_hash: GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH,
      verifier_id: GOVERNED_CODE_REVIEW_VERIFIER_ID,
      verifier_version: GOVERNED_CODE_REVIEW_VERIFIER_VERSION,
    },
    input_binding_hash: computeGovernedCodeReviewInputBindingHash({
      promptHash: input.promptHash,
      corpusScopeHash: input.corpusScopeHash,
    }),
    capability_ceiling: [
      {
        dimension: "filesystem_read",
        capability_id: "read-sealed-review-corpus",
        scope_hash: input.corpusScopeHash,
        minimum_enforcement: "enforced",
        effect: { class: "observation" },
      },
    ],
    budget: {
      max_duration_ms: input.maxDurationMs,
      max_output_bytes: input.maxOutputBytes,
      max_evidence_bytes: input.maxEvidenceBytes ?? GOVERNED_CODE_REVIEW_MAX_EVIDENCE_BYTES,
      max_tool_calls: input.maxToolCalls ?? GOVERNED_CODE_REVIEW_MAX_TOOL_CALLS,
    },
  });
}

export function governedCodeReviewTaskMatches(
  candidate: unknown,
  expected: CreateGovernedCodeReviewTaskInput
): boolean {
  const task = GovernedTaskSpec_v1.safeParse(candidate);
  if (!task.success) return false;
  return task.data.task_spec_hash === createGovernedCodeReviewTaskSpec(expected).task_spec_hash;
}
