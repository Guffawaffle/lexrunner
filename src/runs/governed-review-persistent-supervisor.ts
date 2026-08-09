import { GovernedAttemptAsyncSupervisor } from "./governed-attempt-async-supervisor.js";
import { ProtectedEvidenceCaptureSession } from "./governed-attempt-evidence.js";
import { GovernedAttemptVerificationService } from "./governed-attempt-verification-service.js";
import type { ProtectedEvidenceIndependentReader } from "./governed-attempt-verification.js";
import { QualifiedWsl2CodexExecutor } from "./qualified-wsl2-codex-executor.js";
import type { QualifiedCodexProviderBridge } from "./qualified-wsl2-codex-executor.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type { ProtectedEvidenceStore } from "../store/protected-evidence-store.js";

type GovernedReviewStore = GovernedAttemptOperationStore & GovernedDelegationStore;

export type PersistentGovernedReviewSupervisorResult =
  | {
      supervised: true;
      operationId: string;
      status: "declined" | "completed" | "failed" | "cancelled" | "lost";
      verificationDecision?: "accepted" | "rejected";
    }
  | {
      supervised: false;
      operationId: string;
      reason: "not_found" | "not_recoverable" | "executor_unavailable" | "incomplete";
    };

export interface PersistentGovernedReviewSupervisorDependencies {
  store: GovernedReviewStore;
  evidenceStore: ProtectedEvidenceStore;
  evidenceReader: ProtectedEvidenceIndependentReader;
  bridge: QualifiedCodexProviderBridge;
  now?: () => string;
}

/** One event-driven host process for one durable provider operation. */
export class PersistentGovernedReviewSupervisor {
  private readonly now: () => string;

  constructor(private readonly dependencies: PersistentGovernedReviewSupervisorDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async run(operationId: string): Promise<PersistentGovernedReviewSupervisorResult> {
    const initial = await this.dependencies.store.getAttemptOperation(operationId);
    if (!initial) return { supervised: false, operationId, reason: "not_found" };
    const verifier = new GovernedAttemptVerificationService(
      this.dependencies.store,
      this.dependencies.evidenceReader
    );
    const supervisor = new GovernedAttemptAsyncSupervisor(
      this.dependencies.store,
      async (record) => {
        if (record.operation_id !== operationId || !record.evidence_reservation) return null;
        const evidence = await ProtectedEvidenceCaptureSession.open({
          store: this.dependencies.evidenceStore,
          reservation: record.evidence_reservation,
          openedAt: this.now(),
        });
        const executor = new QualifiedWsl2CodexExecutor(this.dependencies.bridge, this.now);
        await executor.attach({
          handle: record.handle,
          authorization: record.authorization,
          evidence,
          ...(record.status === "completed" ? { terminalType: "completed" as const } : {}),
        });
        return executor;
      },
      {
        verifyCompleted: async (candidate) => {
          const result = await verifier.verifyAndRecord({
            mutationId: `${candidate}:independent-verification:record`,
            verificationId: `${candidate}:independent-verification`,
            verifierId: "lexrunner.windows-host-verifier",
            operationId: candidate,
            verifiedAt: this.now(),
          });
          if (!result.verified)
            throw new Error(`independent verification failed: ${result.reason}`);
        },
      }
    );
    const attached = await supervisor.attach(operationId);
    if (attached === "executor_unavailable") {
      return { supervised: false, operationId, reason: "executor_unavailable" };
    }
    if (attached === "not_recoverable") {
      return { supervised: false, operationId, reason: "not_recoverable" };
    }
    await supervisor.wait(operationId);
    const completed = await this.dependencies.store.getAttemptOperation(operationId);
    if (!completed || completed.status === "running") {
      return { supervised: false, operationId, reason: "incomplete" };
    }
    return {
      supervised: true,
      operationId,
      status: completed.status,
      ...(completed.verification ? { verificationDecision: completed.verification.decision } : {}),
    };
  }
}
