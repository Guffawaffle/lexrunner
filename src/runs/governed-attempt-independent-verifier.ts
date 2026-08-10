import { createHash } from "node:crypto";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  type GovernedAttemptOperationEvent_v1 as GovernedAttemptOperationEvent,
  type GovernedAttemptOperationRecord_v1 as GovernedAttemptOperationRecord,
} from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationRecord_v1 as GovernedDelegationRecord } from "../store/governed-delegation-store.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { AgentTaskPacket_v1, ExecutionEnvelope_v1 } from "../schemas/agent-work.js";
import { validateAgentExecutionPathBinding } from "../schemas/agent-work-projection.js";
import type {
  AttemptRecord,
  LaunchEnvelopeBindingRecord,
  TaskPacketBindingRecord,
  WorkspaceLifecycleLeaseRecord,
} from "../store/workspace-lifecycle-store.js";
import {
  createGovernedAttemptVerificationReceipt,
  type GovernedAttemptVerificationContext_v1 as GovernedAttemptVerificationContext,
  type GovernedAttemptVerificationFailureCode,
  type GovernedAttemptVerificationReceipt_v1 as GovernedAttemptVerificationReceipt,
  type IndependentlyReadEvidenceFrame,
  type IndependentlyVerifiedEvidenceCapture,
} from "./governed-attempt-verification.js";
import {
  GOVERNED_CODE_REVIEW_VERIFIER_ID,
  computeGovernedCodeReviewCorpusScopeHash,
  governedCodeReviewTaskMatches,
  interpretGovernedCodeReviewOutcome,
} from "./governed-review-task-profile.js";

const TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
]);
const STRENGTH_RANK = {
  executor_reported: 0,
  inferred: 1,
  host_enforced_indirect: 2,
  independently_enforced_verified: 3,
} as const;

export interface GovernedAttemptIndependentVerificationInput {
  verificationId: string;
  verifierId: string;
  operation: GovernedAttemptOperationRecord;
  events: readonly GovernedAttemptOperationEvent[];
  context: GovernedAttemptVerificationContext;
  evidence: IndependentlyVerifiedEvidenceCapture;
  delegation?: GovernedDelegationRecord;
  repositoryLifecycle?: {
    attempt: AttemptRecord | null;
    lease: WorkspaceLifecycleLeaseRecord | null;
    launchBinding: LaunchEnvelopeBindingRecord | null;
    packetBinding: TaskPacketBindingRecord | null;
  };
  verifiedAt: string;
}

/**
 * Independent semantic verifier for one completed governed review. It trusts
 * neither the provider's terminal classification nor its collected verdict.
 */
