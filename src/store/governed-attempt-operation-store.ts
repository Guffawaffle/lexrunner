import { z } from "zod";

import {
  AttemptExecutorEvent_v1,
  AttemptExecutorHandle_v1,
  AttemptAuthorization_v1,
  GovernedAttemptResult_v1,
  type AttemptExecutorEvent_v1 as AttemptExecutorEvent,
  type AttemptExecutorHandle_v1 as AttemptExecutorHandle,
  type AttemptAuthorization_v1 as AttemptAuthorization,
  type GovernedAttemptResult_v1 as GovernedAttemptResult,
} from "../runs/governed-attempt-executor.js";
import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";
import {
  ProtectedEvidenceReference_v1,
  ProtectedEvidenceReservationRequest_v1,
  type ProtectedEvidenceReference_v1 as ProtectedEvidenceReference,
  type ProtectedEvidenceReservationRequest_v1 as ProtectedEvidenceReservationRequest,
} from "./protected-evidence-store.js";

export const GOVERNED_ATTEMPT_OPERATION_STORE_VERSION = "1.0.0" as const;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const instant = z.string().datetime({ offset: true });

export const GovernedAttemptOperationStatus = z.enum([
  "running",
  "declined",
  "completed",
  "failed",
  "cancelled",
  "lost",
]);
export type GovernedAttemptOperationStatus = z.infer<typeof GovernedAttemptOperationStatus>;

export const GovernedAttemptOperationRecord_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_OPERATION_STORE_VERSION),
    operation_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    revision: z.number().int().nonnegative(),
    status: GovernedAttemptOperationStatus,
    handle: AttemptExecutorHandle_v1,
    authorization: AttemptAuthorization_v1,
    evidence_reservation: ProtectedEvidenceReservationRequest_v1.optional(),
    evidence_declaration: ProtectedEvidenceReference_v1.optional(),
    last_event_sequence: z.number().int().nonnegative(),
    result: GovernedAttemptResult_v1.optional(),
    result_hash: SHA256Hash.optional(),
    created_at: instant,
    updated_at: instant,
    terminal_at: instant.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.operation_id !== value.handle.operation_id ||
      value.attempt_id !== value.handle.attempt_id ||
      value.delegation_id !== value.handle.delegation_id ||
      value.attempt_id !== value.authorization.attempt_id ||
      value.delegation_id !== value.authorization.delegation_id ||
      value.handle.authorization_binding_digest !== value.authorization.binding_digest
    ) {
      context.addIssue({
        code: "custom",
        path: ["handle"],
        message: "operation identity must match the executor handle",
      });
    }
    if ((value.evidence_reservation === undefined) !== (value.evidence_declaration === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["evidence_declaration"],
        message: "evidence reservation and declaration must appear together",
      });
    }
    if (value.evidence_reservation && value.evidence_declaration) {
      const reservation = value.evidence_reservation;
      const declaration = value.evidence_declaration;
      if (
        declaration.status !== "open" ||
        declaration.capture_id !== reservation.capture_id ||
        declaration.authorization_binding_digest !== reservation.authorization_binding_digest ||
        declaration.executor_binding_digest !== reservation.executor_binding_digest ||
        declaration.environment_binding_digest !== reservation.environment_binding_digest ||
        declaration.workspace_binding_digest !== reservation.workspace_binding_digest ||
        declaration.attempt_id !== value.attempt_id ||
        declaration.delegation_id !== value.delegation_id ||
        declaration.authorization_binding_digest !== value.authorization.binding_digest ||
        declaration.executor_binding_digest !== value.authorization.executor_attestation_hash ||
        declaration.environment_binding_digest !==
          value.authorization.environment_attestation_hash ||
        declaration.workspace_binding_digest !== value.authorization.workspace_attestation_hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence_declaration"],
          message: "evidence declaration must exactly bind the operation authorization",
        });
      }
    }
    const terminal = value.status !== "running";
    if (terminal !== (value.terminal_at !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["terminal_at"],
        message: "terminal operation state and terminal_at must appear together",
      });
    }
    if ((value.result !== undefined) !== (value.result_hash !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["result_hash"],
        message: "result and result hash must appear together",
      });
    }
    if (value.result && computeCanonicalHash(value.result) !== value.result_hash) {
      context.addIssue({
        code: "custom",
        path: ["result_hash"],
        message: "operation result hash does not match its result",
      });
    }
    if (
      value.result &&
      (value.result.attempt_id !== value.attempt_id ||
        value.result.delegation_id !== value.delegation_id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "operation result identity does not match the operation",
      });
    }
  });
