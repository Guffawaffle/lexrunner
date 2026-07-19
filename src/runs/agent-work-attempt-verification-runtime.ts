import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";

import { DEFAULT_REDACT_REGEX } from "../audit/profiles.js";
import { redactSecrets } from "../audit/redaction.js";
import type { AgentTaskReceipt_v2 } from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type { WorkspaceLifecycleLeaseRecord } from "../store/workspace-lifecycle-store.js";

const GIT_TIMEOUT_MS = 30_000;
const CHECK_OUTPUT_BYTES = 64 * 1024;
const PATCH_OUTPUT_BYTES = 64 * 1024 * 1024;
const PATH_OUTPUT_BYTES = 16 * 1024 * 1024;
const SNIPPET_BYTES = 4_096;

export interface VerificationWorkspaceObservation {
  headSha: string;
  patchHash: string;
  observationHash: string;
}

export type VerificationCommandFailureKind =
  "nonzero_exit" | "spawn_error" | "timeout" | "cancelled" | "output_limit";

export interface VerificationCommandResult {
  ok: boolean;
  failureKind?: VerificationCommandFailureKind;
  exitCode?: number;
  stdoutHash?: string;
  stderrHash?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  durationMs: number;
}

export interface AttemptVerificationRuntime {
  resolveEnvironment(keys: readonly string[]): Readonly<Record<string, string>>;
  observe(input: {
    lease: WorkspaceLifecycleLeaseRecord;
    receipt: AgentTaskReceipt_v2;
  }): Promise<VerificationWorkspaceObservation>;
  runCheck(input: {
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<VerificationCommandResult>;
  resolveCheckCwd(worktreePath: string, cwdRel?: string): Promise<string>;
}

/** Host-native verifier runtime. Commands are argv-only and never pass through a shell. */
export class LocalAttemptVerificationRuntime implements AttemptVerificationRuntime {
  resolveEnvironment(keys: readonly string[]): Readonly<Record<string, string>> {
    const environment: Record<string, string> = {};
    for (const key of [...new Set(keys)].sort()) {
      if (key.includes("\0") || key.includes("=")) {
        throw new Error("Bound execution environment contains an invalid key");
      }
      const value = process.env[key];
      if (value !== undefined) environment[key] = value;
    }
    return Object.freeze(environment);
  }

  async resolveCheckCwd(worktreePath: string, cwdRel?: string): Promise<string> {
    const root = await realpath(worktreePath);
    const candidate = await realpath(path.resolve(root, cwdRel ?? "."));
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error("Packet verification cwd escapes the bound worktree");
    }
    return candidate;
  }

  async observe(input: {
    lease: WorkspaceLifecycleLeaseRecord;
    receipt: AgentTaskReceipt_v2;
  }): Promise<VerificationWorkspaceObservation> {
    const worktreePath = await realpath(input.lease.worktreePath);
    const declaredWorktreePath = path.resolve(input.lease.worktreePath);
    if (!sameNativePath(worktreePath, declaredWorktreePath)) {
      throw new Error("Bound worktree path resolves through an unexpected alias");
    }
    const [topLevelBytes, headBytes, branchBytes, statusBytes] = await Promise.all([
      git(["rev-parse", "--show-toplevel"], worktreePath, GIT_TIMEOUT_MS, CHECK_OUTPUT_BYTES),
      git(["rev-parse", "HEAD"], worktreePath, GIT_TIMEOUT_MS, CHECK_OUTPUT_BYTES),
      git(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        worktreePath,
        GIT_TIMEOUT_MS,
        CHECK_OUTPUT_BYTES
      ),
      git(
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        worktreePath,
        GIT_TIMEOUT_MS,
        PATH_OUTPUT_BYTES
      ),
    ]);
    const topLevel = await realpath(text(topLevelBytes).trim());
    if (!sameNativePath(topLevel, worktreePath)) {
      throw new Error("Git resolved a different worktree root");
    }
    const headSha = text(headBytes).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headSha)) {
      throw new Error("Git returned a noncanonical HEAD identity");
    }
    const branch = text(branchBytes).trim();
    if (branch !== input.lease.branch) {
      throw new Error("Workspace branch drifted from its durable lease");
    }
    await git(
      ["cat-file", "-e", `${input.receipt.observed_base_sha}^{commit}`],
      worktreePath,
      GIT_TIMEOUT_MS,
      CHECK_OUTPUT_BYTES
    );
    const patchHash = await canonicalPatchHash(worktreePath, input.receipt.observed_base_sha);
    const observationHash = computeCanonicalHash({
      attempt_id: input.lease.attemptId,
      branch,
      cleanliness: statusBytes.byteLength === 0 ? "clean" : "dirty",
      git_runtime: input.lease.gitRuntime,
      head_sha: headSha,
      host_id: input.lease.hostId,
      patch_hash: patchHash,
      repository_id: input.lease.repositoryId,
      status_hash: hashBytes(statusBytes),
    });
    return { headSha, patchHash, observationHash };
  }

  async runCheck(input: {
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<VerificationCommandResult> {
    const [executable, ...args] = input.argv;
    if (!executable) {
      return { ok: false, failureKind: "spawn_error", durationMs: 0 };
    }
    try {
      const result = await execa(executable, args, {
        cwd: input.cwd,
        env: { ...input.environment },
        extendEnv: false,
        timeout: input.timeoutMs,
        ...(input.signal ? { cancelSignal: input.signal } : {}),
        encoding: "buffer",
        maxBuffer: CHECK_OUTPUT_BYTES,
        reject: false,
        shell: false,
        stripFinalNewline: false,
      });
      const stdout = Buffer.from(result.stdout);
      const stderr = Buffer.from(result.stderr);
      const exitCode = result.exitCode ?? undefined;
      return {
        ok: !result.failed && exitCode === 0,
        ...(result.failed ? { failureKind: classifyFailure(result) } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        stdoutHash: hashBytes(stdout),
        stderrHash: hashBytes(stderr),
        stdoutSnippet: redactAndBound(stdout, input.environment),
        stderrSnippet: redactAndBound(stderr, input.environment),
        durationMs: Math.max(0, Math.round(result.durationMs)),
      };
    } catch (error) {
      const failure = asFailure(error);
      const stdout = Buffer.from(failure.stdout ?? new Uint8Array());
      const stderr = Buffer.from(failure.stderr ?? new Uint8Array());
      return {
        ok: false,
        failureKind: classifyFailure(failure),
        ...(failure.exitCode !== undefined ? { exitCode: failure.exitCode } : {}),
        stdoutHash: hashBytes(stdout),
        stderrHash: hashBytes(stderr),
        stdoutSnippet: redactAndBound(stdout, input.environment),
        stderrSnippet: redactAndBound(stderr, input.environment),
        durationMs: Math.max(0, Math.round(failure.durationMs ?? 0)),
      };
    }
  }
}

async function canonicalPatchHash(worktreePath: string, baseSha: string): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "lexrunner-verification-index-"));
  const indexPath = path.join(temporaryRoot, "index");
  const environment = gitEnvironment({ GIT_INDEX_FILE: indexPath });
  try {
    await git(
      ["read-tree", baseSha],
      worktreePath,
      GIT_TIMEOUT_MS,
      CHECK_OUTPUT_BYTES,
      environment
    );
    const untracked = await git(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      worktreePath,
      GIT_TIMEOUT_MS,
      PATH_OUTPUT_BYTES,
      environment
    );
    if (untracked.byteLength > 0) {
      await git(
        ["--literal-pathspecs", "add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"],
        worktreePath,
        GIT_TIMEOUT_MS,
        CHECK_OUTPUT_BYTES,
        environment,
        untracked
      );
    }
    const patch = await git(
      [
        "-c",
        "core.quotePath=true",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-relative",
        "--binary",
        "--full-index",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        baseSha,
        "--",
      ],
      worktreePath,
      GIT_TIMEOUT_MS,
      PATCH_OUTPUT_BYTES,
      environment
    );
    return hashBytes(patch);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function git(
  args: readonly string[],
  cwd: string,
  timeout: number,
  maxBuffer: number,
  environment = gitEnvironment(),
  input?: Uint8Array
): Promise<Buffer> {
  const result = await execa("git", [...args], {
    cwd,
    env: environment,
    extendEnv: false,
    timeout,
    encoding: "buffer",
    maxBuffer,
    reject: false,
    shell: false,
    stripFinalNewline: false,
    ...(input ? { input } : {}),
  });
  if (result.failed || result.exitCode !== 0) {
    const message = Buffer.from(result.stderr).toString("utf8").trim();
    throw new Error(message || `git ${args[0] ?? "command"} failed`);
  }
  return Buffer.from(result.stdout);
}

function gitEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    ...extra,
  };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TMP", "TEMP"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function sameNativePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

function classifyFailure(value: {
  timedOut?: boolean;
  isCanceled?: boolean;
  isMaxBuffer?: boolean;
  exitCode?: number;
}): VerificationCommandFailureKind {
  if (value.timedOut) return "timeout";
  if (value.isCanceled) return "cancelled";
  if (value.isMaxBuffer) return "output_limit";
  if (value.exitCode !== undefined) return "nonzero_exit";
  return "spawn_error";
}

function asFailure(error: unknown): {
  timedOut?: boolean;
  isCanceled?: boolean;
  isMaxBuffer?: boolean;
  exitCode?: number;
  stdout?: Uint8Array;
  stderr?: Uint8Array;
  durationMs?: number;
} {
  return typeof error === "object" && error !== null ? error : {};
}

function redactAndBound(bytes: Uint8Array, environment: Readonly<Record<string, string>>): string {
  let value = Buffer.from(bytes).toString("utf8");
  for (const secret of Object.values(environment).filter((entry) => entry.length >= 4)) {
    value = value.split(secret).join("***REDACTED***");
  }
  return boundUtf8(redactSecrets(value, DEFAULT_REDACT_REGEX), SNIPPET_BYTES);
}

function boundUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes - 3;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
