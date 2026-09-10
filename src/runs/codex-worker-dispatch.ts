import type { CoordinationStore } from "../store/coordination-store.js";
import { AgentTaskPacket_v1 } from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { validatePersistedCanonicalEnvelope } from "../store/workspace-lifecycle-evidence.js";
import type {
  WorkerDispatchStore,
  ClaimWorkerDispatchInput,
} from "../store/worker-dispatch-store.js";
import type {
  WorkspaceLifecycleStore,
  WorkerSessionStore,
  TaskPacketBindingStore,
  LaunchEnvelopeBindingStore,
  WorkerAuthorityDecisionStore,
} from "../store/workspace-lifecycle-store.js";
import { AgentWorkAuthorityService } from "./agent-work-authority-service.js";
import {
  AgentWorkWorkerAdapterNegotiator,
  WorkerAdapterRegistry,
  WorkerAdapterSelection_v1,
} from "./agent-work-worker-runtime.js";

type Store = Pick<CoordinationStore, "getControllerLease"> &
  WorkerDispatchStore &
  WorkspaceLifecycleStore &
  WorkerSessionStore &
  TaskPacketBindingStore &
  LaunchEnvelopeBindingStore &
  WorkerAuthorityDecisionStore;
export type DispatchAttachedCodexWorkerInput = Omit<
  ClaimWorkerDispatchInput,
  "packetHash" | "requestHash" | "now"
>;
export interface CodexTurnStartParams {
  threadId: string;
  input: Array<{ type: "text"; text: string }>;
}
/** Trusted, explicitly supplied connection to the already-created worker. No automatic launcher. */
export interface AttachedCodexTransport {
  readonly adapterId: string;
  readonly adapterVersion: string;
  /** Must not retry requests internally. Abort is best effort, never proof of no effect. */
  request(
    method: "turn/start",
    params: CodexTurnStartParams,
    options: {
      signal: AbortSignal;
      deadlineAt: string;
    }
  ): Promise<unknown>;
}
export type CodexWorkerDispatchResult =
  | { status: "acknowledged"; turnId: string; replay: boolean }
  | { status: "blocked"; reason: string }
  | { status: "reconciliation_required"; reason: string; observedTurnId?: string };

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_ACK_ID_BYTES = 4096;
const MAX_DISPATCH_MS = 30_000;

/** Foreground composition only. Does not qualify the transport, sandbox, or workspace. */
export class CodexWorkerDispatcher {
  private readonly authority: AgentWorkAuthorityService;
  private readonly negotiator: AgentWorkWorkerAdapterNegotiator;
  private readonly adapter: { id: string; version: string };
  constructor(
    private readonly store: Store,
    private readonly transport: AttachedCodexTransport,
    registry: WorkerAdapterRegistry,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.authority = new AgentWorkAuthorityService(store, now);
    this.negotiator = new AgentWorkWorkerAdapterNegotiator(store, registry);
    this.adapter = { id: transport.adapterId, version: transport.adapterVersion };
  }

