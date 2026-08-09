import { randomUUID } from "node:crypto";

import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
  type AttemptExecutor,
} from "./governed-attempt-executor.js";
import { ProtectedEvidenceCaptureSession } from "./governed-attempt-evidence.js";
import { GovernedAttemptOperationService } from "./governed-attempt-operation-service.js";
import {
  DelegationInvocationRequest_v1,
  computeDelegationOfferHash,
} from "./governed-attempt-protocol.js";
import {
  createGovernedAttemptVerificationContext,
  type GovernedAttemptVerificationContext_v1,
} from "./governed-attempt-verification.js";
import type { QualifiedCodexProviderBridge } from "./qualified-wsl2-codex-executor.js";
import { QualifiedWsl2CodexExecutor } from "./qualified-wsl2-codex-executor.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { isTerminalAttemptStatus } from "../schemas/agent-work.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type { ProtectedEvidenceStore } from "../store/protected-evidence-store.js";
import type { WorkspaceLifecycleStore } from "../store/workspace-lifecycle-store.js";

type GovernedReviewStore = GovernedAttemptOperationStore & GovernedDelegationStore;

export const SYNTHETIC_GOVERNED_REVIEW = Object.freeze({
  repositoryId: "lexrunner-synthetic-retry-window",
  baseObjectId: "1".repeat(40),
  candidateObjectId: "2".repeat(40),
  maxDurationMs: 180_000,
  maxOutputBytes: 2 * 1_024 * 1_024,
});

export const SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "BLOCK"] },
    findings: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "file", "line", "message"],
        properties: {
          severity: { type: "string", enum: ["blocking", "advisory"] },
          file: { type: "string", minLength: 1, maxLength: 256 },
          line: { type: "integer", minimum: 1 },
          message: { type: "string", minLength: 1, maxLength: 2_048 },
        },
      },
    },
  },
} satisfies Record<string, unknown>);

export interface StartSyntheticGovernedReviewInput {
  runId: string;
  attemptId: string;
  environmentId: string;
  prompt: Uint8Array;
  objective: string;
}

export type StartSyntheticGovernedReviewResult =
  | {
      started: true;
      operationId: string;
      delegationId: string;
      captureId: string;
      authorizationBindingDigest: string;
      verificationContext: GovernedAttemptVerificationContext_v1;
    }
  | {
      started: false;
      reason:
        | "attempt_not_found"
        | "attempt_run_mismatch"
        | "attempt_terminal"
        | "attempt_not_running"
        | "authorization_denied"
        | "delegation_rejected"
        | "operation_rejected";
    };

export interface GovernedReviewRuntimeDependencies {
  store: GovernedReviewStore;
  lifecycle: Pick<WorkspaceLifecycleStore, "getAttempt">;
  evidenceStore: ProtectedEvidenceStore;
  bridge: QualifiedCodexProviderBridge;
  now?: () => string;
  randomId?: () => string;
}

/**
 * Binds a real durable ADR-010 Attempt to the synthetic-only governed provider.
 * The provider launches only the offer phase; work remains gated on a durable
 * worker ACCEPT observed by the asynchronous supervisor.
 */
export class GovernedReviewRuntime {
  private readonly now: () => string;
  private readonly randomId: () => string;

  constructor(private readonly dependencies: GovernedReviewRuntimeDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.randomId = dependencies.randomId ?? randomUUID;
  }

