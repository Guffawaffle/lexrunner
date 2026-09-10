import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryWorkerDispatchStore } from "../../src/store/inmemory/worker-dispatch-store.js";
import { SqliteWorkerDispatchStore } from "../../src/store/sqlite/worker-dispatch-store.js";
import type { ClaimWorkerDispatchInput } from "../../src/store/worker-dispatch-store.js";
import { createAttachedWorker, taskPacket } from "./worker-dispatch-fixture.js";

const directories: string[] = [];
const stores: Array<InMemoryWorkerDispatchStore | SqliteWorkerDispatchStore> = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function database() {
  const directory = await mkdtemp(join(tmpdir(), "lexrunner-dispatch-"));
  directories.push(directory);
  return join(directory, "store.db");
}
async function setup(kind: string, sessionId = "worker-session-1") {
  const path = kind === "sqlite" ? await database() : undefined;
  const store = path ? new SqliteWorkerDispatchStore(path) : new InMemoryWorkerDispatchStore();
  stores.push(store);
  const controller = await createAttachedWorker(store, sessionId);
  const input: ClaimWorkerDispatchInput = {
    controller,
    runId: "run-1",
    expectedRunRevision: 0,
    attemptId: "attempt-1",
    expectedAttemptRevision: 3,
    workspaceLeaseId: "workspace-lease-1",
    expectedWorkspaceLeaseRevision: 0,
    sessionId,
    expectedSessionRevision: 0,
    claimId: "claim-1",
    packetHash: taskPacket().packet_hash,
    requestHash: "sha256:" + "b".repeat(64),
    now: "2026-08-12T12:00:04.000Z",
  };
  return { store, input, path };
}