export class GovernedAttemptIndependentVerifier {
  verify(input: GovernedAttemptIndependentVerificationInput): GovernedAttemptVerificationReceipt {
    const failures = new Set<GovernedAttemptVerificationFailureCode>();
    const { operation, context, evidence } = input;

    if (operation.status !== "completed") failures.add("operation_not_completed");
    if (!operation.result || !operation.result_hash) failures.add("result_missing");
    if (operation.result?.admissibility === "admissible") failures.add("provider_claim_elevated");

    this.verifyContext(input, failures);
    this.verifyEvidenceBinding(input, failures);
    this.verifyEvents(input, failures);

    const protocol = analyzeProtocol(evidence.frames, operation, failures);
    this.verifyTaskBudget(input, protocol.finalMessage, failures);
    let taskOutcome: "pass" | "block" | "not_produced" | "invalid" = "not_produced";
    let terminalTaskOutcome: "pass" | "block" | "invalid" | undefined;
    if (protocol.finalMessage !== undefined) {
      let output: unknown;
      try {
        output = JSON.parse(protocol.finalMessage) as unknown;
      } catch {
        failures.add("output_invalid");
      }
      if (output !== undefined) {
        try {
          const validator = new Ajv2020({ allErrors: true, strict: true }).compile(
            context.output_schema
          );
          if (!validator(output)) failures.add("output_invalid");
        } catch {
          failures.add("output_schema_invalid");
        }
        const profile = interpretGovernedCodeReviewOutcome({
          task: context.governed_task,
          verifierId: input.verifierId,
          output,
          terminalTaskOutcome: protocol.terminalTaskOutcome,
        });
        if (!profile.matched) {
          failures.add("task_input_binding_mismatch");
          taskOutcome = "invalid";
        } else {
          taskOutcome = profile.outputOutcome;
          terminalTaskOutcome = profile.terminalOutcome;
          if (taskOutcome === "invalid") failures.add("output_invalid");
          if (!terminalTaskOutcome) failures.add("protocol_violation");
        }
      }
    } else {
      failures.add("protocol_violation");
    }

    if (
      !operation.result ||
      operation.result.task_outcome !== taskOutcome ||
      terminalTaskOutcome !== taskOutcome
    ) {
      failures.add("outcome_mismatch");
    }

    const failureCodes = [...failures].sort();
    const accepted = failureCodes.length === 0;
    return createGovernedAttemptVerificationReceipt({
      verification_id: input.verificationId,
      verifier_id: input.verifierId,
      operation_id: operation.operation_id,
      attempt_id: operation.attempt_id,
      delegation_id: operation.delegation_id,
      capture_id: evidence.reference.capture_id,
      authorization_binding_digest: operation.authorization.binding_digest,
      verification_context_hash: context.context_hash,
      operation_result_hash:
        operation.result_hash ??
        computeCanonicalHash({
          kind: "missing_governed_attempt_result",
          operation: operation.operation_id,
        }),
      capture_root:
        evidence.reference.capture_root ??
        computeCanonicalHash({
          kind: "missing_capture_root",
          capture: evidence.reference.capture_id,
        }),
      capture_verification_hash:
        evidence.reference.verification_hash ??
        computeCanonicalHash({
          kind: "missing_capture_verification",
          capture: evidence.reference.capture_id,
        }),
      decision: accepted ? "accepted" : "rejected",
      task_outcome: taskOutcome,
      admissibility: accepted ? "admissible" : "inadmissible",
      failure_codes: failureCodes,
      verified_at: input.verifiedAt,
    });
  }

