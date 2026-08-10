import { z } from "zod";

import { SHA256Hash, computeCanonicalHash } from "../schemas/task-contract.js";
import {
  DelegatedAuthorityGrant_v1,
  type DelegatedAuthorityCapability_v1,
  computeAuthorityGrantHash,
  evaluateDelegatedAuthorityContainment,
} from "./governed-attempt-protocol.js";
import {
  WorkerAdapterAuthorityDimension,
  WorkerAdapterManifest_v1,
} from "./agent-work-worker-runtime.js";

export const GOVERNED_TASK_CONTRACT_VERSION = "1.0.0" as const;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const semanticVersion = z
  .string()
  .min(5)
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, "Must be a semantic version");

export const GovernedTaskProfileBinding_v1 = z
  .object({
    profile_id: opaqueId,
    profile_version: semanticVersion,
    input_contract_hash: SHA256Hash,
    output_contract_hash: SHA256Hash,
    verifier_id: opaqueId,
    verifier_version: semanticVersion,
  })
  .strict();
export type GovernedTaskProfileBinding_v1 = z.infer<typeof GovernedTaskProfileBinding_v1>;

const WorkspaceMutationEffect = z
  .object({
    class: z.literal("workspace_mutation"),
    ownership_scope_hash: SHA256Hash,
    rollback: z
      .object({
        strategy: z.enum(["discard_workspace", "restore_snapshot"]),
        binding_hash: SHA256Hash,
      })
      .strict(),
  })
  .strict();

const ExternalEffectRecovery = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("compensating_action"),
      binding_hash: SHA256Hash,
    })
    .strict(),
  z
    .object({
      mode: z.literal("irreversible"),
      consequence_acceptance_hash: SHA256Hash,
    })
    .strict(),
]);

export const GovernedTaskCapabilityEffect_v1 = z.discriminatedUnion("class", [
  z.object({ class: z.literal("observation") }).strict(),
  WorkspaceMutationEffect,
  z
    .object({
      class: z.literal("external_effect"),
      consequence_scope_hash: SHA256Hash,
      recovery: ExternalEffectRecovery,
    })
    .strict(),
  z
    .object({
      class: z.literal("runtime_execution"),
      containment_profile_hash: SHA256Hash,
    })
    .strict(),
  z
    .object({
      class: z.literal("sensitive_data_access"),
      secret_scope_hash: SHA256Hash,
      handling_policy_hash: SHA256Hash,
    })
    .strict(),
  z
    .object({
      class: z.literal("delegation"),
      child_authority_ceiling_hash: SHA256Hash,
    })
    .strict(),
]);
export type GovernedTaskCapabilityEffect_v1 = z.infer<typeof GovernedTaskCapabilityEffect_v1>;

type GovernedTaskCapabilityEffectClass = GovernedTaskCapabilityEffect_v1["class"];

const allowedEffectClasses = {
  filesystem_read: ["observation"],
  filesystem_write: ["workspace_mutation"],
  git_write: ["workspace_mutation", "external_effect"],
  github_write: ["external_effect"],
  external_runtime: ["runtime_execution"],
  network: ["external_effect"],
  secrets: ["sensitive_data_access"],
  signing: ["external_effect"],
  release: ["external_effect"],
  nested_delegation: ["delegation"],
} as const satisfies Record<
  z.infer<typeof WorkerAdapterAuthorityDimension>,
  readonly GovernedTaskCapabilityEffectClass[]
>;

export const GovernedTaskCapability_v1 = z
  .object({
    dimension: WorkerAdapterAuthorityDimension,
    capability_id: opaqueId,
    scope_hash: SHA256Hash,
    minimum_enforcement: z.enum(["enforced", "brokered"]),
    effect: GovernedTaskCapabilityEffect_v1,
  })
  .strict()
  .superRefine((capability, context) => {
    const allowed: readonly GovernedTaskCapabilityEffectClass[] =
      allowedEffectClasses[capability.dimension];
    if (!allowed.includes(capability.effect.class)) {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: `${capability.dimension} must declare one of: ${allowed.join(", ")}`,
      });
    }
  });
export type GovernedTaskCapability_v1 = z.infer<typeof GovernedTaskCapability_v1>;

