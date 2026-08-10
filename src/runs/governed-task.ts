import { z } from "zod";

import { SHA256Hash, computeCanonicalHash } from "../schemas/task-contract.js";
import {
  DelegationProtocolState_v1,
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

/** Canonical binding used by a parent's delegation effect to authorize one child task ceiling. */
export function computeGovernedTaskCapabilityCeilingHash(
  capabilities: readonly GovernedTaskCapability_v1[]
): string {
  const parsed = capabilities
    .map((capability) => GovernedTaskCapability_v1.parse(capability))
    .sort((left, right) => compareCanonicalStrings(left.capability_id, right.capability_id));
  return computeCanonicalHash(parsed);
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
        | "delegation_not_accepted"
        | "grant_not_active"
        | "identity_mismatch"
        | "invalid_grant_chain"
        | "provider_mismatch"
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

export const GovernedTaskAdapterSelection_v1 = z
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

const governedTaskCapabilityEnforcementReceiptBody = z
  .object({
    schema_version: z.literal(GOVERNED_TASK_CONTRACT_VERSION),
    receipt_id: opaqueId,
    adapter_id: opaqueId,
    adapter_version: z.string().min(1).max(256),
    manifest_hash: SHA256Hash,
    qualification_hash: SHA256Hash,
    capability_hash: SHA256Hash,
    dimension: WorkerAdapterAuthorityDimension,
    scope_hash: SHA256Hash,
    effect_policy_hash: SHA256Hash,
    enforcement: z.enum(["enforced", "brokered"]),
    evidence_hash: SHA256Hash,
    verified_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (Date.parse(receipt.verified_at) >= Date.parse(receipt.expires_at)) {
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "capability enforcement expiry must be later than verification time",
      });
    }
  });

export const GovernedTaskCapabilityEnforcementReceipt_v1 =
  governedTaskCapabilityEnforcementReceiptBody
    .extend({ receipt_hash: SHA256Hash })
    .strict()
    .superRefine((receipt, context) => {
      const { receipt_hash: _receiptHash, ...body } = receipt;
      if (computeCanonicalHash(body) !== receipt.receipt_hash) {
        context.addIssue({
          code: "custom",
          path: ["receipt_hash"],
          message: "capability enforcement receipt hash does not match its canonical body",
        });
      }
    });
export type GovernedTaskCapabilityEnforcementReceipt_v1 = z.infer<
  typeof GovernedTaskCapabilityEnforcementReceipt_v1
>;

export function createGovernedTaskCapabilityEnforcementReceipt(
  candidate: z.input<typeof governedTaskCapabilityEnforcementReceiptBody>
): GovernedTaskCapabilityEnforcementReceipt_v1 {
  const body = governedTaskCapabilityEnforcementReceiptBody.parse(candidate);
  return GovernedTaskCapabilityEnforcementReceipt_v1.parse({
    ...body,
    receipt_hash: computeCanonicalHash(body),
  });
}

export const GovernedTaskQualifiedAdapterResolution_v1 = z
  .object({
    manifest: WorkerAdapterManifest_v1,
    qualification: GovernedTaskAdapterQualification_v1,
    capability_enforcements: z.array(GovernedTaskCapabilityEnforcementReceipt_v1).max(32),
  })
  .strict()
  .superRefine((resolution, context) => {
    const hashes = resolution.capability_enforcements.map(
      ({ capability_hash: capabilityHash }) => capabilityHash
    );
    if (new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: "custom",
        path: ["capability_enforcements"],
        message: "capability enforcement receipts must have unique capability hashes",
      });
    }
  });
export type GovernedTaskQualifiedAdapterResolution_v1 = z.infer<
  typeof GovernedTaskQualifiedAdapterResolution_v1
>;

