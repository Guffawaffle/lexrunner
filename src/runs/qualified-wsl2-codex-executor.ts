import { z } from "zod";

import { computeCanonicalHash } from "../schemas/task-contract.js";
import { ProtectedEvidenceFrameClass } from "../store/protected-evidence-store.js";
import type { GovernedAttemptEvidenceCapture } from "./governed-attempt-evidence.js";
import {
  AttemptAuthorization_v1,
  AttemptExecutorEvent_v1,
  AttemptExecutorHandle_v1,
  EnvironmentAttestation_v1,
  ExecutorAttestation_v1,
  GovernedAttemptResult_v1,
  WorkspaceAttestation_v1,
  type AttemptAuthorization_v1 as AttemptAuthorization,
  type AttemptExecutor,
  type AttemptExecutorEvent_v1 as AttemptExecutorEvent,
  type AttemptExecutorHandle_v1 as AttemptExecutorHandle,
  type EnvironmentAttestation_v1 as EnvironmentAttestation,
  type ExecutorAttestation_v1 as ExecutorAttestation,
  type GovernedAttemptResult_v1 as GovernedAttemptResult,
  type WorkspaceAttestation_v1 as WorkspaceAttestation,
} from "./governed-attempt-executor.js";

const MAX_PROMPT_BYTES = 1 * 1_024 * 1_024;
const instant = z.string().datetime({ offset: true });
const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const emissionCommon = {
  sequence: z.number().int().positive(),
  observed_at: instant,
  frame_class: ProtectedEvidenceFrameClass,
  raw_bytes: z.instanceof(Uint8Array),
};

export const QualifiedCodexProviderEmission_v1 = z.discriminatedUnion("type", [
  z.object({ ...emissionCommon, type: z.literal("started") }).strict(),
  z
    .object({
      ...emissionCommon,
      type: z.literal("executor_event"),
      executor_event_type: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...emissionCommon,
      type: z.literal("declined"),
      reason_present: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...emissionCommon,
      type: z.enum(["completed", "failed", "cancelled", "lost"]),
    })
    .strict(),
]);
export type QualifiedCodexProviderEmission_v1 = z.infer<typeof QualifiedCodexProviderEmission_v1>;

export interface QualifiedCodexProviderAttestations {
  executor: ExecutorAttestation;
  environment: EnvironmentAttestation;
  workspace: WorkspaceAttestation;
}

export interface QualifiedCodexProviderLaunchReceipt {
  operationId: string;
  providerHandle: string;
  startedAt: string;
}

export interface QualifiedCodexProviderClaim {
  taskOutcome: "pass" | "block" | "not_produced" | "invalid";
}

/**
 * Pre-authorization identity input for the fixed synthetic corpus. The
 * provider computes the actual corpus/selection hashes and returns a
 * short-lived attestation bundle; callers do not get to assert those facts.
 */
export const QualifiedCodexSyntheticPreparation_v1 = z
  .object({
    environment_id: opaqueId,
    repository_id: opaqueId,
    base_object_id: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
    candidate_object_id: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  })
  .strict()
  .refine((value) => value.base_object_id !== value.candidate_object_id, {
    path: ["candidate_object_id"],
    message: "synthetic candidate must differ from its base",
  });
export type QualifiedCodexSyntheticPreparation_v1 = z.infer<
  typeof QualifiedCodexSyntheticPreparation_v1
>;

/**
 * Trusted host bridge for the already-qualified topology:
 * disposable WSL2 -> systemd/cgroup -> outer bwrap -> Codex sandbox.
 * `promptStdin` is deliberately the only prompt transport in this contract.
 */
