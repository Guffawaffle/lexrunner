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
import {
  AgentTaskPacket_v1,
  ExecutionEnvelope_v1,
  isTerminalAttemptStatus,
} from "../schemas/agent-work.js";
import { validateAgentExecutionPathBinding } from "../schemas/agent-work-projection.js";
import type { GovernedAttemptOperationStore } from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";
import type { ProtectedEvidenceStore } from "../store/protected-evidence-store.js";
import type {
  LaunchEnvelopeBindingStore,
  TaskPacketBindingStore,
  WorkspaceLifecycleStore,
} from "../store/workspace-lifecycle-store.js";
import {
  contentHash,
  type GovernedRepositoryCorpusFrame,
  GovernedRepositoryCorpusHeader_v1,
  GovernedRepositoryCorpusExportRequest_v1,
} from "./governed-review-repository-corpus.js";
import type { GovernedRepositoryCorpusSource } from "./external-wsl2-repository-corpus-source.js";
import type { QualifiedCodexProviderAttestations } from "./qualified-wsl2-codex-executor.js";
import {
  GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskExecutionBinding,
  createGovernedCodeReviewTaskSpec,
} from "./governed-review-task-profile.js";

type GovernedReviewStore = GovernedAttemptOperationStore & GovernedDelegationStore;

export const SYNTHETIC_GOVERNED_REVIEW = Object.freeze({
  repositoryId: "lexrunner-synthetic-retry-window",
  baseObjectId: "1".repeat(40),
  candidateObjectId: "2".repeat(40),
  maxDurationMs: 180_000,
  maxOutputBytes: 2 * 1_024 * 1_024,
});

export const SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA = GOVERNED_CODE_REVIEW_OUTPUT_SCHEMA;

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
        | "lifecycle_binding_mismatch"
        | "authorization_denied"
        | "delegation_rejected"
        | "operation_rejected";
    };

export interface StartRepositoryGovernedReviewInput extends StartSyntheticGovernedReviewInput {}

export type StartRepositoryGovernedReviewResult =
  | (Extract<StartSyntheticGovernedReviewResult, { started: true }> & {
      corpus: GovernedRepositoryCorpusHeader_v1;
    })
  | {
      started: false;
      reason:
        | Extract<StartSyntheticGovernedReviewResult, { started: false }>["reason"]
        | "workspace_lease_missing"
        | "workspace_lease_not_active"
        | "launch_binding_missing"
        | "task_packet_binding_missing"
        | "lifecycle_binding_mismatch"
        | "repository_provider_unavailable"
        | "repository_corpus_rejected";
    };

export interface GovernedReviewRuntimeDependencies {
  store: GovernedReviewStore;
  lifecycle: Pick<WorkspaceLifecycleStore, "getAttempt">;
  repositoryLifecycle?: Pick<WorkspaceLifecycleStore, "getWorkspaceLease"> &
    Pick<LaunchEnvelopeBindingStore, "getLaunchEnvelopeBinding"> &
    Pick<TaskPacketBindingStore, "getTaskPacketBinding">;
  evidenceStore: ProtectedEvidenceStore;
  bridge: QualifiedCodexProviderBridge;
  repositoryCorpusSource?: GovernedRepositoryCorpusSource;
  now?: () => string;
  randomId?: () => string;
}