const governedTaskExecutionBindingBody = z
  .object({
    schema_version: z.literal(GOVERNED_TASK_CONTRACT_VERSION),
    task_spec_hash: SHA256Hash,
    authority_grant: DelegatedAuthorityGrant_v1,
    authority_grant_hash: SHA256Hash,
    adapter_selection: GovernedTaskAdapterSelection_v1,
    adapter_resolution: GovernedTaskQualifiedAdapterResolution_v1,
  })
  .strict()
  .superRefine((binding, context) => {
    if (computeAuthorityGrantHash(binding.authority_grant) !== binding.authority_grant_hash) {
      context.addIssue({
        code: "custom",
        path: ["authority_grant_hash"],
        message: "task execution binding must name the exact authority grant",
      });
    }
    if (
      binding.adapter_resolution.manifest.adapter.id !== binding.adapter_selection.adapter_id ||
      binding.adapter_resolution.manifest.adapter.version !==
        binding.adapter_selection.adapter_version
    ) {
      context.addIssue({
        code: "custom",
        path: ["adapter_selection"],
        message: "task execution binding must select the exact qualified adapter",
      });
    }
  });

export const GovernedTaskExecutionBinding_v1 = governedTaskExecutionBindingBody
  .extend({ execution_binding_hash: SHA256Hash })
  .strict()
  .superRefine((binding, context) => {
    const { execution_binding_hash: _executionBindingHash, ...body } = binding;
    if (computeCanonicalHash(body) !== binding.execution_binding_hash) {
      context.addIssue({
        code: "custom",
        path: ["execution_binding_hash"],
        message: "task execution binding hash does not match its canonical body",
      });
    }
  });
export type GovernedTaskExecutionBinding_v1 = z.infer<typeof GovernedTaskExecutionBinding_v1>;

export function createGovernedTaskExecutionBinding(
  candidate: z.input<typeof governedTaskExecutionBindingBody>
): GovernedTaskExecutionBinding_v1 {
  const body = governedTaskExecutionBindingBody.parse(candidate);
  return GovernedTaskExecutionBinding_v1.parse({
    ...body,
    execution_binding_hash: computeCanonicalHash(body),
  });
}

/** Trusted host port; implementations resolve only protected, independently qualified records. */
export interface GovernedTaskAdapterQualificationAuthority {
  resolveQualifiedAdapter(input: {
    adapterId: string;
    adapterVersion: string;
    capabilities: readonly GovernedTaskCapability_v1[];
    evaluatedAt: string;
  }): Promise<unknown | null>;
}

export const GovernedTaskAuthoritySelection_v1 = z
  .object({
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    task_spec_hash: SHA256Hash,
    authority_grant_hash: SHA256Hash,
    authorized_operator_principal_id: opaqueId,
  })
  .strict();
export type GovernedTaskAuthoritySelection_v1 = z.infer<typeof GovernedTaskAuthoritySelection_v1>;

const GovernedTaskAuthorityResolution_v1 = z
  .object({
    task_chain: z.array(GovernedTaskSpec_v1).min(1).max(32),
    grant_chain: z.array(DelegatedAuthorityGrant_v1).min(1).max(32),
    delegation: DelegationProtocolState_v1,
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.task_chain.length !== resolution.grant_chain.length) {
      context.addIssue({
        code: "custom",
        path: ["task_chain"],
        message: "task and grant chains must have the same length",
      });
    }
  });

