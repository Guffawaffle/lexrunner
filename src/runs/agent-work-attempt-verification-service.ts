import type { ControllerLeaseCredential, JsonValue } from "../store/coordination-store.js";
import {
  AgentEngineVerification_v2,
  AgentTaskPacket_v1,
  AgentTaskReceipt_v2,
  ExecutionEnvelope_v1,
  type EngineVerificationTrustGapReason_v2,
  type VerificationOutcome,
} from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { validatePersistedCanonicalEnvelope } from "../store/workspace-lifecycle-evidence.js";
import type {
  ApplyAttemptAcceptanceInput,
  AttemptAcceptanceStore,
  AttemptRecord,
  AttemptReceiptStore,
  AttemptVerificationFailureReason,
  AttemptVerificationRecord,
  AttemptVerificationStore,
  LaunchEnvelopeBindingStore,
  TaskPacketBindingStore,
  WorkerSessionStore,
  WorkerAuthorityDecisionStore,
  WorkspaceLifecycleStore,
  WorkspaceMutationFailureReason,
} from "../store/workspace-lifecycle-store.js";
import {
  STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID,
  STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION,
} from "../store/workspace-lifecycle-store.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import type {
  AttemptVerificationRuntime,
  VerificationCommandFailureKind,
  VerificationCommandResult,
  VerificationWorkspaceObservation,
} from "./agent-work-attempt-verification-runtime.js";
import { verifyAttemptExecutionPathMapping } from "./agent-work-path-mapping.js";

const DEFAULT_CHECK_TIMEOUT_MS = 60_000;
const DEFAULT_INFRASTRUCTURE_RETRIES = 1;
const MAX_STATUS_BYTES = 64 * 1024;
export const ATTEMPT_VERIFIER_ID = "lexrunner.local-packet-verifier" as const;
export const ATTEMPT_VERIFIER_VERSION = "1.0.0" as const;

type VerificationStore = WorkspaceLifecycleStore &
  LaunchEnvelopeBindingStore &
  TaskPacketBindingStore &
  WorkerSessionStore &
  WorkerAuthorityDecisionStore &
  AttemptReceiptStore &
  AttemptVerificationStore;

export interface RunAttemptVerificationInput {
  runId: string;
  expectedRunRevision: number;
  controller: ControllerLeaseCredential;
  verificationId: string;
  attemptId: string;
  expectedAttemptRevision: number;
  workspaceLeaseId: string;
  expectedWorkspaceLeaseRevision: number;
  workerSessionId: string;
  expectedWorkerSessionRevision: number;
  receiptId: string;
  receiptHash: string;
  beginMutationId: string;
  completeMutationId: string;
}

export type AttemptVerificationRunResult =
  | {
      recorded: true;
      verificationId: string;
      verificationHash: string;
      attemptId: string;
      outcome: VerificationOutcome;
      attemptRevision: number;
      attemptStatus: AttemptRecord["status"];
      trustGapCount: number;
      checkCounts: Record<VerificationOutcome, number>;
      idempotentReplay: boolean;
    }
  | {
      recorded: false;
      reason: AttemptVerificationFailureReason;
      message?: string;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentSessionRevision?: number;
      currentRunRevision?: number;
    };

export interface AttemptVerificationStatusResult {
  verification: null | {
    verificationId: string;
    verificationHash: string;
    attemptId: string;
    outcome: VerificationOutcome;
    resultingAttemptRevision: number;
    resultingAttemptStatus: AttemptRecord["status"];
    resultIdentity: { headSha?: string; patchHash?: string };
    trustGapCount: number;
    checkCounts: Record<VerificationOutcome, number>;
    recordedAt: string;
    diagnostics?: {
      summary: string;
      failures: string[];
      trustGapReasons: EngineVerificationTrustGapReason_v2[];
      checks: AgentEngineVerification_v2["checks"];
    };
  };
}

export interface ApplyAttemptAcceptanceRequest extends Omit<
  ApplyAttemptAcceptanceInput,
  "mutationId" | "now"
> {
  mutationId: string;
}

export type AttemptAcceptanceResult =
  | {
      applied: true;
      attemptId: string;
      decision: "accepted" | "rejected";
      attemptRevision: number;
      policyId: typeof STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID;
      policyVersion: typeof STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION;
      reasonCodes: string[];
      idempotentReplay: boolean;
    }
  | {
      applied: false;
      reason: WorkspaceMutationFailureReason;
      currentAttemptRevision?: number;
      currentWorkspaceLeaseRevision?: number;
      currentRunRevision?: number;
    };