  private verifyContext(
    input: GovernedAttemptIndependentVerificationInput,
    failures: Set<GovernedAttemptVerificationFailureCode>
  ): void {
    const { operation, context } = input;
    const authorization = operation.authorization;
    if (
      context.requirements.attempt_id !== operation.attempt_id ||
      context.requirements.delegation_id !== operation.delegation_id ||
      computeCanonicalHash(context.requirements) !== authorization.requirements_hash ||
      computeCanonicalHash(context.executor) !== authorization.executor_attestation_hash ||
      computeCanonicalHash(context.environment) !== authorization.environment_attestation_hash ||
      computeCanonicalHash(context.workspace) !== authorization.workspace_attestation_hash ||
      context.executor.executor_id !== operation.handle.executor_id ||
      context.workspace.repository_id !== authorization.grant.repository_id ||
      context.workspace.base_object_id !== authorization.grant.base_object_id ||
      context.workspace.candidate_object_id !== authorization.grant.candidate_object_id ||
      !["synthetic", "repository"].includes(context.workspace.corpus_kind)
    ) {
      failures.add("context_binding_mismatch");
    }
    if (context.input_binding) {
      if (
        !input.delegation ||
        input.delegation.delegation_id !== operation.delegation_id ||
        input.delegation.attempt_id !== operation.attempt_id ||
        input.delegation.offer_hash !== context.input_binding.delegation_offer_hash ||
        input.delegation.state.offer.task_offer_hash !== context.input_binding.task_offer_hash ||
        context.input_binding.output_schema_hash !== context.output_schema_hash
      ) {
        failures.add("task_input_binding_mismatch");
      }
      if (
        context.governed_task &&
        (!input.delegation ||
          !operation.evidence_reservation ||
          operation.evidence_reservation.max_tool_calls === undefined ||
          input.verifierId !== GOVERNED_CODE_REVIEW_VERIFIER_ID ||
          !context.task_execution ||
          input.delegation.state.offer.authority_grant_hash !==
            context.task_execution.authority_grant_hash ||
          input.delegation.state.offer.worker.provider_id !==
            context.governed_task.authorized_model_provider ||
          !governedCodeReviewTaskMatches(context.governed_task, {
            attemptId: operation.attempt_id,
            delegationId: operation.delegation_id,
            objectiveHash: context.requirements.objective_hash,
            authorizedModelProvider: context.requirements.authorized_model_provider,
            promptHash: context.input_binding.prompt_hash,
            corpusScopeHash: computeGovernedCodeReviewCorpusScopeHash({
              repositoryId: context.workspace.repository_id,
              baseObjectId: context.workspace.base_object_id,
              candidateObjectId: context.workspace.candidate_object_id,
              corpusHash: context.workspace.corpus_hash,
              selectionHash: context.workspace.selection_hash,
            }),
            maxDurationMs: context.requirements.max_duration_ms,
            maxOutputBytes: context.requirements.max_output_bytes,
            maxEvidenceBytes: operation.evidence_reservation.reserved_bytes,
            maxToolCalls: operation.evidence_reservation.max_tool_calls,
          }))
      ) {
        failures.add("task_input_binding_mismatch");
      }
      const budget = context.governed_task?.budget;
      const reservation = operation.evidence_reservation;
      if (
        budget &&
        (!reservation ||
          budget.max_duration_ms !== context.requirements.max_duration_ms ||
          budget.max_duration_ms !== reservation.max_duration_ms ||
          budget.max_duration_ms !== operation.authorization.grant.max_duration_ms ||
          budget.max_output_bytes !== context.requirements.max_output_bytes ||
          budget.max_output_bytes !== operation.authorization.grant.max_output_bytes ||
          budget.max_evidence_bytes !== reservation.reserved_bytes ||
          budget.max_tool_calls !== reservation.max_tool_calls)
      ) {
        failures.add("task_input_binding_mismatch");
      }
      if (context.workspace.corpus_kind === "repository" && !context.governed_task) {
        failures.add("task_input_binding_mismatch");
      }
    } else if (context.workspace.corpus_kind === "repository") {
      failures.add("task_input_binding_mismatch");
    }
    const repository = context.repository_corpus;
    if (
      context.workspace.corpus_kind === "repository" &&
      (!repository ||
        repository.source_binding_hash !==
          computeCanonicalHash({
            attempt_id: operation.attempt_id,
            workspace_lease_id: repository.workspace_lease_id,
            task_packet_hash: repository.task_packet_hash,
            launch_envelope_hash: repository.launch_envelope_hash,
            path_mapping_hash: repository.path_mapping_hash,
          }))
    ) {
      failures.add("context_binding_mismatch");
    }
    if (context.workspace.corpus_kind === "repository") {
      this.verifyRepositoryLifecycle(input, failures);
    }
    if (operation.result?.authorization_outcome !== "valid") {
      failures.add("authorization_invalid");
    }
    const observed = input.evidence.frames.map((frame) => Date.parse(frame.observedAt));
    if (
      observed.some(
        (timestamp) =>
          !Number.isFinite(timestamp) ||
          timestamp < Date.parse(authorization.authorized_at) ||
          timestamp > Date.parse(authorization.expires_at)
      )
    ) {
      failures.add("authorization_expired");
    }
    const attested = new Map(
      context.environment.controls.map((control) => [control.control, control] as const)
    );
    for (const required of context.requirements.controls) {
      const actual = attested.get(required.control);
      if (
        !actual ||
        actual.status !== "enforced" ||
        STRENGTH_RANK[actual.strength] < STRENGTH_RANK[required.minimum_strength]
      ) {
        failures.add("control_unverifiable");
      }
    }
  }

