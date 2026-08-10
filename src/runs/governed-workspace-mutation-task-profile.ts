import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";
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

export const GOVERNED_WORKSPACE_MUTATION_PROFILE_ID = "workspace-mutation" as const;
export const GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION = "1.0.0" as const;
export const GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID =
  "lexrunner.workspace-mutation-verifier" as const;
export const GOVERNED_WORKSPACE_MUTATION_VERIFIER_VERSION = "1.0.0" as const;
export const GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID =
  "lexrunner.qualified-wsl2-codex-writer" as const;
export const GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION = "1.0.0" as const;
export const GOVERNED_WORKSPACE_MUTATION_OPERATOR_PRINCIPAL_ID =
  "lexrunner.workspace-mutation-runtime" as const;
export const GOVERNED_WORKSPACE_MUTATION_MAX_EVIDENCE_BYTES = 16 * 1_024 * 1_024;
export const GOVERNED_WORKSPACE_MUTATION_MAX_TOOL_CALLS = 200;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });

export const GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST = WorkerAdapterManifest_v1.parse({
  schema_version: "1.0.0",
  adapter: {
    id: GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID,
    version: GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION,
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
    artifact_collection: true,
    receipt_collection: true,
  },
  authority: {
    filesystem_read: "enforced",
    filesystem_write: "enforced",
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
    backend_identity: "lexrunner.disposable-wsl2-bwrap-codex-writer",
    backend_version: GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION,
  },
});

export const GOVERNED_WORKSPACE_MUTATION_INPUT_CONTRACT_HASH = computeCanonicalHash({
  schema_version: GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION,
  profile_id: GOVERNED_WORKSPACE_MUTATION_PROFILE_ID,
  fields: [
    "prompt_hash",
    "source_manifest_hash",
    "workspace_read_scope_hash",
    "writable_path_set_hash",
    "ownership_scope_hash",
    "rollback_binding_hash",
    "output_contract_hash",
  ],
  mutation_evidence: "independent_pre_post_manifest_and_patch",
  refusal: "uncoerced_no",
});

export const GOVERNED_WORKSPACE_MUTATION_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["result", "summary"],
  properties: {
    result: { type: "string", enum: ["CHANGED", "UNCHANGED"] },
    summary: { type: "string", minLength: 1, maxLength: 4_096 },
  },
} satisfies Record<string, unknown>);

export const GOVERNED_WORKSPACE_MUTATION_OUTPUT_CONTRACT_HASH = computeCanonicalHash(
  GOVERNED_WORKSPACE_MUTATION_OUTPUT_SCHEMA
);

export const GovernedWorkspaceMutationQualificationControlId_v1 = z.enum([
  "attempt_owned_writable_root",
  "authorized_scope_write_succeeds",
  "outside_scope_write_denied",
  "host_roots_absent",
  "credential_roots_absent",
  "network_denied",
  "before_after_identity_captured",
  "independent_recovery_controller",
  "rollback_after_cancellation",
  "descendant_reaping",
  "degraded_launch_denied",
]);
export type GovernedWorkspaceMutationQualificationControlId_v1 = z.infer<
  typeof GovernedWorkspaceMutationQualificationControlId_v1
>;

const qualificationControl = z
  .object({
    control: GovernedWorkspaceMutationQualificationControlId_v1,
    status: z.literal("enforced"),
    strength: z.literal("independently_enforced_verified"),
    evidence_refs: z.array(SHA256Hash).min(1).max(16),
    enforcement_owner: opaqueId,
  })
  .strict();

const workspaceMutationQualificationEvidenceBody = z
  .object({
    schema_version: z.literal(GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION),
    qualification_id: opaqueId,
    adapter_id: z.literal(GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID),
    adapter_version: z.literal(GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION),
    adapter_manifest_hash: SHA256Hash,
    environment_id: opaqueId,
    provider_image_hash: SHA256Hash,
    execution_profile_hash: SHA256Hash,
    controls: z
      .array(qualificationControl)
      .length(GovernedWorkspaceMutationQualificationControlId_v1.options.length),
    qualified_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine((evidence, context) => {
    requireExactQualificationControls(evidence.controls, context);
    if (
      evidence.adapter_manifest_hash !==
      computeCanonicalHash(GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST)
    ) {
      context.addIssue({
        code: "custom",
        path: ["adapter_manifest_hash"],
        message: "qualification evidence must bind the exact writer adapter manifest",
      });
    }
    if (Date.parse(evidence.qualified_at) >= Date.parse(evidence.expires_at)) {
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "qualification expiry must follow its observation",
      });
    }
  });