export interface AttemptAcceptanceStatusResult {
  acceptance: null | {
    attemptId: string;
    decision: "accepted" | "rejected";
    attemptRevision: number;
    policyId: typeof STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID;
    policyVersion: typeof STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION;
    reasonCodes: string[];
    appliedAt: string;
  };
}

/** Shared CLI/MCP application boundary for engine-owned packet verification. */
export class AgentWorkAttemptVerificationService {
  constructor(
    private readonly store: VerificationStore,
    private readonly runtime: AttemptVerificationRuntime,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async run(input: RunAttemptVerificationInput): Promise<AttemptVerificationRunResult> {
    const existing = await this.store.getAttemptVerificationForAttempt(input.attemptId);
    if (existing) {
      return matchingCommittedVerification(existing, input)
        ? acknowledgement(existing, true)
        : { recorded: false, reason: "verification_conflict" };
    }
    const loaded = await this.loadBoundEvidence(input);
    if (!loaded.ok) return loaded.failure;
    const { attempt, lease, session, receipt, packet, envelope } = loaded;

    let authorization = await this.store.getAttemptVerificationAuthorizationForAttempt(
      input.attemptId
    );
    let expectedAttemptRevision: number;
    if (authorization) {
      if (
        authorization.verificationId !== input.verificationId ||
        authorization.attemptRevision !== input.expectedAttemptRevision + 1 ||
        authorization.workspaceLeaseId !== input.workspaceLeaseId ||
        authorization.workspaceLeaseRevision !== input.expectedWorkspaceLeaseRevision ||
        authorization.workerSessionId !== input.workerSessionId ||
        authorization.workerSessionRevision !== input.expectedWorkerSessionRevision ||
        authorization.receiptId !== input.receiptId ||
        authorization.receiptHash !== input.receiptHash
      ) {
        return { recorded: false, reason: "verification_conflict" };
      }
      expectedAttemptRevision = authorization.attemptRevision;
    } else {
      const begin = await this.store.beginAttemptVerification({
        runId: input.runId,
        expectedRunRevision: input.expectedRunRevision,
        controller: input.controller,
        mutationId: input.beginMutationId,
        now: this.now(),
        verificationId: input.verificationId,
        attemptId: input.attemptId,
        expectedAttemptRevision: input.expectedAttemptRevision,
        workspaceLeaseId: input.workspaceLeaseId,
        expectedWorkspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
        workerSessionId: input.workerSessionId,
        expectedWorkerSessionRevision: input.expectedWorkerSessionRevision,
        receiptId: input.receiptId,
        receiptHash: input.receiptHash,
      });
      if (!begin.started) return { recorded: false, ...begin };
      authorization = begin.authorization;
      expectedAttemptRevision = begin.attempt.revision;
    }

    const checks: AgentEngineVerification_v2["checks"] = [];
    const failures: string[] = [];
    let initialObservation: VerificationWorkspaceObservation | null = null;
    try {
      initialObservation = await this.runtime.observe({ lease, receipt });
    } catch {
      failures.push("workspace:pre_verification_observation_failed");
    }

    if (initialObservation) {
      const environment = this.runtime.resolveEnvironment(envelope.exposed_environment_keys);
      const environmentFingerprint = computeCanonicalHash(environment);
      for (const declared of packet.verification) {
        let cwd: string;
        try {
          cwd = await this.runtime.resolveCheckCwd(lease.worktreePath, declared.cwd_rel);
        } catch {
          checks.push({
            id: declared.id,
            source: "packet",
            outcome: "infrastructure_error",
            command_hash: commandHash(declared),
            ...(declared.cwd_rel ? { cwd_rel: declared.cwd_rel } : {}),
            environment_fingerprint: environmentFingerprint,
            duration_ms: 0,
            retry_count: 0,
            artifact_refs: [],
            determinism: "unknown",
          });
          failures.push(`check:${declared.id}:invalid_cwd`);
          continue;
        }
        const executed = await this.runDeclaredCheck({
          argv: declared.argv,
          cwd,
          environment,
          expectedExitCodes: declared.expected_exit_codes,
        });
        checks.push({
          id: declared.id,
          source: "packet",
          outcome: executed.outcome,
          command_hash: commandHash(declared),
          ...(declared.cwd_rel ? { cwd_rel: declared.cwd_rel } : {}),
          environment_fingerprint: environmentFingerprint,
          ...(executed.result.exitCode !== undefined
            ? { exit_code: executed.result.exitCode }
            : {}),
          ...(executed.result.stdoutHash ? { stdout_hash: executed.result.stdoutHash } : {}),
          ...(executed.result.stderrHash ? { stderr_hash: executed.result.stderrHash } : {}),
          ...(executed.result.stdoutSnippet
            ? { stdout_snippet: executed.result.stdoutSnippet }
            : {}),
          ...(executed.result.stderrSnippet
            ? { stderr_snippet: executed.result.stderrSnippet }
            : {}),
          duration_ms: executed.durationMs,
          retry_count: executed.retryCount,
          artifact_refs: [],
          determinism: "unknown",
        });
        if (executed.outcome !== "pass") {
          failures.push(`check:${declared.id}:${executed.outcome}`);
        }
      }
    }

    let finalObservation = initialObservation;
    let observationFailed = initialObservation === null;
    if (initialObservation) {
      try {
        finalObservation = await this.runtime.observe({ lease, receipt });
      } catch {
        observationFailed = true;
        failures.push("workspace:post_verification_observation_failed");
      }
    }
    const observationDrifted =
      initialObservation !== null &&
      finalObservation !== null &&
      (finalObservation.headSha !== initialObservation.headSha ||
        finalObservation.patchHash !== initialObservation.patchHash ||
        finalObservation.observationHash !== initialObservation.observationHash);
    if (observationDrifted) failures.push("workspace:changed_during_verification");

    let outcome = aggregateOutcome(checks.map((check) => check.outcome));
    if (observationFailed) outcome = "infrastructure_error";
    else if (observationDrifted) outcome = "inconclusive";
    const authorityDeviation = (await this.store.listWorkerAuthorityEvents(input.runId)).some(
      (event) =>
        event.attemptId === input.attemptId &&
        event.workerSessionId === input.workerSessionId &&
        event.decision === "deviation"
    );
    const trustGapReasons = trustGaps(
      receipt,
      checks,
      finalObservation,
      outcome,
      authorityDeviation
    );
    const completedAt = notBefore(this.now(), authorization.startedAt);
    const verification = AgentEngineVerification_v2.parse({
      schema_version: "2.0.0",
      verification_id: input.verificationId,
      run_id: input.runId,
      work_item_id: attempt.workItemId,
      work_item_revision: attempt.workItemRevision,
      attempt_id: input.attemptId,
      packet_id: packet.packet_id,
      packet_hash: packet.packet_hash,
      workspace_lease_id: input.workspaceLeaseId,
      workspace_lease_revision: input.expectedWorkspaceLeaseRevision,
      worker_session_id: input.workerSessionId,
      worker_session_revision: input.expectedWorkerSessionRevision,
      receipt_id: input.receiptId,
      receipt_hash: input.receiptHash,
      observed_base_sha: receipt.observed_base_sha,
      ...(finalObservation
        ? {
            verified_head_sha: finalObservation.headSha,
            verified_patch_hash: finalObservation.patchHash,
          }
        : {}),
      workspace_observation_hash:
        finalObservation?.observationHash ??
        computeCanonicalHash({
          attempt_id: input.attemptId,
          failure: "workspace_observation_unavailable",
          verification_id: input.verificationId,
        }),
      outcome,
      summary: verificationSummary(outcome, checks.length, trustGapReasons.length),
      checks,
      failures,
      trust_gap_reasons: trustGapReasons,
      verifier_id: ATTEMPT_VERIFIER_ID,
      verifier_version: ATTEMPT_VERIFIER_VERSION,
      started_at: authorization.startedAt,
      completed_at: completedAt,
    });
    const submitted = await this.store.submitAttemptVerification({
      runId: input.runId,
      expectedRunRevision: input.expectedRunRevision,
      controller: input.controller,
      mutationId: input.completeMutationId,
      now: completedAt,
      attemptId: input.attemptId,
      expectedAttemptRevision,
      workspaceLeaseId: input.workspaceLeaseId,
      expectedWorkspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
      workerSessionId: input.workerSessionId,
      expectedWorkerSessionRevision: input.expectedWorkerSessionRevision,
      receiptId: input.receiptId,
      receiptHash: input.receiptHash,
      verification,
    });
    return submitted.recorded
      ? acknowledgement(submitted.verification, submitted.idempotentReplay)
      : submitted;
  }

  async status(input: {
    runId: string;
    attemptId: string;
    diagnostics?: boolean;
  }): Promise<AttemptVerificationStatusResult> {
    const record = await this.store.getAttemptVerificationForAttempt(input.attemptId);
    if (!record || record.runId !== input.runId) return { verification: null };
    const parsed = parseStoredVerification(record);
    const result: NonNullable<AttemptVerificationStatusResult["verification"]> = {
      verificationId: bounded(record.verificationId, 4_096),
      verificationHash: record.verificationHash,
      attemptId: bounded(record.attemptId, 4_096),
      outcome: record.outcome,
      resultingAttemptRevision: record.resultingAttemptRevision,
      resultingAttemptStatus: record.resultingAttemptStatus,
      resultIdentity: {
        ...(record.verifiedHeadSha ? { headSha: record.verifiedHeadSha } : {}),
        ...(record.verifiedPatchHash ? { patchHash: record.verifiedPatchHash } : {}),
      },
      trustGapCount: record.trustGapReasons.length,
      checkCounts: countOutcomes(parsed.checks.map((check) => check.outcome)),
      recordedAt: record.recordedAt,
      ...(input.diagnostics
        ? {
            diagnostics: {
              summary: parsed.summary,
              failures: parsed.failures,
              trustGapReasons: parsed.trust_gap_reasons,
              checks: parsed.checks,
            },
          }
        : {}),
    };
    if (Buffer.byteLength(canonicalJSONStringify(result), "utf8") > MAX_STATUS_BYTES) {
      throw new Error("Stored verification diagnostics exceed the bounded status response");
    }
    return { verification: result };
  }

  private async loadBoundEvidence(input: RunAttemptVerificationInput): Promise<
    | {
        ok: true;
        attempt: AttemptRecord;
        lease: NonNullable<Awaited<ReturnType<VerificationStore["getWorkspaceLease"]>>>;
        session: NonNullable<Awaited<ReturnType<VerificationStore["getWorkerSession"]>>>;
        receipt: AgentTaskReceipt_v2;
        packet: AgentTaskPacket_v1;
        envelope: ExecutionEnvelope_v1;
      }
    | { ok: false; failure: AttemptVerificationRunResult & { recorded: false } }
  > {
    const [attempt, lease, session, receiptRecord, packetBinding, envelopeBinding] =
      await Promise.all([
        this.store.getAttempt(input.attemptId),
        this.store.getWorkspaceLease(input.workspaceLeaseId),
        this.store.getWorkerSession(input.workerSessionId),
        this.store.getAttemptReceipt(input.receiptId),
        this.store.getTaskPacketBinding(input.attemptId),
        this.store.getLaunchEnvelopeBinding(input.attemptId),
      ]);
    if (!attempt || !lease || !session || !receiptRecord || !packetBinding || !envelopeBinding) {
      return { ok: false, failure: { recorded: false, reason: "not_found" } };
    }
    if (attempt.revision !== input.expectedAttemptRevision) {
      const authorization = await this.store.getAttemptVerificationAuthorizationForAttempt(
        input.attemptId
      );
      if (!authorization || authorization.attemptRevision !== attempt.revision) {
        return {
          ok: false,
          failure: {
            recorded: false,
            reason: "stale_attempt_revision",
            currentAttemptRevision: attempt.revision,
          },
        };
      }
    }
    if (lease.revision !== input.expectedWorkspaceLeaseRevision) {
      return {
        ok: false,
        failure: {
          recorded: false,
          reason: "stale_workspace_revision",
          currentWorkspaceLeaseRevision: lease.revision,
        },
      };
    }
    if (session.revision !== input.expectedWorkerSessionRevision) {
      return {
        ok: false,
        failure: {
          recorded: false,
          reason: "stale_session_revision",
          currentSessionRevision: session.revision,
        },
      };
    }
    let receipt: AgentTaskReceipt_v2;
    let packet: AgentTaskPacket_v1;
    const envelope = validatePersistedCanonicalEnvelope(envelopeBinding, attempt, lease);
    try {
      receipt = AgentTaskReceipt_v2.parse(JSON.parse(receiptRecord.receiptJson) as unknown);
      packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson) as unknown);
    } catch {
      return { ok: false, failure: { recorded: false, reason: "evidence_mismatch" } };
    }
    const pathBinding =
      envelope?.paths.allocation_root &&
      verifyAttemptExecutionPathMapping(envelope.path_mappings, {
        repositoryId: lease.repositoryId,
        baseSha: attempt.baseSha,
        hostId: lease.hostId,
        gitRuntime: lease.gitRuntime,
        repositoryRoot: lease.projectRoot,
        allocationRoot: envelope.paths.allocation_root,
        worktreePath: lease.worktreePath,
      });
    if (
      !envelope ||
      !pathBinding ||
      !pathBinding.valid ||
      attempt.runId !== input.runId ||
      attempt.workspaceLeaseId !== input.workspaceLeaseId ||
      attempt.receiptId !== input.receiptId ||
      lease.attemptId !== input.attemptId ||
      session.attemptId !== input.attemptId ||
      receiptRecord.receiptHash !== input.receiptHash ||
      receipt.receipt_id !== input.receiptId ||
      receipt.run_id !== input.runId ||
      receipt.attempt_id !== input.attemptId ||
      receipt.workspace_lease_id !== input.workspaceLeaseId ||
      // A receipt binds the workspace revision at worker attachment. The active
      // lease may advance through ordinary supervisor heartbeats before
      // verification begins, so comparing it with the current fencing revision
      // would reject valid long-running sessions.
      receipt.workspace_lease_revision !== session.workspaceLeaseRevision ||
      receipt.worker_session_id !== input.workerSessionId ||
      session.executionEnvelopeId !== envelopeBinding.envelopeId ||
      session.executionEnvelopeHash !== envelopeBinding.envelopeHash ||
      receipt.packet_hash !== packet.packet_hash ||
      envelope.packet_hash !== packet.packet_hash ||
      envelope.paths.worktree_root !== lease.worktreePath ||
      envelope.runtime.host_id !== lease.hostId ||
      envelope.runtime.git_runtime !== lease.gitRuntime
    ) {
      return { ok: false, failure: { recorded: false, reason: "evidence_mismatch" } };
    }
    return { ok: true, attempt, lease, session, receipt, packet, envelope };
  }

  private async runDeclaredCheck(input: {
    argv: readonly string[];
    cwd: string;
    environment: Readonly<Record<string, string>>;
    expectedExitCodes: readonly number[];
  }): Promise<{
    outcome: VerificationOutcome;
    result: VerificationCommandResult;
    retryCount: number;
    durationMs: number;
  }> {
    let retryCount = 0;
    let durationMs = 0;
    let result = await this.runtime.runCheck({
      argv: input.argv,
      cwd: input.cwd,
      environment: input.environment,
      timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
    });
    durationMs += result.durationMs;
    while (
      retryCount < DEFAULT_INFRASTRUCTURE_RETRIES &&
      isRetryableInfrastructureFailure(result.failureKind)
    ) {
      retryCount += 1;
      result = await this.runtime.runCheck({
        argv: input.argv,
        cwd: input.cwd,
        environment: input.environment,
        timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
      });
      durationMs += result.durationMs;
    }
    return {
      outcome: commandOutcome(result, input.expectedExitCodes),
      result,
      retryCount,
      durationMs,
    };
  }
}