export const GovernedTaskBudget_v1 = z
  .object({
    max_duration_ms: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000),
    max_output_bytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1_024 * 1_024),
    max_evidence_bytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1_024 * 1_024),
    max_tool_calls: z.number().int().positive().max(10_000),
  })
  .strict();
export type GovernedTaskBudget_v1 = z.infer<typeof GovernedTaskBudget_v1>;

const governedTaskSpecBody = z
  .object({
    schema_version: z.literal(GOVERNED_TASK_CONTRACT_VERSION),
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    objective_hash: SHA256Hash,
    authorized_model_provider: opaqueId,
    profile: GovernedTaskProfileBinding_v1,
    input_binding_hash: SHA256Hash,
    capability_ceiling: z.array(GovernedTaskCapability_v1).max(32),
    budget: GovernedTaskBudget_v1,
  })
  .strict()
  .superRefine((spec, context) => {
    const ids = spec.capability_ceiling.map(({ capability_id: id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["capability_ceiling"],
        message: "capability_id values must be unique within the task ceiling",
      });
    }
    const sorted = [...ids].sort(compareCanonicalStrings);
    if (ids.some((id, index) => id !== sorted[index])) {
      context.addIssue({
        code: "custom",
        path: ["capability_ceiling"],
        message: "capability ceiling must be sorted by capability_id",
      });
    }
  });

export const GovernedTaskSpecHashInput_v1 = governedTaskSpecBody;
export type GovernedTaskSpecHashInput_v1 = z.infer<typeof GovernedTaskSpecHashInput_v1>;

export const GovernedTaskSpec_v1 = governedTaskSpecBody
  .extend({ task_spec_hash: SHA256Hash })
  .strict()
  .superRefine((spec, context) => {
    const { task_spec_hash: _taskSpecHash, ...body } = spec;
    if (computeCanonicalHash(body) !== spec.task_spec_hash) {
      context.addIssue({
        code: "custom",
        path: ["task_spec_hash"],
        message: "task spec hash does not match its canonical body",
      });
    }
  });
export type GovernedTaskSpec_v1 = z.infer<typeof GovernedTaskSpec_v1>;

export function createGovernedTaskSpec(
  candidate: GovernedTaskSpecHashInput_v1
): GovernedTaskSpec_v1 {
  const parsed = GovernedTaskSpecHashInput_v1.parse({
    ...candidate,
    capability_ceiling: [...candidate.capability_ceiling].sort((left, right) =>
      compareCanonicalStrings(left.capability_id, right.capability_id)
    ),
  });
  return GovernedTaskSpec_v1.parse({
    ...parsed,
    task_spec_hash: computeCanonicalHash(parsed),
  });
}

export type GovernedTaskGrantEvaluation =
  | {
      permitted: true;
      taskSpecHash: string;
      capabilities: GovernedTaskCapability_v1[];
    }
  | {
      permitted: false;
      reason:
        | "invalid_authority_selection"
        | "authority_unavailable"
        | "grant_not_active"
        | "identity_mismatch"
        | "invalid_grant_chain"
        | "capability_expansion";
    };

export type GovernedTaskAdapterEvaluation =
  | Extract<GovernedTaskGrantEvaluation, { permitted: false }>
  | {
      permitted: false;
      reason: "invalid_adapter" | "adapter_unqualified" | "enforcement_unavailable";
      blockedCapabilityIds?: string[];
    }
  | Extract<GovernedTaskGrantEvaluation, { permitted: true }>;

const GovernedTaskAdapterSelection_v1 = z
  .object({
    adapter_id: opaqueId,
    adapter_version: z.string().min(1).max(256),
  })
  .strict();

const governedTaskAdapterQualificationBody = z
  .object({
    schema_version: z.literal(GOVERNED_TASK_CONTRACT_VERSION),
    qualification_id: opaqueId,
    adapter_id: opaqueId,
    adapter_version: z.string().min(1).max(256),
    manifest_hash: SHA256Hash,
    qualification_profile_id: opaqueId,
    qualification_profile_version: semanticVersion,
    evidence_hash: SHA256Hash,
    decision: z.literal("qualified"),
    qualified_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((qualification, context) => {
    if (Date.parse(qualification.qualified_at) >= Date.parse(qualification.expires_at)) {
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "qualification expiry must be later than qualification time",
      });
    }
  });

