import { z } from "zod";

import {
  AgentTaskPacket_v1,
  WorkerSessionBackend,
  type AgentTaskPacket_v1 as AgentTaskPacket,
} from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import type { TaskPacketBindingStore } from "../store/workspace-lifecycle-store.js";

export const WORKER_ADAPTER_CONTRACT_VERSION = "1.0.0" as const;

export const WorkerAdapterAuthorityDimension = z.enum([
  "filesystem_read",
  "filesystem_write",
  "git_write",
  "github_write",
  "external_runtime",
  "network",
  "secrets",
  "signing",
  "release",
  "nested_delegation",
]);
export type WorkerAdapterAuthorityDimension = z.infer<typeof WorkerAdapterAuthorityDimension>;

export const WorkerAdapterEnforcement = z.enum([
  "enforced",
  "brokered",
  "unenforced",
  "unsupported",
]);
export type WorkerAdapterEnforcement = z.infer<typeof WorkerAdapterEnforcement>;

const boundedText = z.string().min(1).max(256);
const authorityMatrix = z.object(
  Object.fromEntries(
    WorkerAdapterAuthorityDimension.options.map((dimension) => [
      dimension,
      WorkerAdapterEnforcement,
    ])
  ) as Record<WorkerAdapterAuthorityDimension, typeof WorkerAdapterEnforcement>
);

export const WorkerAdapterManifest_v1 = z
  .object({
    schema_version: z.literal(WORKER_ADAPTER_CONTRACT_VERSION),
    adapter: z
      .object({
        id: boundedText,
        version: boundedText,
        kind: z.enum(["assisted", "subprocess", "remote"]),
        session_backend: WorkerSessionBackend,
      })
      .strict(),
    lifecycle: z
      .object({
        prepare: z.boolean(),
        launch: z.boolean(),
        assisted_attach: z.boolean(),
        heartbeat: z.boolean(),
        cancellation: z.boolean(),
        teardown: z.boolean(),
        artifact_collection: z.boolean(),
        receipt_collection: z.boolean(),
      })
      .strict(),
    authority: authorityMatrix.strict(),
    signals: z
      .object({
        structured: z.boolean(),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024),
      })
      .strict(),
    reproducibility: z
      .object({
        backend_identity: boundedText,
        backend_version: boundedText,
      })
      .strict(),
  })
  .strict();
export type WorkerAdapterManifest_v1 = z.infer<typeof WorkerAdapterManifest_v1>;

export const WorkerAdapterSelection_v1 = z
  .object({
    schema_version: z.literal(WORKER_ADAPTER_CONTRACT_VERSION),
    adapter_id: boundedText,
    adapter_version: boundedText,
    mode: z.enum(["launch", "assisted_attach"]),
    accepted_trust_gaps: z.array(WorkerAdapterAuthorityDimension).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.accepted_trust_gaps).size !== value.accepted_trust_gaps.length) {
      context.addIssue({
        code: "custom",
        path: ["accepted_trust_gaps"],
        message: "accepted trust-gap dimensions must be unique",
      });
    }
  });
export type WorkerAdapterSelection_v1 = z.infer<typeof WorkerAdapterSelection_v1>;

export interface WorkerAdapterNegotiationDimension {
  dimension: WorkerAdapterAuthorityDimension;
  required: boolean;
  enforcement: WorkerAdapterEnforcement;
  acceptedTrustGap: boolean;
}

export type WorkerAdapterNegotiationResult =
  | {
      go: true;
      adapter: {
        id: string;
        version: string;
        kind: "assisted" | "subprocess" | "remote";
        session_backend: z.infer<typeof WorkerSessionBackend>;
      };
      dimensions: WorkerAdapterNegotiationDimension[];
      trustGaps: WorkerAdapterAuthorityDimension[];
      enforcementSummaryHash: string;
    }
  | {
      go: false;
      reason:
        | "adapter_not_found"
        | "lifecycle_unsupported"
        | "authority_unenforceable"
        | "packet_missing";
      blockedDimensions: WorkerAdapterAuthorityDimension[];
    };

const workerSignalBase = {
  summary: z.string().min(1).max(4_096),
  at: z.string().datetime({ offset: true }),
};

export const WorkerRuntimeSignalSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["heartbeat", "progress", "completed", "failed"]),
      ...workerSignalBase,
    })
    .strict(),
  z
    .object({
      type: z.literal("blocked"),
      ...workerSignalBase,
      blocker: z
        .object({
          code: boundedText,
          retryable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("dependency_discovered"),
      ...workerSignalBase,
      dependency: z
        .object({
          work_item_id: boundedText,
          relationship: z.enum(["blocks", "blocked_by", "related"]),
          evidence_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("evidence_discovered"),
      ...workerSignalBase,
      evidence: z
        .object({
          kind: z.enum(["artifact", "observation", "decision", "eliminated_hypothesis"]),
          id: boundedText,
          hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("human_action_requested"),
      ...workerSignalBase,
      request: z
        .object({
          request_id: boundedText,
          action_class: boundedText,
        })
        .strict(),
    })
    .strict(),
]);
export type WorkerRuntimeSignal = z.infer<typeof WorkerRuntimeSignalSchema>;

export const WorkerRuntimeArtifactSchema = z
  .object({
    id: boundedText,
    hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
export type WorkerRuntimeArtifact = z.infer<typeof WorkerRuntimeArtifactSchema>;

/** Runtime-neutral lifecycle port. Adapters execute packets; they never define work or acceptance. */
export interface WorkerRuntimeAdapter {
  readonly manifest: WorkerAdapterManifest_v1;
  prepare(input: {
    packet: AgentTaskPacket;
    signal(signal: WorkerRuntimeSignal): void;
  }): Promise<void>;
  launch(): Promise<{ backendWorkerId: string }>;
  assistedAttach(input: { backendWorkerId: string }): Promise<void>;
  heartbeat(): Promise<{ alive: boolean; signal?: WorkerRuntimeSignal }>;
  cancel(reason: string): Promise<void>;
  teardown(): Promise<void>;
  collectArtifacts(): Promise<WorkerRuntimeArtifact[]>;
  collectReceipt(): Promise<unknown>;
}

/** Provider-specific integration hidden behind the canonical adapter contract. */
export interface WorkerRuntimePort {
  prepare(packet: AgentTaskPacket): Promise<void>;
  launch?(): Promise<{ backendWorkerId: string }>;
  assistedAttach?(input: { backendWorkerId: string }): Promise<void>;
  heartbeat(): Promise<{ alive: boolean; signal?: WorkerRuntimeSignal }>;
  cancel(reason: string): Promise<void>;
  teardown(): Promise<void>;
  collectArtifacts(): Promise<WorkerRuntimeArtifact[]>;
  collectReceipt(): Promise<unknown>;
}

/** Shared lifecycle and evidence validation for assisted, subprocess, and remote adapters. */
export class PortBackedWorkerRuntimeAdapter implements WorkerRuntimeAdapter {
  readonly manifest: WorkerAdapterManifest_v1;
  private state: "idle" | "prepared" | "active" | "cancelled" | "torn_down" = "idle";
  private emit: ((signal: WorkerRuntimeSignal) => void) | null = null;

  constructor(
    manifest: WorkerAdapterManifest_v1,
    private readonly port: WorkerRuntimePort
  ) {
    this.manifest = deepFreeze(structuredClone(WorkerAdapterManifest_v1.parse(manifest)));
  }

  async prepare(input: {
    packet: AgentTaskPacket;
    signal(signal: WorkerRuntimeSignal): void;
  }): Promise<void> {
    if (!this.manifest.lifecycle.prepare || this.state !== "idle") {
      throw new Error("Worker adapter cannot prepare in its current lifecycle state");
    }
    const packet = AgentTaskPacket_v1.parse(input.packet);
    await this.port.prepare(structuredClone(packet));
    this.emit = input.signal;
    this.state = "prepared";
  }

  async launch(): Promise<{ backendWorkerId: string }> {
    if (!this.manifest.lifecycle.launch || !this.port.launch || this.state !== "prepared") {
      throw new Error("Worker adapter does not support launch in its current lifecycle state");
    }
    const launched = await this.port.launch();
    if (!boundedText.safeParse(launched.backendWorkerId).success) {
      throw new Error("Worker adapter returned an invalid backend worker identity");
    }
    this.state = "active";
    return { backendWorkerId: launched.backendWorkerId };
  }

  async assistedAttach(input: { backendWorkerId: string }): Promise<void> {
    if (
      !this.manifest.lifecycle.assisted_attach ||
      !this.port.assistedAttach ||
      this.state !== "prepared" ||
      !boundedText.safeParse(input.backendWorkerId).success
    ) {
      throw new Error("Worker adapter does not support assisted attach in its current state");
    }
    await this.port.assistedAttach(input);
    this.state = "active";
  }

  async heartbeat(): Promise<{ alive: boolean; signal?: WorkerRuntimeSignal }> {
    this.requireObservableState();
    const heartbeat = await this.port.heartbeat();
    if (typeof heartbeat.alive !== "boolean") {
      throw new Error("Worker adapter returned an invalid heartbeat");
    }
    if (!heartbeat.signal) return { alive: heartbeat.alive };
    const signal = this.parseSignal(heartbeat.signal);
    this.emit?.(signal);
    return { alive: heartbeat.alive, signal };
  }

  async cancel(reason: string): Promise<void> {
    if (!this.manifest.lifecycle.cancellation || this.state !== "active") {
      throw new Error("Worker adapter cannot cancel in its current lifecycle state");
    }
    if (!z.string().min(1).max(4_096).safeParse(reason).success) {
      throw new Error("Worker adapter cancellation reason is invalid");
    }
    await this.port.cancel(reason);
    this.state = "cancelled";
  }

  async teardown(): Promise<void> {
    if (!this.manifest.lifecycle.teardown || !["active", "cancelled"].includes(this.state)) {
      throw new Error("Worker adapter cannot tear down in its current lifecycle state");
    }
    await this.port.teardown();
    this.state = "torn_down";
  }

  async collectArtifacts(): Promise<WorkerRuntimeArtifact[]> {
    if (!this.manifest.lifecycle.artifact_collection) {
      throw new Error("Worker adapter does not support artifact collection");
    }
    this.requireObservableState();
    return z
      .array(WorkerRuntimeArtifactSchema)
      .max(256)
      .parse(await this.port.collectArtifacts());
  }

  async collectReceipt(): Promise<unknown> {
    if (!this.manifest.lifecycle.receipt_collection) {
      throw new Error("Worker adapter does not support receipt collection");
    }
    this.requireObservableState();
    const receipt = await this.port.collectReceipt();
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(receipt);
    } catch {
      throw new Error("Worker adapter returned a non-JSON receipt");
    }
    if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > 256 * 1024) {
      throw new Error("Worker adapter receipt exceeds the bounded evidence limit");
    }
    return structuredClone(receipt);
  }

  private parseSignal(candidate: WorkerRuntimeSignal): WorkerRuntimeSignal {
    const signal = WorkerRuntimeSignalSchema.parse(candidate);
    if (Buffer.byteLength(JSON.stringify(signal), "utf8") > this.manifest.signals.max_bytes) {
      throw new Error("Worker adapter signal exceeds its declared bound");
    }
    return signal;
  }

  private requireObservableState(): void {
    if (!["active", "cancelled"].includes(this.state)) {
      throw new Error("Worker adapter has no observable worker in its current state");
    }
  }
}

export class WorkerAdapterRegistry {
  private readonly manifests = new Map<string, WorkerAdapterManifest_v1>();

  constructor(manifests: readonly WorkerAdapterManifest_v1[] = [HOST_ASSISTED_ADAPTER_MANIFEST]) {
    for (const candidate of manifests) {
      const manifest = WorkerAdapterManifest_v1.parse(candidate);
      const key = adapterKey(manifest.adapter.id, manifest.adapter.version);
      if (this.manifests.has(key)) throw new Error(`Duplicate worker adapter ${key}`);
      this.manifests.set(key, deepFreeze(structuredClone(manifest)));
    }
  }

  get(id: string, version: string): WorkerAdapterManifest_v1 | null {
    const manifest = this.manifests.get(adapterKey(id, version));
    return manifest ? structuredClone(manifest) : null;
  }
}

export class AgentWorkWorkerAdapterNegotiator {
  constructor(
    private readonly packets: TaskPacketBindingStore,
    private readonly registry: WorkerAdapterRegistry = new WorkerAdapterRegistry()
  ) {}

  async negotiate(
    attemptId: string,
    selection: WorkerAdapterSelection_v1
  ): Promise<WorkerAdapterNegotiationResult> {
    const selected = WorkerAdapterSelection_v1.parse(selection);
    const binding = await this.packets.getTaskPacketBinding(attemptId);
    if (!binding) return { go: false, reason: "packet_missing", blockedDimensions: [] };
    let packet: AgentTaskPacket;
    try {
      packet = AgentTaskPacket_v1.parse(JSON.parse(binding.packetJson) as unknown);
    } catch {
      return { go: false, reason: "packet_missing", blockedDimensions: [] };
    }
    const manifest = this.registry.get(selected.adapter_id, selected.adapter_version);
    if (!manifest) return { go: false, reason: "adapter_not_found", blockedDimensions: [] };
    const lifecycleSupported =
      manifest.lifecycle.prepare &&
      manifest.lifecycle.heartbeat &&
      manifest.lifecycle.cancellation &&
      manifest.lifecycle.teardown &&
      manifest.lifecycle.artifact_collection &&
      manifest.lifecycle.receipt_collection &&
      (selected.mode === "launch" ? manifest.lifecycle.launch : manifest.lifecycle.assisted_attach);
    if (!lifecycleSupported) {
      return { go: false, reason: "lifecycle_unsupported", blockedDimensions: [] };
    }
    const accepted = new Set(selected.accepted_trust_gaps);
    const required = requiredDimensions(packet);
    const dimensions = WorkerAdapterAuthorityDimension.options.map((dimension) => {
      const enforcement = manifest.authority[dimension];
      return {
        dimension,
        required: required.has(dimension),
        enforcement,
        acceptedTrustGap:
          required.has(dimension) &&
          (enforcement === "brokered" || enforcement === "unenforced") &&
          accepted.has(dimension),
      } satisfies WorkerAdapterNegotiationDimension;
    });
    const blockedDimensions = dimensions
      .filter(
        (dimension) =>
          dimension.required &&
          (dimension.enforcement === "unsupported" ||
            ((dimension.enforcement === "brokered" || dimension.enforcement === "unenforced") &&
              !dimension.acceptedTrustGap))
      )
      .map((dimension) => dimension.dimension);
    if (blockedDimensions.length > 0) {
      return { go: false, reason: "authority_unenforceable", blockedDimensions };
    }
    const trustGaps = dimensions
      .filter((dimension) => dimension.acceptedTrustGap)
      .map((dimension) => dimension.dimension);
    return {
      go: true,
      adapter: { ...manifest.adapter },
      dimensions,
      trustGaps,
      enforcementSummaryHash: computeCanonicalHash({
        adapter: manifest.adapter,
        authority: dimensions,
        scope_hash: computeCanonicalHash({
          read_globs: packet.scope.read_globs,
          write_globs: packet.scope.write_globs,
          deny_globs: packet.scope.deny_globs,
          cross_repo_allowed: packet.scope.cross_repo_allowed,
        }),
      }),
    };
  }
}

export const HOST_ASSISTED_ADAPTER_MANIFEST: WorkerAdapterManifest_v1 =
  WorkerAdapterManifest_v1.parse({
    schema_version: WORKER_ADAPTER_CONTRACT_VERSION,
    adapter: {
      id: "lexrunner.host-assisted",
      version: "1.0.0",
      kind: "assisted",
      session_backend: "host-subagent",
    },
    lifecycle: {
      prepare: true,
      launch: false,
      assisted_attach: true,
      heartbeat: true,
      cancellation: true,
      teardown: true,
      artifact_collection: true,
      receipt_collection: true,
    },
    authority: {
      filesystem_read: "unenforced",
      filesystem_write: "unenforced",
      git_write: "unenforced",
      github_write: "unenforced",
      external_runtime: "unenforced",
      network: "unsupported",
      secrets: "unenforced",
      signing: "unenforced",
      release: "unenforced",
      nested_delegation: "unsupported",
    },
    signals: { structured: true, max_bytes: 4096 },
    reproducibility: {
      backend_identity: "lexrunner.host-assisted",
      backend_version: "1.0.0",
    },
  });

function requiredDimensions(packet: AgentTaskPacket): Set<WorkerAdapterAuthorityDimension> {
  const required = new Set<WorkerAdapterAuthorityDimension>(["filesystem_read"]);
  if (packet.authority.edit) required.add("filesystem_write");
  if (packet.authority.git_write) required.add("git_write");
  if (packet.authority.github_write) required.add("github_write");
  if (packet.authority.external_runtime) required.add("external_runtime");
  if (packet.authority.secrets) required.add("secrets");
  if (packet.authority.signing) required.add("signing");
  if (packet.authority.release) required.add("release");
  return required;
}

function adapterKey(id: string, version: string): string {
  return `${id}\u0000${version}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
