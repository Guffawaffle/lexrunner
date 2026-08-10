import { computeCanonicalHash } from "../schemas/task-contract.js";
import { WorkerAdapterManifest_v1 } from "./agent-work-worker-runtime.js";
import { DelegatedAuthorityGrant_v1 } from "./governed-attempt-protocol.js";
import {
  GovernedTaskSpec_v1,
  createGovernedTaskAdapterQualification,
  createGovernedTaskCapabilityEnforcementReceipt,
  createGovernedTaskExecutionBinding,
  createGovernedTaskSpec,
  type GovernedTaskExecutionBinding_v1 as GovernedTaskExecutionBinding,
  type GovernedTaskSpec_v1 as GovernedTaskSpec,
} from "./governed-task.js";

export const GOVERNED_CODE_REVIEW_PROFILE_ID = "code-review" as const;
export const GOVERNED_CODE_REVIEW_PROFILE_VERSION = "1.0.0" as const;
export const GOVERNED_CODE_REVIEW_VERIFIER_ID = "lexrunner.windows-host-verifier" as const;
export const GOVERNED_CODE_REVIEW_VERIFIER_VERSION = "1.0.0" as const;
export const GOVERNED_CODE_REVIEW_MAX_EVIDENCE_BYTES = 8 * 1_024 * 1_024;
export const GOVERNED_CODE_REVIEW_MAX_TOOL_CALLS = 100;
export const GOVERNED_CODE_REVIEW_ADAPTER_ID = "lexrunner.qualified-wsl2-codex" as const;
export const GOVERNED_CODE_REVIEW_ADAPTER_VERSION = "1.0.0" as const;
export const GOVERNED_CODE_REVIEW_OPERATOR_PRINCIPAL_ID =
  "lexrunner.governed-review-runtime" as const;

export const GOVERNED_CODE_REVIEW_ADAPTER_MANIFEST = WorkerAdapterManifest_v1.parse({
  schema_version: "1.0.0",
  adapter: {
    id: GOVERNED_CODE_REVIEW_ADAPTER_ID,
    version: GOVERNED_CODE_REVIEW_ADAPTER_VERSION,
    kind: "subprocess",
    session_backend: "codex-cli",
  },
  lifecycle: {
    prepare: true,
    launch: true,
    assisted_attach: false,
    heartbeat: false,
    cancellation: true,
    teardown: true,
    artifact_collection: false,
    receipt_collection: true,
  },
  authority: {
    filesystem_read: "enforced",
    filesystem_write: "unsupported",
    git_write: "unsupported",
    github_write: "unsupported",
    external_runtime: "unsupported",
    network: "unsupported",
    secrets: "unsupported",
    signing: "unsupported",
    release: "unsupported",
    nested_delegation: "unsupported",
  },
  signals: { structured: true, max_bytes: 1 * 1_024 * 1_024 },
  reproducibility: {
    backend_identity: "lexrunner.disposable-wsl2-bwrap-codex",
    backend_version: GOVERNED_CODE_REVIEW_ADAPTER_VERSION,
  },
});

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