/** Shared policy boundary; callers cannot choose or weaken the policy decision. */
export class AgentWorkAttemptAcceptanceService {
  constructor(
    private readonly store: WorkspaceLifecycleStore &
      LaunchEnvelopeBindingStore &
      WorkerSessionStore &
      AttemptVerificationStore &
      AttemptAcceptanceStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async apply(input: ApplyAttemptAcceptanceRequest): Promise<AttemptAcceptanceResult> {
    const [attempt, lease, session, binding] = await Promise.all([
      this.store.getAttempt(input.attemptId),
      this.store.getWorkspaceLease(input.workspaceLeaseId),
      this.store.getWorkerSession(input.workerSessionId),
      this.store.getLaunchEnvelopeBinding(input.attemptId),
    ]);
    if (!attempt || !lease || !session || !binding) {
      return { applied: false, reason: "not_found" };
    }
    const envelope = validatePersistedCanonicalEnvelope(binding, attempt, lease);
    const pathBinding =
      envelope?.paths.allocation_root &&
      verifyAttemptExecutionPathMapping(envelope.path_mappings, {
        repositoryId: lease.repositoryId,
        baseSha: attempt.baseSha,
        hostId: lease.hostId,
        gitRuntime: lease.gitRuntime,
        repositoryRoot: lease.projectRoot,
        allocationRoot: envelope.paths.allocation_root,
        worktreePath: lease.worktreePath,
      });
    if (
      !pathBinding ||
      !pathBinding.valid ||
      session.executionEnvelopeId !== binding.envelopeId ||
      session.executionEnvelopeHash !== binding.envelopeHash
    ) {
      return {
        applied: false,
        reason: "evidence_mismatch",
        currentAttemptRevision: attempt.revision,
        currentWorkspaceLeaseRevision: lease.revision,
      };
    }
    const verification = await this.store.getAttemptVerification(input.verificationId);
    const result = await this.store.applyAttemptAcceptance({
      ...input,
      mutationId: input.mutationId,
      now: this.now(),
    });
    if (!result.updated) return { applied: false, ...result };
    const reasonCodes = verification?.trustGapReasons.map((reason) => `trust_gap:${reason}`) ?? [];
    return {
      applied: true,
      attemptId: result.attempt.attemptId,
      decision: result.attempt.status === "accepted" ? "accepted" : "rejected",
      attemptRevision: result.attempt.revision,
      policyId: STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID,
      policyVersion: STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION,
      reasonCodes,
      idempotentReplay: result.idempotentReplay,
    };
  }

  async status(input: {
    runId: string;
    attemptId: string;
  }): Promise<AttemptAcceptanceStatusResult> {
    const [attempt, events] = await Promise.all([
      this.store.getAttempt(input.attemptId),
      this.store.listWorkspaceLifecycleEvents(input.runId),
    ]);
    if (!attempt || attempt.runId !== input.runId) return { acceptance: null };
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.attemptId === input.attemptId && isStrictAcceptancePayload(candidate.payload)
      );
    if (!event) return { acceptance: null };
    const details = (event.payload as Record<string, JsonValue>).details as Record<
      string,
      JsonValue
    >;
    return {
      acceptance: {
        attemptId: attempt.attemptId,
        decision: details.decision as "accepted" | "rejected",
        attemptRevision: event.attemptRevision,
        policyId: STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID,
        policyVersion: STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION,
        reasonCodes: details.reasonCodes as string[],
        appliedAt: event.createdAt,
      },
    };
  }
}

