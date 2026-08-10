import { z } from "zod";

import {
  EnvironmentAttestation_v1,
  ExecutorAttestation_v1,
  GovernedReviewRequirements_v1,
  WorkspaceAttestation_v1,
} from "./governed-attempt-executor.js";
import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";
import {
  ProtectedEvidenceFrameClass,
  ProtectedEvidenceReference_v1,
} from "../store/protected-evidence-store.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { GovernedTaskExecutionBinding_v1, GovernedTaskSpec_v1 } from "./governed-task.js";

export const GOVERNED_ATTEMPT_VERIFICATION_VERSION = "1.0.0" as const;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });

const BoundedOutputSchema = z.record(z.string(), z.unknown()).refine(
  (value) => {
    try {
      return Buffer.byteLength(canonicalJSONStringify(value), "utf8") <= 256 * 1_024;
    } catch {
      return false;
    }
  },
  { message: "output schema must be bounded canonical JSON" }
);

export const GovernedAttemptInputBinding_v1 = z
  .object({
    prompt_hash: SHA256Hash,
    output_schema_hash: SHA256Hash,
    task_offer_hash: SHA256Hash,
    delegation_offer_hash: SHA256Hash,
  })
  .strict();
export type GovernedAttemptInputBinding_v1 = z.infer<typeof GovernedAttemptInputBinding_v1>;

export const GovernedRepositoryCorpusVerificationBinding_v1 = z
  .object({
    manifest_hash: SHA256Hash,
    source_binding_hash: SHA256Hash,
    workspace_lease_id: opaqueId,
    workspace_lease_revision: z.number().int().nonnegative(),
    task_packet_hash: SHA256Hash,
    launch_envelope_hash: SHA256Hash,
    path_mapping_hash: SHA256Hash,
    candidate_tree_hash: SHA256Hash,
    patch_hash: SHA256Hash,
  })
  .strict();
export type GovernedRepositoryCorpusVerificationBinding_v1 = z.infer<
  typeof GovernedRepositoryCorpusVerificationBinding_v1
>;

const verificationContextBody = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_VERIFICATION_VERSION),
    requirements: GovernedReviewRequirements_v1,
    executor: ExecutorAttestation_v1,
    environment: EnvironmentAttestation_v1,
    workspace: WorkspaceAttestation_v1,
    output_schema: BoundedOutputSchema,
    output_schema_hash: SHA256Hash,
    input_binding: GovernedAttemptInputBinding_v1.optional(),
    governed_task: GovernedTaskSpec_v1.optional(),
    task_execution: GovernedTaskExecutionBinding_v1.optional(),
    repository_corpus: GovernedRepositoryCorpusVerificationBinding_v1.optional(),
  })
  .strict();

/**
 * Safe, durable verifier input. It contains no prompt or raw evidence. Every
 * attestation and requirement is hash-bound to the operation authorization.
 */
export const GovernedAttemptVerificationContext_v1 = verificationContextBody
  .extend({ context_hash: SHA256Hash })
  .strict()
  .superRefine((value, context) => {
    if (computeCanonicalHash(value.output_schema) !== value.output_schema_hash) {
      context.addIssue({
        code: "custom",
        path: ["output_schema_hash"],
        message: "output schema hash does not match the canonical schema",
      });
    }
    if (
      value.input_binding &&
      value.input_binding.output_schema_hash !== value.output_schema_hash
    ) {
      context.addIssue({
        code: "custom",
        path: ["input_binding", "output_schema_hash"],
        message: "input binding must name the exact output schema",
      });
    }
    if (
      value.governed_task &&
      (!value.input_binding ||
        value.governed_task.attempt_id !== value.requirements.attempt_id ||
        value.governed_task.delegation_id !== value.requirements.delegation_id ||
        value.governed_task.objective_hash !== value.requirements.objective_hash ||
        value.governed_task.authorized_model_provider !==
          value.requirements.authorized_model_provider ||
        value.governed_task.profile.output_contract_hash !== value.output_schema_hash ||
        value.input_binding.task_offer_hash !== value.governed_task.task_spec_hash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["governed_task"],
        message: "governed task must bind the requirements, output contract, and exact task offer",
      });
    }
    if ((value.governed_task !== undefined) !== (value.task_execution !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["task_execution"],
        message: "governed task and task execution authority must appear together",
      });
    }
    if (
      value.governed_task &&
      value.task_execution &&
      (value.task_execution.task_spec_hash !== value.governed_task.task_spec_hash ||
        value.task_execution.authority_grant.attempt_id !== value.governed_task.attempt_id ||
        value.task_execution.authority_grant.delegation_id !== value.governed_task.delegation_id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["task_execution"],
        message: "task execution authority must bind the exact governed task and delegation",
      });
    }
    if (
      (value.workspace.corpus_kind === "repository") !==
      (value.repository_corpus !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["repository_corpus"],
        message: "repository workspace requires exactly one repository corpus binding",
      });
    }
    if (value.workspace.corpus_kind === "repository" && !value.input_binding) {
      context.addIssue({
        code: "custom",
        path: ["input_binding"],
        message: "repository workspace requires an exact task input binding",
      });
    }
    if (value.workspace.corpus_kind === "repository" && !value.governed_task) {
      context.addIssue({
        code: "custom",
        path: ["governed_task"],
        message: "repository workspace requires an exact governed task specification",
      });
    }
    const { context_hash: _contextHash, ...body } = value;
    if (computeCanonicalHash(body) !== value.context_hash) {
      context.addIssue({
        code: "custom",
        path: ["context_hash"],
        message: "verification context hash does not match its canonical body",
      });
    }
  });