  private verifyRepositoryLifecycle(
    input: GovernedAttemptIndependentVerificationInput,
    failures: Set<GovernedAttemptVerificationFailureCode>
  ): void {
    const repository = input.context.repository_corpus;
    const lifecycle = input.repositoryLifecycle;
    if (!repository || !lifecycle) {
      failures.add("lifecycle_binding_mismatch");
      return;
    }
    const { attempt, lease, launchBinding, packetBinding } = lifecycle;
    if (!attempt || !lease || !launchBinding || !packetBinding) {
      failures.add("lifecycle_binding_mismatch");
      return;
    }
    try {
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
      if (
        !pathBinding.valid ||
        pathBinding.mappingDigest !== repository.path_mapping_hash ||
        attempt.attemptId !== input.operation.attempt_id ||
        attempt.workspaceLeaseId !== repository.workspace_lease_id ||
        attempt.packetHash !== repository.task_packet_hash ||
        attempt.baseSha !== input.context.workspace.base_object_id ||
        lease.leaseId !== repository.workspace_lease_id ||
        lease.status !== "active" ||
        Date.parse(lease.expiresAt) <= Date.parse(input.verifiedAt) ||
        lease.revision < repository.workspace_lease_revision ||
        lease.attemptId !== attempt.attemptId ||
        lease.runId !== attempt.runId ||
        lease.packetId !== attempt.packetId ||
        lease.packetHash !== attempt.packetHash ||
        lease.repositoryId !== input.context.workspace.repository_id ||
        lease.baseSha !== attempt.baseSha ||
        launchBinding.attemptId !== attempt.attemptId ||
        launchBinding.runId !== attempt.runId ||
        launchBinding.workspaceLeaseId !== lease.leaseId ||
        launchBinding.workspaceLeaseRevision !== repository.workspace_lease_revision ||
        launchBinding.envelopeHash !== repository.launch_envelope_hash ||
        launchBinding.envelopeId !== envelope.envelope_id ||
        launchBinding.workspaceLeaseRevision !== envelope.workspace_lease_revision ||
        computeCanonicalHash(envelope) !== launchBinding.envelopeHash ||
        envelope.run_id !== attempt.runId ||
        envelope.attempt_id !== attempt.attemptId ||
        envelope.workspace_lease_id !== lease.leaseId ||
        envelope.packet_id !== attempt.packetId ||
        envelope.packet_hash !== attempt.packetHash ||
        envelope.expected_head_sha !== attempt.baseSha ||
        envelope.branch !== lease.branch ||
        envelope.paths.worktree_root !== lease.worktreePath ||
        packetBinding.attemptId !== attempt.attemptId ||
        packetBinding.runId !== attempt.runId ||
        packetBinding.packetHash !== repository.task_packet_hash ||
        packet.packet_hash !== packetBinding.packetHash ||
        packet.packet_id !== attempt.packetId ||
        packet.run_id !== attempt.runId ||
        packet.attempt_id !== attempt.attemptId ||
        packet.repository.id !== lease.repositoryId ||
        packet.repository.base_sha !== attempt.baseSha
      ) {
        failures.add("lifecycle_binding_mismatch");
      }
    } catch {
      failures.add("lifecycle_binding_mismatch");
    }
  }

  private verifyEvidenceBinding(
    input: GovernedAttemptIndependentVerificationInput,
    failures: Set<GovernedAttemptVerificationFailureCode>
  ): void {
    const { operation, evidence } = input;
    const reference = evidence.reference;
    if (
      reference.status !== "complete" ||
      !reference.capture_root ||
      !reference.verification_hash
    ) {
      failures.add("evidence_incomplete");
    }
    if (
      !operation.evidence_reservation ||
      !operation.evidence_declaration ||
      reference.capture_id !== operation.evidence_declaration?.capture_id ||
      reference.attempt_id !== operation.attempt_id ||
      reference.delegation_id !== operation.delegation_id ||
      reference.authorization_binding_digest !== operation.authorization.binding_digest ||
      reference.executor_binding_digest !== operation.authorization.executor_attestation_hash ||
      reference.environment_binding_digest !==
        operation.authorization.environment_attestation_hash ||
      reference.workspace_binding_digest !== operation.authorization.workspace_attestation_hash
    ) {
      failures.add("evidence_binding_mismatch");
    }
    if (
      reference.frame_count !== evidence.frames.length ||
      evidence.frames.some((frame, index) => frame.sequence !== index + 1)
    ) {
      failures.add("evidence_integrity_failure");
    }
  }

