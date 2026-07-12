import path from "node:path";
import { stat } from "node:fs/promises";

import { z } from "zod";

import { RunStateSchema } from "./types.js";
import type {
  AgentWorkLifecycleResult,
  AgentWorkStatus,
  StartAttemptInput,
} from "./agent-work-lifecycle-service.js";
import { readAgentWorkStatus } from "./agent-work-lifecycle-service.js";
import {
  AgentWorkRuntimeConfigSchema,
  createAgentWorkRuntime,
  type AgentWorkRuntimeConfig,
} from "./agent-work-runtime.js";
import { SqliteWorkspaceLifecycleStore } from "../store/sqlite/workspace-lifecycle-store.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_TEXT = 4_096;
const MAX_PATH = 16_384;
const MAX_ISSUES = 20;

const text = z.string().min(1).max(MAX_TEXT);
const nativePath = z
  .string()
  .min(1)
  .max(MAX_PATH)
  .refine((value) => !value.includes("\0"), {
    message: "must not contain NUL bytes",
  });
const instant = z.string().datetime({ offset: true });
const revision = z.number().int().nonnegative();
const positiveTtl = z
  .number()
  .int()
  .positive()
  .max(24 * 60 * 60 * 1_000);
const mutation = z.object({ mutationId: text, now: instant }).strict();

export const AttemptStartInputSchema = z
  .object({
    runId: text,
    initialRunState: RunStateSchema,
    controller: z
      .object({ controllerId: text, leaseId: text, now: instant, ttlMs: positiveTtl })
      .strict(),
    attempt: z
      .object({
        attemptId: text,
        workItemId: text,
        workItemRevision: revision,
        packetId: text,
        packetHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        baseSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
      })
      .strict(),
    workspace: z
      .object({
        workspaceLeaseId: text,
        repositoryId: text,
        hostId: text,
        gitRuntime: text,
        projectRoot: nativePath,
        branch: text,
        worktreePath: nativePath,
        ttlMs: positiveTtl,
      })
      .strict(),
    mutations: z
      .object({
        createAttempt: mutation,
        reserveWorkspace: mutation,
        activateWorkspace: mutation,
        resumeWorkspace: mutation,
        quarantineWorkspace: mutation,
        authorizeLaunch: mutation,
      })
      .strict(),
    broker: z.object({ timeoutMs: positiveTtl }).strict().optional(),
  })
  .strict();

export const AttemptStatusInputSchema = z
  .object({
    databasePath: nativePath.refine((value) => path.isAbsolute(value), {
      message: "must be a runtime-native absolute path",
    }),
    runId: text,
    attemptId: text,
  })
  .strict();

export const AttemptStartRequestSchema = z
  .object({ runtime: AgentWorkRuntimeConfigSchema, attempt: AttemptStartInputSchema })
  .strict();

export const AttemptStartRequestJsonSchema = z.toJSONSchema(AttemptStartRequestSchema, {
  target: "draft-7",
});
export const AttemptStatusInputJsonSchema = z.toJSONSchema(AttemptStatusInputSchema, {
  target: "draft-7",
});

export type AttemptStartHandlerInput = z.infer<typeof AttemptStartInputSchema>;
export type AttemptStatusHandlerInput = z.infer<typeof AttemptStatusInputSchema>;
export type AttemptStartRequest = z.infer<typeof AttemptStartRequestSchema>;

export interface AgentWorkRuntimeBinding {
  repositoryId: string;
  repositoryRoot: string;
  worktreeRoot: string;
  hostId: string;
  gitRuntime: string;
  pathComparison: "case-sensitive" | "case-insensitive";
}

export interface AdapterInputError {
  code: "invalid_input";
  message: string;
  issues: Array<{ path: string; message: string }>;
}

export interface AdapterOperationError {
  code: "operation_failed";
  message: string;
}

export type AdapterError = AdapterInputError | AdapterOperationError;

export type AgentWorkHandlerResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: AdapterError };

export interface AttemptLifecycleHandlers {
  start(request: unknown): Promise<AgentWorkHandlerResult<AgentWorkLifecycleResult>>;
  status(request: unknown): Promise<AgentWorkHandlerResult<AgentWorkStatus>>;
}

