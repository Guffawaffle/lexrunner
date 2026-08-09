import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";
import type { GovernedAttemptEvidenceCapture } from "./governed-attempt-evidence.js";

export const GOVERNED_ATTEMPT_EXECUTOR_VERSION = "1.0.0" as const;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });
const gitObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);

export const GovernedControlId = z.enum([
  "corpus_read_scope",
  "filesystem_write_denied",
  "tool_network_denied",
  "local_ipc_denied",
  "credential_read_denied",
  "descendant_reaping",
  "evidence_sink_protected",
  "degraded_launch_denied",
]);
export type GovernedControlId = z.infer<typeof GovernedControlId>;

export const EvidenceStrength = z.enum([
  "executor_reported",
  "inferred",
  "host_enforced_indirect",
  "independently_enforced_verified",
]);
export type EvidenceStrength = z.infer<typeof EvidenceStrength>;

const EVIDENCE_STRENGTH_RANK: Readonly<Record<EvidenceStrength, number>> = Object.freeze({
  executor_reported: 0,
  inferred: 1,
  host_enforced_indirect: 2,
  independently_enforced_verified: 3,
});

export const RequiredControl_v1 = z
  .object({
    control: GovernedControlId,
    minimum_strength: EvidenceStrength,
  })
  .strict();
export type RequiredControl_v1 = z.infer<typeof RequiredControl_v1>;

export const AttestedControl_v1 = z
  .object({
    control: GovernedControlId,
    status: z.enum(["enforced", "violated", "unverifiable"]),
    strength: EvidenceStrength,
    evidence_refs: z.array(SHA256Hash).min(1).max(32),
    enforcement_owner: opaqueId,
  })
  .strict();
export type AttestedControl_v1 = z.infer<typeof AttestedControl_v1>;

export const GovernedReviewRequirements_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    repository_id: opaqueId,
    base_object_id: gitObjectId,
    candidate_object_id: gitObjectId,
    objective_hash: SHA256Hash,
    authorized_model_provider: opaqueId,
    source_disclosure_allowed: z.literal(true),
    controls: z.array(RequiredControl_v1).length(GovernedControlId.options.length),
    max_duration_ms: z
      .number()
      .int()
      .positive()
      .max(15 * 60 * 1_000),
    max_output_bytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1_024 * 1_024),
  })
  .strict()
  .superRefine((value, context) => {
    requireExactControls(value.controls, context, ["controls"]);
    if (value.base_object_id === value.candidate_object_id) {
      context.addIssue({
        code: "custom",
        path: ["candidate_object_id"],
        message: "candidate must differ from base for a governed review",
      });
    }
  });
export type GovernedReviewRequirements_v1 = z.infer<typeof GovernedReviewRequirements_v1>;

export const ExecutorAttestation_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    executor_id: opaqueId,
    executor_version: z.string().min(1).max(256),
    executable_hash: SHA256Hash,
    protocol: z.enum(["jsonl-stdin", "synthetic"]),
    configuration_hash: SHA256Hash,
    tool_surface_hash: SHA256Hash,
    observed_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine(requireFreshInterval);
export type ExecutorAttestation_v1 = z.infer<typeof ExecutorAttestation_v1>;

export const EnvironmentAttestation_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    provider_id: opaqueId,
    environment_id: opaqueId,
    topology_hash: SHA256Hash,
    controls: z.array(AttestedControl_v1).length(GovernedControlId.options.length),
    observed_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine((value, context) => {
    requireExactControls(value.controls, context, ["controls"]);
    requireFreshInterval(value, context);
  });
export type EnvironmentAttestation_v1 = z.infer<typeof EnvironmentAttestation_v1>;

export const WorkspaceAttestation_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    workspace_id: opaqueId,
    repository_id: opaqueId,
    base_object_id: gitObjectId,
    candidate_object_id: gitObjectId,
    corpus_hash: SHA256Hash,
    selection_hash: SHA256Hash,
    corpus_kind: z.enum(["synthetic", "repository"]),
    observed_at: instant,
    expires_at: instant,
  })
  .strict()
  .superRefine(requireFreshInterval);
export type WorkspaceAttestation_v1 = z.infer<typeof WorkspaceAttestation_v1>;

export const GovernedCapabilityGrant_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    repository_id: opaqueId,
    base_object_id: gitObjectId,
    candidate_object_id: gitObjectId,
    authorized_model_provider: opaqueId,
    source_disclosure_allowed: z.literal(true),
    controls: z.array(RequiredControl_v1).length(GovernedControlId.options.length),
    tools: z.array(z.enum(["read_only_shell"])).max(1),
    max_duration_ms: z
      .number()
      .int()
      .positive()
      .max(15 * 60 * 1_000),
    max_output_bytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1_024 * 1_024),
  })
  .strict()
  .superRefine((value, context) => requireExactControls(value.controls, context, ["controls"]));
