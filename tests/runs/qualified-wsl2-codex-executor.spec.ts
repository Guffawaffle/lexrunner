import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProtectedEvidenceCaptureSession } from "../../src/runs/governed-attempt-evidence.js";
import {
  GovernedCapabilityGrant_v1,
  GovernedControlId,
  GovernedReviewRequirements_v1,
  authorizeGovernedReview,
  type AttemptAuthorization_v1,
  type ExecutorAttestation_v1,
} from "../../src/runs/governed-attempt-executor.js";
import {
  QualifiedWsl2CodexExecutor,
  type QualifiedCodexProviderAttestations,
  type QualifiedCodexProviderBridge,
  type QualifiedCodexProviderClaim,
  type QualifiedCodexProviderEmission_v1,
  type QualifiedCodexProviderLaunchReceipt,
} from "../../src/runs/qualified-wsl2-codex-executor.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { LocalProtectedEvidenceStore } from "../../src/store/local-protected-evidence-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T15:00:${String(seconds).padStart(2, "0")}.000Z`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("QualifiedWsl2CodexExecutor", () => {
  it("binds synthetic attestations, stdin prompt transport, raw evidence, and provider events", async () => {
    const fixture = authorizationFixture("synthetic");
    const evidence = await evidenceSession(fixture);
    const bridge = new DeferredBridge(fixture.attestations);
    const executor = new QualifiedWsl2CodexExecutor(bridge, () => at(10));
    const prompt = Buffer.from("Review only the synthetic corpus");
    const handle = await executor.start({
      authorization: fixture.authorization,
      prompt,
      outputSchema: { type: "object" },
      evidence,
    });
    expect(bridge.launchInput).toMatchObject({ mode: "synthetic_only" });
    expect(Buffer.from(bridge.launchInput!.promptStdin)).toEqual(prompt);
    expect(bridge.launchInput).not.toHaveProperty("promptArgv");

    const observed = collectEvents(executor.observe(handle));
    bridge.emit([
      emission("started", 1, '{"type":"thread.started"}'),
      emission("executor_event", 2, '{"type":"item.completed"}'),
      emission("completed", 3, '{"type":"turn.completed"}'),
    ]);
    const events = await observed;
    expect(events.map((event) => event.type)).toEqual(["started", "executor_event", "completed"]);
    expect(JSON.stringify(events)).not.toContain("thread.started");
    expect(events.every((event) => event.evidence_ref.startsWith("sha256:"))).toBe(true);

    const restarted = new QualifiedWsl2CodexExecutor(bridge, () => at(10));
    await restarted.attach({
      handle,
      authorization: fixture.authorization,
      evidence,
      terminalType: "completed",
    });
    const result = await restarted.collect(handle);
    expect(result).toMatchObject({
      worker_outcome: "completed",
      task_outcome: "pass",
      authorization_outcome: "valid",
      evidence_outcome: "sufficient",
      admissibility: "inadmissible",
    });
    expect(result.evidence_refs).toHaveLength(2);
    expect(evidence.getReference().status).toBe("complete");
    await restarted.release(handle);
    expect(bridge.releaseCount).toBe(1);
  });

  it("preserves bare NO as terminal before any later provider action", async () => {
    const fixture = authorizationFixture("synthetic");
    const evidence = await evidenceSession(fixture);
    const bridge = new DeferredBridge(fixture.attestations);
    const executor = new QualifiedWsl2CodexExecutor(bridge, () => at(10));
    const handle = await executor.start({
      authorization: fixture.authorization,
      prompt: Buffer.from("synthetic offer"),
      outputSchema: { type: "object" },
      evidence,
    });
    const observed = collectEvents(executor.observe(handle));
    bridge.emit([
      emission("started", 1, '{"type":"thread.started"}'),
      {
        ...emission("declined", 2, "NO"),
        type: "declined",
        reason_present: false,
      },
      emission("completed", 3, "must-not-be-consumed"),
    ]);
    const events = await observed;
    expect(events.map((event) => event.type)).toEqual(["started", "declined"]);
    expect(events[1]).toMatchObject({ type: "declined", reason_present: false });
    expect(JSON.stringify(events)).not.toContain("NO");
    await executor.cancel(handle);
    await executor.release(handle);
    expect(bridge.cancelCount).toBe(1);
    expect(bridge.releaseCount).toBe(1);
    expect(evidence.getReference().status).toBe("complete");
  });

  it("refuses repository corpus launch while the adapter is synthetic-only", async () => {
    const fixture = authorizationFixture("repository");
    const evidence = await evidenceSession(fixture);
    const bridge = new DeferredBridge(fixture.attestations);
    const executor = new QualifiedWsl2CodexExecutor(bridge, () => at(10));
    await expect(
      executor.start({
        authorization: fixture.authorization,
        prompt: Buffer.from("real review"),
        outputSchema: { type: "object" },
        evidence,
      })
    ).rejects.toThrow("restricted to synthetic JSONL-stdin launch");
    expect(bridge.launchInput).toBeUndefined();
  });
});

class DeferredBridge implements QualifiedCodexProviderBridge {
  launchInput?: Parameters<QualifiedCodexProviderBridge["launch"]>[0];
  cancelCount = 0;
  releaseCount = 0;
  private releaseEmissions!: (events: QualifiedCodexProviderEmission_v1[]) => void;
  private readonly emissions = new Promise<QualifiedCodexProviderEmission_v1[]>((resolve) => {
    this.releaseEmissions = resolve;
  });

  constructor(private readonly attestations: QualifiedCodexProviderAttestations) {}

  async prepareSynthetic(): Promise<QualifiedCodexProviderAttestations> {
    return this.attestations;
  }

  async inspect(): Promise<ExecutorAttestation_v1> {
    return structuredClone(this.attestations.executor);
  }

  async attest(): Promise<QualifiedCodexProviderAttestations> {
    return structuredClone(this.attestations);
  }

  async launch(
    input: Parameters<QualifiedCodexProviderBridge["launch"]>[0]
  ): Promise<QualifiedCodexProviderLaunchReceipt> {
    this.launchInput = structuredClone(input);
    return {
      operationId: "operation-1",
      providerHandle: "provider-handle-1",
      startedAt: at(1),
    };
  }

  async *observe(): AsyncIterable<QualifiedCodexProviderEmission_v1> {
    for (const event of await this.emissions) yield structuredClone(event);
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  async collect(): Promise<QualifiedCodexProviderClaim> {
    return { taskOutcome: "pass" };
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }

  emit(events: QualifiedCodexProviderEmission_v1[]): void {
    this.releaseEmissions(events);
  }
}

async function collectEvents<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function emission(
  type: "started" | "executor_event" | "declined" | "completed",
  sequence: number,
  raw: string
): QualifiedCodexProviderEmission_v1 {
  const common = {
    type,
    sequence,
    observed_at: at(sequence + 1),
    frame_class: "executor_event" as const,
    raw_bytes: Buffer.from(raw),
  };
  if (type === "executor_event") {
    return { ...common, type, executor_event_type: "item.completed" };
  }
  if (type === "declined") return { ...common, type, reason_present: false };
  return common;
}

async function evidenceSession(fixture: ReturnType<typeof authorizationFixture>) {
  const root = await mkdtemp(path.join(tmpdir(), "lexrunner-qualified-codex-"));
  roots.push(root);
  const store = new LocalProtectedEvidenceStore(root, {
    attestRoot: async () => true,
    syncDirectory: async () => undefined,
    now: () => at(0),
  });
  return ProtectedEvidenceCaptureSession.open({
    store,
    openedAt: at(1),
    reservation: {
      capture_id: "capture-1",
      attempt_id: fixture.authorization.attempt_id,
      delegation_id: fixture.authorization.delegation_id,
      authorization_binding_digest: fixture.authorization.binding_digest,
      executor_binding_digest: fixture.authorization.executor_attestation_hash,
      environment_binding_digest: fixture.authorization.environment_attestation_hash,
      workspace_binding_digest: fixture.authorization.workspace_attestation_hash,
      reserved_bytes: 1_000_000,
      reserved_frames: 10,
      reserved_events: 10,
      max_duration_ms: 60_000,
    },
  });
}

function authorizationFixture(corpusKind: "synthetic" | "repository") {
  const controls = GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: "host_enforced_indirect" as const,
  }));
  const requirements = GovernedReviewRequirements_v1.parse({
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    repository_id: "synthetic-repository",
    base_object_id: "1".repeat(40),
    candidate_object_id: "2".repeat(40),
    objective_hash: hash("objective"),
    authorized_model_provider: "openai",
    source_disclosure_allowed: true,
    controls,
    max_duration_ms: 60_000,
    max_output_bytes: 1_000_000,
  });
  const grant = GovernedCapabilityGrant_v1.parse({
    schema_version: "1.0.0",
    attempt_id: requirements.attempt_id,
    delegation_id: requirements.delegation_id,
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
  const attestations: QualifiedCodexProviderAttestations = {
    executor: {
      schema_version: "1.0.0",
      executor_id: "codex-linux-pinned",
      executor_version: "0.145.0",
      executable_hash: hash("codex-executable"),
      protocol: "jsonl-stdin",
      configuration_hash: hash("config"),
      tool_surface_hash: hash("tools"),
      observed_at: at(0),
      expires_at: at(50),
    },
    environment: {
      schema_version: "1.0.0",
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "disposable-environment-1",
      topology_hash: hash("wsl2-systemd-bwrap-codex"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced",
        strength: "independently_enforced_verified",
        evidence_refs: [hash(`control:${control}`)],
        enforcement_owner: "lexrunner-host-verifier",
      })),
      observed_at: at(0),
      expires_at: at(50),
    },
    workspace: {
      schema_version: "1.0.0",
      workspace_id: "synthetic-workspace-1",
      repository_id: requirements.repository_id,
      base_object_id: requirements.base_object_id,
      candidate_object_id: requirements.candidate_object_id,
      corpus_hash: hash("synthetic-corpus"),
      selection_hash: hash("synthetic-selection"),
      corpus_kind: corpusKind,
      observed_at: at(0),
      expires_at: at(50),
    },
  };
  const decision = authorizeGovernedReview({
    authorizationId: "authorization-1",
    requirements,
    grant,
    executor: attestations.executor,
    environment: attestations.environment,
    workspace: attestations.workspace,
    authorizedAt: at(1),
    expiresAt: at(40),
  });
  if (!decision.authorized) throw new Error(`fixture authorization failed: ${decision.reason}`);
  return { authorization: decision.authorization as AttemptAuthorization_v1, attestations };
}
