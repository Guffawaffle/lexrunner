import path from "node:path";
import { stat } from "node:fs/promises";

import { z } from "zod";

import {
  DelegationInvocationRequest_v1,
  DelegationOffer_v1,
  createDelegationDecisionReceipt,
} from "./governed-attempt-protocol.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { SqliteGovernedDelegationStore } from "../store/sqlite/governed-delegation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import {
  GovernedDelegationService,
  type GovernedDelegationStatusProjection,
} from "./governed-delegation-service.js";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_ISSUES = 20;
const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const nativePath = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => !value.includes("\0") && path.isAbsolute(value), {
    message: "must be a runtime-native absolute path",
  });

export const SyntheticDelegationRequestSchema = z
  .object({
    databasePath: nativePath,
    delegationId: opaqueId,
    attemptId: opaqueId.optional(),
    decision: z.enum(["ACCEPT", "NO"]),
    reason: z.string().min(1).max(4_096).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "ACCEPT" && value.reason !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "a refusal reason is valid only with NO",
      });
    }
  });

export const GovernedDelegationStatusRequestSchema = z
  .object({ databasePath: nativePath, delegationId: opaqueId })
  .strict();

export interface SyntheticDelegationResult {
  operation: "agent-work.delegation.synthetic";
  syntheticOnly: true;
  completed: boolean;
  delegationId: string;
  attemptId: string;
  status?: "offered" | "accepted" | "declined";
  decision?: "accept" | "decline";
  terminal?: boolean;
  reasonVolunteered?: boolean;
  executorInvocation?: {
    attempted: false;
    authorized: boolean;
    denialReason?: string;
  };
  evidence?: {
    offerHash: string;
    decisionReceiptHash: string;
    authorizationBindingHash?: string;
  };
  eventCount?: number;
  reason?: string;
}

export interface GovernedDelegationHandlers {
  synthetic(request: unknown): Promise<AgentWorkHandlerResult<SyntheticDelegationResult>>;
  status(request: unknown): Promise<AgentWorkHandlerResult<GovernedDelegationStatusProjection>>;
}

interface CloseableGovernedDelegationStore extends GovernedDelegationStore {
  close(): Promise<void>;
}

export interface GovernedDelegationHandlerDependencies {
  now?: () => string;
  openStore?: (
    databasePath: string,
    options?: { readOnly?: boolean }
  ) => CloseableGovernedDelegationStore;
}