export type GovernedAttemptVerificationContext_v1 = z.infer<
  typeof GovernedAttemptVerificationContext_v1
>;

export function createGovernedAttemptVerificationContext(
  input: Omit<z.input<typeof verificationContextBody>, "schema_version" | "output_schema_hash"> & {
    output_schema: Record<string, unknown>;
  }
): GovernedAttemptVerificationContext_v1 {
  const body = verificationContextBody.parse({
    schema_version: GOVERNED_ATTEMPT_VERIFICATION_VERSION,
    ...input,
    output_schema_hash: computeCanonicalHash(input.output_schema),
  });
  return GovernedAttemptVerificationContext_v1.parse({
    ...body,
    context_hash: computeCanonicalHash(body),
  });
}

export const GovernedAttemptVerificationFailureCode = z.enum([
  "operation_not_completed",
  "result_missing",
  "provider_claim_elevated",
  "authorization_invalid",
  "authorization_expired",
  "context_binding_mismatch",
  "lifecycle_binding_mismatch",
  "task_input_binding_mismatch",
  "control_unverifiable",
  "evidence_incomplete",
  "evidence_binding_mismatch",
  "evidence_integrity_failure",
  "event_mismatch",
  "protocol_violation",
  "output_schema_invalid",
  "output_invalid",
  "outcome_mismatch",
]);
export type GovernedAttemptVerificationFailureCode = z.infer<
  typeof GovernedAttemptVerificationFailureCode
>;

const verificationReceiptBody = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_VERIFICATION_VERSION),
    verification_id: opaqueId,
    verifier_id: opaqueId,
    operation_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    capture_id: opaqueId,
    authorization_binding_digest: SHA256Hash,
    verification_context_hash: SHA256Hash,
    operation_result_hash: SHA256Hash,
    capture_root: SHA256Hash,
    capture_verification_hash: SHA256Hash,
    decision: z.enum(["accepted", "rejected"]),
    task_outcome: z.enum(["pass", "block", "not_produced", "invalid"]),
    admissibility: z.enum(["admissible", "inadmissible"]),
    failure_codes: z.array(GovernedAttemptVerificationFailureCode).max(32),
    verified_at: instant,
  })
  .strict();

/** Coordination-safe independent-verifier receipt. Raw bytes never enter it. */
export const GovernedAttemptVerificationReceipt_v1 = verificationReceiptBody
  .extend({ receipt_hash: SHA256Hash })
  .strict()
  .superRefine((value, context) => {
    const accepted = value.decision === "accepted";
    if (
      accepted !== (value.admissibility === "admissible") ||
      accepted !== (value.failure_codes.length === 0) ||
      (accepted && !["pass", "block"].includes(value.task_outcome))
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "accepted verification requires an admissible PASS/BLOCK and no failures",
      });
    }
    const { receipt_hash: _receiptHash, ...body } = value;
    if (computeCanonicalHash(body) !== value.receipt_hash) {
      context.addIssue({
        code: "custom",
        path: ["receipt_hash"],
        message: "verification receipt hash does not match its canonical body",
      });
    }
  });
export type GovernedAttemptVerificationReceipt_v1 = z.infer<
  typeof GovernedAttemptVerificationReceipt_v1
>;

export function createGovernedAttemptVerificationReceipt(
  input: Omit<z.input<typeof verificationReceiptBody>, "schema_version">
): GovernedAttemptVerificationReceipt_v1 {
  const body = verificationReceiptBody.parse({
    schema_version: GOVERNED_ATTEMPT_VERIFICATION_VERSION,
    ...input,
  });
  return GovernedAttemptVerificationReceipt_v1.parse({
    ...body,
    receipt_hash: computeCanonicalHash(body),
  });
}

export interface IndependentlyReadEvidenceFrame {
  sequence: number;
  frameClass: z.infer<typeof ProtectedEvidenceFrameClass>;
  observedAt: string;
  evidenceRef: string;
  bytes: Uint8Array;
}

/**
 * Result of a fresh, verifier-owned read of the sealed container. This port is
 * intentionally separate from the write-only execution evidence port.
 */
export interface IndependentlyVerifiedEvidenceCapture {
  reference: z.infer<typeof ProtectedEvidenceReference_v1>;
  frames: readonly IndependentlyReadEvidenceFrame[];
}

export interface ProtectedEvidenceIndependentReader {
  readVerifiedCapture(captureId: string): Promise<IndependentlyVerifiedEvidenceCapture>;
}