export const GovernedWorkspaceMutationQualificationEvidence_v1 =
  workspaceMutationQualificationEvidenceBody
    .extend({ evidence_hash: SHA256Hash })
    .strict()
    .superRefine((evidence, context) => {
      const { evidence_hash: _evidenceHash, ...body } = evidence;
      if (computeCanonicalHash(body) !== evidence.evidence_hash) {
        context.addIssue({
          code: "custom",
          path: ["evidence_hash"],
          message: "qualification evidence hash does not match its canonical body",
        });
      }
    });
export type GovernedWorkspaceMutationQualificationEvidence_v1 = z.infer<
  typeof GovernedWorkspaceMutationQualificationEvidence_v1
>;

export function createGovernedWorkspaceMutationQualificationEvidence(
  candidate: z.input<typeof workspaceMutationQualificationEvidenceBody>
): GovernedWorkspaceMutationQualificationEvidence_v1 {
  const body = workspaceMutationQualificationEvidenceBody.parse(candidate);
  return GovernedWorkspaceMutationQualificationEvidence_v1.parse({
    ...body,
    evidence_hash: computeCanonicalHash(body),
  });
}

const preparedWorkspaceEvidenceBody = z
  .object({
    schema_version: z.literal(GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION),
    attempt_id: opaqueId,
    task_spec_hash: SHA256Hash,
    environment_id: opaqueId,
    workspace_id: opaqueId,
    writable_root_identity_hash: SHA256Hash,
    prompt_hash: SHA256Hash,
    source_manifest_hash: SHA256Hash,
    before_filesystem_manifest_hash: SHA256Hash,
    before_git_identity_hash: SHA256Hash,
    workspace_read_scope_hash: SHA256Hash,
    writable_path_set_hash: SHA256Hash,
    ownership_scope_hash: SHA256Hash,
    rollback: z
      .object({
        strategy: z.literal("discard_workspace"),
        binding_hash: SHA256Hash,
        controller_id: opaqueId,
        controller_executable_hash: SHA256Hash,
        controller_authority: z.literal("separate_process"),
        state: z.literal("prepared"),
        evidence_refs: z.array(SHA256Hash).min(1).max(16),
      })
      .strict(),
    evidence_refs: z.array(SHA256Hash).min(1).max(32),
    observed_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (Date.parse(evidence.observed_at) >= Date.parse(evidence.expires_at)) {
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "prepared workspace evidence expiry must follow its observation",
      });
    }
  });

export const GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1 = preparedWorkspaceEvidenceBody
  .extend({ evidence_hash: SHA256Hash })
  .strict()
  .superRefine((evidence, context) => {
    const { evidence_hash: _evidenceHash, ...body } = evidence;
    if (computeCanonicalHash(body) !== evidence.evidence_hash) {
      context.addIssue({
        code: "custom",
        path: ["evidence_hash"],
        message: "prepared workspace evidence hash does not match its canonical body",
      });
    }
  });
export type GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1 = z.infer<
  typeof GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1
>;

export function createGovernedWorkspaceMutationPreparedWorkspaceEvidence(
  candidate: z.input<typeof preparedWorkspaceEvidenceBody>
): GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1 {
  const body = preparedWorkspaceEvidenceBody.parse(candidate);
  return GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1.parse({
    ...body,
    evidence_hash: computeCanonicalHash(body),
  });
}