export type GovernedAttemptOperationRecord_v1 = z.infer<typeof GovernedAttemptOperationRecord_v1>;

export const GovernedAttemptOperationEvent_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_ATTEMPT_OPERATION_STORE_VERSION),
    operation_id: opaqueId,
    attempt_id: opaqueId,
    delegation_id: opaqueId,
    operation_revision: z.number().int().nonnegative(),
    mutation_id: opaqueId,
    mutation_fingerprint: SHA256Hash,
    event: AttemptExecutorEvent_v1,
    created_at: instant,
  })
  .strict();
export type GovernedAttemptOperationEvent_v1 = z.infer<typeof GovernedAttemptOperationEvent_v1>;

export interface CreateGovernedAttemptOperationInput {
  mutationId: string;
  handle: AttemptExecutorHandle;
  authorization: AttemptAuthorization;
  evidenceReservation?: ProtectedEvidenceReservationRequest;
  evidenceDeclaration?: ProtectedEvidenceReference;
  now: string;
}

export interface AppendGovernedAttemptOperationEventInput {
  mutationId: string;
  operationId: string;
  expectedRevision: number;
  event: AttemptExecutorEvent;
  now: string;
}

export interface RecordGovernedAttemptOperationResultInput {
  mutationId: string;
  operationId: string;
  expectedRevision: number;
  result: GovernedAttemptResult;
  now: string;
}

export type GovernedAttemptOperationFailureReason =
  | "not_found"
  | "operation_conflict"
  | "mutation_conflict"
  | "stale_revision"
  | "sequence_mismatch"
  | "terminal_latched"
  | "binding_mismatch"
  | "result_conflict";

export type CreateGovernedAttemptOperationResult =
  | {
      created: true;
      record: GovernedAttemptOperationRecord_v1;
      idempotentReplay: boolean;
    }
  | { created: false; reason: GovernedAttemptOperationFailureReason };

export type AppendGovernedAttemptOperationEventResult =
  | {
      appended: true;
      record: GovernedAttemptOperationRecord_v1;
      event: GovernedAttemptOperationEvent_v1;
      idempotentReplay: boolean;
    }
  | { appended: false; reason: GovernedAttemptOperationFailureReason };

export type RecordGovernedAttemptOperationResultResult =
  | {
      recorded: true;
      record: GovernedAttemptOperationRecord_v1;
      idempotentReplay: boolean;
    }
  | { recorded: false; reason: GovernedAttemptOperationFailureReason };

export interface GovernedAttemptOperationStore {
  createAttemptOperation(
    input: CreateGovernedAttemptOperationInput
  ): Promise<CreateGovernedAttemptOperationResult>;
  appendAttemptOperationEvent(
    input: AppendGovernedAttemptOperationEventInput
  ): Promise<AppendGovernedAttemptOperationEventResult>;
  recordAttemptOperationResult(
    input: RecordGovernedAttemptOperationResultInput
  ): Promise<RecordGovernedAttemptOperationResultResult>;
  getAttemptOperation(operationId: string): Promise<GovernedAttemptOperationRecord_v1 | null>;
  listRecoverableAttemptOperations(): Promise<GovernedAttemptOperationRecord_v1[]>;
  listAttemptOperationEvents(operationId: string): Promise<GovernedAttemptOperationEvent_v1[]>;
}

export function operationStatusForEvent(
  event: AttemptExecutorEvent
): GovernedAttemptOperationStatus {
  switch (event.type) {
    case "declined":
      return "declined";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "lost":
      return "lost";
    default:
      return "running";
  }
}