export type GovernedCapabilityGrant_v1 = z.infer<typeof GovernedCapabilityGrant_v1>;

const attemptAuthorizationBody = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    authorization_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    requirements_hash: SHA256Hash,
    executor_attestation_hash: SHA256Hash,
    environment_attestation_hash: SHA256Hash,
    workspace_attestation_hash: SHA256Hash,
    grant: GovernedCapabilityGrant_v1,
    authorized_at: instant,
    expires_at: instant,
  })
  .strict();

export const AttemptAuthorization_v1 = attemptAuthorizationBody
  .extend({ binding_digest: SHA256Hash })
  .strict()
  .superRefine((value, context) => {
    requireFreshInterval(value, context);
    const { binding_digest: _bindingDigest, ...body } = value;
    if (computeCanonicalHash(body) !== value.binding_digest) {
      context.addIssue({
        code: "custom",
        path: ["binding_digest"],
        message: "authorization binding digest does not match its canonical body",
      });
    }
    if (
      value.attempt_id !== value.grant.attempt_id ||
      value.delegation_id !== value.grant.delegation_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["grant"],
        message: "grant identity must match the authorization identity",
      });
    }
  });
export type AttemptAuthorization_v1 = z.infer<typeof AttemptAuthorization_v1>;

export type GovernedAuthorizationFailureReason =
  "identity_mismatch" | "stale_attestation" | "control_unavailable" | "grant_exceeds_requirements";

export type GovernedAuthorizationDecision =
  | { authorized: true; authorization: AttemptAuthorization_v1 }
  | {
      authorized: false;
      reason: GovernedAuthorizationFailureReason;
      blocked_controls?: GovernedControlId[];
    };

export function authorizeGovernedReview(input: {
  authorizationId: string;
  requirements: GovernedReviewRequirements_v1;
  executor: ExecutorAttestation_v1;
  environment: EnvironmentAttestation_v1;
  workspace: WorkspaceAttestation_v1;
  grant: GovernedCapabilityGrant_v1;
  authorizedAt: string;
  expiresAt: string;
}): GovernedAuthorizationDecision {
  const requirements = GovernedReviewRequirements_v1.parse(input.requirements);
  const executor = ExecutorAttestation_v1.parse(input.executor);
  const environment = EnvironmentAttestation_v1.parse(input.environment);
  const workspace = WorkspaceAttestation_v1.parse(input.workspace);
  const grant = GovernedCapabilityGrant_v1.parse(input.grant);
  const authorizationTime = Date.parse(input.authorizedAt);
  const requestedExpiry = Date.parse(input.expiresAt);
  if (
    workspace.repository_id !== requirements.repository_id ||
    workspace.base_object_id !== requirements.base_object_id ||
    workspace.candidate_object_id !== requirements.candidate_object_id ||
    grant.attempt_id !== requirements.attempt_id ||
    grant.delegation_id !== requirements.delegation_id ||
    grant.repository_id !== requirements.repository_id ||
    grant.base_object_id !== requirements.base_object_id ||
    grant.candidate_object_id !== requirements.candidate_object_id
  ) {
    return { authorized: false, reason: "identity_mismatch" };
  }
  if (
    !Number.isFinite(authorizationTime) ||
    !Number.isFinite(requestedExpiry) ||
    requestedExpiry <= authorizationTime ||
    [executor, environment, workspace].some(
      (attestation) =>
        Date.parse(attestation.observed_at) > authorizationTime ||
        Date.parse(attestation.expires_at) <= authorizationTime ||
        Date.parse(attestation.expires_at) < requestedExpiry
    )
  ) {
    return { authorized: false, reason: "stale_attestation" };
  }
  if (!grantWithinRequirements(grant, requirements)) {
    return { authorized: false, reason: "grant_exceeds_requirements" };
  }
  const attested = new Map(environment.controls.map((control) => [control.control, control]));
  const blockedControls = requirements.controls
    .filter((required) => {
      const actual = attested.get(required.control);
      return (
        !actual ||
        actual.status !== "enforced" ||
        EVIDENCE_STRENGTH_RANK[actual.strength] < EVIDENCE_STRENGTH_RANK[required.minimum_strength]
      );
    })
    .map((control) => control.control);
  if (blockedControls.length > 0) {
    return { authorized: false, reason: "control_unavailable", blocked_controls: blockedControls };
  }
  const body = attemptAuthorizationBody.parse({
    schema_version: GOVERNED_ATTEMPT_EXECUTOR_VERSION,
    authorization_id: input.authorizationId,
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
    requirements_hash: computeCanonicalHash(requirements),
    executor_attestation_hash: computeCanonicalHash(executor),
    environment_attestation_hash: computeCanonicalHash(environment),
    workspace_attestation_hash: computeCanonicalHash(workspace),
    grant,
    authorized_at: input.authorizedAt,
    expires_at: input.expiresAt,
  });
  return {
    authorized: true,
    authorization: AttemptAuthorization_v1.parse({
      ...body,
      binding_digest: computeCanonicalHash(body),
    }),
  };
}