export interface CreateGovernedWorkspaceMutationTaskInput {
  attemptId: string;
  delegationId: string;
  objectiveHash: string;
  authorizedModelProvider: string;
  promptHash: string;
  sourceManifestHash: string;
  workspaceReadScopeHash: string;
  writablePathSetHash: string;
  ownershipScopeHash: string;
  rollbackBindingHash: string;
  maxDurationMs: number;
  maxOutputBytes: number;
  maxEvidenceBytes?: number;
  maxToolCalls?: number;
}

export interface CreateGovernedWorkspaceMutationTaskExecutionInput {
  task: GovernedTaskSpec;
  authorizedAt: string;
  expiresAt: string;
  qualificationEvidence: GovernedWorkspaceMutationQualificationEvidence_v1;
  preparedWorkspaceEvidence: GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1;
}

export function computeGovernedWorkspaceMutationInputBindingHash(input: {
  promptHash: string;
  sourceManifestHash: string;
  workspaceReadScopeHash: string;
  writablePathSetHash: string;
  ownershipScopeHash: string;
  rollbackBindingHash: string;
  outputContractHash?: string;
}): string {
  return computeCanonicalHash({
    schema_version: GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION,
    prompt_hash: input.promptHash,
    source_manifest_hash: input.sourceManifestHash,
    workspace_read_scope_hash: input.workspaceReadScopeHash,
    writable_path_set_hash: input.writablePathSetHash,
    ownership_scope_hash: input.ownershipScopeHash,
    rollback_binding_hash: input.rollbackBindingHash,
    output_contract_hash:
      input.outputContractHash ?? GOVERNED_WORKSPACE_MUTATION_OUTPUT_CONTRACT_HASH,
  });
}

/** One non-review task profile with a real, recoverable filesystem-write ceiling. */
export function createGovernedWorkspaceMutationTaskSpec(
  input: CreateGovernedWorkspaceMutationTaskInput
): GovernedTaskSpec {
  return createGovernedTaskSpec({
    schema_version: "1.0.0",
    attempt_id: input.attemptId,
    delegation_id: input.delegationId,
    objective_hash: input.objectiveHash,
    authorized_model_provider: input.authorizedModelProvider,
    profile: {
      profile_id: GOVERNED_WORKSPACE_MUTATION_PROFILE_ID,
      profile_version: GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION,
      input_contract_hash: GOVERNED_WORKSPACE_MUTATION_INPUT_CONTRACT_HASH,
      output_contract_hash: GOVERNED_WORKSPACE_MUTATION_OUTPUT_CONTRACT_HASH,
      verifier_id: GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
      verifier_version: GOVERNED_WORKSPACE_MUTATION_VERIFIER_VERSION,
    },
    input_binding_hash: computeGovernedWorkspaceMutationInputBindingHash(input),
    capability_ceiling: [
      {
        dimension: "filesystem_read",
        capability_id: "read-owned-workspace",
        scope_hash: input.workspaceReadScopeHash,
        minimum_enforcement: "enforced",
        effect: { class: "observation" },
      },
      {
        dimension: "filesystem_write",
        capability_id: "write-authorized-paths",
        scope_hash: input.writablePathSetHash,
        minimum_enforcement: "enforced",
        effect: {
          class: "workspace_mutation",
          ownership_scope_hash: input.ownershipScopeHash,
          rollback: {
            strategy: "discard_workspace",
            binding_hash: input.rollbackBindingHash,
          },
        },
      },
    ],
    budget: {
      max_duration_ms: input.maxDurationMs,
      max_output_bytes: input.maxOutputBytes,
      max_evidence_bytes: input.maxEvidenceBytes ?? GOVERNED_WORKSPACE_MUTATION_MAX_EVIDENCE_BYTES,
      max_tool_calls: input.maxToolCalls ?? GOVERNED_WORKSPACE_MUTATION_MAX_TOOL_CALLS,
    },
  });
}

/**
 * A write receipt cannot be constructed from adapter metadata alone. It needs
 * both a live image qualification and task-specific prepared-workspace proof.
 */
