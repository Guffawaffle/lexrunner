import { createHash } from "node:crypto";
import path from "node:path";

import { execa } from "execa";

import { AgentTaskPacket_v1 } from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type {
  RecordWorkerAuthorityDecisionInput,
  TaskPacketBindingStore,
  WorkerAuthorityDecisionResult,
  WorkerAuthorityDecisionStore,
  WorkerAuthorityDimension,
  WorkerSessionStore,
  WorkspaceLifecycleStore,
} from "../store/workspace-lifecycle-store.js";

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const WORKER_AUTHORITY_BROKER_ID = "lexrunner.argv-authority-broker" as const;
export const WORKER_AUTHORITY_BROKER_VERSION = "1.0.0" as const;

type AuthorityStore = WorkspaceLifecycleStore &
  TaskPacketBindingStore &
  WorkerSessionStore &
  WorkerAuthorityDecisionStore;

export interface WorkerAuthorityBinding {
  runId: string;
  expectedRunRevision: number;
  controller: RecordWorkerAuthorityDecisionInput["controller"];
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
}

export interface ClassifiedWorkerAuthorityAction {
  dimension: WorkerAuthorityDimension;
  actionClass: string;
  actionHash: string;
}

export type WorkerAuthorityAuthorizationResult =
  | {
      authorized: true;
      action: ClassifiedWorkerAuthorityAction;
      event: Extract<WorkerAuthorityDecisionResult, { recorded: true }>["event"];
      idempotentReplay: boolean;
    }
  | {
      authorized: false;
      action: ClassifiedWorkerAuthorityAction;
      event?: Extract<WorkerAuthorityDecisionResult, { recorded: true }>["event"];
      reason: string;
      idempotentReplay?: boolean;
    };

