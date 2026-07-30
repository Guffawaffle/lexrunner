import { z } from "zod";

import {
  NativeWslProjectionRequest_v1,
  nativeWslProjectionId,
  type NativeWslProjectionReasonCode,
} from "../schemas/agent-work-projection.js";
import type {
  NativeWslProjectionCleanupResult,
  NativeWslProjectionCommandEvidence,
  NativeWslProjectionInspection,
  NativeWslProjectionResult,
} from "../workspaces/native-wsl-projection-engine.js";
import { NativeWslProjectionEngine } from "../workspaces/native-wsl-projection-engine.js";
import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ISSUES = 20;
const text = z.string().min(1).max(4_096);
const mutationAuthority = z
  .object({
    authorized: z.literal(true),
    reason: text.optional(),
  })
  .strict();

export const NativeWslProjectionPrepareRequestSchema = z
  .object({
    request: NativeWslProjectionRequest_v1,
    mutation: mutationAuthority,
  })
  .strict();
export const NativeWslProjectionStatusRequestSchema = z
  .object({ request: NativeWslProjectionRequest_v1 })
  .strict();
export const NativeWslProjectionCleanupRequestSchema = z
  .object({
    request: NativeWslProjectionRequest_v1,
    mutation: mutationAuthority,
    includeQuarantine: z.boolean().optional(),
  })
  .strict();
export const NativeWslProjectionQuarantineRequestSchema = z
  .object({ request: NativeWslProjectionRequest_v1 })
  .strict();

export const NativeWslProjectionPrepareRequestJsonSchema = z.toJSONSchema(
  NativeWslProjectionPrepareRequestSchema,
  { target: "draft-7" }
);
export const NativeWslProjectionStatusRequestJsonSchema = z.toJSONSchema(
  NativeWslProjectionStatusRequestSchema,
  { target: "draft-7" }
);
export const NativeWslProjectionCleanupRequestJsonSchema = z.toJSONSchema(
  NativeWslProjectionCleanupRequestSchema,
  { target: "draft-7" }
);
export const NativeWslProjectionQuarantineRequestJsonSchema = z.toJSONSchema(
  NativeWslProjectionQuarantineRequestSchema,
  { target: "draft-7" }
);

export type NativeWslProjectionPrepareRequest = z.infer<
  typeof NativeWslProjectionPrepareRequestSchema
>;
export type NativeWslProjectionStatusRequest = z.infer<
  typeof NativeWslProjectionStatusRequestSchema
>;
export type NativeWslProjectionCleanupRequest = z.infer<
  typeof NativeWslProjectionCleanupRequestSchema
>;

export type NativeWslProjectionPublicNextAction =
  | "prepare_projection"
  | "retry_projection_status"
  | "prepare_attempt"
  | "inspect_quarantine"
  | "cleanup_projection"
  | "remove_active_worktrees"
  | "correct_projection_request";

export interface NativeWslProjectionPrepareResult {
  schemaVersion: "1.0.0";
  operation: "agent-work.projection.prepare";
  outcome: NativeWslProjectionResult["outcome"];
  state: "ready" | "rejected" | "quarantined";
  reasonCode: NativeWslProjectionReasonCode;
  projectionId: string;
  requestDigest: string;
  selectionDigest?: string;
  manifestDigest?: string;
  mappingDigest?: string;
  sourceObservationDigest?: string;
  commandEvidence: NativeWslProjectionCommandEvidence[];
  nextActions: NativeWslProjectionPublicNextAction[];
}

export interface NativeWslProjectionStatusResult extends Omit<
  NativeWslProjectionInspection,
  "commandEvidence"
> {
  schemaVersion: "1.0.0";
  operation: "agent-work.projection.status";
  commandEvidence: NativeWslProjectionCommandEvidence[];
  nextActions: NativeWslProjectionPublicNextAction[];
}

export interface NativeWslProjectionQuarantineResult {
  schemaVersion: "1.0.0";
  operation: "agent-work.projection.quarantine.inspect";
  projectionId: string;
  requestDigest: string;
  state: NativeWslProjectionInspection["state"];
  quarantine: NativeWslProjectionInspection["quarantine"];
  nextActions: NativeWslProjectionPublicNextAction[];
}