/**
 * Trusted host port. Implementations resolve only protected task/grant/delegation records, authorize
 * the root operator issuer, and return the accepted offer. Caller-provided bodies are never input.
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
  const { task_chain: taskChain, grant_chain: grantChain, delegation } = resolution.data;
  const task = taskChain[taskChain.length - 1]!;
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
  if (delegation.status !== "accepted") {
    return { permitted: false, reason: "delegation_not_accepted" };
  }
  if (
    delegation.offer.attempt_id !== selection.data.attempt_id ||
    delegation.offer.delegation_id !== selection.data.delegation_id ||
    delegation.offer.task_offer_hash !== selection.data.task_spec_hash ||
    delegation.offer.authority_grant_hash !== selection.data.authority_grant_hash
  ) {
    return { permitted: false, reason: "identity_mismatch" };
  }
  if (delegation.offer.worker.provider_id !== task.authorized_model_provider) {
    return { permitted: false, reason: "provider_mismatch" };
  }
  const rootIssuer = grantChain[0]!.issuer;
  if (
    rootIssuer.kind !== "operator" ||
    rootIssuer.principal_id !== selection.data.authorized_operator_principal_id
  ) {
    return { permitted: false, reason: "invalid_grant_chain" };
  }
  for (let index = 0; index < grantChain.length - 1; index += 1) {
    if (!taskAndGrantAlign(taskChain[index]!, grantChain[index]!)) {
      return { permitted: false, reason: "invalid_grant_chain" };
    }
  }
  for (let index = 1; index < grantChain.length; index += 1) {
    if (
      !evaluateDelegatedAuthorityContainment(grantChain[index - 1], grantChain[index]).contained ||
      !taskAuthorizesChildCeiling(taskChain[index - 1]!, grantChain[index - 1]!, taskChain[index]!)
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
      capabilities: grant.capabilities,
      evaluatedAt,
    });
  } catch {
    return { permitted: false, reason: "adapter_unqualified" };
  }
  if (candidate === null) return { permitted: false, reason: "adapter_unqualified" };
  const resolution = GovernedTaskQualifiedAdapterResolution_v1.safeParse(candidate);
  if (!resolution.success) return { permitted: false, reason: "adapter_unqualified" };
  const {
    manifest: adapter,
    qualification,
    capability_enforcements: capabilityEnforcements,
  } = resolution.data;
  const evaluationTime = Date.parse(evaluatedAt);
  const manifestHash = computeCanonicalHash(adapter);
  if (
    adapter.adapter.id !== selection.data.adapter_id ||
    adapter.adapter.version !== selection.data.adapter_version ||
    qualification.adapter_id !== selection.data.adapter_id ||
    qualification.adapter_version !== selection.data.adapter_version ||
    qualification.manifest_hash !== manifestHash ||
    evaluationTime < Date.parse(qualification.qualified_at) ||
    evaluationTime >= Date.parse(qualification.expires_at)
  ) {
    return { permitted: false, reason: "adapter_unqualified" };
  }
  const receipts = new Map(
    capabilityEnforcements.map((receipt) => [receipt.capability_hash, receipt])
  );
  const blockedCapabilityIds = grant.capabilities
    .filter((capability) => {
      const actual = adapter.authority[capability.dimension];
      const receipt = receipts.get(computeCanonicalHash(capability));
      return (
        !enforcementMeetsFloor(actual, capability.minimum_enforcement) ||
        !receipt ||
        receipt.adapter_id !== selection.data.adapter_id ||
        receipt.adapter_version !== selection.data.adapter_version ||
        receipt.manifest_hash !== manifestHash ||
        receipt.qualification_hash !== qualification.qualification_hash ||
        receipt.dimension !== capability.dimension ||
        receipt.scope_hash !== capability.scope_hash ||
        receipt.effect_policy_hash !== computeCanonicalHash(capability.effect) ||
        !enforcementMeetsFloor(receipt.enforcement, capability.minimum_enforcement) ||
        Date.parse(receipt.verified_at) < Date.parse(qualification.qualified_at) ||
        evaluationTime < Date.parse(receipt.verified_at) ||
        evaluationTime >= Date.parse(receipt.expires_at)
      );
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

function enforcementMeetsFloor(
  actual: "enforced" | "brokered" | "unenforced" | "unsupported",
  minimum: "enforced" | "brokered"
): boolean {
  return minimum === "enforced"
    ? actual === "enforced"
    : actual === "enforced" || actual === "brokered";
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

function taskAndGrantAlign(task: GovernedTaskSpec_v1, grant: DelegatedAuthorityGrant_v1): boolean {
  if (task.attempt_id !== grant.attempt_id || task.delegation_id !== grant.delegation_id) {
    return false;
  }
  const ceiling = new Set(task.capability_ceiling.map((capability) => capabilityKey(capability)));
  return grant.capabilities.every((capability) => ceiling.has(capabilityKey(capability)));
}

function taskAuthorizesChildCeiling(
  parentTask: GovernedTaskSpec_v1,
  parentGrant: DelegatedAuthorityGrant_v1,
  childTask: GovernedTaskSpec_v1
): boolean {
  const grantedDelegations = new Set(
    parentGrant.capabilities
      .filter(({ dimension }) => dimension === "nested_delegation")
      .map((capability) => capabilityKey(capability))
  );
  const childCeilingHash = computeGovernedTaskCapabilityCeilingHash(childTask.capability_ceiling);
  return parentTask.capability_ceiling.some(
    (capability) =>
      capability.dimension === "nested_delegation" &&
      grantedDelegations.has(capabilityKey(capability)) &&
      capability.effect.class === "delegation" &&
      capability.effect.child_authority_ceiling_hash === childCeilingHash
  );
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
