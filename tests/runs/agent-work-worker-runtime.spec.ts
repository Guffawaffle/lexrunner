import { describe, expect, it, vi } from "vitest";

import { createAgentTaskPacket, type AgentTaskPacket_v1 } from "../../src/schemas/agent-work.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import {
  AgentWorkWorkerAdapterNegotiator,
  HOST_ASSISTED_ADAPTER_MANIFEST,
  PortBackedWorkerRuntimeAdapter,
  WorkerAdapterManifest_v1,
  WorkerAdapterRegistry,
  type WorkerRuntimeArtifact,
  type WorkerRuntimePort,
  type WorkerRuntimeSignal,
} from "../../src/runs/agent-work-worker-runtime.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";

const subprocessManifest = WorkerAdapterManifest_v1.parse({
  ...HOST_ASSISTED_ADAPTER_MANIFEST,
  adapter: {
    id: "lexrunner.controlled-subprocess-fixture",
    version: "1.0.0",
    kind: "subprocess",
    session_backend: "codex-cli",
  },
  lifecycle: {
    ...HOST_ASSISTED_ADAPTER_MANIFEST.lifecycle,
    launch: true,
    assisted_attach: false,
  },
  authority: Object.fromEntries(
    Object.keys(HOST_ASSISTED_ADAPTER_MANIFEST.authority).map((dimension) => [
      dimension,
      "enforced",
    ])
  ),
  reproducibility: {
    backend_identity: "lexrunner.controlled-subprocess-fixture",
    backend_version: "1.0.0",
  },
});

describe.each([
  { name: "assisted host worker", manifest: HOST_ASSISTED_ADAPTER_MANIFEST, mode: "attach" },
  { name: "controlled subprocess", manifest: subprocessManifest, mode: "launch" },
] as const)("worker adapter conformance: $name", ({ manifest, mode }) => {
  it("shares prepare, liveness, cancellation, artifact, receipt, and teardown semantics", async () => {
    const port = new ControlledWorkerPort();
    const adapter = new PortBackedWorkerRuntimeAdapter(manifest, port);
    const signals: WorkerRuntimeSignal[] = [];
    const packet = taskPacket();

    await adapter.prepare({ packet, signal: (signal) => signals.push(signal) });
    expect(port.preparedPacketHash).toBe(packet.packet_hash);
    if (mode === "launch") {
      await expect(adapter.launch()).resolves.toEqual({ backendWorkerId: "worker-fixture" });
    } else {
      await adapter.assistedAttach({ backendWorkerId: "worker-fixture" });
    }

    await expect(adapter.heartbeat()).resolves.toEqual({
      alive: true,
      signal: port.signal,
    });
    expect(signals).toEqual([port.signal]);
    await expect(adapter.collectArtifacts()).resolves.toEqual(port.artifacts);
    await expect(adapter.collectReceipt()).resolves.toEqual(port.receipt);

    port.alive = false;
    await expect(adapter.heartbeat()).resolves.toMatchObject({ alive: false });
    await adapter.cancel("operator-requested cancellation");
    expect(port.cancelReason).toBe("operator-requested cancellation");
    await expect(adapter.collectReceipt()).resolves.toEqual(port.receipt);
    await adapter.teardown();
    expect(port.tornDown).toBe(true);
    await expect(adapter.heartbeat()).rejects.toThrow("no observable worker");
  });
});