export const GovernedTaskAdapterQualification_v1 = governedTaskAdapterQualificationBody
  .extend({ qualification_hash: SHA256Hash })
  .strict()
  .superRefine((qualification, context) => {
    const { qualification_hash: _qualificationHash, ...body } = qualification;
    if (computeCanonicalHash(body) !== qualification.qualification_hash) {
      context.addIssue({
        code: "custom",
        path: ["qualification_hash"],
        message: "adapter qualification hash does not match its canonical body",
      });
    }
  });
export type GovernedTaskAdapterQualification_v1 = z.infer<
  typeof GovernedTaskAdapterQualification_v1
>;

export function createGovernedTaskAdapterQualification(
  candidate: z.input<typeof governedTaskAdapterQualificationBody>
): GovernedTaskAdapterQualification_v1 {
  const body = governedTaskAdapterQualificationBody.parse(candidate);
  return GovernedTaskAdapterQualification_v1.parse({
    ...body,
    qualification_hash: computeCanonicalHash(body),
  });
}

const GovernedTaskQualifiedAdapterResolution_v1 = z
  .object({
    manifest: WorkerAdapterManifest_v1,
    qualification: GovernedTaskAdapterQualification_v1,
  })
  .strict();

/** Trusted host port; implementations resolve only protected, independently qualified records. */
export interface GovernedTaskAdapterQualificationAuthority {
  resolveQualifiedAdapter(input: {
    adapterId: string;
    adapterVersion: string;
    evaluatedAt: string;
  }): Promise<unknown | null>;
}

export const GovernedTaskAuthoritySelection_v1 = z
  .object({
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    task_spec_hash: SHA256Hash,
    authority_grant_hash: SHA256Hash,
  })
  .strict();
export type GovernedTaskAuthoritySelection_v1 = z.infer<typeof GovernedTaskAuthoritySelection_v1>;

const GovernedTaskAuthorityResolution_v1 = z
  .object({
    task: GovernedTaskSpec_v1,
    grant_chain: z.array(DelegatedAuthorityGrant_v1).min(1).max(32),
  })
  .strict();

/**
 * Trusted host port. Implementations resolve only protected task/grant records and must authorize
 * the root operator issuer before returning a chain. Caller-provided grant bodies are never input.
 */
export interface GovernedTaskGrantAuthority {
  resolveAuthorizedTaskGrant(input: {
    attemptId: string;
    delegationId: string;
    taskSpecHash: string;
    authorityGrantHash: string;
    evaluatedAt: string;
  }): Promise<unknown | null>;
}

/**
 * Resolve protected task/grant authority, verify the complete attenuation chain, and evaluate the
 * selected grant against the task's positive capability ceiling. Absence is denial.
 */
export async function evaluateGovernedTaskGrant(
  authoritySelectionCandidate: unknown,
  grantAuthority: GovernedTaskGrantAuthority,
  evaluatedAt: string
): Promise<GovernedTaskGrantEvaluation> {
  const selection = GovernedTaskAuthoritySelection_v1.safeParse(authoritySelectionCandidate);
  if (!selection.success) return { permitted: false, reason: "invalid_authority_selection" };
  let candidate: unknown | null;
  try {
    candidate = await grantAuthority.resolveAuthorizedTaskGrant({
      attemptId: selection.data.attempt_id,
      delegationId: selection.data.delegation_id,
      taskSpecHash: selection.data.task_spec_hash,
      authorityGrantHash: selection.data.authority_grant_hash,
      evaluatedAt,
    });
  } catch {
    return { permitted: false, reason: "authority_unavailable" };
  }
  if (candidate === null) return { permitted: false, reason: "authority_unavailable" };
  const resolution = GovernedTaskAuthorityResolution_v1.safeParse(candidate);
  if (!resolution.success) return { permitted: false, reason: "authority_unavailable" };
  const { task, grant_chain: grantChain } = resolution.data;
  const grant = grantChain[grantChain.length - 1]!;
  if (
    task.attempt_id !== selection.data.attempt_id ||
    task.delegation_id !== selection.data.delegation_id ||
    task.task_spec_hash !== selection.data.task_spec_hash ||
    grant.attempt_id !== selection.data.attempt_id ||
    grant.delegation_id !== selection.data.delegation_id ||
    computeAuthorityGrantHash(grant) !== selection.data.authority_grant_hash
  ) {
    return { permitted: false, reason: "identity_mismatch" };
  }
  if (grantChain[0]!.issuer.kind !== "operator") {
    return { permitted: false, reason: "invalid_grant_chain" };
  }
  for (let index = 1; index < grantChain.length; index += 1) {
    if (
      !evaluateDelegatedAuthorityContainment(grantChain[index - 1], grantChain[index]).contained
    ) {
      return { permitted: false, reason: "invalid_grant_chain" };
    }
  }
  const evaluationTime = Date.parse(evaluatedAt);
  if (
    !Number.isFinite(evaluationTime) ||
    evaluationTime < Date.parse(grant.not_before) ||
    evaluationTime >= Date.parse(grant.expires_at)
  ) {
    return { permitted: false, reason: "grant_not_active" };
  }

  const ceiling = new Map(
    task.capability_ceiling.map((capability) => [capabilityKey(capability), capability])
  );
  const capabilities: GovernedTaskCapability_v1[] = [];
  for (const granted of grant.capabilities) {
    const permitted = ceiling.get(capabilityKey(granted));
    if (!permitted) return { permitted: false, reason: "capability_expansion" };
    capabilities.push(permitted);
  }
  return {
    permitted: true,
    taskSpecHash: task.task_spec_hash,
    capabilities,
  };
}