function matchingCommittedVerification(
  record: AttemptVerificationRecord,
  input: RunAttemptVerificationInput
): boolean {
  return (
    record.verificationId === input.verificationId &&
    record.runId === input.runId &&
    record.attemptId === input.attemptId &&
    record.workspaceLeaseId === input.workspaceLeaseId &&
    record.workerSessionId === input.workerSessionId &&
    record.receiptId === input.receiptId &&
    record.receiptHash === input.receiptHash
  );
}

function acknowledgement(
  record: AttemptVerificationRecord,
  idempotentReplay: boolean
): Extract<AttemptVerificationRunResult, { recorded: true }> {
  const parsed = parseStoredVerification(record);
  return {
    recorded: true,
    verificationId: record.verificationId,
    verificationHash: record.verificationHash,
    attemptId: record.attemptId,
    outcome: record.outcome,
    attemptRevision: record.resultingAttemptRevision,
    attemptStatus: record.resultingAttemptStatus,
    trustGapCount: record.trustGapReasons.length,
    checkCounts: countOutcomes(parsed.checks.map((check) => check.outcome)),
    idempotentReplay,
  };
}

function parseStoredVerification(record: AttemptVerificationRecord): AgentEngineVerification_v2 {
  const parsed = AgentEngineVerification_v2.parse(JSON.parse(record.verificationJson) as unknown);
  if (canonicalJSONStringify(parsed) !== record.verificationJson) {
    throw new Error("Stored Attempt verification is not canonical");
  }
  return parsed;
}

