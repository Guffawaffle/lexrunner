import { stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import { SqliteGovernedAttemptOperationStore } from "../store/sqlite/governed-attempt-operation-store.js";

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const nativePath = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => !value.includes("\0") && path.isAbsolute(value), {
    message: "must be a runtime-native absolute path",
  });

export const GovernedAttemptOperationStatusRequest_v1 = z
  .object({ databasePath: nativePath, operationId: opaqueId })
  .strict();

export interface GovernedAttemptOperationStatusProjection {
  operation: "agent-work.review.status";
  found: boolean;
  operationId: string;
  attemptId?: string;
  delegationId?: string;
  status?: "running" | "declined" | "completed" | "failed" | "cancelled" | "lost";
  terminal?: boolean;
  resultPending?: boolean;
  lastEventSequence?: number;
  eventCount?: number;
  executor?: { executorId: string; providerHandle: string };
  evidence?: {
    captureId: string;
    declarationStatus: "open";
    reservedBytes: number;
    reservedFrames: number;
  };
  result?: {
    workerOutcome: string;
    taskOutcome: string;
    authorizationOutcome: string;
    evidenceOutcome: string;
    admissibility: string;
  };
}

export interface GovernedAttemptOperationHandlers {
  status(
    request: unknown
  ): Promise<AgentWorkHandlerResult<GovernedAttemptOperationStatusProjection>>;
}

type CloseableOperationStore = GovernedAttemptOperationStore & { close(): Promise<void> };

export interface GovernedAttemptOperationHandlerDependencies {
  openStore?: (databasePath: string, options?: { readOnly?: boolean }) => CloseableOperationStore;
}

export function createGovernedAttemptOperationHandlers(
  dependencies: GovernedAttemptOperationHandlerDependencies = {}
): GovernedAttemptOperationHandlers {
  const openStore =
    dependencies.openStore ??
    ((databasePath: string, options?: { readOnly?: boolean }) =>
      new SqliteGovernedAttemptOperationStore(databasePath, options));
  return {
    async status(candidate) {
      const parsed = GovernedAttemptOperationStatusRequest_v1.safeParse(candidate);
      if (!parsed.success) {
        return invalid(
          parsed.error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          }))
        );
      }
      try {
        const entry = await stat(parsed.data.databasePath);
        if (!entry.isFile()) return invalid([{ path: "databasePath", message: "must be a file" }]);
      } catch {
        return invalid([{ path: "databasePath", message: "must be a file" }]);
      }
      let store: CloseableOperationStore;
      try {
        store = openStore(parsed.data.databasePath, { readOnly: true });
      } catch (error) {
        return operationFailed(error);
      }
      try {
        const record = await store.getAttemptOperation(parsed.data.operationId);
        if (!record) {
          return {
            ok: true,
            result: {
              operation: "agent-work.review.status",
              found: false,
              operationId: parsed.data.operationId,
            },
          };
        }
        const events = await store.listAttemptOperationEvents(record.operation_id);
        return {
          ok: true,
          result: {
            operation: "agent-work.review.status",
            found: true,
            operationId: record.operation_id,
            attemptId: record.attempt_id,
            delegationId: record.delegation_id,
            status: record.status,
            terminal: record.status !== "running",
            resultPending: record.status === "completed" && !record.result,
            lastEventSequence: record.last_event_sequence,
            eventCount: events.length,
            executor: {
              executorId: record.handle.executor_id,
              providerHandle: record.handle.provider_handle,
            },
            ...(record.evidence_reservation && record.evidence_declaration
              ? {
                  evidence: {
                    captureId: record.evidence_declaration.capture_id,
                    declarationStatus: "open" as const,
                    reservedBytes: record.evidence_reservation.reserved_bytes,
                    reservedFrames: record.evidence_reservation.reserved_frames,
                  },
                }
              : {}),
            ...(record.result
              ? {
                  result: {
                    workerOutcome: record.result.worker_outcome,
                    taskOutcome: record.result.task_outcome,
                    authorizationOutcome: record.result.authorization_outcome,
                    evidenceOutcome: record.result.evidence_outcome,
                    admissibility: record.result.admissibility,
                  },
                }
              : {}),
          },
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.close().catch(() => undefined);
      }
    },
  };
}

function invalid(issues: AdapterInputError["issues"]): { ok: false; error: AdapterInputError } {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid governed review status input", issues },
  };
}

function operationFailed(error: unknown): { ok: false; error: AdapterOperationError } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: "operation_failed",
      message: Buffer.from(message, "utf8").subarray(0, 4_096).toString("utf8"),
    },
  };
}
