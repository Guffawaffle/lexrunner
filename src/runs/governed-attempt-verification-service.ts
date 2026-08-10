import { GovernedAttemptIndependentVerifier } from "./governed-attempt-independent-verifier.js";
import type {
  GovernedAttemptVerificationReceipt_v1,
  ProtectedEvidenceIndependentReader,
} from "./governed-attempt-verification.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type {
  LaunchEnvelopeBindingStore,
  TaskPacketBindingStore,
  WorkspaceLifecycleStore,
} from "../store/workspace-lifecycle-store.js";

type GovernedVerificationStore = GovernedAttemptOperationStore &
  Partial<Pick<GovernedDelegationStore, "getDelegation">>;
type GovernedRepositoryLifecycleReader = Pick<
  WorkspaceLifecycleStore,
  "getAttempt" | "getWorkspaceLease"
> &
  Pick<LaunchEnvelopeBindingStore, "getLaunchEnvelopeBinding"> &
  Pick<TaskPacketBindingStore, "getTaskPacketBinding">;

export interface VerifyGovernedAttemptOperationInput {
  mutationId: string;
  verificationId: string;
  verifierId: string;
  operationId: string;
  verifiedAt: string;
}

export type VerifyGovernedAttemptOperationResult =
  | {
      verified: true;
      idempotentReplay: boolean;
      receipt: GovernedAttemptVerificationReceipt_v1;
    }
  | {
      verified: false;
      reason:
        | "not_found"
        | "not_ready"
        | "verification_context_missing"
        | "evidence_unavailable"
        | "store_rejected";
    };

/** Coordinates a fresh protected read, independent semantics, and durable receipt. */
export class GovernedAttemptVerificationService {
  constructor(
    private readonly store: GovernedVerificationStore,
    private readonly evidence: ProtectedEvidenceIndependentReader,
    private readonly verifier = new GovernedAttemptIndependentVerifier(),
    private readonly repositoryLifecycle?: GovernedRepositoryLifecycleReader
  ) {}

  async verifyAndRecord(
    input: VerifyGovernedAttemptOperationInput
  ): Promise<VerifyGovernedAttemptOperationResult> {
    const operation = await this.store.getAttemptOperation(input.operationId);
    if (!operation) return { verified: false, reason: "not_found" };
    if (operation.verification) {
      return { verified: true, idempotentReplay: true, receipt: operation.verification };
    }
    if (operation.status !== "completed" || !operation.result || !operation.result_hash) {
      return { verified: false, reason: "not_ready" };
    }
    if (!operation.verification_context || !operation.evidence_declaration) {
      return { verified: false, reason: "verification_context_missing" };
    }
    let capture;
    try {
      capture = await this.evidence.readVerifiedCapture(operation.evidence_declaration.capture_id);
    } catch {
      return { verified: false, reason: "evidence_unavailable" };
    }
    const events = await this.store.listAttemptOperationEvents(operation.operation_id);
    const delegation = this.store.getDelegation
      ? await this.store.getDelegation(operation.delegation_id)
      : undefined;
    const repositoryBinding = operation.verification_context.repository_corpus;
    const repositoryLifecycle =
      repositoryBinding && this.repositoryLifecycle
        ? {
            attempt: await this.repositoryLifecycle.getAttempt(operation.attempt_id),
            lease: await this.repositoryLifecycle.getWorkspaceLease(
              repositoryBinding.workspace_lease_id
            ),
            launchBinding: await this.repositoryLifecycle.getLaunchEnvelopeBinding(
              operation.attempt_id
            ),
            packetBinding: await this.repositoryLifecycle.getTaskPacketBinding(
              operation.attempt_id
            ),
          }
        : undefined;
    const receipt = this.verifier.verify({
      verificationId: input.verificationId,
      verifierId: input.verifierId,
      operation,
      events,
      context: operation.verification_context,
      evidence: capture,
      ...(delegation ? { delegation } : {}),
      ...(repositoryLifecycle ? { repositoryLifecycle } : {}),
      verifiedAt: input.verifiedAt,
    });
    const recorded = await this.store.recordAttemptOperationVerification({
      mutationId: input.mutationId,
      operationId: operation.operation_id,
      expectedRevision: operation.revision,
      verification: receipt,
      now: input.verifiedAt,
    });
    if (!recorded.recorded) return { verified: false, reason: "store_rejected" };
    return {
      verified: true,
      idempotentReplay: recorded.idempotentReplay,
      receipt: recorded.record.verification!,
    };
  }
}