/** Resolve a qualified adapter and require it to meet every granted capability's floor. */
export async function evaluateGovernedTaskGrantForAdapter(
  authoritySelectionCandidate: unknown,
  grantAuthority: GovernedTaskGrantAuthority,
  adapterSelectionCandidate: unknown,
  qualificationAuthority: GovernedTaskAdapterQualificationAuthority,
  evaluatedAt: string
): Promise<GovernedTaskAdapterEvaluation> {
  const grant = await evaluateGovernedTaskGrant(
    authoritySelectionCandidate,
    grantAuthority,
    evaluatedAt
  );
  if (!grant.permitted) return grant;
  const selection = GovernedTaskAdapterSelection_v1.safeParse(adapterSelectionCandidate);
  if (!selection.success) return { permitted: false, reason: "invalid_adapter" };
  let candidate: unknown | null;
  try {
    candidate = await qualificationAuthority.resolveQualifiedAdapter({
      adapterId: selection.data.adapter_id,
      adapterVersion: selection.data.adapter_version,
      evaluatedAt,
    });
  } catch {
    return { permitted: false, reason: "adapter_unqualified" };
  }
  if (candidate === null) return { permitted: false, reason: "adapter_unqualified" };
  const resolution = GovernedTaskQualifiedAdapterResolution_v1.safeParse(candidate);
  if (!resolution.success) return { permitted: false, reason: "adapter_unqualified" };
  const { manifest: adapter, qualification } = resolution.data;
  const evaluationTime = Date.parse(evaluatedAt);
  if (
    adapter.adapter.id !== selection.data.adapter_id ||
    adapter.adapter.version !== selection.data.adapter_version ||
    qualification.adapter_id !== selection.data.adapter_id ||
    qualification.adapter_version !== selection.data.adapter_version ||
    qualification.manifest_hash !== computeCanonicalHash(adapter) ||
    evaluationTime < Date.parse(qualification.qualified_at) ||
    evaluationTime >= Date.parse(qualification.expires_at)
  ) {
    return { permitted: false, reason: "adapter_unqualified" };
  }
  const blockedCapabilityIds = grant.capabilities
    .filter((capability) => {
      const actual = adapter.authority[capability.dimension];
      return capability.minimum_enforcement === "enforced"
        ? actual !== "enforced"
        : !["enforced", "brokered"].includes(actual);
    })
    .map(({ capability_id: capabilityId }) => capabilityId)
    .sort(compareCanonicalStrings);
  if (blockedCapabilityIds.length > 0) {
    return {
      permitted: false,
      reason: "enforcement_unavailable",
      blockedCapabilityIds,
    };
  }
  return grant;
}

function capabilityKey(
  capability: Pick<DelegatedAuthorityCapability_v1, "dimension" | "capability_id" | "scope_hash">
): string {
  return computeCanonicalHash({
    dimension: capability.dimension,
    capability_id: capability.capability_id,
    scope_hash: capability.scope_hash,
  });
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