for (const kind of ["memory", "sqlite"])
  describe(`${kind} worker dispatch`, () => {
    it("preserves canonical opaque identities and unrestricted provider turn IDs", async () => {
      const sessionId = "worker/session α/" + "x".repeat(17000);
      const { store, input } = await setup(kind, sessionId);
      expect(await store.claimWorkerDispatch(input)).toMatchObject({
        recorded: true,
        newlyClaimed: true,
        record: { sessionId },
      });
      expect(
        await store.acknowledgeWorkerDispatch({ ...input, turnId: "turn/opaque α" })
      ).toMatchObject({
        recorded: true,
        newlyClaimed: false,
        record: { acknowledgement: { turnId: "turn/opaque α" } },
      });
    });
    it("claims once, preserves binding, and never renews a claim on replay", async () => {
      const { store, input } = await setup(kind);
      const results = await Promise.all([
        store.claimWorkerDispatch(input),
        store.claimWorkerDispatch(input),
      ]);
      expect(results.filter((r) => r.recorded && r.newlyClaimed)).toHaveLength(1);
      const record = await store.getWorkerDispatch(input.sessionId);
      expect(record).toMatchObject({
        packetHash: input.packetHash,
        workerId: "native-session-1",
        claimId: "claim-1",
      });
      record!.claimId = "caller-mutation";
      expect((await store.getWorkerDispatch(input.sessionId))!.claimId).toBe("claim-1");
      expect(await store.claimWorkerDispatch({ ...input, claimId: "new-random-id" })).toMatchObject(
        { recorded: false, reason: "dispatch_conflict" }
      );
      expect(
        await store.claimWorkerDispatch({ ...input, requestHash: "sha256:" + "c".repeat(64) })
      ).toMatchObject({ recorded: false, reason: "dispatch_conflict" });
    });
    it("records an acknowledgement separately and rejects conflicting provider turns", async () => {
      const { store, input } = await setup(kind);
      expect(await store.acknowledgeWorkerDispatch({ ...input, turnId: "turn-1" })).toMatchObject({
        recorded: false,
        reason: "dispatch_missing",
      });
      await store.claimWorkerDispatch(input);
      expect((await store.getWorkerDispatch(input.sessionId))!.acknowledgement).toBeUndefined();
      const ack = { ...input, turnId: "turn-1", now: "2026-08-12T12:00:05.000Z" };
      const first = await store.acknowledgeWorkerDispatch(ack);
      expect(first).toMatchObject({
        recorded: true,
        newlyClaimed: false,
        record: { acknowledgement: { turnId: "turn-1" } },
      });
      expect(await store.acknowledgeWorkerDispatch(ack)).toEqual(first);
      expect(await store.acknowledgeWorkerDispatch({ ...ack, turnId: "turn-2" })).toMatchObject({
        recorded: false,
        reason: "acknowledgement_conflict",
      });
      expect(await store.claimWorkerDispatch(ack)).toMatchObject({
        recorded: true,
        newlyClaimed: false,
      });
    });
    it("requires current canonical attachment, packet and fenced lifecycle bindings", async () => {
      const { store, input } = await setup(kind);
      for (const [patch, reason] of [
        [{ sessionId: "missing" }, "not_found"],
        [{ packetHash: "sha256:" + "d".repeat(64) }, "identity_mismatch"],
        [{ expectedRunRevision: 8 }, "stale_run_revision"],
        [{ expectedAttemptRevision: 8 }, "stale_attempt_revision"],
        [{ expectedSessionRevision: 8 }, "stale_session_revision"],
        [{ expectedWorkspaceLeaseRevision: 8 }, "stale_workspace_revision"],
        [{ controller: { ...input.controller, fencingToken: 8 } }, "stale_fence"],
        [{ controller: { ...input.controller, runId: "different" } }, "lease_mismatch"],
        [{ now: "2026-08-12T12:02:00.000Z" }, "lease_expired"],
        [{ now: "2026-08-12T12:00:02.000Z" }, "invalid_time"],
      ] as const) {
        expect(await store.claimWorkerDispatch({ ...input, ...patch })).toMatchObject({
          recorded: false,
          reason,
        });
      }
      expect(await store.getWorkerDispatch(input.sessionId)).toBeNull();
      await expect(
        store.claimWorkerDispatch({ ...input, requestHash: "invalid" })
      ).rejects.toThrow();
      await store.claimWorkerDispatch(input);
      expect(
        await store.claimWorkerDispatch({
          ...input,
          controller: { ...input.controller, fencingToken: 2 },
        })
      ).toMatchObject({ recorded: false, reason: "stale_fence" });
    });
    it("does not treat a terminal session or a backward clock as a new claim", async () => {
      const { store, input } = await setup(kind);
      await store.claimWorkerDispatch(input);
      const end = await store.endWorkerSession({
        ...input,
        mutationId: "worker-end",
        status: "lost",
      });
      expect(end.updated).toBe(true);
      expect(await store.claimWorkerDispatch(input)).toMatchObject({ recorded: false });
      expect((await store.getWorkerDispatch(input.sessionId))!.acknowledgement).toBeUndefined();
    });
  });

it("retains uncertainty across SQLite reopen and serializes competing connections", async () => {
  const { store, input, path } = await setup("sqlite");
  const second = new SqliteWorkerDispatchStore(path!);
  stores.push(second);
  const results = await Promise.all([
    store.claimWorkerDispatch(input),
    second.claimWorkerDispatch({ ...input, claimId: "other-controller-request" }),
  ]);
  expect(results.filter((r) => r.recorded && r.newlyClaimed)).toHaveLength(1);
  await second.close();
  stores.splice(stores.indexOf(second), 1);
  await store.close();
  stores.splice(stores.indexOf(store), 1);
  const reopened = new SqliteWorkerDispatchStore(path!);
  stores.push(reopened);
  expect(await reopened.claimWorkerDispatch(input)).toMatchObject({
    recorded: true,
    newlyClaimed: false,
  });
  expect((await reopened.getWorkerDispatch(input.sessionId))!.acknowledgement).toBeUndefined();
  await reopened.acknowledgeWorkerDispatch({ ...input, turnId: "provider-turn-1" });
  await reopened.close();
  stores.splice(stores.indexOf(reopened), 1);
  const reader = new SqliteWorkerDispatchStore(path!, { readOnly: true });
  stores.push(reader);
  expect((await reader.getWorkerDispatch(input.sessionId))!.acknowledgement?.turnId).toBe(
    "provider-turn-1"
  );
});