  async dispatch(input: DispatchAttachedCodexWorkerInput): Promise<CodexWorkerDispatchResult> {
    // Snapshot mutable caller input before asynchronous reads; no caller-supplied prompt or override.
    input = structuredClone(input);
    const [attempt, lease, session, packetBinding, envelopeBinding, adapterBinding, controller] =
      await Promise.all([
        this.store.getAttempt(input.attemptId),
        this.store.getWorkspaceLease(input.workspaceLeaseId),
        this.store.getWorkerSession(input.sessionId),
        this.store.getTaskPacketBinding(input.attemptId),
        this.store.getLaunchEnvelopeBinding(input.attemptId),
        this.store.getWorkerAdapterBinding(input.sessionId),
        this.store.getControllerLease(input.runId),
      ]);
    if (
      !attempt ||
      !lease ||
      !session ||
      !packetBinding ||
      !envelopeBinding ||
      !adapterBinding ||
      !controller
    ) {
      return { status: "blocked", reason: "canonical_attachment_missing" };
    }
    const envelope = validatePersistedCanonicalEnvelope(envelopeBinding, attempt, lease);
    let packet: AgentTaskPacket_v1;
    try {
      packet = AgentTaskPacket_v1.parse(JSON.parse(packetBinding.packetJson));
    } catch {
      return { status: "blocked", reason: "packet_invalid" };
    }
    if (
      !envelope ||
      input.runId !== session.runId ||
      session.attemptId !== input.attemptId ||
      session.workspaceLeaseId !== input.workspaceLeaseId ||
      session.packetHash !== packet.packet_hash ||
      packet.run_id !== input.runId ||
      packet.attempt_id !== input.attemptId ||
      session.executionEnvelopeHash !== envelopeBinding.envelopeHash ||
      session.workerRuntime !== "codex-native"
    ) {
      return { status: "blocked", reason: "identity_mismatch" };
    }
    if (
      adapterBinding.adapterId !== this.adapter.id ||
      adapterBinding.adapterVersion !== this.adapter.version
    ) {
      return { status: "blocked", reason: "provider_adapter_mismatch" };
    }
    const selection = WorkerAdapterSelection_v1.safeParse({
      schema_version: "1.0.0",
      adapter_id: this.adapter.id,
      adapter_version: this.adapter.version,
      mode: "assisted_attach",
      accepted_trust_gaps: adapterBinding.trustGapDimensions,
    });
    if (!selection.success) return { status: "blocked", reason: "adapter_binding_invalid" };
    const negotiated = await this.negotiator.negotiate(input.attemptId, selection.data);
    if (
      !negotiated.go ||
      negotiated.enforcementSummaryHash !== adapterBinding.enforcementSummaryHash ||
      negotiated.adapter.session_backend !== session.backend
    ) {
      return { status: "blocked", reason: "adapter_negotiation_failed" };
    }
    const params: CodexTurnStartParams = {
      threadId: session.workerId,
      input: [
        {
          type: "text",
          text: canonicalJSONStringify({ task_packet: packet, execution_envelope: envelope }),
        },
      ],
    };
    const request = { method: "turn/start" as const, params };
    if (Buffer.byteLength(canonicalJSONStringify(request), "utf8") > MAX_REQUEST_BYTES) {
      return { status: "blocked", reason: "provider_request_too_large" };
    }
    const claimInput = {
      ...input,
      packetHash: packet.packet_hash,
      requestHash: computeCanonicalHash(request),
      now: this.now(),
    };
    let claimed: Awaited<ReturnType<WorkerDispatchStore["claimWorkerDispatch"]>>;
    try {
      claimed = await this.store.claimWorkerDispatch(claimInput);
    } catch {
      return { status: "reconciliation_required", reason: "claim_persistence_unknown" };
    }
    if (!claimed.recorded) return { status: "blocked", reason: claimed.reason };
    if (!claimed.newlyClaimed) {
      return claimed.record.acknowledgement
        ? { status: "acknowledged", turnId: claimed.record.acknowledgement.turnId, replay: true }
        : { status: "reconciliation_required", reason: "dispatch_claim_already_exists" };
    }
    let authorization: Awaited<ReturnType<AgentWorkAuthorityService["authorize"]>>;
    try {
      authorization = await this.authority.authorize({
        binding: {
          runId: input.runId,
          expectedRunRevision: input.expectedRunRevision,
          controller: input.controller,
          attemptId: input.attemptId,
          expectedAttemptRevision: input.expectedAttemptRevision,
          workspaceLeaseId: input.workspaceLeaseId,
          expectedWorkspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
          workerSessionId: input.sessionId,
          expectedWorkerSessionRevision: input.expectedSessionRevision,
        },
        action: {
          dimension: "external_runtime",
          actionClass: "codex.turn.start",
          actionHash: claimInput.requestHash,
        },
        mutationId: `dispatch:${computeCanonicalHash({ sessionId: input.sessionId, claimId: input.claimId })}`,
        enforcement: "brokered",
      });
    } catch {
      return { status: "reconciliation_required", reason: "authorization_persistence_unknown" };
    }
    if (!authorization.authorized) return { status: "blocked", reason: authorization.reason };
    if (authorization.idempotentReplay)
      return { status: "reconciliation_required", reason: "authorization_replayed" };
    // This bounds initiation and response waiting, not the lifetime of model work already accepted.
    const now = Date.parse(this.now());
    const deadline = Math.min(
      Date.parse(lease.expiresAt),
      Date.parse(controller.expiresAt),
      now + MAX_DISPATCH_MS
    );
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(deadline) ||
      deadline <= now ||
      now < Date.parse(authorization.event.createdAt)
    ) {
      return { status: "blocked", reason: "dispatch_window_expired" };
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: unknown;
    try {
      response = await Promise.race([
        this.transport.request("turn/start", structuredClone(params), {
          signal: abort.signal,
          deadlineAt: new Date(deadline).toISOString(),
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error("timeout"));
          }, deadline - now);
        }),
      ]);
    } catch {
      return { status: "reconciliation_required", reason: "provider_delivery_unknown" };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const turnId = (response as { turn?: { id?: unknown } } | null)?.turn?.id;
    if (
      typeof turnId !== "string" ||
      !turnId ||
      Buffer.byteLength(turnId, "utf8") > MAX_ACK_ID_BYTES
    ) {
      return { status: "reconciliation_required", reason: "provider_acknowledgement_invalid" };
    }
    try {
      const acknowledged = await this.store.acknowledgeWorkerDispatch({
        ...claimInput,
        turnId,
        now: this.now(),
      });
      if (acknowledged.recorded) return { status: "acknowledged", turnId, replay: false };
    } catch {
      /* The observed effect must survive a failed acknowledgement write in the result. */
    }
    return {
      status: "reconciliation_required",
      reason: "acknowledgement_not_recorded",
      observedTurnId: turnId,
    };
  }
}