export interface QualifiedCodexProviderBridge {
  inspect(environmentId: string): Promise<ExecutorAttestation>;
  prepareSynthetic(
    input: QualifiedCodexSyntheticPreparation_v1
  ): Promise<QualifiedCodexProviderAttestations>;
  attest(authorization: AttemptAuthorization): Promise<QualifiedCodexProviderAttestations>;
  launch(input: {
    authorization: AttemptAuthorization;
    promptStdin: Uint8Array;
    outputSchema: unknown;
    mode: "synthetic_only";
  }): Promise<QualifiedCodexProviderLaunchReceipt>;
  observe(
    providerHandle: string,
    options: { afterSequence: number; signal?: AbortSignal }
  ): AsyncIterable<QualifiedCodexProviderEmission_v1>;
  cancel(providerHandle: string): Promise<void>;
  collect(providerHandle: string): Promise<QualifiedCodexProviderClaim>;
  release(providerHandle: string): Promise<void>;
}

interface ActiveOperation {
  authorization: AttemptAuthorization;
  evidence: GovernedAttemptEvidenceCapture;
  handle: AttemptExecutorHandle;
  lastObservedAt: string;
  terminalType?: "declined" | "completed" | "failed" | "cancelled" | "lost";
}

/**
 * Synthetic-only executor adapter. It will not dispatch a repository corpus;
 * changing that requires a separate reviewed policy transition.
 */
export class QualifiedWsl2CodexExecutor implements AttemptExecutor {
  private readonly active = new Map<string, ActiveOperation>();