  private verifyTaskBudget(
    input: GovernedAttemptIndependentVerificationInput,
    finalMessage: string | undefined,
    failures: Set<GovernedAttemptVerificationFailureCode>
  ): void {
    const budget = input.context.governed_task?.budget;
    if (!budget) return;
    const openedAt = Date.parse(input.evidence.reference.opened_at ?? "");
    const sealedAt = Date.parse(input.evidence.reference.sealed_at ?? "");
    const elapsedMs =
      Number.isFinite(openedAt) && Number.isFinite(sealedAt)
        ? sealedAt - openedAt
        : Number.POSITIVE_INFINITY;
    if (
      elapsedMs > budget.max_duration_ms ||
      Buffer.byteLength(finalMessage ?? "", "utf8") > budget.max_output_bytes ||
      input.evidence.reference.total_bytes > budget.max_evidence_bytes ||
      countObservedToolCalls(input.evidence.frames) > budget.max_tool_calls
    ) {
      failures.add("budget_exceeded");
    }
  }

  private verifyEvents(
    input: GovernedAttemptIndependentVerificationInput,
    failures: Set<GovernedAttemptVerificationFailureCode>
  ): void {
    const { operation, events, evidence } = input;
    if (
      events.length !== evidence.frames.length ||
      events.length !== operation.last_event_sequence ||
      events.some((entry, index) => {
        const frame = evidence.frames[index];
        const expectedType =
          index === 0
            ? "started"
            : index === evidence.frames.length - 1
              ? "completed"
              : frame?.frameClass === "provider_receipt" &&
                  parseObject(frame.bytes)?.decision === "ACCEPT"
                ? "accepted"
                : "executor_event";
        const expectedExecutorEventType =
          expectedType === "executor_event" ? executorEventType(frame) : undefined;
        return (
          entry.operation_id !== operation.operation_id ||
          entry.event.sequence !== index + 1 ||
          entry.event.sequence !== frame?.sequence ||
          entry.event.observed_at !== frame?.observedAt ||
          entry.event.evidence_ref !== frame?.evidenceRef ||
          entry.event.type !== expectedType ||
          (entry.event.type === "executor_event" &&
            entry.event.executor_event_type !== expectedExecutorEventType)
        );
      })
    ) {
      failures.add("event_mismatch");
    }
  }
}