export const AttemptExecutorHandle_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    operation_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    authorization_binding_digest: SHA256Hash,
    executor_id: opaqueId,
    provider_handle: opaqueId,
    started_at: instant,
  })
  .strict();
export type AttemptExecutorHandle_v1 = z.infer<typeof AttemptExecutorHandle_v1>;

export const AttemptExecutorEvent_v1 = z.discriminatedUnion("type", [
  z
    .object({
      schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
      type: z.literal("started"),
      sequence: z.number().int().positive(),
      observed_at: instant,
      evidence_ref: SHA256Hash,
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
      type: z.literal("executor_event"),
      sequence: z.number().int().positive(),
      observed_at: instant,
      evidence_ref: SHA256Hash,
      executor_event_type: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
      type: z.literal("declined"),
      sequence: z.number().int().positive(),
      observed_at: instant,
      evidence_ref: SHA256Hash,
      reason_present: z.boolean(),
    })
    .strict(),
  z
    .object({
      schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
      type: z.enum(["completed", "failed", "cancelled", "lost"]),
      sequence: z.number().int().positive(),
      observed_at: instant,
      evidence_ref: SHA256Hash,
    })
    .strict(),
]);
export type AttemptExecutorEvent_v1 = z.infer<typeof AttemptExecutorEvent_v1>;

export const GovernedAttemptResult_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_EXECUTOR_VERSION),
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    authorization_binding_digest: SHA256Hash,
    worker_outcome: z.enum(["completed", "declined", "failed", "cancelled", "lost"]),
    task_outcome: z.enum(["pass", "block", "not_produced", "invalid"]),
    authorization_outcome: z.enum(["valid", "invalid", "expired"]),
    evidence_outcome: z.enum(["sufficient", "insufficient", "violated"]),
    admissibility: z.enum(["admissible", "inadmissible"]),
    evidence_refs: z.array(SHA256Hash).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.admissibility === "admissible" &&
      (value.worker_outcome !== "completed" ||
        !["pass", "block"].includes(value.task_outcome) ||
        value.authorization_outcome !== "valid" ||
        value.evidence_outcome !== "sufficient")
    ) {
      context.addIssue({
        code: "custom",
        path: ["admissibility"],
        message: "admissibility requires completed work, a task verdict, and valid evidence",
      });
    }
  });
export type GovernedAttemptResult_v1 = z.infer<typeof GovernedAttemptResult_v1>;

/**
 * Runtime-neutral event-driven executor port. `observe` waits on provider events;
 * callers do not need to poll a live process to make progress.
 */
export interface AttemptExecutor {
  inspect(environmentId: string): Promise<ExecutorAttestation_v1>;
  start(input: {
    authorization: AttemptAuthorization_v1;
    prompt: Uint8Array;
    outputSchema: unknown;
    evidence?: GovernedAttemptEvidenceCapture;
  }): Promise<AttemptExecutorHandle_v1>;
  observe(
    handle: AttemptExecutorHandle_v1,
    options?: { afterSequence?: number; signal?: AbortSignal }
  ): AsyncIterable<AttemptExecutorEvent_v1>;
  cancel(handle: AttemptExecutorHandle_v1): Promise<void>;
  collect(handle: AttemptExecutorHandle_v1): Promise<GovernedAttemptResult_v1>;
  release(handle: AttemptExecutorHandle_v1): Promise<void>;
}

function grantWithinRequirements(
  grant: GovernedCapabilityGrant_v1,
  requirements: GovernedReviewRequirements_v1
): boolean {
  const required = new Map(
    requirements.controls.map((control) => [control.control, control.minimum_strength])
  );
  return (
    grant.authorized_model_provider === requirements.authorized_model_provider &&
    grant.source_disclosure_allowed === requirements.source_disclosure_allowed &&
    grant.max_duration_ms <= requirements.max_duration_ms &&
    grant.max_output_bytes <= requirements.max_output_bytes &&
    grant.controls.every((control) => required.get(control.control) === control.minimum_strength) &&
    grant.tools.length <= 1
  );
}

function requireExactControls(
  controls: readonly { control: GovernedControlId }[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const actual = new Set(controls.map((control) => control.control));
  if (
    actual.size !== GovernedControlId.options.length ||
    GovernedControlId.options.some((control) => !actual.has(control))
  ) {
    context.addIssue({
      code: "custom",
      path,
      message: "every governed denial control must appear exactly once",
    });
  }
}

function requireFreshInterval(
  value: { observed_at?: string; authorized_at?: string; expires_at: string },
  context: z.RefinementCtx
): void {
  const start = value.observed_at ?? value.authorized_at;
  if (!start || Date.parse(value.expires_at) <= Date.parse(start)) {
    context.addIssue({
      code: "custom",
      path: ["expires_at"],
      message: "expiry must follow the observation or authorization time",
    });
  }
}
