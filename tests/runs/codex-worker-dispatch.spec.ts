import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexWorkerDispatcher,
  type AttachedCodexTransport,
  type DispatchAttachedCodexWorkerInput,
} from "../../src/runs/codex-worker-dispatch.js";
import { WorkerAdapterRegistry } from "../../src/runs/agent-work-worker-runtime.js";
import { InMemoryWorkerDispatchStore } from "../../src/store/inmemory/worker-dispatch-store.js";
import { SqliteWorkerDispatchStore } from "../../src/store/sqlite/worker-dispatch-store.js";
import { createAttachedWorker } from "../store/worker-dispatch-fixture.js";

const directories: string[] = [];
const stores: Array<InMemoryWorkerDispatchStore | SqliteWorkerDispatchStore> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup(kind: string, externalRuntime = true, bindAdapter = true) {
  const directory =
    kind === "sqlite" ? await mkdtemp(join(tmpdir(), "lexrunner-codex-dispatch-")) : undefined;
  if (directory) directories.push(directory);
  const path = directory && join(directory, "store.db");
  const store = path ? new SqliteWorkerDispatchStore(path) : new InMemoryWorkerDispatchStore();
  stores.push(store);
  const controller = await createAttachedWorker(store, "worker/session-1", {
    externalRuntime,
    bindAdapter,
  });
  const input: DispatchAttachedCodexWorkerInput = {
    controller,
    runId: "run-1",
    expectedRunRevision: 0,
    attemptId: "attempt-1",
    expectedAttemptRevision: 3,
    workspaceLeaseId: "workspace-lease-1",
    expectedWorkspaceLeaseRevision: 0,
    sessionId: "worker/session-1",
    expectedSessionRevision: 0,
    claimId: "dispatch-1",
  };
  const request = vi
    .fn<AttachedCodexTransport["request"]>()
    .mockResolvedValue({ turn: { id: "turn/1" } });
  const transport = { adapterId: "lexrunner.host-assisted", adapterVersion: "1.0.0", request };
  const clock = { now: "2026-08-12T12:00:04.000Z" };
  const dispatcher = new CodexWorkerDispatcher(
    store,
    transport,
    new WorkerAdapterRegistry(),
    () => clock.now
  );
  return { store, input, request, dispatcher, transport, clock, path };
}