export interface NativeWslProjectionCleanupPublicResult extends NativeWslProjectionCleanupResult {
  schemaVersion: "1.0.0";
  operation: "agent-work.projection.cleanup";
  nextActions: NativeWslProjectionPublicNextAction[];
}

export interface ProjectionLifecycleEngine {
  prepare(
    request: NativeWslProjectionPrepareRequest["request"]
  ): Promise<NativeWslProjectionResult>;
  inspect(
    request: NativeWslProjectionStatusRequest["request"]
  ): Promise<NativeWslProjectionInspection>;
  cleanup(
    request: NativeWslProjectionCleanupRequest["request"],
    includeQuarantine?: boolean
  ): Promise<NativeWslProjectionCleanupResult>;
}

export interface NativeWslProjectionLifecycleHandlers {
  prepare(request: unknown): Promise<AgentWorkHandlerResult<NativeWslProjectionPrepareResult>>;
  status(request: unknown): Promise<AgentWorkHandlerResult<NativeWslProjectionStatusResult>>;
  cleanup(
    request: unknown
  ): Promise<AgentWorkHandlerResult<NativeWslProjectionCleanupPublicResult>>;
  quarantine(
    request: unknown
  ): Promise<AgentWorkHandlerResult<NativeWslProjectionQuarantineResult>>;
}

/** One bounded application seam shared by the projection CLI and MCP adapters. */
export function createNativeWslProjectionLifecycleHandlers(
  engine: ProjectionLifecycleEngine = new NativeWslProjectionEngine()
): NativeWslProjectionLifecycleHandlers {
  return {
    async prepare(input) {
      const parsed = parseBounded(NativeWslProjectionPrepareRequestSchema, input);
      if (!parsed.success) return parsed.failure;
      try {
        return { ok: true, result: publicPrepare(await engine.prepare(parsed.data.request)) };
      } catch (error) {
        return operationFailed(error);
      }
    },
    async status(input) {
      const parsed = parseBounded(NativeWslProjectionStatusRequestSchema, input);
      if (!parsed.success) return parsed.failure;
      try {
        return { ok: true, result: publicStatus(await engine.inspect(parsed.data.request)) };
      } catch (error) {
        return operationFailed(error);
      }
    },
    async cleanup(input) {
      const parsed = parseBounded(NativeWslProjectionCleanupRequestSchema, input);
      if (!parsed.success) return parsed.failure;
      try {
        const result = await engine.cleanup(
          parsed.data.request,
          parsed.data.includeQuarantine ?? true
        );
        return { ok: true, result: publicCleanup(result) };
      } catch (error) {
        return operationFailed(error);
      }
    },
    async quarantine(input) {
      const parsed = parseBounded(NativeWslProjectionQuarantineRequestSchema, input);
      if (!parsed.success) return parsed.failure;
      try {
        const inspected = await engine.inspect(parsed.data.request);
        return {
          ok: true,
          result: {
            schemaVersion: "1.0.0",
            operation: "agent-work.projection.quarantine.inspect",
            projectionId: inspected.projectionId,
            requestDigest: inspected.requestDigest,
            state: inspected.state,
            quarantine: inspected.quarantine,
            nextActions:
              inspected.quarantine.repository.count + inspected.quarantine.allocation.count > 0
                ? ["cleanup_projection"]
                : statusNextActions(inspected),
          },
        };
      } catch (error) {
        return operationFailed(error);
      }
    },
  };
}