/** Top-level lifecycle seam. Every request owns and closes its SQLite connection. */
export function createAttemptLifecycleHandlers(): AttemptLifecycleHandlers {
  return {
    async start(request) {
      const parsed = parseBounded(AttemptStartRequestSchema, request);
      if (!parsed.success) return parsed.failure;
      const mismatch = bindingIssue(parsed.data.attempt, parsed.data.runtime);
      if (mismatch) return invalid([mismatch]);
      let runtime;
      try {
        runtime = createAgentWorkRuntime(parsed.data.runtime);
      } catch (error) {
        return operationFailed(error);
      }
      try {
        return {
          ok: true,
          result: await runtime.service.startAttempt(parsed.data.attempt as StartAttemptInput),
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await runtime.close().catch(() => undefined);
      }
    },
    async status(request) {
      const parsed = parseBounded(AttemptStatusInputSchema, request);
      if (!parsed.success) return parsed.failure;
      try {
        const database = await stat(parsed.data.databasePath);
        if (!database.isFile()) {
          return invalid([{ path: "databasePath", message: "must identify an existing file" }]);
        }
      } catch {
        return invalid([{ path: "databasePath", message: "must identify an existing file" }]);
      }
      let store: SqliteWorkspaceLifecycleStore;
      try {
        store = new SqliteWorkspaceLifecycleStore(parsed.data.databasePath, { readOnly: true });
      } catch (error) {
        return operationFailed(error);
      }
      try {
        return { ok: true, result: await readAgentWorkStatus(store, store, parsed.data) };
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
    return {
      success: false,
      failure: invalid([{ path: "", message: "input must be JSON-safe" }]),
    };
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return { success: false, failure: invalid([{ path: "", message: "input must be JSON-safe" }]) };
  }
  if (encoded === undefined)
    return { success: false, failure: invalid([{ path: "", message: "input must be JSON-safe" }]) };
  if (Buffer.byteLength(encoded, "utf8") > MAX_INPUT_BYTES) {
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
        path: issue.path.map(String).join("."),
        message: issue.message.slice(0, 512),
      }))
    ),
  };
}

function isJsonSafe(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth > 100) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
    return false;
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const safe = entries.every((entry) => isJsonSafe(entry, seen, depth + 1));
  seen.delete(value);
  return safe;
}

function bindingIssue(
  input: AttemptStartHandlerInput,
  binding: AgentWorkRuntimeBinding
): { path: string; message: string } | null {
  const workspace = input.workspace;
  if (workspace.repositoryId !== binding.repositoryId)
    return { path: "attempt.workspace.repositoryId", message: "must match the configured runtime" };
  if (workspace.hostId !== binding.hostId)
    return { path: "attempt.workspace.hostId", message: "must match the configured runtime" };
  if (workspace.gitRuntime !== binding.gitRuntime)
    return { path: "attempt.workspace.gitRuntime", message: "must match the configured runtime" };
  if (!samePath(workspace.projectRoot, binding.repositoryRoot, binding.pathComparison))
    return {
      path: "attempt.workspace.projectRoot",
      message: "must match the configured repositoryRoot",
    };
  if (!strictDescendant(workspace.worktreePath, binding.worktreeRoot, binding.pathComparison))
    return {
      path: "attempt.workspace.worktreePath",
      message: "must be beneath configured worktreeRoot",
    };
  return null;
}

function samePath(
  left: string,
  right: string,
  comparison: AgentWorkRuntimeBinding["pathComparison"]
): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/[\\/]+$/u, "");
  const a = normalize(left);
  const b = normalize(right);
  return comparison === "case-insensitive" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function strictDescendant(
  child: string,
  root: string,
  comparison: AgentWorkRuntimeBinding["pathComparison"]
): boolean {
  const normalize = (value: string) =>
    path.resolve(value).replace(/\\/gu, "/").replace(/\/+$/u, "");
  let candidate = normalize(child);
  let parent = normalize(root);
  if (comparison === "case-insensitive") {
    candidate = candidate.toLowerCase();
    parent = parent.toLowerCase();
  }
  return candidate.startsWith(`${parent}/`) && candidate.length > parent.length + 1;
}

function invalid(issues: AdapterInputError["issues"]): { ok: false; error: AdapterInputError } {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid attempt lifecycle input", issues },
  };
}

function operationFailed(error: unknown): { ok: false; error: AdapterOperationError } {
  return {
    ok: false,
    error: { code: "operation_failed", message: safeError(error) },
  };
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "lifecycle operation failed").slice(0, 512);
}
