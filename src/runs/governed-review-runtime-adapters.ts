import { spawn } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import { ExternalWsl2CodexProviderBridge } from "./external-wsl2-codex-provider-bridge.js";
import { PersistentGovernedReviewSupervisor } from "./governed-review-persistent-supervisor.js";
import { GovernedReviewRuntime } from "./governed-review-runtime.js";
import type { QualifiedCodexProviderBridge } from "./qualified-wsl2-codex-executor.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import { LocalProtectedEvidenceVerifier } from "../store/local-protected-evidence-verifier.js";
import { LocalProtectedEvidenceStore } from "../store/local-protected-evidence-store.js";
import { SqliteGovernedAttemptOperationStore } from "../store/sqlite/governed-attempt-operation-store.js";
import { SqliteWorkspaceLifecycleStore } from "../store/sqlite/workspace-lifecycle-store.js";
import {
  WindowsProtectedEvidenceAuthority,
  defaultWindowsProtectedEvidenceRoot,
} from "../store/windows-protected-evidence-authority.js";
import type { WorkspaceLifecycleStore } from "../store/workspace-lifecycle-store.js";

const MAX_PROMPT_BYTES = 1 * 1_024 * 1_024;
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
const distribution = z
  .string()
  .regex(/^lexrunner-attempt-[0-9a-f]{8,64}$/u, "must be a disposable LexRunner distribution");

export const GovernedReviewStartRequest_v1 = z
  .object({
    databasePath: nativePath,
    runId: opaqueId,
    attemptId: opaqueId,
    distribution,
    environmentId: opaqueId,
    objective: z.string().trim().min(1).max(4_096),
    prompt: z.instanceof(Uint8Array).refine((value) => value.byteLength <= MAX_PROMPT_BYTES),
  })
  .strict();

export const GovernedReviewSuperviseRequest_v1 = z
  .object({
    databasePath: nativePath,
    operationId: opaqueId,
    distribution,
  })
  .strict();

export interface GovernedReviewStartProjection {
  operation: "agent-work.review.start";
  started: boolean;
  operationId?: string;
  delegationId?: string;
  captureId?: string;
  supervisionStarted?: boolean;
  reason?: string;
}

export interface GovernedReviewSuperviseProjection {
  operation: "agent-work.review.supervise";
  operationId: string;
  supervised: boolean;
  status?: string;
  verificationDecision?: string;
  reason?: string;
}

export interface GovernedReviewRuntimeHandlers {
  start(request: unknown): Promise<AgentWorkHandlerResult<GovernedReviewStartProjection>>;
  supervise(request: unknown): Promise<AgentWorkHandlerResult<GovernedReviewSuperviseProjection>>;
}

type ReviewStore = GovernedAttemptOperationStore &
  GovernedDelegationStore & { close(): Promise<void> };
type LifecycleReader = Pick<WorkspaceLifecycleStore, "getAttempt"> & { close(): Promise<void> };
interface ProtectedRootAuthority {
  attestRoot(root: string): Promise<boolean>;
  syncDirectory(directory: string): Promise<void>;
  close(): Promise<void>;
}

export interface GovernedReviewRuntimeHandlerDependencies {
  openStore?: (databasePath: string) => ReviewStore;
  openLifecycle?: (databasePath: string) => LifecycleReader;
  createAuthority?: () => ProtectedRootAuthority;
  evidenceRoot?: () => string;
  createBridge?: (distribution: string) => QualifiedCodexProviderBridge;
  launchSupervisor?: (input: {
    databasePath: string;
    operationId: string;
    distribution: string;
  }) => Promise<boolean>;
  now?: () => string;
}

