import { execa } from "execa";

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export interface CommandRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  /** Explicit process environment additions. Never included in command evidence. */
  env?: Readonly<Record<string, string>>;
  /** Whether to merge env with the parent process environment. Defaults to true. */
  extendEnv?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Maximum buffered bytes for each output stream. */
  maxOutputBytes?: number;
  /** Synchronous identity assertion run immediately before process creation. */
  preflight?: () => void;
}

interface CommandResultBase {
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandSuccess extends CommandResultBase {
  ok: true;
  exitCode: 0;
}

export type CommandFailureKind =
  | "invalid_request"
  | "nonzero_exit"
  | "spawn_error"
  | "preflight_error"
  | "timeout"
  | "aborted"
  | "output_limit";

export interface CommandFailure extends CommandResultBase {
  ok: false;
  kind: CommandFailureKind;
  exitCode: number | null;
  message: string;
}

export type CommandResult = CommandSuccess | CommandFailure;

/** Injectable process boundary used by the Git workspace broker. */
export interface CommandRunner {
  /** Implementations that spawn must execute request.preflight immediately before spawning. */
  run(request: CommandRequest): Promise<CommandResult>;
}

/**
 * Execute commands directly, without a shell, and return bounded structured
 * evidence for every expected process outcome.
 */
export class ExecaCommandRunner implements CommandRunner {
  async run(request: CommandRequest): Promise<CommandResult> {
    const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      return invalidRequest("timeoutMs must be a positive finite number");
    }
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      return invalidRequest("maxOutputBytes must be a positive safe integer");
    }

    try {
      try {
        request.preflight?.();
      } catch (error) {
        return {
          ok: false,
          kind: "preflight_error",
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const result = await execa(request.executable, [...request.args], {
        cwd: request.cwd,
        ...(request.env ? { env: request.env } : {}),
        extendEnv: request.extendEnv ?? true,
        timeout: request.timeoutMs,
        cancelSignal: request.signal,
        maxBuffer: maxOutputBytes,
        reject: false,
        shell: false,
        stripFinalNewline: false,
      });

      const stdout = boundOutput(asText(result.stdout), maxOutputBytes);
      const stderr = boundOutput(asText(result.stderr), maxOutputBytes);

      if (!result.failed && result.exitCode === 0) {
        return { ok: true, exitCode: 0, stdout, stderr, durationMs: result.durationMs };
      }

      return {
        ok: false,
        kind: classifyFailure(result),
        exitCode: result.exitCode ?? null,
        stdout,
        stderr,
        durationMs: result.durationMs,
        message: boundOutput(
          result.shortMessage || result.message || "Command failed",
          maxOutputBytes
        ),
      };
    } catch (error) {
      const processError = asProcessError(error);
      return {
        ok: false,
        kind: classifyFailure(processError),
        exitCode: processError.exitCode ?? null,
        stdout: boundOutput(asText(processError.stdout), maxOutputBytes),
        stderr: boundOutput(asText(processError.stderr), maxOutputBytes),
        durationMs: processError.durationMs ?? 0,
        message: boundOutput(
          error instanceof Error ? error.message : String(error),
          maxOutputBytes
        ),
      };
    }
  }
}

interface ProcessFailureShape {
  timedOut?: boolean;
  isCanceled?: boolean;
  isMaxBuffer?: boolean;
  exitCode?: number;
  stdout?: unknown;
  stderr?: unknown;
  durationMs?: number;
}

function classifyFailure(result: ProcessFailureShape): CommandFailureKind {
  if (result.timedOut) return "timeout";
  if (result.isCanceled) return "aborted";
  if (result.isMaxBuffer) return "output_limit";
  if (result.exitCode !== undefined) return "nonzero_exit";
  return "spawn_error";
}

function invalidRequest(message: string): CommandFailure {
  return {
    ok: false,
    kind: "invalid_request",
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: 0,
    message,
  };
}

function asProcessError(error: unknown): ProcessFailureShape {
  return typeof error === "object" && error !== null ? (error as ProcessFailureShape) : {};
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function boundOutput(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}