export interface CreateGovernedCodeReviewTaskExecutionInput {
  task: GovernedTaskSpec;
  authorizedAt: string;
  expiresAt: string;
  executorAttestationHash: string;
  environmentAttestationHash: string;
  workspaceAttestationHash: string;
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

/** Build the protected generic grant and qualified-adapter records for one review task. */
export function createGovernedCodeReviewTaskExecutionBinding(
  input: CreateGovernedCodeReviewTaskExecutionInput
): GovernedTaskExecutionBinding {
  const task = GovernedTaskSpec_v1.parse(input.task);
  const grant = DelegatedAuthorityGrant_v1.parse({
    schema_version: "1.0.0",
    grant_id: `grant-${task.delegation_id}`,
    attempt_id: task.attempt_id,
    delegation_id: task.delegation_id,
    issuer: {
      kind: "operator",
      principal_id: GOVERNED_CODE_REVIEW_OPERATOR_PRINCIPAL_ID,
    },
    capabilities: task.capability_ceiling.map(({ dimension, capability_id, scope_hash }) => ({
      dimension,
      capability_id,
      scope_hash,
    })),
    issued_at: input.authorizedAt,
    not_before: input.authorizedAt,
    expires_at: input.expiresAt,
  });
  const manifestHash = computeCanonicalHash(GOVERNED_CODE_REVIEW_ADAPTER_MANIFEST);
  const qualificationEvidenceHash = computeCanonicalHash({
    kind: "governed-code-review-qualified-adapter",
    task_spec_hash: task.task_spec_hash,
    executor_attestation_hash: input.executorAttestationHash,
    environment_attestation_hash: input.environmentAttestationHash,
    workspace_attestation_hash: input.workspaceAttestationHash,
  });
  const qualification = createGovernedTaskAdapterQualification({
    schema_version: "1.0.0",
    qualification_id: `qualification-${task.delegation_id}`,
    adapter_id: GOVERNED_CODE_REVIEW_ADAPTER_ID,
    adapter_version: GOVERNED_CODE_REVIEW_ADAPTER_VERSION,
    manifest_hash: manifestHash,
    qualification_profile_id: "governed-code-review-read-only",
    qualification_profile_version: GOVERNED_CODE_REVIEW_PROFILE_VERSION,
    evidence_hash: qualificationEvidenceHash,
    decision: "qualified",
    qualified_at: input.authorizedAt,
    expires_at: input.expiresAt,
  });
  const capabilityEnforcements = task.capability_ceiling.map((capability) =>
    createGovernedTaskCapabilityEnforcementReceipt({
      schema_version: "1.0.0",
      receipt_id: `enforcement-${task.delegation_id}-${capability.capability_id}`,
      adapter_id: GOVERNED_CODE_REVIEW_ADAPTER_ID,
      adapter_version: GOVERNED_CODE_REVIEW_ADAPTER_VERSION,
      manifest_hash: manifestHash,
      qualification_hash: qualification.qualification_hash,
      capability_hash: computeCanonicalHash(capability),
      dimension: capability.dimension,
      scope_hash: capability.scope_hash,
      effect_policy_hash: computeCanonicalHash(capability.effect),
      enforcement: "enforced",
      evidence_hash: computeCanonicalHash({
        qualification_evidence_hash: qualificationEvidenceHash,
        capability_hash: computeCanonicalHash(capability),
      }),
      verified_at: input.authorizedAt,
      expires_at: input.expiresAt,
    })
  );
  return createGovernedTaskExecutionBinding({
    schema_version: "1.0.0",
    task_spec_hash: task.task_spec_hash,
    authority_grant: grant,
    authority_grant_hash: computeCanonicalHash(grant),
    adapter_selection: {
      adapter_id: GOVERNED_CODE_REVIEW_ADAPTER_ID,
      adapter_version: GOVERNED_CODE_REVIEW_ADAPTER_VERSION,
    },
    adapter_resolution: {
      manifest: GOVERNED_CODE_REVIEW_ADAPTER_MANIFEST,
      qualification,
      capability_enforcements: capabilityEnforcements,
    },
  });
}

export type GovernedCodeReviewOutcome = "pass" | "block" | "invalid";

/** Review vocabulary is interpreted only after exact profile/verifier dispatch. */
export function interpretGovernedCodeReviewOutcome(input: {
  task: unknown;
  verifierId: string;
  output: unknown;
  terminalTaskOutcome: unknown;
}):
  | { matched: false }
  | {
      matched: true;
      outputOutcome: GovernedCodeReviewOutcome;
      terminalOutcome?: GovernedCodeReviewOutcome;
    } {
  const task = GovernedTaskSpec_v1.safeParse(input.task);
  if (
    !task.success ||
    input.verifierId !== GOVERNED_CODE_REVIEW_VERIFIER_ID ||
    task.data.profile.profile_id !== GOVERNED_CODE_REVIEW_PROFILE_ID ||
    task.data.profile.profile_version !== GOVERNED_CODE_REVIEW_PROFILE_VERSION ||
    task.data.profile.output_contract_hash !== GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH ||
    task.data.profile.verifier_id !== GOVERNED_CODE_REVIEW_VERIFIER_ID ||
    task.data.profile.verifier_version !== GOVERNED_CODE_REVIEW_VERIFIER_VERSION
  ) {
    return { matched: false };
  }
  const output = isObject(input.output) ? input.output : undefined;
  const verdict = typeof output?.verdict === "string" ? output.verdict : undefined;
  const findings = Array.isArray(output?.findings) ? output.findings : [];
  const hasBlockingFinding = findings.some(
    (finding) => isObject(finding) && finding.severity === "blocking"
  );
  const outputOutcome =
    verdict === "PASS"
      ? hasBlockingFinding
        ? "invalid"
        : "pass"
      : verdict === "BLOCK"
        ? "block"
        : "invalid";
  const terminalOutcome =
    input.terminalTaskOutcome === "pass"
      ? "pass"
      : input.terminalTaskOutcome === "block"
        ? "block"
        : input.terminalTaskOutcome === "invalid"
          ? "invalid"
          : undefined;
  return {
    matched: true,
    outputOutcome,
    ...(terminalOutcome ? { terminalOutcome } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