export function createGovernedReviewRuntimeHandlers(
  dependencies: GovernedReviewRuntimeHandlerDependencies = {}
): GovernedReviewRuntimeHandlers {
  const openStore =
    dependencies.openStore ??
    ((databasePath: string) => new SqliteGovernedAttemptOperationStore(databasePath));
  const openLifecycle =
    dependencies.openLifecycle ??
    ((databasePath: string) => new SqliteWorkspaceLifecycleStore(databasePath, { readOnly: true }));
  const createAuthority =
    dependencies.createAuthority ?? (() => new WindowsProtectedEvidenceAuthority());
  const evidenceRoot = dependencies.evidenceRoot ?? defaultWindowsProtectedEvidenceRoot;
  const createBridge =
    dependencies.createBridge ??
    ((candidate: string) => new ExternalWsl2CodexProviderBridge({ distribution: candidate }));
  const launchSupervisor = dependencies.launchSupervisor ?? launchDetachedSupervisor;
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async start(candidate) {
      const parsed = GovernedReviewStartRequest_v1.safeParse(candidate);
      if (!parsed.success) return invalid("start", parsed.error.issues);
      let store: ReviewStore | undefined;
      let lifecycle: LifecycleReader | undefined;
      let authority: ProtectedRootAuthority | undefined;
      try {
        store = openStore(parsed.data.databasePath);
        lifecycle = openLifecycle(parsed.data.databasePath);
        authority = createAuthority();
      } catch (error) {
        await lifecycle?.close().catch(() => undefined);
        await store?.close().catch(() => undefined);
        await authority?.close().catch(() => undefined);
        return operationFailed(error);
      }
      try {
        const root = evidenceRoot();
        if (!(await authority.attestRoot(root))) {
          throw new Error("protected evidence root attestation failed");
        }
        const evidenceStore = new LocalProtectedEvidenceStore(root, {
          attestRoot: (candidateRoot) => authority.attestRoot(candidateRoot),
          syncDirectory: (directory) => authority.syncDirectory(directory),
          now,
        });
        const runtime = new GovernedReviewRuntime({
          store,
          lifecycle,
          evidenceStore,
          bridge: createBridge(parsed.data.distribution),
          now,
        });
        const result = await runtime.startSynthetic({
          runId: parsed.data.runId,
          attemptId: parsed.data.attemptId,
          environmentId: parsed.data.environmentId,
          objective: parsed.data.objective,
          prompt: parsed.data.prompt,
        });
        if (!result.started) {
          return {
            ok: true,
            result: {
              operation: "agent-work.review.start",
              started: false,
              reason: result.reason,
            },
          };
        }
        const supervisionStarted = await launchSupervisor({
          databasePath: parsed.data.databasePath,
          operationId: result.operationId,
          distribution: parsed.data.distribution,
        });
        return {
          ok: true,
          result: {
            operation: "agent-work.review.start",
            started: true,
            operationId: result.operationId,
            delegationId: result.delegationId,
            captureId: result.captureId,
            supervisionStarted,
            ...(!supervisionStarted ? { reason: "supervisor_launch_failed" } : {}),
          },
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await lifecycle.close().catch(() => undefined);
        await store.close().catch(() => undefined);
        await authority.close().catch(() => undefined);
      }
    },

    async supervise(candidate) {
      const parsed = GovernedReviewSuperviseRequest_v1.safeParse(candidate);
      if (!parsed.success) return invalid("supervise", parsed.error.issues);
      let store: ReviewStore | undefined;
      let authority: ProtectedRootAuthority | undefined;
      try {
        store = openStore(parsed.data.databasePath);
        authority = createAuthority();
      } catch (error) {
        await store?.close().catch(() => undefined);
        await authority?.close().catch(() => undefined);
        return operationFailed(error);
      }
      try {
        const root = evidenceRoot();
        if (!(await authority.attestRoot(root))) {
          throw new Error("protected evidence root attestation failed");
        }
        const evidenceStore = new LocalProtectedEvidenceStore(root, {
          attestRoot: (candidateRoot) => authority.attestRoot(candidateRoot),
          syncDirectory: (directory) => authority.syncDirectory(directory),
          now,
        });
        const evidenceReader = new LocalProtectedEvidenceVerifier(root, {
          attestRoot: (candidateRoot) => authority.attestRoot(candidateRoot),
        });
        const result = await new PersistentGovernedReviewSupervisor({
          store,
          evidenceStore,
          evidenceReader,
          bridge: createBridge(parsed.data.distribution),
          now,
        }).run(parsed.data.operationId);
        return {
          ok: true,
          result: {
            operation: "agent-work.review.supervise",
            operationId: parsed.data.operationId,
            supervised: result.supervised,
            ...(result.supervised
              ? {
                  status: result.status,
                  ...(result.verificationDecision
                    ? { verificationDecision: result.verificationDecision }
                    : {}),
                }
              : { reason: result.reason }),
          },
        };
      } catch (error) {
        return operationFailed(error);
      } finally {
        await store.close().catch(() => undefined);
        await authority.close().catch(() => undefined);
      }
    },
  };
}

async function launchDetachedSupervisor(input: {
  databasePath: string;
  operationId: string;
  distribution: string;
}): Promise<boolean> {
  const cli = process.argv[1];
  if (!cli) return false;
  try {
    const child = spawn(
      process.execPath,
      [
        path.resolve(cli),
        "attempt",
        "review",
        "supervise",
        "--database-path",
        input.databasePath,
        "--operation-id",
        input.operationId,
        "--distribution",
        input.distribution,
        "--json",
      ],
      {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        env: sanitizedSupervisorEnvironment(),
      }
    );
    return await new Promise<boolean>((resolve) => {
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
  } catch {
    return false;
  }
}

function sanitizedSupervisorEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["SystemRoot", "LOCALAPPDATA", "TEMP", "TMP"] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function invalid(
  operation: "start" | "supervise",
  issues: readonly z.core.$ZodIssue[]
): { ok: false; error: AdapterInputError } {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message: `Invalid governed review ${operation} input`,
      issues: issues.slice(0, 20).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
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