export function createGovernedWorkspaceMutationTaskExecutionBinding(
  input: CreateGovernedWorkspaceMutationTaskExecutionInput
): GovernedTaskExecutionBinding {
  const task = GovernedTaskSpec_v1.parse(input.task);
  const qualificationEvidence = GovernedWorkspaceMutationQualificationEvidence_v1.parse(
    input.qualificationEvidence
  );
  const prepared = GovernedWorkspaceMutationPreparedWorkspaceEvidence_v1.parse(
    input.preparedWorkspaceEvidence
  );
  const authorizedAt = Date.parse(input.authorizedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(authorizedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= authorizedAt ||
    Date.parse(qualificationEvidence.qualified_at) > authorizedAt ||
    Date.parse(qualificationEvidence.expires_at) < expiresAt ||
    Date.parse(prepared.observed_at) < Date.parse(qualificationEvidence.qualified_at) ||
    Date.parse(prepared.observed_at) > authorizedAt ||
    Date.parse(prepared.expires_at) < expiresAt
  ) {
    throw new Error("workspace mutation qualification or prepared workspace is not active");
  }
  if (
    task.profile.profile_id !== GOVERNED_WORKSPACE_MUTATION_PROFILE_ID ||
    task.profile.profile_version !== GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION ||
    task.profile.input_contract_hash !== GOVERNED_WORKSPACE_MUTATION_INPUT_CONTRACT_HASH ||
    task.profile.output_contract_hash !== GOVERNED_WORKSPACE_MUTATION_OUTPUT_CONTRACT_HASH ||
    task.profile.verifier_id !== GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID ||
    task.input_binding_hash !==
      computeGovernedWorkspaceMutationInputBindingHash({
        promptHash: prepared.prompt_hash,
        sourceManifestHash: prepared.source_manifest_hash,
        workspaceReadScopeHash: prepared.workspace_read_scope_hash,
        writablePathSetHash: prepared.writable_path_set_hash,
        ownershipScopeHash: prepared.ownership_scope_hash,
        rollbackBindingHash: prepared.rollback.binding_hash,
      }) ||
    prepared.attempt_id !== task.attempt_id ||
    prepared.task_spec_hash !== task.task_spec_hash ||
    prepared.environment_id !== qualificationEvidence.environment_id
  ) {
    throw new Error("workspace mutation task and protected evidence do not align");
  }
  const readCapability = task.capability_ceiling.find(
    ({ capability_id: capabilityId }) => capabilityId === "read-owned-workspace"
  );
  const writeCapability = task.capability_ceiling.find(
    ({ capability_id: capabilityId }) => capabilityId === "write-authorized-paths"
  );
  if (
    !readCapability ||
    readCapability.dimension !== "filesystem_read" ||
    readCapability.scope_hash !== prepared.workspace_read_scope_hash ||
    !writeCapability ||
    writeCapability.dimension !== "filesystem_write" ||
    writeCapability.scope_hash !== prepared.writable_path_set_hash ||
    writeCapability.effect.class !== "workspace_mutation" ||
    writeCapability.effect.ownership_scope_hash !== prepared.ownership_scope_hash ||
    writeCapability.effect.rollback.strategy !== prepared.rollback.strategy ||
    writeCapability.effect.rollback.binding_hash !== prepared.rollback.binding_hash
  ) {
    throw new Error("prepared workspace does not enforce the task capability ceiling");
  }

  const grant = DelegatedAuthorityGrant_v1.parse({
    schema_version: "1.0.0",
    grant_id: `grant-${task.delegation_id}`,
    attempt_id: task.attempt_id,
    delegation_id: task.delegation_id,
    issuer: {
      kind: "operator",
      principal_id: GOVERNED_WORKSPACE_MUTATION_OPERATOR_PRINCIPAL_ID,
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
  const manifestHash = computeCanonicalHash(GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST);
  const qualification = createGovernedTaskAdapterQualification({
    schema_version: "1.0.0",
    qualification_id: qualificationEvidence.qualification_id,
    adapter_id: GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID,
    adapter_version: GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION,
    manifest_hash: manifestHash,
    qualification_profile_id: "governed-workspace-mutation-live-canaries",
    qualification_profile_version: GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION,
    evidence_hash: qualificationEvidence.evidence_hash,
    decision: "qualified",
    qualified_at: qualificationEvidence.qualified_at,
    expires_at: qualificationEvidence.expires_at,
  });
  const capabilityEnforcements = task.capability_ceiling.map((capability) =>
    createGovernedTaskCapabilityEnforcementReceipt({
      schema_version: "1.0.0",
      receipt_id: `enforcement-${task.delegation_id}-${capability.capability_id}`,
      adapter_id: GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID,
      adapter_version: GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION,
      manifest_hash: manifestHash,
      qualification_hash: qualification.qualification_hash,
      capability_hash: computeCanonicalHash(capability),
      dimension: capability.dimension,
      scope_hash: capability.scope_hash,
      effect_policy_hash: computeCanonicalHash(capability.effect),
      enforcement: "enforced",
      evidence_hash: computeCanonicalHash({
        qualification_evidence_hash: qualificationEvidence.evidence_hash,
        prepared_workspace_evidence_hash: prepared.evidence_hash,
        capability_hash: computeCanonicalHash(capability),
      }),
      verified_at: prepared.observed_at,
      expires_at: prepared.expires_at,
    })
  );
  return createGovernedTaskExecutionBinding({
    schema_version: "1.0.0",
    task_spec_hash: task.task_spec_hash,
    authority_grant: grant,
    authority_grant_hash: computeCanonicalHash(grant),
    adapter_selection: {
      adapter_id: GOVERNED_WORKSPACE_MUTATION_ADAPTER_ID,
      adapter_version: GOVERNED_WORKSPACE_MUTATION_ADAPTER_VERSION,
    },
    adapter_resolution: {
      manifest: GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST,
      qualification,
      capability_enforcements: capabilityEnforcements,
    },
  });
}

export type GovernedWorkspaceMutationOutcome = "changed" | "unchanged" | "invalid";

/** Task-quality vocabulary only; mutation evidence still decides admissibility separately. */
export function interpretGovernedWorkspaceMutationOutcome(input: {
  task: unknown;
  verifierId: string;
  output: unknown;
  terminalTaskOutcome: unknown;
}):
  | { matched: false }
  | {
      matched: true;
      outputOutcome: GovernedWorkspaceMutationOutcome;
      terminalOutcome?: GovernedWorkspaceMutationOutcome;
    } {
  const task = GovernedTaskSpec_v1.safeParse(input.task);
  if (
    !task.success ||
    input.verifierId !== GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID ||
    task.data.profile.profile_id !== GOVERNED_WORKSPACE_MUTATION_PROFILE_ID ||
    task.data.profile.profile_version !== GOVERNED_WORKSPACE_MUTATION_PROFILE_VERSION ||
    task.data.profile.output_contract_hash !== GOVERNED_WORKSPACE_MUTATION_OUTPUT_CONTRACT_HASH ||
    task.data.profile.verifier_id !== GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID ||
    task.data.profile.verifier_version !== GOVERNED_WORKSPACE_MUTATION_VERIFIER_VERSION
  ) {
    return { matched: false };
  }
  const output = isObject(input.output) ? input.output : undefined;
  const outputOutcome =
    output?.result === "CHANGED"
      ? "changed"
      : output?.result === "UNCHANGED"
        ? "unchanged"
        : "invalid";
  const terminalOutcome =
    input.terminalTaskOutcome === "changed"
      ? "changed"
      : input.terminalTaskOutcome === "unchanged"
        ? "unchanged"
        : input.terminalTaskOutcome === "invalid"
          ? "invalid"
          : undefined;
  return {
    matched: true,
    outputOutcome,
    ...(terminalOutcome ? { terminalOutcome } : {}),
  };
}

function requireExactQualificationControls(
  controls: readonly { control: GovernedWorkspaceMutationQualificationControlId_v1 }[],
  context: z.RefinementCtx
): void {
  const actual = new Set(controls.map(({ control }) => control));
  if (
    actual.size !== GovernedWorkspaceMutationQualificationControlId_v1.options.length ||
    GovernedWorkspaceMutationQualificationControlId_v1.options.some(
      (control) => !actual.has(control)
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["controls"],
      message: "every workspace mutation qualification control must appear exactly once",
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
