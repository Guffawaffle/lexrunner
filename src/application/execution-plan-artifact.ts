import { createHash } from "node:crypto";

import { z } from "zod";

import { loadPlan } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

export const EXECUTION_PLAN_ARTIFACT_CONTRACT = "lexrunner.execution-plan-artifact.v1" as const;
export const PLAN_ARTIFACT_REFERENCE_CONTRACT = "lexrunner.plan-artifact-reference.v1" as const;
export const EXECUTION_PLAN_CANONICALIZATION_PROFILE =
  "lexrunner.execution-plan.canonical-json.v1" as const;
export const EXECUTION_PLAN_HASH_PROFILE = "lexrunner.execution-plan-artifact.sha256.v1" as const;
export const EXECUTION_PLAN_HASH_DOMAIN = "lexrunner:execution-plan-artifact:v1\0" as const;

export const MAX_PLAN_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_PLAN_RETRIEVAL_REFERENCE_BYTES = 4_096;
const MAX_SCOPE_LABEL_BYTES = 512;

const Sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const BoundedScopeLabel = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_SCOPE_LABEL_BYTES, {
    message: "Scope label exceeds the transport limit",
  });
const BoundedIdentityLabel = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_SCOPE_LABEL_BYTES, {
    message: "Identity label exceeds the transport limit",
  });

export const PlanArtifactScope_v1Schema = z
  .object({
    tenant: BoundedScopeLabel,
    workspace: BoundedScopeLabel,
    repository: BoundedScopeLabel,
    refNamespace: BoundedScopeLabel,
    policy: BoundedScopeLabel,
  })
  .strict();

export type PlanArtifactScope_v1 = z.infer<typeof PlanArtifactScope_v1Schema>;

export const ExecutionPlanArtifactIdentity_v1Schema = z
  .object({
    contract: z.literal(EXECUTION_PLAN_ARTIFACT_CONTRACT),
    kind: z.literal("execution-plan"),
    planSchema: z.literal("lexrunner.execution-plan"),
    planSchemaVersion: BoundedIdentityLabel,
    canonicalizationProfile: z.literal(EXECUTION_PLAN_CANONICALIZATION_PROFILE),
    hashProfile: z.literal(EXECUTION_PLAN_HASH_PROFILE),
    digestAlgorithm: z.literal("sha256"),
    digest: Sha256Digest,
    canonicalByteLength: z.number().int().nonnegative().max(MAX_PLAN_ARTIFACT_BYTES),
    target: BoundedIdentityLabel,
    summary: z
      .object({
        itemCount: z.number().int().nonnegative().max(256),
        gateCount: z
          .number()
          .int()
          .nonnegative()
          .max(256 * 64),
      })
      .strict(),
  })
  .strict();

export type ExecutionPlanArtifactIdentity_v1 = z.infer<
  typeof ExecutionPlanArtifactIdentity_v1Schema
>;

export const ExecutionPlanArtifact_v1Schema = z
  .object({
    identity: ExecutionPlanArtifactIdentity_v1Schema,
    canonicalBytes: z.string(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const byteLength = Buffer.byteLength(artifact.canonicalBytes, "utf8");
    if (byteLength > MAX_PLAN_ARTIFACT_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["canonicalBytes"],
        message: "Canonical plan bytes exceed the artifact limit",
      });
    }
    if (byteLength !== artifact.identity.canonicalByteLength) {
      context.addIssue({
        code: "custom",
        path: ["identity", "canonicalByteLength"],
        message: "Canonical plan byte length does not match the artifact identity",
      });
    }
    if (computeExecutionPlanArtifactDigest(artifact.canonicalBytes) !== artifact.identity.digest) {
      context.addIssue({
        code: "custom",
        path: ["identity", "digest"],
        message: "Canonical plan digest does not match the artifact identity",
      });
    }
    try {
      const plan = loadPlan(artifact.canonicalBytes);
      if (canonicalJSONStringify(plan) !== artifact.canonicalBytes) {
        context.addIssue({
          code: "custom",
          path: ["canonicalBytes"],
          message: "Plan bytes are not in the declared canonical form",
        });
      }
      const gateCount = plan.items.reduce((count, item) => count + item.gates.length, 0);
      if (
        artifact.identity.planSchemaVersion !== plan.schemaVersion ||
        artifact.identity.target !== plan.target ||
        artifact.identity.summary.itemCount !== plan.items.length ||
        artifact.identity.summary.gateCount !== gateCount
      ) {
        context.addIssue({
          code: "custom",
          path: ["identity"],
          message: "Plan semantics do not match the artifact identity",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["canonicalBytes"],
        message: "Canonical bytes do not contain a valid execution plan",
      });
    }
  });

export type ExecutionPlanArtifact_v1 = z.infer<typeof ExecutionPlanArtifact_v1Schema>;

export const PlanArtifactReference_v1Schema = z
  .object({
    contract: z.literal(PLAN_ARTIFACT_REFERENCE_CONTRACT),
    artifact: ExecutionPlanArtifactIdentity_v1Schema,
    expectedDigest: Sha256Digest,
    expectedCanonicalByteLength: z.number().int().nonnegative().max(MAX_PLAN_ARTIFACT_BYTES),
    retrieval: z
      .object({
        kind: z.enum(["file", "registered"]),
        reference: z
          .string()
          .min(1)
          .refine(
            (value) =>
              !value.includes("\0") &&
              Buffer.byteLength(value, "utf8") <= MAX_PLAN_RETRIEVAL_REFERENCE_BYTES,
            { message: "Retrieval reference is invalid or exceeds the transport limit" }
          ),
      })
      .strict(),
    scope: PlanArtifactScope_v1Schema.optional(),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.expectedDigest !== reference.artifact.digest) {
      context.addIssue({
        code: "custom",
        path: ["expectedDigest"],
        message: "Expected digest does not match the embedded artifact identity",
      });
    }
    if (reference.expectedCanonicalByteLength !== reference.artifact.canonicalByteLength) {
      context.addIssue({
        code: "custom",
        path: ["expectedCanonicalByteLength"],
        message: "Expected byte length does not match the embedded artifact identity",
      });
    }
  });

export type PlanArtifactReference_v1 = z.infer<typeof PlanArtifactReference_v1Schema>;

export function computeExecutionPlanArtifactDigest(canonicalBytes: string): string {
  const digest = createHash("sha256")
    .update(EXECUTION_PLAN_HASH_DOMAIN, "utf8")
    .update(canonicalBytes, "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}