function commandHash(declared: AgentTaskPacket_v1["verification"][number]): string {
  return computeCanonicalHash({
    argv: declared.argv,
    ...(declared.cwd_rel ? { cwd_rel: declared.cwd_rel } : {}),
    expected_exit_codes: declared.expected_exit_codes,
  });
}

function commandOutcome(
  result: VerificationCommandResult,
  expectedExitCodes: readonly number[]
): VerificationOutcome {
  if (result.failureKind === "cancelled") return "cancelled";
  if (
    result.failureKind === "spawn_error" ||
    result.failureKind === "timeout" ||
    result.failureKind === "output_limit"
  ) {
    return "infrastructure_error";
  }
  return result.exitCode !== undefined && expectedExitCodes.includes(result.exitCode)
    ? "pass"
    : "fail";
}

function aggregateOutcome(outcomes: readonly VerificationOutcome[]): VerificationOutcome {
  if (outcomes.includes("cancelled")) return "cancelled";
  if (outcomes.includes("infrastructure_error")) return "infrastructure_error";
  if (outcomes.includes("inconclusive")) return "inconclusive";
  if (outcomes.includes("fail")) return "fail";
  return "pass";
}

function countOutcomes(
  outcomes: readonly VerificationOutcome[]
): Record<VerificationOutcome, number> {
  const counts: Record<VerificationOutcome, number> = {
    pass: 0,
    fail: 0,
    inconclusive: 0,
    infrastructure_error: 0,
    cancelled: 0,
  };
  outcomes.forEach((outcome) => (counts[outcome] += 1));
  return counts;
}

