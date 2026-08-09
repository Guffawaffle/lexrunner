import { stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  AdapterInputError,
  AdapterOperationError,
  AgentWorkHandlerResult,
} from "./agent-work-adapters.js";
import { GovernedAttemptVerificationService } from "./governed-attempt-verification-service.js";
import type { ProtectedEvidenceIndependentReader } from "./governed-attempt-verification.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import { LocalProtectedEvidenceVerifier } from "../store/local-protected-evidence-verifier.js";
import { SqliteGovernedAttemptOperationStore } from "../store/sqlite/governed-attempt-operation-store.js";
import {
  WindowsProtectedEvidenceAuthority,
  defaultWindowsProtectedEvidenceRoot,
} from "../store/windows-protected-evidence-authority.js";

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

export const GovernedAttemptVerificationRequest_v1 = z
  .object({
    databasePath: nativePath,
    operationId: opaqueId,
    verificationId: opaqueId,
    verifierId: opaqueId.default("lexrunner.windows-host-verifier"),
  })
  .strict();

export interface GovernedAttemptVerificationProjection {
  operation: "agent-work.review.verify";
  operationId: string;
  verificationId: string;
  verified: boolean;
  idempotentReplay?: boolean;
  decision?: "accepted" | "rejected";
  taskOutcome?: "pass" | "block" | "not_produced" | "invalid";
  admissibility?: "admissible" | "inadmissible";
  failureCodes?: string[];
  receiptHash?: string;
  reason?: string;
}

export interface GovernedAttemptVerificationHandlers {
  verify(request: unknown): Promise<AgentWorkHandlerResult<GovernedAttemptVerificationProjection>>;
}

type CloseableOperationStore = GovernedAttemptOperationStore & { close(): Promise<void> };
interface ProtectedRootAuthority {
  attestRoot(root: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface GovernedAttemptVerificationHandlerDependencies {
  openStore?: (databasePath: string) => CloseableOperationStore;
  createAuthority?: () => ProtectedRootAuthority;
  evidenceRoot?: () => string;
  createReader?: (
    root: string,
    attestRoot: (root: string) => Promise<boolean>
  ) => ProtectedEvidenceIndependentReader;
  now?: () => string;
}

export function createGovernedAttemptVerificationHandlers(
  dependencies: GovernedAttemptVerificationHandlerDependencies = {}
): GovernedAttemptVerificationHandlers {
  const openStore =
    dependencies.openStore ??
    ((databasePath: string) => new SqliteGovernedAttemptOperationStore(databasePath));
  const createAuthority =
    dependencies.createAuthority ?? (() => new WindowsProtectedEvidenceAuthority());
  const evidenceRoot = dependencies.evidenceRoot ?? defaultWindowsProtectedEvidenceRoot;
  const createReader =
    dependencies.createReader ??
    ((root, attestRoot) => new LocalProtectedEvidenceVerifier(root, { attestRoot }));
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async verify(candidate) {
      const parsed = GovernedAttemptVerificationRequest_v1.safeParse(candidate);
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
      let authority: ProtectedRootAuthority;
      try {
        store = openStore(parsed.data.databasePath);
        authority = createAuthority();
      } catch (error) {
        return operationFailed(error);
      }
      try {
        const root = evidenceRoot();
        const reader = createReader(root, (candidateRoot) => authority.attestRoot(candidateRoot));
        const result = await new GovernedAttemptVerificationService(store, reader).verifyAndRecord({
          mutationId: `${parsed.data.verificationId}:record`,
          verificationId: parsed.data.verificationId,
          verifierId: parsed.data.verifierId,
          operationId: parsed.data.operationId,
          verifiedAt: now(),
        });
        if (!result.verified) {
          return {
            ok: true,
            result: {
              operation: "agent-work.review.verify",
              operationId: parsed.data.operationId,
              verificationId: parsed.data.verificationId,
              verified: false,
              reason: result.reason,
            },
          };
        }
        return {
          ok: true,
          result: {
            operation: "agent-work.review.verify",
            operationId: parsed.data.operationId,
            verificationId: result.receipt.verification_id,
            verified: true,
            idempotentReplay: result.idempotentReplay,
            decision: result.receipt.decision,
            taskOutcome: result.receipt.task_outcome,
            admissibility: result.receipt.admissibility,
            failureCodes: [...result.receipt.failure_codes],
            receiptHash: result.receipt.receipt_hash,
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

function invalid(issues: AdapterInputError["issues"]): { ok: false; error: AdapterInputError } {
  return {
    ok: false,
    error: { code: "invalid_input", message: "Invalid governed review verification input", issues },
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