function publicPrepare(result: NativeWslProjectionResult): NativeWslProjectionPrepareResult {
  if (result.ok) {
    return {
      schemaVersion: "1.0.0",
      operation: "agent-work.projection.prepare",
      outcome: result.outcome,
      state: "ready",
      reasonCode: result.receipt.reason_code,
      projectionId: result.manifest.projection_id,
      requestDigest: result.receipt.request_digest,
      selectionDigest: result.selection.selection_digest,
      manifestDigest: result.manifest.manifest_digest,
      mappingDigest: result.manifest.path_mapping.mapping_digest,
      sourceObservationDigest: result.sourceObservation.observation_digest,
      commandEvidence: result.commandEvidence,
      nextActions: ["prepare_attempt"],
    };
  }
  return {
    schemaVersion: "1.0.0",
    operation: "agent-work.projection.prepare",
    outcome: result.outcome,
    state: result.outcome === "quarantined" ? "quarantined" : "rejected",
    reasonCode: result.reasonCode,
    projectionId: nativeWslProjectionId(result.receipt.request_digest),
    requestDigest: result.receipt.request_digest,
    ...(result.sourceObservation
      ? { sourceObservationDigest: result.sourceObservation.observation_digest }
      : {}),
    commandEvidence: result.commandEvidence,
    nextActions: prepareFailureNextActions(result.reasonCode, result.outcome),
  };
}

function publicStatus(inspected: NativeWslProjectionInspection): NativeWslProjectionStatusResult {
  return {
    schemaVersion: "1.0.0",
    operation: "agent-work.projection.status",
    ...inspected,
    nextActions: statusNextActions(inspected),
  };
}

function publicCleanup(
  result: NativeWslProjectionCleanupResult
): NativeWslProjectionCleanupPublicResult {
  const nextActions: NativeWslProjectionPublicNextAction[] =
    result.outcome === "refused" && result.reasonCode === "active_worktrees"
      ? ["remove_active_worktrees", "cleanup_projection"]
      : result.outcome === "quarantined"
        ? ["inspect_quarantine", "cleanup_projection"]
        : result.outcome === "failed"
          ? ["inspect_quarantine", "cleanup_projection"]
          : ["prepare_projection"];
  return {
    schemaVersion: "1.0.0",
    operation: "agent-work.projection.cleanup",
    ...result,
    nextActions,
  };
}

function statusNextActions(
  inspected: NativeWslProjectionInspection
): NativeWslProjectionPublicNextAction[] {
  const hasQuarantine =
    inspected.quarantine.repository.count + inspected.quarantine.allocation.count > 0;
  switch (inspected.state) {
    case "ready":
      return hasQuarantine ? ["prepare_attempt", "inspect_quarantine"] : ["prepare_attempt"];
    case "preparing":
      return ["retry_projection_status"];
    case "ready_unselected":
    case "stale":
    case "invalid":
      return hasQuarantine ? ["prepare_projection", "inspect_quarantine"] : ["prepare_projection"];
    case "conflicting":
      return ["correct_projection_request", "cleanup_projection"];
    case "absent":
      return hasQuarantine ? ["inspect_quarantine", "prepare_projection"] : ["prepare_projection"];
  }
}

function prepareFailureNextActions(
  reasonCode: string,
  outcome: NativeWslProjectionResult["outcome"]
): NativeWslProjectionPublicNextAction[] {
  if (outcome === "quarantined") return ["inspect_quarantine", "cleanup_projection"];
  if (reasonCode === "concurrent_request") return ["retry_projection_status"];
  if (
    reasonCode === "source_dirty" ||
    reasonCode === "source_head_mismatch" ||
    reasonCode === "repository_identity_mismatch"
  ) {
    return ["correct_projection_request"];
  }
  return ["inspect_quarantine", "prepare_projection"];
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
        path: issue.path.map(String).join("."),
        message: issue.message.slice(0, 512),
      }))
    ),
  };
}

function invalid(issues: AdapterInputError["issues"]): {
  ok: false;
  error: AdapterInputError;
} {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid projection lifecycle input", issues },
  };
}

function operationFailed(_error: unknown): { ok: false; error: AdapterOperationError } {
  return {
    ok: false,
    error: {
      code: "operation_failed",
      message: "Projection lifecycle operation failed",
    },
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
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    return false;
  }
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const safe = entries.every((entry) => isJsonSafe(entry, seen, depth + 1));
  seen.delete(value);
  return safe;
}