function analyzeProtocol(
  frames: readonly IndependentlyReadEvidenceFrame[],
  operation: GovernedAttemptOperationRecord,
  failures: Set<GovernedAttemptVerificationFailureCode>
): { finalMessage?: string; terminalTaskOutcome?: unknown } {
  if (frames.length < 3) {
    failures.add("protocol_violation");
    return {};
  }
  const first = parseObject(frames[0]!.bytes);
  const firstInputBinding = isObject(first?.input_binding) ? first.input_binding : undefined;
  const firstRepositoryCorpus = isObject(first?.repository_corpus)
    ? first.repository_corpus
    : undefined;
  if (
    frames[0]!.frameClass !== "provider_receipt" ||
    first?.operation_id !== operation.operation_id ||
    first?.provider_handle !== operation.handle.provider_handle ||
    first?.authorization_binding_digest !== operation.authorization.binding_digest ||
    (operation.verification_context?.input_binding !== undefined &&
      (!firstInputBinding ||
        computeCanonicalHash(firstInputBinding) !==
          computeCanonicalHash(operation.verification_context.input_binding))) ||
    (operation.verification_context?.repository_corpus !== undefined &&
      (!firstRepositoryCorpus ||
        computeCanonicalHash(firstRepositoryCorpus) !==
          computeCanonicalHash(
            providerRepositoryCorpusBinding(operation.verification_context.repository_corpus)
          )))
  ) {
    failures.add("protocol_violation");
  }

  let accepted = false;
  let acceptedReceipt = false;
  const threadIds: string[] = [];
  const reviewMessages: string[] = [];
  for (const frame of frames.slice(1, -1)) {
    if (frame.frameClass === "executor_stderr") continue;
    if (frame.frameClass === "provider_receipt") {
      const receipt = parseObject(frame.bytes);
      const acceptedThread = threadIds[threadIds.length - 1];
      if (
        !accepted ||
        acceptedReceipt ||
        receipt?.decision !== "ACCEPT" ||
        !acceptedThread ||
        receipt.thread_binding_hash !== contentHash(acceptedThread)
      ) {
        failures.add("protocol_violation");
      } else {
        acceptedReceipt = true;
      }
      continue;
    }
    if (frame.frameClass !== "executor_stdout") {
      failures.add("protocol_violation");
      continue;
    }
    const event = parseObject(frame.bytes);
    if (!event) {
      failures.add("protocol_violation");
      continue;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      if (threadIds.length > 0 && !acceptedReceipt) failures.add("protocol_violation");
      threadIds.push(event.thread_id);
    }
    const item = isObject(event.item) ? event.item : undefined;
    if (
      !acceptedReceipt &&
      item &&
      typeof item.type === "string" &&
      TOOL_ITEM_TYPES.has(item.type)
    ) {
      failures.add("protocol_violation");
    }
    if (
      acceptedReceipt &&
      item &&
      typeof item.type === "string" &&
      item.type !== "command_execution" &&
      TOOL_ITEM_TYPES.has(item.type)
    ) {
      failures.add("protocol_violation");
    }
    if (event.type === "item.completed" && item?.type === "agent_message") {
      const message = item.text;
      if (typeof message !== "string") {
        failures.add("protocol_violation");
      } else if (!accepted) {
        if (message.trim() !== "ACCEPT") failures.add("protocol_violation");
        else accepted = true;
      } else if (!acceptedReceipt) {
        failures.add("protocol_violation");
      } else {
        reviewMessages.push(message);
      }
    }
  }
  if (!accepted || !acceptedReceipt || threadIds.length < 2 || new Set(threadIds).size !== 1) {
    failures.add("protocol_violation");
  }

  const terminalFrame = frames[frames.length - 1]!;
  const terminal = parseObject(terminalFrame.bytes);
  if (
    terminalFrame.frameClass !== "provider_receipt" ||
    terminal?.structured_result_present !== true ||
    !("task_outcome" in (terminal ?? {}))
  ) {
    failures.add("protocol_violation");
  }
  return {
    ...(reviewMessages.length > 0
      ? { finalMessage: reviewMessages[reviewMessages.length - 1]! }
      : {}),
    ...(terminal && "task_outcome" in terminal
      ? { terminalTaskOutcome: terminal.task_outcome }
      : {}),
  };
}

function providerRepositoryCorpusBinding(
  binding: NonNullable<GovernedAttemptVerificationContext["repository_corpus"]>
): Omit<typeof binding, "workspace_lease_revision"> {
  const { workspace_lease_revision: _hostLifecycleRevision, ...providerBinding } = binding;
  return providerBinding;
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function countObservedToolCalls(frames: readonly IndependentlyReadEvidenceFrame[]): number {
  return frames.reduce((count, frame) => {
    if (frame.frameClass !== "executor_stdout") return count;
    const event = parseObject(frame.bytes);
    const item = isObject(event?.item) ? event.item : undefined;
    return event?.type === "item.completed" &&
      typeof item?.type === "string" &&
      TOOL_ITEM_TYPES.has(item.type)
      ? count + 1
      : count;
  }, 0);
}

function executorEventType(frame: IndependentlyReadEvidenceFrame | undefined): string | undefined {
  if (!frame) return undefined;
  if (frame.frameClass === "executor_stderr") return "codex.stderr";
  if (frame.frameClass !== "executor_stdout") return undefined;
  return String(parseObject(frame.bytes)?.type ?? "codex.invalid_json").slice(0, 128);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
