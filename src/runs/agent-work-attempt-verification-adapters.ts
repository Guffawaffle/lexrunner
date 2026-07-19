import { stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { SqliteWorkspaceLifecycleStore } from "../store/sqlite/workspace-lifecycle-store.js";
import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import {
  AgentWorkAttemptAcceptanceService,
  AgentWorkAttemptVerificationService,
  type AttemptAcceptanceResult,
  type AttemptAcceptanceStatusResult,
  type AttemptVerificationRunResult,
  type AttemptVerificationStatusResult,
} from "./agent-work-attempt-verification-service.js";
import {
  LocalAttemptVerificationRuntime,
  type AttemptVerificationRuntime,
} from "./agent-work-attempt-verification-runtime.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ISSUES = 20;
const text = z.string().min(1).max(4_096);
const revision = z.number().int().nonnegative();
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nativePath = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => !value.includes("\0") && path.isAbsolute(value), {
    message: "must be a runtime-native absolute path",
  });
const controller = z
  .object({
    runId: text,
    controllerId: text,
    leaseId: text,
    fencingToken: z.number().int().positive(),
  })
  .strict();

const verificationBinding = {
  runId: text,
  expectedRunRevision: revision,
  controller,
  verificationId: text,
  attemptId: text,
  expectedAttemptRevision: revision,
  workspaceLeaseId: text,
  expectedWorkspaceLeaseRevision: revision,
  workerSessionId: text,
  expectedWorkerSessionRevision: revision,
  receiptId: text,
  receiptHash: sha256,
};

export const AttemptVerificationRunRequestSchema = z
  .object({
    databasePath: nativePath,
    verification: z
      .object({
        ...verificationBinding,
        beginMutationId: text,
        completeMutationId: text,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verification.controller.runId !== value.verification.runId) {
      context.addIssue({
        code: "custom",
        path: ["verification", "controller", "runId"],
        message: "must match verification.runId",
      });
    }
    if (value.verification.beginMutationId === value.verification.completeMutationId) {
      context.addIssue({
        code: "custom",
        path: ["verification", "completeMutationId"],
        message: "must differ from beginMutationId",
      });
    }
  });

export const AttemptVerificationStatusRequestSchema = z
  .object({
    databasePath: nativePath,
    runId: text,
    attemptId: text,
    diagnostics: z.boolean().optional(),
  })
  .strict();

export const AttemptAcceptanceApplyRequestSchema = z
  .object({
    databasePath: nativePath,
    acceptance: z
      .object({
        ...verificationBinding,
        verificationHash: sha256,
        mutationId: text,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.acceptance.controller.runId !== value.acceptance.runId) {
      context.addIssue({
        code: "custom",
        path: ["acceptance", "controller", "runId"],
        message: "must match acceptance.runId",
      });
    }
  });

export const AttemptAcceptanceStatusRequestSchema = z
  .object({ databasePath: nativePath, runId: text, attemptId: text })
  .strict();

export const AttemptVerificationRunRequestJsonSchema = z.toJSONSchema(
  AttemptVerificationRunRequestSchema,
  { target: "draft-7" }
);
export const AttemptVerificationStatusRequestJsonSchema = z.toJSONSchema(
  AttemptVerificationStatusRequestSchema,
  { target: "draft-7" }
);
export const AttemptAcceptanceApplyRequestJsonSchema = z.toJSONSchema(
  AttemptAcceptanceApplyRequestSchema,
  { target: "draft-7" }
);
export const AttemptAcceptanceStatusRequestJsonSchema = z.toJSONSchema(
  AttemptAcceptanceStatusRequestSchema,
  { target: "draft-7" }
);

export interface AttemptVerificationHandlers {
  run(request: unknown): Promise<AgentWorkHandlerResult<AttemptVerificationRunResult>>;
  status(request: unknown): Promise<AgentWorkHandlerResult<AttemptVerificationStatusResult>>;
  applyAcceptance(request: unknown): Promise<AgentWorkHandlerResult<AttemptAcceptanceResult>>;
  acceptanceStatus(
    request: unknown
  ): Promise<AgentWorkHandlerResult<AttemptAcceptanceStatusResult>>;
}

export interface AttemptVerificationHandlerOptions {
  runtime?: AttemptVerificationRuntime;
  now?: () => string;
}

export function createAttemptVerificationHandlers(
  options: AttemptVerificationHandlerOptions = {}
): AttemptVerificationHandlers {
  const runtime = options.runtime ?? new LocalAttemptVerificationRuntime();
  return {
    async run(request) {
      const parsed = parseBounded(AttemptVerificationRunRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      const store = openStore(parsed.data.databasePath);
      if (!store.ok) return store.failure;
      try {
        return {
          ok: true,
          result: await new AgentWorkAttemptVerificationService(
            store.value,
            runtime,
            options.now
          ).run(parsed.data.verification),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.value.close().catch(() => undefined);
      }
    },
    async status(request) {
      const parsed = parseBounded(AttemptVerificationStatusRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      const readable = await requireExistingFile(parsed.data.databasePath);
      if (!readable) return invalid([{ path: "databasePath", message: "must be a file" }]);
      const store = openStore(parsed.data.databasePath, true);
      if (!store.ok) return store.failure;
      try {
        return {
          ok: true,
          result: await new AgentWorkAttemptVerificationService(
            store.value,
            runtime,
            options.now
          ).status(parsed.data),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.value.close().catch(() => undefined);
      }
    },
    async applyAcceptance(request) {
      const parsed = parseBounded(AttemptAcceptanceApplyRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      const store = openStore(parsed.data.databasePath);
      if (!store.ok) return store.failure;
      try {
        return {
          ok: true,
          result: await new AgentWorkAttemptAcceptanceService(store.value, options.now).apply(
            parsed.data.acceptance
          ),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.value.close().catch(() => undefined);
      }
    },
    async acceptanceStatus(request) {
      const parsed = parseBounded(AttemptAcceptanceStatusRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      const readable = await requireExistingFile(parsed.data.databasePath);
      if (!readable) return invalid([{ path: "databasePath", message: "must be a file" }]);
      const store = openStore(parsed.data.databasePath, true);
      if (!store.ok) return store.failure;
      try {
        return {
          ok: true,
          result: await new AgentWorkAttemptAcceptanceService(store.value, options.now).status(
            parsed.data
          ),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.value.close().catch(() => undefined);
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

function openStore(
  databasePath: string,
  readOnly = false
):
  | { ok: true; value: SqliteWorkspaceLifecycleStore }
  | { ok: false; failure: { ok: false; error: AdapterOperationError } } {
  try {
    return {
      ok: true,
      value: new SqliteWorkspaceLifecycleStore(databasePath, { readOnly }),
    };
  } catch (error) {
    return { ok: false, failure: operationFailed(error) };
  }
}

async function requireExistingFile(databasePath: string): Promise<boolean> {
  try {
    return (await stat(databasePath)).isFile();
  } catch {
    return false;
  }
}

function invalid(issues: Array<{ path: string; message: string }>): {
  ok: false;
  error: AdapterInputError;
} {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid Attempt verification input", issues },
  };
}

function operationFailed(error: unknown): { ok: false; error: AdapterOperationError } {
  return {
    ok: false,
    error: {
      code: "operation_failed",
      message: bounded(error instanceof Error ? error.message : String(error)),
    },
  };
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