/**
 * Binds a real durable ADR-010 Attempt to the qualified governed provider.
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

    const attestations = await this.dependencies.bridge.prepareSynthetic({
      environment_id: input.environmentId,
      repository_id: SYNTHETIC_GOVERNED_REVIEW.repositoryId,
      base_object_id: SYNTHETIC_GOVERNED_REVIEW.baseObjectId,
      candidate_object_id: SYNTHETIC_GOVERNED_REVIEW.candidateObjectId,
    });
    return this.startPrepared(input, {
      repositoryId: SYNTHETIC_GOVERNED_REVIEW.repositoryId,
      baseObjectId: SYNTHETIC_GOVERNED_REVIEW.baseObjectId,
      candidateObjectId: SYNTHETIC_GOVERNED_REVIEW.candidateObjectId,
      attestations,
    });
  }

  async startRepository(
    input: StartRepositoryGovernedReviewInput
  ): Promise<StartRepositoryGovernedReviewResult> {
    const attempt = await this.dependencies.lifecycle.getAttempt(input.attemptId);
    if (!attempt) return { started: false, reason: "attempt_not_found" };
    if (attempt.runId !== input.runId) return { started: false, reason: "attempt_run_mismatch" };
    if (isTerminalAttemptStatus(attempt.status)) {
      return { started: false, reason: "attempt_terminal" };
    }
    if (attempt.status !== "running") return { started: false, reason: "attempt_not_running" };
    if (!attempt.workspaceLeaseId) return { started: false, reason: "workspace_lease_missing" };

    const repositoryLifecycle = this.dependencies.repositoryLifecycle;
    if (!repositoryLifecycle) {
      return { started: false, reason: "repository_provider_unavailable" };
    }
    const [lease, launchBinding, packetBinding] = await Promise.all([
      repositoryLifecycle.getWorkspaceLease(attempt.workspaceLeaseId),
      repositoryLifecycle.getLaunchEnvelopeBinding(attempt.attemptId),
      repositoryLifecycle.getTaskPacketBinding(attempt.attemptId),
    ]);
    if (!lease) return { started: false, reason: "workspace_lease_missing" };
    if (lease.status !== "active") {
      return { started: false, reason: "workspace_lease_not_active" };
    }
    if (!launchBinding) return { started: false, reason: "launch_binding_missing" };
    if (!packetBinding) return { started: false, reason: "task_packet_binding_missing" };
    if (
      !this.dependencies.repositoryCorpusSource ||
      !this.dependencies.bridge.prepareRepository ||
      !this.dependencies.bridge.discardRepository
    ) {
      return { started: false, reason: "repository_provider_unavailable" };
    }

    let envelope: ReturnType<typeof ExecutionEnvelope_v1.parse>;
    let packet: ReturnType<typeof AgentTaskPacket_v1.parse>;
    try {
      envelope = ExecutionEnvelope_v1.parse(JSON.parse(launchBinding.envelopeJson));
      packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson));
    } catch {
      return { started: false, reason: "lifecycle_binding_mismatch" };
    }
    const pathBinding = validateAgentExecutionPathBinding(envelope.path_mappings, {
      repositoryId: lease.repositoryId,
      baseSha: lease.baseSha,
      hostId: lease.hostId,
      gitRuntime: lease.gitRuntime,
      repositoryRoot: lease.projectRoot,
      allocationRoot: envelope.paths.allocation_root ?? "",
      worktreePath: lease.worktreePath,
    });
    const mapping = envelope.path_mappings[0];
    if (
      !pathBinding.valid ||
      !mapping ||
      computeCanonicalHash(envelope) !== launchBinding.envelopeHash ||
      envelope.envelope_id !== launchBinding.envelopeId ||
      envelope.run_id !== attempt.runId ||
      envelope.attempt_id !== attempt.attemptId ||
      envelope.workspace_lease_id !== lease.leaseId ||
      envelope.workspace_lease_revision !== launchBinding.workspaceLeaseRevision ||
      envelope.packet_id !== attempt.packetId ||
      envelope.packet_hash !== attempt.packetHash ||
      envelope.expected_head_sha !== attempt.baseSha ||
      envelope.branch !== lease.branch ||
      packet.packet_hash !== packetBinding.packetHash ||
      packet.packet_hash !== attempt.packetHash ||
      packet.packet_id !== attempt.packetId ||
      packet.run_id !== attempt.runId ||
      packet.attempt_id !== attempt.attemptId ||
      packet.repository.id !== lease.repositoryId ||
      packet.repository.base_sha !== attempt.baseSha ||
      lease.packetHash !== attempt.packetHash ||
      lease.packetId !== attempt.packetId ||
      lease.runId !== attempt.runId ||
      lease.attemptId !== attempt.attemptId ||
      lease.baseSha !== attempt.baseSha ||
      lease.worktreePath !== envelope.paths.worktree_root
    ) {
      return { started: false, reason: "lifecycle_binding_mismatch" };
    }

    const request: GovernedRepositoryCorpusExportRequest_v1 = {
      schema_version: "1.0.0",
      environment_id: input.environmentId,
      repository_id: lease.repositoryId,
      attempt_id: attempt.attemptId,
      workspace_lease_id: lease.leaseId,
      task_packet_hash: packet.packet_hash,
      launch_envelope_hash: launchBinding.envelopeHash,
      path_mapping_hash: pathBinding.mappingDigest,
      base_object_id: attempt.baseSha,
      host_id: lease.hostId,
      git_runtime: lease.gitRuntime,
      branch: lease.branch,
      repository_root: mapping.roots.native_repository.path,
      allocation_root: mapping.roots.native_allocation_root.path,
      worktree_root: mapping.roots.native_worktree.path,
      directory_identities: {
        repository: mapping.roots.native_repository.directory_identity,
        allocation: mapping.roots.native_allocation_root.directory_identity,
        worktree: mapping.roots.native_worktree.directory_identity,
      },
    };
    let preparedWorkspaceId: string | undefined;
    try {
      const corpus = await this.dependencies.repositoryCorpusSource.export(request);
      const header = GovernedRepositoryCorpusHeader_v1.parse(corpus.header);
      if (
        header.environment_id !== request.environment_id ||
        header.repository_id !== request.repository_id ||
        header.base_object_id !== request.base_object_id ||
        header.source_binding.attempt_id !== request.attempt_id ||
        header.source_binding.workspace_lease_id !== request.workspace_lease_id ||
        header.source_binding.task_packet_hash !== request.task_packet_hash ||
        header.source_binding.launch_envelope_hash !== request.launch_envelope_hash ||
        header.source_binding.path_mapping_hash !== request.path_mapping_hash
      ) {
        return { started: false, reason: "repository_corpus_rejected" };
      }
      const attestations = await this.dependencies.bridge.prepareRepository(corpus);
      preparedWorkspaceId = attestations.workspace.workspace_id;
      if (!(await this.repositoryLifecycleStillMatches(input, request))) {
        await this.dependencies.bridge.discardRepository(preparedWorkspaceId);
        return { started: false, reason: "lifecycle_binding_mismatch" };
      }
      const started = await this.startPrepared(input, {
        repositoryId: corpus.header.repository_id,
        baseObjectId: corpus.header.base_object_id,
        candidateObjectId: corpus.header.candidate_object_id,
        attestations,
        corpus,
        workspaceLeaseRevision: launchBinding.workspaceLeaseRevision,
      });
      if (!started.started) {
        await this.dependencies.bridge.discardRepository(preparedWorkspaceId);
      }
      return started.started ? { ...started, corpus: corpus.header } : started;
    } catch {
      if (preparedWorkspaceId) {
        await this.dependencies.bridge
          .discardRepository(preparedWorkspaceId)
          .catch(() => undefined);
      }
      return { started: false, reason: "repository_corpus_rejected" };
    }
  }

  private async repositoryLifecycleStillMatches(
    input: StartRepositoryGovernedReviewInput,
    expected: GovernedRepositoryCorpusExportRequest_v1
  ): Promise<boolean> {
    const repositoryLifecycle = this.dependencies.repositoryLifecycle;
    if (!repositoryLifecycle) return false;
    try {
      const attempt = await this.dependencies.lifecycle.getAttempt(input.attemptId);
      if (
        !attempt ||
        attempt.runId !== input.runId ||
        attempt.status !== "running" ||
        attempt.workspaceLeaseId !== expected.workspace_lease_id ||
        attempt.packetHash !== expected.task_packet_hash ||
        attempt.baseSha !== expected.base_object_id
      ) {
        return false;
      }
      const [lease, launchBinding, packetBinding] = await Promise.all([
        repositoryLifecycle.getWorkspaceLease(expected.workspace_lease_id),
        repositoryLifecycle.getLaunchEnvelopeBinding(input.attemptId),
        repositoryLifecycle.getTaskPacketBinding(input.attemptId),
      ]);
      if (!lease || lease.status !== "active" || !launchBinding || !packetBinding) return false;
      const envelope = ExecutionEnvelope_v1.parse(JSON.parse(launchBinding.envelopeJson));
      const packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson));
      const pathBinding = validateAgentExecutionPathBinding(envelope.path_mappings, {
        repositoryId: lease.repositoryId,
        baseSha: lease.baseSha,
        hostId: lease.hostId,
        gitRuntime: lease.gitRuntime,
        repositoryRoot: lease.projectRoot,
        allocationRoot: envelope.paths.allocation_root ?? "",
        worktreePath: lease.worktreePath,
      });
      const mapping = envelope.path_mappings[0];
      if (!pathBinding.valid || !mapping) return false;
      const observed = GovernedRepositoryCorpusExportRequest_v1.parse({
        schema_version: "1.0.0",
        environment_id: input.environmentId,
        repository_id: lease.repositoryId,
        attempt_id: attempt.attemptId,
        workspace_lease_id: lease.leaseId,
        task_packet_hash: packet.packet_hash,
        launch_envelope_hash: launchBinding.envelopeHash,
        path_mapping_hash: pathBinding.mappingDigest,
        base_object_id: attempt.baseSha,
        host_id: lease.hostId,
        git_runtime: lease.gitRuntime,
        branch: lease.branch,
        repository_root: mapping.roots.native_repository.path,
        allocation_root: mapping.roots.native_allocation_root.path,
        worktree_root: mapping.roots.native_worktree.path,
        directory_identities: {
          repository: mapping.roots.native_repository.directory_identity,
          allocation: mapping.roots.native_allocation_root.directory_identity,
          worktree: mapping.roots.native_worktree.directory_identity,
        },
      });
      return (
        computeCanonicalHash(observed) === computeCanonicalHash(expected) &&
        computeCanonicalHash(envelope) === launchBinding.envelopeHash &&
        envelope.envelope_id === launchBinding.envelopeId &&
        envelope.run_id === attempt.runId &&
        envelope.attempt_id === attempt.attemptId &&
        envelope.workspace_lease_id === lease.leaseId &&
        envelope.workspace_lease_revision === launchBinding.workspaceLeaseRevision &&
        envelope.packet_id === attempt.packetId &&
        envelope.packet_hash === attempt.packetHash &&
        envelope.expected_head_sha === attempt.baseSha &&
        envelope.branch === lease.branch &&
        packet.packet_hash === packetBinding.packetHash &&
        packet.packet_hash === attempt.packetHash &&
        packet.packet_id === attempt.packetId &&
        packet.run_id === attempt.runId &&
        packet.attempt_id === attempt.attemptId &&
        packet.repository.id === lease.repositoryId &&
        packet.repository.base_sha === attempt.baseSha &&
        lease.packetHash === attempt.packetHash &&
        lease.packetId === attempt.packetId &&
        lease.runId === attempt.runId &&
        lease.attemptId === attempt.attemptId
      );
    } catch {
      return false;
    }
  }

  private async startPrepared(
    input: StartSyntheticGovernedReviewInput,
    prepared: {
      repositoryId: string;
      baseObjectId: string;
      candidateObjectId: string;
      attestations: QualifiedCodexProviderAttestations;
      corpus?: GovernedRepositoryCorpusFrame;
      workspaceLeaseRevision?: number;
    }
  ): Promise<StartSyntheticGovernedReviewResult> {
    if (prepared.corpus && prepared.workspaceLeaseRevision === undefined) {
      return { started: false, reason: "lifecycle_binding_mismatch" };
    }
    const attempt = await this.dependencies.lifecycle.getAttempt(input.attemptId);
    if (!attempt) return { started: false, reason: "attempt_not_found" };
    if (attempt.runId !== input.runId) return { started: false, reason: "attempt_run_mismatch" };
    if (isTerminalAttemptStatus(attempt.status)) {
      return { started: false, reason: "attempt_terminal" };
    }
    if (attempt.status !== "running") return { started: false, reason: "attempt_not_running" };
    const delegationId = `delegation-${this.randomId()}`;
    const logicalThreadId = `thread-${this.randomId()}`;
    const { attestations } = prepared;
    const controls = GovernedControlId.options.map((control) => ({
      control,
      minimum_strength: "independently_enforced_verified" as const,
    }));
    const objectiveHash = computeCanonicalHash({ objective: input.objective });
    const requirements = GovernedReviewRequirements_v1.parse({
      schema_version: "1.0.0",
      attempt_id: input.attemptId,
      delegation_id: delegationId,
      repository_id: prepared.repositoryId,
      base_object_id: prepared.baseObjectId,
      candidate_object_id: prepared.candidateObjectId,
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
    const promptHash = contentHash(input.prompt);
    const outputSchemaHash = computeCanonicalHash(SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA);
    const corpusScopeHash = computeGovernedCodeReviewCorpusScopeHash({
      repositoryId: attestations.workspace.repository_id,
      baseObjectId: attestations.workspace.base_object_id,
      candidateObjectId: attestations.workspace.candidate_object_id,
      corpusHash: attestations.workspace.corpus_hash,
      selectionHash: attestations.workspace.selection_hash,
    });
    const governedTask = createGovernedCodeReviewTaskSpec({
      attemptId: input.attemptId,
      delegationId,
      objectiveHash,
      authorizedModelProvider: requirements.authorized_model_provider,
      promptHash,
      corpusScopeHash,
      maxDurationMs: requirements.max_duration_ms,
      maxOutputBytes: requirements.max_output_bytes,
    });
    const taskExecution = createGovernedCodeReviewTaskExecutionBinding({
      task: governedTask,
      authorizedAt,
      expiresAt,
      executorAttestationHash: authorization.authorization.executor_attestation_hash,
      environmentAttestationHash: authorization.authorization.environment_attestation_hash,
      workspaceAttestationHash: authorization.authorization.workspace_attestation_hash,
    });
    const taskOfferHash = governedTask.task_spec_hash;
    const offer = {
      schema_version: "1.0.0" as const,
      delegation_id: delegationId,
      attempt_id: input.attemptId,
      worker: {
        provider_id: governedTask.authorized_model_provider,
        worker_id: attestations.executor.executor_id,
        thread_id: logicalThreadId,
      },
      task_offer_hash: taskOfferHash,
      requirements_hash: computeCanonicalHash(requirements),
      authority_grant_hash: taskExecution.authority_grant_hash,
      transcript_start_hash: computeCanonicalHash({ kind: "new-governed-review-transcript" }),
      offered_at: authorizedAt,
    };
    const delegationOfferHash = computeDelegationOfferHash(offer);
    const verificationContext = createGovernedAttemptVerificationContext({
      requirements,
      executor: attestations.executor,
      environment: attestations.environment,
      workspace: attestations.workspace,
      output_schema: SYNTHETIC_GOVERNED_REVIEW_OUTPUT_SCHEMA,
      governed_task: governedTask,
      task_execution: taskExecution,
      input_binding: {
        prompt_hash: promptHash,
        output_schema_hash: outputSchemaHash,
        task_offer_hash: taskOfferHash,
        delegation_offer_hash: delegationOfferHash,
      },
      ...(prepared.corpus
        ? {
            repository_corpus: {
              manifest_hash: computeCanonicalHash(prepared.corpus.header),
              source_binding_hash: prepared.corpus.header.source_binding_hash,
              workspace_lease_id: prepared.corpus.header.source_binding.workspace_lease_id,
              workspace_lease_revision: prepared.workspaceLeaseRevision!,
              task_packet_hash: prepared.corpus.header.source_binding.task_packet_hash,
              launch_envelope_hash: prepared.corpus.header.source_binding.launch_envelope_hash,
              path_mapping_hash: prepared.corpus.header.source_binding.path_mapping_hash,
              candidate_tree_hash: prepared.corpus.header.candidate_tree_hash,
              patch_hash: prepared.corpus.header.patch_hash,
            },
          }
        : {}),
    });
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
      reserved_bytes: governedTask.budget.max_evidence_bytes,
      reserved_frames: 4_096,
      reserved_events: 4_096,
      max_duration_ms: requirements.max_duration_ms,
      max_tool_calls: governedTask.budget.max_tool_calls,
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
      offer_hash: delegationOfferHash,
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