function trustGaps(
  receipt: AgentTaskReceipt_v2,
  checks: AgentEngineVerification_v2["checks"],
  observation: VerificationWorkspaceObservation | null,
  outcome: VerificationOutcome,
  authorityDeviation: boolean
): EngineVerificationTrustGapReason_v2[] {
  const reasons = new Set<EngineVerificationTrustGapReason_v2>();
  if ((receipt.outcome === "completed") !== (outcome === "pass")) {
    reasons.add("worker_outcome_disagrees");
  }
  if (receipt.final_head_sha && receipt.final_head_sha !== observation?.headSha) {
    reasons.add("head_identity_disagrees");
  }
  if (receipt.patch_hash && receipt.patch_hash !== observation?.patchHash) {
    reasons.add("patch_identity_disagrees");
  }
  const observed = new Map(checks.map((check) => [check.id, check.outcome]));
  if (
    receipt.claimed_checks.some(
      (claim) => observed.get(claim.id) !== normalizeClaimedCheckOutcome(claim.outcome)
    )
  ) {
    reasons.add("claimed_check_disagrees");
  }
  if (authorityDeviation) reasons.add("authority_deviation");
  return [...reasons].sort();
}

function normalizeClaimedCheckOutcome(
  outcome: AgentTaskReceipt_v2["claimed_checks"][number]["outcome"]
): VerificationOutcome {
  if (outcome === "pass") return "pass";
  if (outcome === "fail") return "fail";
  return "inconclusive";
}