export function createGovernedDelegationHandlers(
  dependencies: GovernedDelegationHandlerDependencies = {}
): GovernedDelegationHandlers {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const openStore =
    dependencies.openStore ??
    ((databasePath: string, options?: { readOnly?: boolean }) =>
      new SqliteGovernedDelegationStore(databasePath, options));
  return {
    async synthetic(request) {
      const parsed = parseBounded(SyntheticDelegationRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      let store: CloseableGovernedDelegationStore;
      try {
        store = openStore(parsed.data.databasePath);
      } catch (error) {
        return operationFailed(error);
      }
      try {
        const service = new GovernedDelegationService(store);
        const input = parsed.data;
        const at = normalizeInstant(now());
        const attemptId = input.attemptId ?? `synthetic-attempt:${input.delegationId}`;
        const syntheticHash = (kind: string): string =>
          computeCanonicalHash({
            protocol: "lexrunner.synthetic-governed-delegation@1.0.0",
            kind,
            delegation_id: input.delegationId,
            attempt_id: attemptId,
          });
        const offer = DelegationOffer_v1.parse({
          schema_version: "1.0.0",
          delegation_id: input.delegationId,
          attempt_id: attemptId,
          worker: {
            provider_id: "lexrunner.synthetic",
            worker_id: `synthetic-worker:${syntheticHash("worker").slice(-16)}`,
            thread_id: `synthetic-thread:${syntheticHash("thread").slice(-16)}`,
          },
          task_offer_hash: syntheticHash("task-offer"),
          requirements_hash: syntheticHash("requirements"),
          authority_grant_hash: syntheticHash("authority-grant"),
          transcript_start_hash: syntheticHash("transcript-start"),
          offered_at: at,
        });
        const created = await service.create({
          mutationId: `synthetic-offer:${input.delegationId}`,
          offer,
          now: at,
        });
        if (!created.created) {
          return {
            ok: true,
            result: {
              operation: "agent-work.delegation.synthetic",
              syntheticOnly: true,
              completed: false,
              delegationId: input.delegationId,
              attemptId,
              reason: created.reason,
            },
          };
        }

        const receipt = createDelegationDecisionReceipt({
          offer,
          decision:
            input.decision === "NO" && input.reason !== undefined
              ? { decision: "NO", reason: input.reason }
              : input.decision,
          decisionReceiptId: `synthetic-decision:${input.delegationId}`,
          decidedAt: at,
        });
        const decided = await service.decide({
          mutationId: `synthetic-decision:${input.delegationId}`,
          delegationId: input.delegationId,
          expectedRevision: 0,
          receipt,
          now: at,
        });
        if (!decided.recorded) {
          return {
            ok: true,
            result: {
              operation: "agent-work.delegation.synthetic",
              syntheticOnly: true,
              completed: false,
              delegationId: input.delegationId,
              attemptId,
              reason: decided.reason,
            },
          };
        }

        const invocation = DelegationInvocationRequest_v1.parse({
          schema_version: "1.0.0",
          delegation_id: input.delegationId,
          attempt_id: attemptId,
          offer_hash: created.record.offer_hash,
          authority_grant_hash: offer.authority_grant_hash,
          worker_thread_id: offer.worker.thread_id,
          transcript_start_hash: offer.transcript_start_hash,
          provider_attestation_hash: syntheticHash("provider-attestation"),
          environment_attestation_hash: syntheticHash("environment-attestation"),
          workspace_attestation_hash: syntheticHash("empty-workspace-attestation"),
          phase: "authorized_work",
        });
        const authorization = await service.authorize({
          mutationId: `synthetic-authorize:${input.delegationId}`,
          delegationId: input.delegationId,
          expectedRevision: decided.record.revision,
          request: invocation,
          now: at,
        });
        const status = await service.status(input.delegationId);
        const authorized = authorization.authorized;
        return {
          ok: true,
          result: {
            operation: "agent-work.delegation.synthetic",
            syntheticOnly: true,
            completed: true,
            delegationId: input.delegationId,
            attemptId,
            status: decided.record.status,
            decision: receipt.decision,
            terminal: decided.record.status === "declined",
            reasonVolunteered: receipt.reason !== undefined,
            executorInvocation: {
              attempted: false,
              authorized,
              ...(!authorized ? { denialReason: authorization.reason } : {}),
            },
            evidence: {
              offerHash: created.record.offer_hash,
              decisionReceiptHash: decided.decisionReceiptHash,
              ...(authorized
                ? { authorizationBindingHash: authorization.authorizationBindingHash }
                : {}),
            },
            eventCount: status.events.length,
          },
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.close().catch(() => undefined);
      }
    },

    async status(request) {
      const parsed = parseBounded(GovernedDelegationStatusRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      try {
        const entry = await stat(parsed.data.databasePath);
        if (!entry.isFile()) return invalid([{ path: "databasePath", message: "must be a file" }]);
      } catch {
        return invalid([{ path: "databasePath", message: "must be a file" }]);
      }
      let store: CloseableGovernedDelegationStore;
      try {
        store = openStore(parsed.data.databasePath, { readOnly: true });
      } catch (error) {
        return operationFailed(error);
      }
      try {
        return {
          ok: true,
          result: await new GovernedDelegationService(store).status(parsed.data.delegationId),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.close().catch(() => undefined);
      }
    },
  };
}

type ParseResult<T> =
  { success: true; data: T } | { success: false; failure: { ok: false; error: AdapterInputError } };

function parseBounded<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  if (!isJsonSafe(input)) {
    return { success: false, failure: invalid([{ path: "", message: "input must be JSON-safe" }]) };
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return { success: false, failure: invalid([{ path: "", message: "input must be JSON-safe" }]) };
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > MAX_INPUT_BYTES) {
    return {
      success: false,
      failure: invalid([{ path: "", message: `input exceeds ${MAX_INPUT_BYTES} bytes` }]),
    };
  }
  const parsed = schema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    failure: invalid(
      parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    ),
  };
}

function invalid(issues: AdapterInputError["issues"]): { ok: false; error: AdapterInputError } {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid governed Delegation input", issues },
  };
}

function operationFailed(error: unknown): { ok: false; error: AdapterOperationError } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: "operation_failed", message: bounded(message) } };
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= 4_096) return value;
  let end = 4_093;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}

function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null) return depth <= 32;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonSafe(entry, depth + 1));
  return Object.values(value).every((entry) => isJsonSafe(entry, depth + 1));
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid governed Delegation clock value");
  return new Date(timestamp).toISOString();
}
