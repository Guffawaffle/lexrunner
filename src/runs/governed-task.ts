import { z } from "zod";

import { SHA256Hash, computeCanonicalHash } from "../schemas/task-contract.js";
import {
  DelegatedAuthorityGrant_v1,
  type DelegatedAuthorityCapability_v1,
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
      class: z.literal("delegation"),
      child_authority_ceiling_hash: SHA256Hash,
    })
    .strict(),
]);
export type GovernedTaskCapabilityEffect_v1 = z.infer<typeof GovernedTaskCapabilityEffect_v1>;

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
    const effectClass = capability.effect.class;
    if (capability.dimension === "filesystem_write" && effectClass !== "workspace_mutation") {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: "filesystem_write must be an owned, recoverable workspace mutation",
      });
    }
    if (
      capability.dimension === "git_write" &&
      !["workspace_mutation", "external_effect"].includes(effectClass)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: "git_write must declare either workspace recovery or an external effect",
      });
    }
    if (
      ["github_write", "signing", "release"].includes(capability.dimension) &&
      effectClass !== "external_effect"
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: `${capability.dimension} must declare its durable external effect`,
      });
    }
    if (capability.dimension === "external_runtime" && effectClass !== "runtime_execution") {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: "external_runtime must bind an enforced containment profile",
      });
    }
    if (capability.dimension === "nested_delegation" && effectClass !== "delegation") {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: "nested_delegation must bind a child authority ceiling",
      });
    }
    if (
      effectClass === "workspace_mutation" &&
      !["filesystem_write", "git_write"].includes(capability.dimension)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect", "class"],
        message: "workspace mutation recovery is valid only for filesystem or Git writes",
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
        | "invalid_task_spec"
        | "invalid_grant"
        | "grant_not_active"
        | "identity_mismatch"
        | "capability_expansion";
    };

export type GovernedTaskAdapterEvaluation =
  | Extract<GovernedTaskGrantEvaluation, { permitted: false }>
  | {
      permitted: false;
      reason: "invalid_adapter" | "enforcement_unavailable";
      blockedCapabilityIds?: string[];
    }
  | Extract<GovernedTaskGrantEvaluation, { permitted: true }>;

/**
 * Evaluate an attenuated Delegation grant against the task's positive capability ceiling.
 * Absence from the ceiling is denial; the grant may remove capabilities but cannot widen them.
 */
export function evaluateGovernedTaskGrant(
  taskCandidate: unknown,
  grantCandidate: unknown,
  evaluatedAt: string
): GovernedTaskGrantEvaluation {
  const task = GovernedTaskSpec_v1.safeParse(taskCandidate);
  if (!task.success) return { permitted: false, reason: "invalid_task_spec" };
  const grant = DelegatedAuthorityGrant_v1.safeParse(grantCandidate);
  if (!grant.success) return { permitted: false, reason: "invalid_grant" };
  const evaluationTime = Date.parse(evaluatedAt);
  if (
    !Number.isFinite(evaluationTime) ||
    evaluationTime < Date.parse(grant.data.not_before) ||
    evaluationTime >= Date.parse(grant.data.expires_at)
  ) {
    return { permitted: false, reason: "grant_not_active" };
  }
  if (
    task.data.attempt_id !== grant.data.attempt_id ||
    task.data.delegation_id !== grant.data.delegation_id
  ) {
    return { permitted: false, reason: "identity_mismatch" };
  }

  const ceiling = new Map(
    task.data.capability_ceiling.map((capability) => [capabilityKey(capability), capability])
  );
  const capabilities: GovernedTaskCapability_v1[] = [];
  for (const granted of grant.data.capabilities) {
    const permitted = ceiling.get(capabilityKey(granted));
    if (!permitted) return { permitted: false, reason: "capability_expansion" };
    capabilities.push(permitted);
  }
  return {
    permitted: true,
    taskSpecHash: task.data.task_spec_hash,
    capabilities,
  };
}

/** Require the selected adapter to meet every granted capability's enforcement floor. */
export function evaluateGovernedTaskGrantForAdapter(
  taskCandidate: unknown,
  grantCandidate: unknown,
  adapterCandidate: unknown,
  evaluatedAt: string
): GovernedTaskAdapterEvaluation {
  const grant = evaluateGovernedTaskGrant(taskCandidate, grantCandidate, evaluatedAt);
  if (!grant.permitted) return grant;
  const adapter = WorkerAdapterManifest_v1.safeParse(adapterCandidate);
  if (!adapter.success) return { permitted: false, reason: "invalid_adapter" };
  const blockedCapabilityIds = grant.capabilities
    .filter((capability) => {
      const actual = adapter.data.authority[capability.dimension];
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
