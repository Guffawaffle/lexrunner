import { execa } from "execa";
import { z } from "zod";

import {
  AxfExternalAwaitResult_v1,
  type AxfExternalAwaitResult_v1 as AxfExternalAwaitResult,
} from "./attempt-awaitable-contract.js";
import type {
  AttemptAwaitableObservationRequest,
  AttemptAwaitableObserver,
} from "./attempt-awaitable-supervisor.js";

const MAX_AXF_OUTPUT_BYTES = 128 * 1_024;

const AxfEnvelope = z
  .object({
    ok: z.boolean(),
    data: z.unknown(),
    error: z.unknown().optional(),
    meta: z.unknown().optional(),
  })
  .passthrough();

export interface AxfCliAttemptAwaitableObserverOptions {
  executable?: string;
  executableArgs?: readonly string[];
  capabilityId?: "global.wait.external" | "global.await.external";
  cwd?: string;
  /** Resolve authority at observation time. The returned values are never persisted by LexRunner. */
  environment?: () => NodeJS.ProcessEnv;
}

/** No-shell AXF CLI adapter for one bounded, process-bound external wait. */
export class AxfCliAttemptAwaitableObserver implements AttemptAwaitableObserver {
  private readonly executable: string;
  private readonly executableArgs: readonly string[];
  private readonly capabilityId: "global.wait.external" | "global.await.external";

  constructor(private readonly options: AxfCliAttemptAwaitableObserverOptions = {}) {
    this.executable = options.executable ?? "axf";
    this.executableArgs = options.executableArgs ?? [];
    this.capabilityId = options.capabilityId ?? "global.wait.external";
  }

  async observe(request: AttemptAwaitableObservationRequest): Promise<AxfExternalAwaitResult> {
    if (request.signal.aborted) throw interrupted();
    let execution;
    try {
      execution = await execa(
        this.executable,
        [
          ...this.executableArgs,
          "run",
          this.capabilityId,
          "--axf-json",
          "--",
          "--descriptorJson",
          JSON.stringify(request.descriptor),
          "--deadlineMs",
          String(request.deadlineMs),
        ],
        {
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          ...(this.options.environment ? { env: this.options.environment() } : {}),
          extendEnv: this.options.environment === undefined,
          cancelSignal: request.signal,
          forceKillAfterDelay: 2_000,
          maxBuffer: MAX_AXF_OUTPUT_BYTES,
          reject: false,
          shell: false,
          stdin: "ignore",
        }
      );
    } catch (error) {
      if (request.signal.aborted) throw interrupted();
      throw new Error(`AXF external wait could not be executed: ${safeErrorName(error)}`);
    }
    if (request.signal.aborted) throw interrupted();
    let envelope: z.infer<typeof AxfEnvelope>;
    try {
      envelope = AxfEnvelope.parse(JSON.parse(execution.stdout));
    } catch {
      throw new Error("AXF external wait returned an invalid JSON envelope");
    }
    const result = AxfExternalAwaitResult_v1.parse(envelope.data);
    if (envelope.ok !== (result.outcome !== "observation-error")) {
      throw new Error("AXF external wait returned an inconsistent result envelope");
    }
    if (execution.exitCode !== 0 && result.outcome !== "observation-error") {
      throw new Error(`AXF external wait exited with code ${execution.exitCode}`);
    }
    return result;
  }
}

function interrupted(): Error {
  const error = new Error("AXF external wait was interrupted");
  error.name = "AbortError";
  return error;
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.name || "Error";
}