for (const kind of ["memory", "sqlite"])
  describe(`${kind} Codex worker dispatch bridge`, () => {
    it("sends only after a fresh durable claim and authority decision, then records the turn", async () => {
      const { store, input, dispatcher, request } = await setup(kind);
      request.mockImplementation(async (method, params, options) => {
        expect(method).toBe("turn/start");
        expect(params.threadId).toBe("native-session-1");
        const payload = JSON.parse(params.input[0]!.text);
        expect(payload.task_packet.packet_id).toBe("packet-1");
        expect(payload.execution_envelope.envelope_id).toBe("envelope-1");
        expect(Object.keys(params)).toEqual(["threadId", "input"]);
        expect(await store.getWorkerDispatch(input.sessionId)).toMatchObject({
          claimId: input.claimId,
        });
        expect(await store.listWorkerAuthorityEvents(input.runId)).toMatchObject([
          { decision: "allowed", dimension: "external_runtime", actionClass: "codex.turn.start" },
        ]);
        expect(options.signal.aborted).toBe(false);
        return { turn: { id: "turn/1" } };
      });
      expect(await dispatcher.dispatch(input)).toEqual({
        status: "acknowledged",
        turnId: "turn/1",
        replay: false,
      });
      expect(await dispatcher.dispatch(input)).toEqual({
        status: "acknowledged",
        turnId: "turn/1",
        replay: true,
      });
      expect(request).toHaveBeenCalledTimes(1);
    });
    it("persists packet denial and does not call the transport", async () => {
      const { store, input, dispatcher, request } = await setup(kind, false);
      expect(await dispatcher.dispatch(input)).toMatchObject({
        status: "blocked",
        reason: "packet_denied",
      });
      expect(request).not.toHaveBeenCalled();
      expect(await store.listWorkerAuthorityEvents(input.runId)).toMatchObject([
        { decision: "denied" },
      ]);
    });
    it("requires bound adapter evidence and rejects stale sessions before claiming", async () => {
      const missing = await setup(kind, true, false);
      expect(await missing.dispatcher.dispatch(missing.input)).toMatchObject({
        status: "blocked",
        reason: "canonical_attachment_missing",
      });
      expect(missing.request).not.toHaveBeenCalled();
      const active = await setup(kind);
      expect(
        await active.dispatcher.dispatch({ ...active.input, expectedSessionRevision: 9 })
      ).toMatchObject({ status: "blocked", reason: "stale_session_revision" });
      expect(await active.store.getWorkerDispatch(active.input.sessionId)).toBeNull();
    });
    it("retains lost-response uncertainty and never resends with a new service or claim ID", async () => {
      const { store, input, dispatcher, request, transport, clock } = await setup(kind);
      request.mockRejectedValue(new Error("credential-bearing diagnostic must not escape"));
      expect(await dispatcher.dispatch(input)).toEqual({
        status: "reconciliation_required",
        reason: "provider_delivery_unknown",
      });
      const recovered = new CodexWorkerDispatcher(
        store,
        transport,
        new WorkerAdapterRegistry(),
        () => clock.now
      );
      expect(await recovered.dispatch(input)).toEqual({
        status: "reconciliation_required",
        reason: "dispatch_claim_already_exists",
      });
      expect(await recovered.dispatch({ ...input, claimId: "different" })).toMatchObject({
        status: "blocked",
        reason: "dispatch_conflict",
      });
      expect(request).toHaveBeenCalledTimes(1);
    });
    it("preserves the observed turn in its result when acknowledgement persistence fails", async () => {
      const { store, input, dispatcher, request } = await setup(kind);
      vi.spyOn(store, "acknowledgeWorkerDispatch").mockRejectedValueOnce(new Error("write failed"));
      expect(await dispatcher.dispatch(input)).toEqual({
        status: "reconciliation_required",
        reason: "acknowledgement_not_recorded",
        observedTurnId: "turn/1",
      });
      expect(await dispatcher.dispatch(input)).toMatchObject({ status: "reconciliation_required" });
      expect(request).toHaveBeenCalledTimes(1);
      expect((await store.getWorkerDispatch(input.sessionId))?.acknowledgement).toBeUndefined();
    });
    it("does not dispatch when a committed claim or authority decision loses its response", async () => {
      const claim = await setup(kind);
      const claimWrite = claim.store.claimWorkerDispatch.bind(claim.store);
      vi.spyOn(claim.store, "claimWorkerDispatch").mockImplementationOnce(async (input) => {
        await claimWrite(input);
        throw new Error("lost claim response");
      });
      expect(await claim.dispatcher.dispatch(claim.input)).toMatchObject({
        status: "reconciliation_required",
        reason: "claim_persistence_unknown",
      });
      expect(await claim.dispatcher.dispatch(claim.input)).toMatchObject({
        status: "reconciliation_required",
      });
      expect(claim.request).not.toHaveBeenCalled();
      const authority = await setup(kind);
      const authorityWrite = authority.store.recordWorkerAuthorityDecision.bind(authority.store);
      vi.spyOn(authority.store, "recordWorkerAuthorityDecision").mockImplementationOnce(
        async (input) => {
          await authorityWrite(input);
          throw new Error("lost authority response");
        }
      );
      expect(await authority.dispatcher.dispatch(authority.input)).toMatchObject({
        status: "reconciliation_required",
        reason: "authorization_persistence_unknown",
      });
      expect(await authority.dispatcher.dispatch(authority.input)).toMatchObject({
        status: "reconciliation_required",
      });
      expect(authority.request).not.toHaveBeenCalled();
    });
    it("treats malformed provider acknowledgements as uncertainty", async () => {
      const { input, dispatcher, request } = await setup(kind);
      request.mockResolvedValue({ turn: { id: "x".repeat(4097) } });
      expect(await dispatcher.dispatch(input)).toEqual({
        status: "reconciliation_required",
        reason: "provider_acknowledgement_invalid",
      });
    });
  });

it("bounds response waiting and preserves the claim after best-effort abort", async () => {
  const { input, dispatcher, request } = await setup("memory");
  vi.useFakeTimers();
  request.mockImplementation(() => new Promise(() => {}));
  const pending = dispatcher.dispatch(input);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await pending).toEqual({
    status: "reconciliation_required",
    reason: "provider_delivery_unknown",
  });
  expect(request.mock.calls[0]![2].signal.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