  async startSynthetic(
    input: StartSyntheticGovernedReviewInput
  ): Promise<StartSyntheticGovernedReviewResult> {
    const attempt = await this.dependencies.lifecycle.getAttempt(input.attemptId);
    if (!attempt) return { started: false, reason: "attempt_not_found" };
    if (attempt.runId !== input.runId) return { started: false, reason: "attempt_run_mismatch" };
    if (isTerminalAttemptStatus(attempt.status)) {
      return { started: false, reason: "attempt_terminal" };
    }
    if (attempt.status !== "running") {
      return { started: false, reason: "attempt_not_running" };
    }

    const delegationId = `delegation-${this.randomId()}`;
    const logicalThreadId = `thread-${this.randomId()}`;
    const attestations = await this.dependencies.bridge.prepareSynthetic({
      environment_id: input.environmentId,
      repository_id: SYNTHETIC_GOVERNED_REVIEW.repositoryId,
      base_object_id: SYNTHETIC_GOVERNED_REVIEW.baseObjectId,
      candidate_object_id: SYNTHETIC_GOVERNED_REVIEW.candidateObjectId,
    });
    const controls = GovernedControlId.options.map((control) => ({
      control,
      minimum_strength: "independently_enforced_verified" as const,
    }));
    const objectiveHash = computeCanonicalHash({ objective: input.objective });
    const requirements = GovernedReviewRequirements_v1.parse({
      schema_version: "1.0.0",
      attempt_id: input.attemptId,
      delegation_id: delegationId,
      repository_id: SYNTHETIC_GOVERNED_REVIEW.repositoryId,
      base_object_id: SYNTHETIC_GOVERNED_REVIEW.baseObjectId,
      candidate_object_id: SYNTHETIC_GOVERNED_REVIEW.candidateObjectId,
      objective_hash: objectiveHash,
      authorized_model_provider: "openai",
      source_disclosure_allowed: true,
      controls,
      max_duration_ms: SYNTHETIC_GOVERNED_REVIEW.maxDurationMs,
      max_output_bytes: SYNTHETIC_GOVERNED_REVIEW.maxOutputBytes,
    });
    const grant = GovernedCapabilityGrant_v1.parse({
      schema_version: "1.0.0",
      attempt_id: input.attemptId,
      delegation_id: delegationId,
      repository_id: requirements.repository_id,
      base_object_id: requirements.base_object_id,
      candidate_object_id: requirements.candidate_object_id,
      authorized_model_provider: requirements.authorized_model_provider,
      source_disclosure_allowed: true,
      controls,
      tools: ["read_only_shell"],
      max_duration_ms: requirements.max_duration_ms,
      max_output_bytes: requirements.max_output_bytes,
    });
    const authorizedAt = this.now();
    const expiry = Math.min(
      Date.parse(attestations.executor.expires_at),
      Date.parse(attestations.environment.expires_at),
      Date.parse(attestations.workspace.expires_at),
      Date.parse(authorizedAt) + 4 * 60_000
    );
    const expiresAt = new Date(expiry - 1_000).toISOString();
    const authorization = authorizeGovernedReview({
      authorizationId: `authorization-${this.randomId()}`,
      requirements,
      executor: attestations.executor,
      environment: attestations.environment,
      workspace: attestations.workspace,
      grant,
      authorizedAt,
      expiresAt,
    });
    if (!authorization.authorized) {
      return { started: false, reason: "authorization_denied" };
    }
    const verificationContext = createGovernedAttemptVerificationContext({
      requirements,
      executor: attestations.executor,
      environment: attestations.environment,
      workspace: attestations.workspace,
      output_schema: SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA,
    });

    const offer = {
      schema_version: "1.0.0" as const,
      delegation_id: delegationId,
      attempt_id: input.attemptId,
      worker: {
        provider_id: "openai-codex",
        worker_id: attestations.executor.executor_id,
        thread_id: logicalThreadId,
      },
      task_offer_hash: computeCanonicalHash({
        objective_hash: objectiveHash,
        prompt_hash: computeCanonicalHash({ bytes: Buffer.from(input.prompt).toString("base64") }),
        output_schema_hash: verificationContext.output_schema_hash,
      }),
      requirements_hash: computeCanonicalHash(requirements),
      authority_grant_hash: computeCanonicalHash(grant),
      transcript_start_hash: computeCanonicalHash({ kind: "new-governed-review-transcript" }),
      offered_at: authorizedAt,
    };
    const created = await this.dependencies.store.createDelegation({
      mutationId: `${delegationId}:create`,
      offer,
      now: authorizedAt,
    });
    if (!created.created) return { started: false, reason: "delegation_rejected" };

    const captureId = `capture-${this.randomId()}`;
    const reservation = {
      capture_id: captureId,
      attempt_id: input.attemptId,
      delegation_id: delegationId,
      authorization_binding_digest: authorization.authorization.binding_digest,
      executor_binding_digest: authorization.authorization.executor_attestation_hash,
      environment_binding_digest: authorization.authorization.environment_attestation_hash,
      workspace_binding_digest: authorization.authorization.workspace_attestation_hash,
      reserved_bytes: 8 * 1_024 * 1_024,
      reserved_frames: 4_096,
      reserved_events: 4_096,
      max_duration_ms: requirements.max_duration_ms,
    };
    const evidence = await ProtectedEvidenceCaptureSession.open({
      store: this.dependencies.evidenceStore,
      reservation,
      openedAt: this.now(),
    });
    const invocation = DelegationInvocationRequest_v1.parse({
      schema_version: "1.0.0",
      delegation_id: delegationId,
      attempt_id: input.attemptId,
      offer_hash: computeDelegationOfferHash(offer),
      authority_grant_hash: offer.authority_grant_hash,
      worker_thread_id: logicalThreadId,
      transcript_start_hash: offer.transcript_start_hash,
      provider_attestation_hash: authorization.authorization.executor_attestation_hash,
      environment_attestation_hash: authorization.authorization.environment_attestation_hash,
      workspace_attestation_hash: authorization.authorization.workspace_attestation_hash,
      phase: "offer",
    });
    const executor: AttemptExecutor = new QualifiedWsl2CodexExecutor(this.dependencies.bridge);
    const started = await new GovernedAttemptOperationService(this.dependencies.store).start(
      executor,
      {
        operationMutationId: `${delegationId}:operation:create`,
        authorizationMutationId: `${delegationId}:offer:authorize`,
        authorization: authorization.authorization,
        invocation,
        prompt: input.prompt,
        outputSchema: SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA,
        evidence,
        evidenceReservation: reservation,
        verificationContext,
        now: this.now(),
      }
    );
    if (!started.started) return { started: false, reason: "operation_rejected" };
    return {
      started: true,
      operationId: started.operationId,
      delegationId,
      captureId,
      authorizationBindingDigest: authorization.authorization.binding_digest,
      verificationContext,
    };
  }
}
