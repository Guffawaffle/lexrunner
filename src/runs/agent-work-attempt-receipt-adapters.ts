import path from "node:path";
import { stat } from "node:fs/promises";

import { z } from "zod";

import {
  AgentTaskReceipt_v2,
  AgentTaskReceiptOutcome,
  ClaimedCheckOutcome,
} from "../schemas/agent-work.js";
import { SqliteWorkspaceLifecycleStore } from "../store/sqlite/workspace-lifecycle-store.js";
import type { AttemptReceiptSubmissionResult } from "../store/workspace-lifecycle-store.js";
import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import {
  AgentWorkAttemptReceiptService,
  type AttemptReceiptStatusResult,
} from "./agent-work-attempt-receipt-service.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ISSUES = 20;
const text = z.string().min(1).max(4_096);
const shortText = z.string().min(1).max(1_024);
const instant = z.string().datetime({ offset: true });
const revision = z.number().int().nonnegative();
const gitObjectId = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nativePath = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => !value.includes("\0") && path.isAbsolute(value), {
    message: "must be a runtime-native absolute path",
  });
const receiptPath = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") &&
      !value.startsWith("/"),
    { message: "must be a canonical slash-separated repository path" }
  );
const controller = z
  .object({
    runId: text,
    controllerId: text,
    leaseId: text,
    fencingToken: z.number().int().positive(),
  })
  .strict();
const mutation = z.object({ mutationId: text, now: instant }).strict();

const BoundedAgentTaskReceiptV2Schema = z
  .object({
    schema_version: z.literal("2.0.0"),
    receipt_id: text,
    run_id: text,
    work_item_id: text,
    work_item_revision: revision,
    attempt_id: text,
    packet_id: text,
    packet_hash: sha256,
    workspace_lease_id: text,
    workspace_lease_revision: revision,
    worker_runtime: text,
    worker_session_id: text,
    observed_base_sha: gitObjectId,
    final_head_sha: gitObjectId.optional(),
    patch_hash: sha256.optional(),
    outcome: AgentTaskReceiptOutcome,
    exit_reason: text,
    summary: z.string().min(1).max(4_096),
    files_touched: z.array(receiptPath).max(2_048),
    commits: z.array(gitObjectId).max(1_024),
    acceptance_criteria_addressed: z.array(text).max(1_024),
    claimed_checks: z
      .array(
        z
          .object({
            id: text,
            outcome: ClaimedCheckOutcome,
            exit_code: z.number().int().optional(),
            output_snippet: shortText.optional(),
          })
          .strict()
      )
      .max(512),
    assumptions: z.array(shortText).max(512),
    blockers: z.array(shortText).max(512),
    human_action_request_ids: z.array(text).max(512),
    cost: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        tool_calls: z.number().int().nonnegative().optional(),
        elapsed_ms: z.number().int().nonnegative().optional(),
      })
      .strict(),
    worker_started_at: instant,
    worker_completed_at: instant,
    submitted_at: instant,
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = AgentTaskReceipt_v2.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, MAX_ISSUES)) {
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
      }
    }
  });

export const AttemptReceiptSubmitRequestSchema = z
  .object({
    databasePath: nativePath,
    submission: z
      .object({
        runId: text,
        expectedRunRevision: revision,
        controller,
        attemptId: text,
        expectedAttemptRevision: revision,
        workspaceLeaseId: text,
        expectedWorkspaceLeaseRevision: revision,
        workerSessionId: text,
        expectedWorkerSessionRevision: revision,
        receipt: BoundedAgentTaskReceiptV2Schema,
        mutation,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const { submission } = value;
    if (submission.controller.runId !== submission.runId) {
      context.addIssue({
        code: "custom",
        path: ["submission", "controller", "runId"],
        message: "must match submission.runId",
      });
    }
    if (Date.parse(submission.receipt.submitted_at) > Date.parse(submission.mutation.now)) {
      context.addIssue({
        code: "custom",
        path: ["submission", "receipt", "submitted_at"],
        message: "must not be later than mutation.now",
      });
    }
  });

export const AttemptReceiptStatusRequestSchema = z
  .object({ databasePath: nativePath, runId: text, attemptId: text })
  .strict();

export const AttemptReceiptSubmitRequestJsonSchema = z.toJSONSchema(
  AttemptReceiptSubmitRequestSchema,
  { target: "draft-7" }
);
export const AttemptReceiptStatusRequestJsonSchema = z.toJSONSchema(
  AttemptReceiptStatusRequestSchema,
  { target: "draft-7" }
);

export interface AttemptReceiptHandlers {
  submit(request: unknown): Promise<AgentWorkHandlerResult<AttemptReceiptSubmissionResult>>;
  status(request: unknown): Promise<AgentWorkHandlerResult<AttemptReceiptStatusResult>>;
}

export function createAttemptReceiptHandlers(): AttemptReceiptHandlers {
  return {
    async submit(request) {
      const parsed = parseBounded(AttemptReceiptSubmitRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      let store: SqliteWorkspaceLifecycleStore;
      try {
        store = new SqliteWorkspaceLifecycleStore(parsed.data.databasePath);
      } catch (error) {
        return operationFailed(error);
      }
      try {
        const { submission } = parsed.data;
        return {
          ok: true,
          result: await new AgentWorkAttemptReceiptService(store).submit({
            runId: submission.runId,
            expectedRunRevision: submission.expectedRunRevision,
            controller: submission.controller,
            mutationId: submission.mutation.mutationId,
            now: submission.mutation.now,
            attemptId: submission.attemptId,
            expectedAttemptRevision: submission.expectedAttemptRevision,
            workspaceLeaseId: submission.workspaceLeaseId,
            expectedWorkspaceLeaseRevision: submission.expectedWorkspaceLeaseRevision,
            workerSessionId: submission.workerSessionId,
            expectedWorkerSessionRevision: submission.expectedWorkerSessionRevision,
            receipt: submission.receipt,
          }),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.close().catch(() => undefined);
      }
    },
    async status(request) {
      const parsed = parseBounded(AttemptReceiptStatusRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      try {
        const entry = await stat(parsed.data.databasePath);
        if (!entry.isFile()) return invalid([{ path: "databasePath", message: "must be a file" }]);
      } catch {
        return invalid([{ path: "databasePath", message: "must be a file" }]);
      }
      let store: SqliteWorkspaceLifecycleStore;
      try {
        store = new SqliteWorkspaceLifecycleStore(parsed.data.databasePath, { readOnly: true });
      } catch (error) {
        return operationFailed(error);
      }
      try {
        return {
          ok: true,
          result: await new AgentWorkAttemptReceiptService(store).status(parsed.data),
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
  | { success: true; data: T }
  | { success: false; failure: { ok: false; error: AdapterInputError } };

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

function invalid(issues: Array<{ path: string; message: string }>): {
  ok: false;
  error: AdapterInputError;
} {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid Attempt receipt input", issues },
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