  constructor(
    private readonly bridge: QualifiedCodexProviderBridge,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async inspect(environmentId: string): Promise<ExecutorAttestation> {
    return ExecutorAttestation_v1.parse(await this.bridge.inspect(environmentId));
  }

  async start(input: {
    authorization: AttemptAuthorization;
    prompt: Uint8Array;
    outputSchema: unknown;
    evidence?: GovernedAttemptEvidenceCapture;
  }): Promise<AttemptExecutorHandle> {
    const authorization = AttemptAuthorization_v1.parse(input.authorization);
    if (!input.evidence) throw new Error("Qualified Codex launch requires protected evidence");
    if (input.prompt.byteLength === 0 || input.prompt.byteLength > MAX_PROMPT_BYTES) {
      throw new Error("Qualified Codex prompt exceeds its bounded stdin contract");
    }
    const attestations = await this.attestExact(authorization);
    this.requireSyntheticEvidenceBinding(authorization, attestations, input.evidence, ["open"]);
    const launched = launchReceipt(
      await this.bridge.launch({
        authorization,
        promptStdin: Uint8Array.from(input.prompt),
        outputSchema: structuredClone(input.outputSchema),
        mode: "synthetic_only",
      })
    );
    const handle = AttemptExecutorHandle_v1.parse({
      schema_version: "1.0.0",
      operation_id: launched.operationId,
      attempt_id: authorization.attempt_id,
      delegation_id: authorization.delegation_id,
      authorization_binding_digest: authorization.binding_digest,
      executor_id: attestations.executor.executor_id,
      provider_handle: launched.providerHandle,
      started_at: launched.startedAt,
    });
    this.active.set(handle.provider_handle, {
      authorization,
      evidence: input.evidence,
      handle,
      lastObservedAt: handle.started_at,
    });
    return handle;
  }

  async attach(input: {
    handle: AttemptExecutorHandle;
    authorization: AttemptAuthorization;
    evidence: GovernedAttemptEvidenceCapture;
    terminalType?: ActiveOperation["terminalType"];
  }): Promise<void> {
    const handle = AttemptExecutorHandle_v1.parse(input.handle);
    const authorization = AttemptAuthorization_v1.parse(input.authorization);
    if (
      handle.attempt_id !== authorization.attempt_id ||
      handle.delegation_id !== authorization.delegation_id ||
      handle.authorization_binding_digest !== authorization.binding_digest
    ) {
      throw new Error("Qualified Codex durable operation binding mismatch");
    }
    const attestations = await this.attestExact(authorization);
    this.requireSyntheticEvidenceBinding(authorization, attestations, input.evidence, [
      "open",
      "sealed_unindexed",
      "complete",
    ]);
    this.active.set(handle.provider_handle, {
      authorization,
      evidence: input.evidence,
      handle,
      lastObservedAt: handle.started_at,
      ...(input.terminalType
        ? { terminalType: input.terminalType }
        : input.evidence.getReference().status === "complete"
          ? { terminalType: "completed" as const }
          : {}),
    });
  }

  async *observe(
    handleCandidate: AttemptExecutorHandle,
    options: { afterSequence?: number; signal?: AbortSignal } = {}
  ): AsyncIterable<AttemptExecutorEvent> {
    const handle = AttemptExecutorHandle_v1.parse(handleCandidate);
    const active = this.requireActive(handle);
    let expectedSequence = (options.afterSequence ?? 0) + 1;
    try {
      for await (const candidate of this.bridge.observe(handle.provider_handle, {
        afterSequence: options.afterSequence ?? 0,
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        const emission = QualifiedCodexProviderEmission_v1.parse(candidate);
        if (emission.sequence !== expectedSequence) return;
        const evidence = await active.evidence.append({
          frameClass: emission.frame_class,
          bytes: emission.raw_bytes,
          observedAt: emission.observed_at,
        });
        const event = eventFromEmission(emission, evidence.evidenceRef);
        active.lastObservedAt = emission.observed_at;
        expectedSequence += 1;
        if (["declined", "completed", "failed", "cancelled", "lost"].includes(event.type)) {
          active.terminalType = event.type as ActiveOperation["terminalType"];
          if (["failed", "cancelled", "lost"].includes(event.type)) {
            await active.evidence.sealAndVerify({
              sealedAt: emission.observed_at,
              indexedAt: emission.observed_at,
            });
          }
          yield event;
          return;
        }
        yield event;
      }
    } catch {
      if (!options.signal?.aborted) {
        await this.bridge.cancel(handle.provider_handle).catch(() => undefined);
      }
      return;
    }
  }

  async cancel(handleCandidate: AttemptExecutorHandle): Promise<void> {
    const handle = AttemptExecutorHandle_v1.parse(handleCandidate);
    const active = this.requireActive(handle);
    await this.bridge.cancel(handle.provider_handle);
    if (active.evidence.getReference().status === "open") {
      if (active.terminalType === "declined") {
        await active.evidence.sealAndVerify({
          sealedAt: active.lastObservedAt,
          indexedAt: this.now(),
        });
      } else {
        await active.evidence.markIncomplete({ reasonCode: "cancelled", terminalAt: this.now() });
      }
    }
  }

  async collect(handleCandidate: AttemptExecutorHandle): Promise<GovernedAttemptResult> {
    const handle = AttemptExecutorHandle_v1.parse(handleCandidate);
    const active = this.requireActive(handle);
    if (active.terminalType !== "completed") {
      throw new Error("Qualified Codex result is unavailable before completed evidence");
    }
    const claim = providerClaim(await this.bridge.collect(handle.provider_handle));
    const evidence = await active.evidence.sealAndVerify({
      sealedAt: active.lastObservedAt,
      indexedAt: this.now(),
    });
    const authorizationOutcome =
      Date.parse(active.authorization.expires_at) > Date.parse(this.now()) ? "valid" : "expired";
    return GovernedAttemptResult_v1.parse({
      schema_version: "1.0.0",
      attempt_id: active.authorization.attempt_id,
      delegation_id: active.authorization.delegation_id,
      authorization_binding_digest: active.authorization.binding_digest,
      worker_outcome: "completed",
      task_outcome: claim.taskOutcome,
      authorization_outcome: authorizationOutcome,
      evidence_outcome: evidence.status === "complete" ? "sufficient" : "insufficient",
      // Provider semantics remain a claim until an independent verifier accepts the capture.
      admissibility: "inadmissible",
      evidence_refs: [evidence.capture_root, evidence.verification_hash].filter(
        (value): value is string => value !== undefined
      ),
    });
  }

  async release(handleCandidate: AttemptExecutorHandle): Promise<void> {
    const handle = AttemptExecutorHandle_v1.parse(handleCandidate);
    const active = this.requireActive(handle);
    if (!["complete", "incomplete"].includes(active.evidence.getReference().status)) {
      throw new Error(
        "Qualified Codex provider spool cannot be released before evidence terminality"
      );
    }
    await this.bridge.release(handle.provider_handle);
    this.active.delete(handle.provider_handle);
  }

  private async attestExact(
    authorization: AttemptAuthorization
  ): Promise<QualifiedCodexProviderAttestations> {
    const candidate = await this.bridge.attest(authorization);
    const attestations = {
      executor: ExecutorAttestation_v1.parse(candidate.executor),
      environment: EnvironmentAttestation_v1.parse(candidate.environment),
      workspace: WorkspaceAttestation_v1.parse(candidate.workspace),
    };
    if (
      computeCanonicalHash(attestations.executor) !== authorization.executor_attestation_hash ||
      computeCanonicalHash(attestations.environment) !==
        authorization.environment_attestation_hash ||
      computeCanonicalHash(attestations.workspace) !== authorization.workspace_attestation_hash
    ) {
      throw new Error("Qualified Codex launch attestation binding mismatch");
    }
    if (
      attestations.executor.protocol !== "jsonl-stdin" ||
      attestations.workspace.corpus_kind !== "synthetic"
    ) {
      throw new Error("Qualified Codex executor is restricted to synthetic JSONL-stdin launch");
    }
    return attestations;
  }

  private requireSyntheticEvidenceBinding(
    authorization: AttemptAuthorization,
    attestations: QualifiedCodexProviderAttestations,
    evidence: GovernedAttemptEvidenceCapture,
    allowedStatuses: readonly ReturnType<GovernedAttemptEvidenceCapture["getReference"]>["status"][]
  ): void {
    const reference = evidence.getReference();
    if (
      !allowedStatuses.includes(reference.status) ||
      reference.attempt_id !== authorization.attempt_id ||
      reference.delegation_id !== authorization.delegation_id ||
      reference.authorization_binding_digest !== authorization.binding_digest ||
      reference.executor_binding_digest !== computeCanonicalHash(attestations.executor) ||
      reference.environment_binding_digest !== computeCanonicalHash(attestations.environment) ||
      reference.workspace_binding_digest !== computeCanonicalHash(attestations.workspace)
    ) {
      throw new Error("Qualified Codex protected evidence binding mismatch");
    }
  }

  private requireActive(handle: AttemptExecutorHandle): ActiveOperation {
    const active = this.active.get(handle.provider_handle);
    if (!active || computeCanonicalHash(active.handle) !== computeCanonicalHash(handle)) {
      throw new Error("Qualified Codex provider handle is not attached");
    }
    return active;
  }
}

function eventFromEmission(
  emission: QualifiedCodexProviderEmission_v1,
  evidenceRef: string
): AttemptExecutorEvent {
  const common = {
    schema_version: "1.0.0" as const,
    type: emission.type,
    sequence: emission.sequence,
    observed_at: emission.observed_at,
    evidence_ref: evidenceRef,
  };
  if (emission.type === "executor_event") {
    return AttemptExecutorEvent_v1.parse({
      ...common,
      executor_event_type: emission.executor_event_type,
    });
  }
  if (emission.type === "declined") {
    return AttemptExecutorEvent_v1.parse({ ...common, reason_present: emission.reason_present });
  }
  return AttemptExecutorEvent_v1.parse(common);
}

function launchReceipt(candidate: QualifiedCodexProviderLaunchReceipt) {
  return z
    .object({
      operationId: opaqueId,
      providerHandle: opaqueId,
      startedAt: instant,
    })
    .strict()
    .parse(candidate);
}

function providerClaim(candidate: QualifiedCodexProviderClaim) {
  return z
    .object({
      taskOutcome: z.enum(["pass", "block", "not_produced", "invalid"]),
    })
    .strict()
    .parse(candidate);
}