export interface WorkerAuthorityCommandExecutor {
  run(input: {
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<{
    exitCode?: number;
    failureKind?: "nonzero_exit" | "spawn_error" | "timeout" | "output_limit";
    stdoutHash: string;
    stderrHash: string;
  }>;
}

/**
 * Packet-bound authority decision service. Raw argv never reaches durable audit storage.
 * Adapters must call this boundary before starting an authority-bearing subprocess.
 *
 * A brokered decision proves only that a direct argv invocation passed this boundary. It is not a
 * process sandbox: adapters that cannot prevent alternate subprocess paths must declare the
 * affected authority dimensions unenforced and fail capability negotiation before launch.
 */
export class AgentWorkAuthorityService {
  constructor(
    private readonly store: AuthorityStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async authorize(input: {
    binding: WorkerAuthorityBinding;
    action: ClassifiedWorkerAuthorityAction;
    mutationId: string;
    enforcement?: "enforced" | "brokered" | "unenforced";
  }): Promise<WorkerAuthorityAuthorizationResult> {
    const packet = await this.packet(input.binding.attemptId);
    if (!packet) {
      return { authorized: false, action: input.action, reason: "evidence_mismatch" };
    }
    const enforcement = input.enforcement ?? "brokered";
    const granted = packet.authority[input.action.dimension];
    const decision = granted && enforcement !== "unenforced" ? "allowed" : "denied";
    const reason = granted ? "backend_unenforceable" : "packet_denied";
    const recorded = await this.store.recordWorkerAuthorityDecision({
      ...input.binding,
      mutationId: input.mutationId,
      now: this.now(),
      dimension: input.action.dimension,
      decision,
      enforcement,
      actionClass: input.action.actionClass,
      actionHash: input.action.actionHash,
      backendId: WORKER_AUTHORITY_BROKER_ID,
      backendVersion: WORKER_AUTHORITY_BROKER_VERSION,
      reason: decision === "allowed" ? "packet_granted" : reason,
    });
    if (!recorded.recorded) {
      return { authorized: false, action: input.action, reason: recorded.reason };
    }
    return decision === "allowed"
      ? {
          authorized: true,
          action: input.action,
          event: recorded.event,
          idempotentReplay: recorded.idempotentReplay,
        }
      : {
          authorized: false,
          action: input.action,
          event: recorded.event,
          reason,
          idempotentReplay: recorded.idempotentReplay,
        };
  }

  async recordObservedDeviation(input: {
    binding: WorkerAuthorityBinding;
    action: ClassifiedWorkerAuthorityAction;
    mutationId: string;
    enforcement: "enforced" | "brokered" | "unenforced";
  }): Promise<WorkerAuthorityDecisionResult> {
    return this.store.recordWorkerAuthorityDecision({
      ...input.binding,
      mutationId: input.mutationId,
      now: this.now(),
      dimension: input.action.dimension,
      decision: "deviation",
      enforcement: input.enforcement,
      actionClass: input.action.actionClass,
      actionHash: input.action.actionHash,
      backendId: WORKER_AUTHORITY_BROKER_ID,
      backendVersion: WORKER_AUTHORITY_BROKER_VERSION,
      reason: "observed_after_execution",
    });
  }

  private async packet(attemptId: string): Promise<AgentTaskPacket_v1 | null> {
    const binding = await this.store.getTaskPacketBinding(attemptId);
    if (!binding) return null;
    try {
      return AgentTaskPacket_v1.parse(JSON.parse(binding.packetJson) as unknown);
    } catch {
      return null;
    }
  }
}

/**
 * Executes only after a durable, packet-derived authority decision permits the classified argv.
 * This broker does not make an otherwise-unsandboxed worker conformant by itself.
 */
export class WorkerAuthorityCommandBroker {
  constructor(
    private readonly authority: AgentWorkAuthorityService,
    private readonly executor: WorkerAuthorityCommandExecutor = new LocalWorkerAuthorityCommandExecutor()
  ) {}

  async run(input: {
    binding: WorkerAuthorityBinding;
    mutationId: string;
    argv: readonly string[];
    cwd: string;
    environment?: Readonly<Record<string, string>>;
    timeoutMs?: number;
  }): Promise<
    | {
        executed: false;
        authorization: WorkerAuthorityAuthorizationResult;
        reason?: "authorization_replayed";
      }
    | {
        executed: true;
        authorization: Extract<WorkerAuthorityAuthorizationResult, { authorized: true }>;
        result: Awaited<ReturnType<WorkerAuthorityCommandExecutor["run"]>>;
      }
  > {
    const action = classifyWorkerAuthorityAction(input.argv);
    const authorization = await this.authority.authorize({
      binding: input.binding,
      action,
      mutationId: input.mutationId,
      enforcement: "brokered",
    });
    if (!authorization.authorized) return { executed: false, authorization };
    // A persisted decision proves authorization, not whether a prior process crossed the spawn
    // boundary. Reconciliation must resolve that ambiguity instead of silently repeating a side
    // effect under the same mutation identity.
    if (authorization.idempotentReplay) {
      return { executed: false, authorization, reason: "authorization_replayed" };
    }
    const result = await this.executor.run({
      argv: input.argv,
      cwd: input.cwd,
      environment: input.environment ?? {},
      timeoutMs: input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    });
    return { executed: true, authorization, result };
  }
}

/** Local argv-only executor. Its authority comes from the broker decision, never command prose. */
export class LocalWorkerAuthorityCommandExecutor implements WorkerAuthorityCommandExecutor {
  async run(input: {
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    timeoutMs: number;
  }): Promise<{
    exitCode?: number;
    failureKind?: "nonzero_exit" | "spawn_error" | "timeout" | "output_limit";
    stdoutHash: string;
    stderrHash: string;
  }> {
    const [executable, ...args] = input.argv;
    if (!executable) throw new Error("Authority-bearing argv must not be empty");
    try {
      const result = await execa(executable, args, {
        cwd: input.cwd,
        env: { ...input.environment },
        extendEnv: false,
        timeout: input.timeoutMs,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        encoding: "buffer",
        reject: false,
        shell: false,
        stripFinalNewline: false,
      });
      const exitCode = result.exitCode ?? undefined;
      return {
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(result.failed
          ? {
              failureKind: result.timedOut
                ? ("timeout" as const)
                : result.isMaxBuffer
                  ? ("output_limit" as const)
                  : exitCode !== undefined
                    ? ("nonzero_exit" as const)
                    : ("spawn_error" as const),
            }
          : {}),
        stdoutHash: hashBytes(Buffer.from(result.stdout)),
        stderrHash: hashBytes(Buffer.from(result.stderr)),
      };
    } catch (error) {
      const failure = typeof error === "object" && error !== null ? error : {};
      const typed = failure as {
        timedOut?: boolean;
        isMaxBuffer?: boolean;
        exitCode?: number;
        stdout?: Uint8Array;
        stderr?: Uint8Array;
      };
      return {
        ...(typed.exitCode !== undefined ? { exitCode: typed.exitCode } : {}),
        failureKind: typed.timedOut
          ? "timeout"
          : typed.isMaxBuffer
            ? "output_limit"
            : typed.exitCode !== undefined
              ? "nonzero_exit"
              : "spawn_error",
        stdoutHash: hashBytes(Buffer.from(typed.stdout ?? new Uint8Array())),
        stderrHash: hashBytes(Buffer.from(typed.stderr ?? new Uint8Array())),
      };
    }
  }
}

/**
 * Conservative direct-argv classifier. Unknown commands require edit authority; shell and
 * interpreter entry points require external-runtime authority because their nested actions cannot
 * be classified from the outer argv alone.
 */
export function classifyWorkerAuthorityAction(
  argv: readonly string[]
): ClassifiedWorkerAuthorityAction {
  const executable = normalizedExecutable(argv[0]);
  const lowerArgs = argv.slice(1).map((value) => value.toLowerCase());
  let dimension: WorkerAuthorityDimension = "edit";
  let actionClass = "workspace_mutation";

  if (EXTERNAL_RUNTIME_EXECUTABLES.has(executable)) {
    dimension = "external_runtime";
    actionClass = "external_runtime";
  } else if (executable === "git") {
    const subcommand = gitSubcommand(lowerArgs);
    if (!GIT_READ_SUBCOMMANDS.has(subcommand)) {
      dimension = "git_write";
      actionClass = "git_write";
    }
  } else if (executable === "gh") {
    if (lowerArgs[0] === "release") {
      dimension = "release";
      actionClass = "release";
    } else {
      dimension = "github_write";
      actionClass = "github_write";
    }
  } else if (SIGNING_EXECUTABLES.has(executable)) {
    dimension = "signing";
    actionClass = "signing";
  } else if (SECRET_EXECUTABLES.has(executable)) {
    dimension = "secrets";
    actionClass = "secret_access";
  } else if (isPackageRelease(executable, lowerArgs)) {
    dimension = "release";
    actionClass = "release";
  }

  return {
    dimension,
    actionClass,
    actionHash: computeCanonicalHash({ action_class: actionClass, executable }),
  };
}

const EXTERNAL_RUNTIME_EXECUTABLES = new Set([
  "bash",
  "bun",
  "cmd",
  "deno",
  "docker",
  "node",
  "podman",
  "powershell",
  "pwsh",
  "python",
  "python3",
  "sh",
  "kubectl",
  "nerdctl",
  "systemctl",
  "service",
  "postgres",
  "postmaster",
  "mysqld",
  "redis-server",
]);
const SIGNING_EXECUTABLES = new Set(["gpg", "gpg2", "cosign", "ssh-keygen"]);
const SECRET_EXECUTABLES = new Set(["env", "printenv", "keyring", "secret-tool"]);
const GIT_READ_SUBCOMMANDS = new Set([
  "blame",
  "cat-file",
  "diff",
  "diff-tree",
  "for-each-ref",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "name-rev",
  "rev-list",
  "rev-parse",
  "show",
  "show-ref",
  "status",
]);

function normalizedExecutable(value: string | undefined): string {
  if (!value) throw new Error("Authority-bearing argv must not be empty");
  return path.posix
    .basename(value.replace(/\\/gu, "/"))
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/u, "");
}

function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "-c" || value === "--git-dir" || value === "--work-tree") {
      index += 1;
      continue;
    }
    if (!value.startsWith("-")) return value;
  }
  return "";
}

function isPackageRelease(executable: string, args: readonly string[]): boolean {
  if (executable === "npm" || executable === "pnpm") {
    return ["publish", "unpublish", "deprecate", "dist-tag", "access", "owner", "token"].includes(
      args[0] ?? ""
    );
  }
  return executable === "yarn" && args[0] === "npm" && args[1] === "publish";
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