describe("worker adapter capability negotiation", () => {
  it("fails closed before GO until each required host trust gap is explicitly accepted", async () => {
    const packet = taskPacket();
    const negotiator = negotiatorFor(packet);
    const denied = await negotiator.negotiate(packet.attempt_id, {
      schema_version: "1.0.0",
      adapter_id: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.id,
      adapter_version: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.version,
      mode: "assisted_attach",
      accepted_trust_gaps: [],
    });
    expect(denied).toEqual({
      go: false,
      reason: "authority_unenforceable",
      blockedDimensions: ["filesystem_read", "filesystem_write"],
    });

    const accepted = await negotiator.negotiate(packet.attempt_id, {
      schema_version: "1.0.0",
      adapter_id: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.id,
      adapter_version: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.version,
      mode: "assisted_attach",
      accepted_trust_gaps: ["filesystem_read", "filesystem_write"],
    });
    expect(accepted).toMatchObject({
      go: true,
      adapter: { id: "lexrunner.host-assisted", session_backend: "host-subagent" },
      trustGaps: ["filesystem_read", "filesystem_write"],
      enforcementSummaryHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });

  it("rejects unsupported lifecycle modes without calling a provider runtime", async () => {
    const packet = taskPacket();
    const launch = vi.fn();
    const negotiator = negotiatorFor(packet);
    const result = await negotiator.negotiate(packet.attempt_id, {
      schema_version: "1.0.0",
      adapter_id: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.id,
      adapter_version: HOST_ASSISTED_ADAPTER_MANIFEST.adapter.version,
      mode: "launch",
      accepted_trust_gaps: ["filesystem_read", "filesystem_write"],
    });

    expect(result).toEqual({ go: false, reason: "lifecycle_unsupported", blockedDimensions: [] });
    expect(launch).not.toHaveBeenCalled();
  });

  it("keeps provider configuration outside canonical packet and negotiation identity", async () => {
    const packet = taskPacket();
    const before = computeCanonicalHash(packet);
    const registry = new WorkerAdapterRegistry([subprocessManifest]);
    const negotiator = negotiatorFor(packet, registry);
    const first = await negotiator.negotiate(packet.attempt_id, {
      schema_version: "1.0.0",
      adapter_id: subprocessManifest.adapter.id,
      adapter_version: subprocessManifest.adapter.version,
      mode: "launch",
      accepted_trust_gaps: [],
    });
    const providerConfiguration = { model: "provider-private-model", endpoint: "local-fixture" };
    const second = await negotiator.negotiate(packet.attempt_id, {
      schema_version: "1.0.0",
      adapter_id: subprocessManifest.adapter.id,
      adapter_version: subprocessManifest.adapter.version,
      mode: "launch",
      accepted_trust_gaps: [],
    });

    expect(providerConfiguration).not.toHaveProperty("packet_hash");
    expect(computeCanonicalHash(packet)).toBe(before);
    expect(second).toEqual(first);
  });

  it("binds filesystem-scope ceilings into the enforcement summary without exposing globs", async () => {
    const firstPacket = taskPacket();
    const secondPacket = taskPacket(["src/runtime/**"]);
    const selection = {
      schema_version: "1.0.0" as const,
      adapter_id: subprocessManifest.adapter.id,
      adapter_version: subprocessManifest.adapter.version,
      mode: "launch" as const,
      accepted_trust_gaps: [],
    };
    const first = await negotiatorFor(
      firstPacket,
      new WorkerAdapterRegistry([subprocessManifest])
    ).negotiate(firstPacket.attempt_id, selection);
    const second = await negotiatorFor(
      secondPacket,
      new WorkerAdapterRegistry([subprocessManifest])
    ).negotiate(secondPacket.attempt_id, selection);

    expect(first.go && second.go).toBe(true);
    if (!first.go || !second.go) throw new Error("expected successful negotiation");
    expect(first.enforcementSummaryHash).not.toBe(second.enforcementSummaryHash);
    expect(JSON.stringify(first)).not.toContain("src/**");
  });

  it("returns immutable manifest copies from the registry", () => {
    const registry = new WorkerAdapterRegistry();
    const manifest = registry.get("lexrunner.host-assisted", "1.0.0");
    if (!manifest) throw new Error("expected host manifest");
    manifest.authority.filesystem_read = "enforced";
    expect(registry.get("lexrunner.host-assisted", "1.0.0")?.authority.filesystem_read).toBe(
      "unenforced"
    );
  });
});

describe("worker adapter evidence bounds", () => {
  it("rejects a provider signal that exceeds its declared limit", async () => {
    const port = new ControlledWorkerPort();
    port.signal.summary = "x".repeat(HOST_ASSISTED_ADAPTER_MANIFEST.signals.max_bytes);
    const adapter = new PortBackedWorkerRuntimeAdapter(HOST_ASSISTED_ADAPTER_MANIFEST, port);
    await adapter.prepare({ packet: taskPacket(), signal: () => undefined });
    await adapter.assistedAttach({ backendWorkerId: "worker-fixture" });

    await expect(adapter.heartbeat()).rejects.toThrow("exceeds its declared bound");
  });
});

class ControlledWorkerPort implements WorkerRuntimePort {
  preparedPacketHash: string | null = null;
  alive = true;
  cancelReason: string | null = null;
  tornDown = false;
  readonly signal: WorkerRuntimeSignal = {
    type: "progress",
    summary: "fixture reached its checkpoint",
    at: "2026-07-19T12:00:01.000Z",
  };
  readonly artifacts: WorkerRuntimeArtifact[] = [
    { id: "artifact-fixture", hash: `sha256:${"a".repeat(64)}` },
  ];
  readonly receipt = { schema_version: "fixture-1", outcome: "cancelled", learned: true };

  async prepare(packet: AgentTaskPacket_v1): Promise<void> {
    this.preparedPacketHash = packet.packet_hash;
  }

  async launch(): Promise<{ backendWorkerId: string }> {
    return { backendWorkerId: "worker-fixture" };
  }

  async assistedAttach(): Promise<void> {}

  async heartbeat(): Promise<{ alive: boolean; signal: WorkerRuntimeSignal }> {
    return { alive: this.alive, signal: this.signal };
  }

  async cancel(reason: string): Promise<void> {
    this.cancelReason = reason;
  }

  async teardown(): Promise<void> {
    this.tornDown = true;
  }

  async collectArtifacts(): Promise<WorkerRuntimeArtifact[]> {
    return structuredClone(this.artifacts);
  }

  async collectReceipt(): Promise<unknown> {
    return structuredClone(this.receipt);
  }
}

function negotiatorFor(packet: AgentTaskPacket_v1, registry?: WorkerAdapterRegistry) {
  return new AgentWorkWorkerAdapterNegotiator(
    {
      getTaskPacketBinding: async (attemptId: string) =>
        attemptId === packet.attempt_id
          ? {
              runId: packet.run_id,
              attemptId: packet.attempt_id,
              workItemId: packet.work_item.work_item_id,
              workItemRevision: packet.work_item.revision,
              packetId: packet.packet_id,
              packetHash: packet.packet_hash,
              packetJson: canonicalJSONStringify(packet),
              createdAt: packet.created_at,
            }
          : null,
    },
    registry
  );
}

function taskPacket(writeGlobs: string[] = ["src/**"]): AgentTaskPacket_v1 {
  return createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: "packet-adapter",
    run_id: "run-adapter",
    work_item: { work_item_id: "work-adapter", revision: 1 },
    attempt_id: "attempt-adapter",
    repository: { id: "owner/repo", base_sha: "a".repeat(40) },
    objective: "Exercise a runtime-neutral worker adapter",
    acceptance_criteria: [],
    instructions: [],
    scope: {
      read_globs: ["**"],
      write_globs: writeGlobs,
      deny_globs: [],
      cross_repo_allowed: false,
    },
    authority: {
      edit: true,
      git_write: false,
      github_write: false,
      external_runtime: false,
      secrets: false,
      signing: false,
      release: false,
    },
    verification: [],
    budget: {},
    created_at: "2026-07-19T12:00:00.000Z",
  });
}