function verificationSummary(
  outcome: VerificationOutcome,
  checkCount: number,
  trustGapCount: number
): string {
  return `Engine verification ${outcome}; ${checkCount} packet check(s); ${trustGapCount} trust gap(s).`;
}

function isRetryableInfrastructureFailure(
  failureKind: VerificationCommandFailureKind | undefined
): boolean {
  return (
    failureKind === "spawn_error" || failureKind === "timeout" || failureKind === "output_limit"
  );
}

function notBefore(candidate: string, floor: string): string {
  if (!Number.isFinite(Date.parse(candidate)))
    throw new Error("Verifier clock returned invalid time");
  return Date.parse(candidate) < Date.parse(floor) ? floor : candidate;
}

function bounded(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes - 3;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}

function isStrictAcceptancePayload(payload: JsonValue): boolean {
  if (!isRecord(payload) || !isRecord(payload.details)) return false;
  return (
    payload.details.policyId === STRICT_ATTEMPT_ACCEPTANCE_POLICY_ID &&
    payload.details.policyVersion === STRICT_ATTEMPT_ACCEPTANCE_POLICY_VERSION &&
    (payload.details.decision === "accepted" || payload.details.decision === "rejected") &&
    Array.isArray(payload.details.reasonCodes) &&
    payload.details.reasonCodes.every((value) => typeof value === "string")
  );
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
