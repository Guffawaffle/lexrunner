import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryWorkerObservationStore } from "../../src/store/inmemory/worker-observation-store.js";
import { SqliteWorkerObservationStore } from "../../src/store/sqlite/worker-observation-store.js";
import type { ClaimWorkerDispatchInput } from "../../src/store/worker-dispatch-store.js";
import type { WorkerObservationInput } from "../../src/store/worker-observation-store.js";
import { createAttachedWorker, taskPacket } from "./worker-dispatch-fixture.js";

const directories: string[] = [];
const stores: Array<InMemoryWorkerObservationStore | SqliteWorkerObservationStore> = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup(kind: string, sessionId = "worker/session α") {
  let path: string | undefined;
  if (kind === "sqlite") {
    const directory = await mkdtemp(join(tmpdir(), "lexrunner-observations-"));
    directories.push(directory);
    path = join(directory, "store.db");
  }
  const store = path
    ? new SqliteWorkerObservationStore(path)
    : new InMemoryWorkerObservationStore();
  stores.push(store);
  const controller = await createAttachedWorker(store, sessionId);
  const claim: ClaimWorkerDispatchInput = {
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
  const observation: WorkerObservationInput = {
    sessionId,
    claimId: claim.claimId,
    requestHash: claim.requestHash,
    workerId: "native-session-1",
    observationId: "observation-1",
    observerId: "owned-connection-1",
    turnId: "turn/α",
    kind: "completed",
    observedAt: "2026-08-12T12:05:00.000Z",
    evidenceHash: "sha256:" + "c".repeat(64),
    summary: "Provider reported completion; verification pending.",
  };
  return { store, claim, observation, path };
}
const recordedAt = "2026-08-12T12:05:01.000Z";
for (const kind of ["memory", "sqlite"])
  describe(`${kind} observation journal`, () => {
    it("requires an exact durable dispatch binding", async () => {
      const { store, claim, observation } = await setup(kind);
      expect(await store.recordWorkerObservation(observation, recordedAt)).toEqual({
        recorded: false,
        reason: "dispatch_missing",
      });
      await store.claimWorkerDispatch(claim);
      for (const patch of [
        { claimId: "other" },
        { workerId: "other" },
        { requestHash: "sha256:" + "d".repeat(64) },
      ])
        expect(
          await store.recordWorkerObservation({ ...observation, ...patch }, recordedAt)
        ).toEqual({ recorded: false, reason: "identity_mismatch" });
      expect(await store.listWorkerObservations(claim.sessionId)).toEqual([]);
    });
    it("retains late reports for a lost session without changing authority or acknowledgments", async () => {
      const { store, claim, observation } = await setup(kind);
      await store.claimWorkerDispatch(claim);
      expect(
        await store.endWorkerSession({ ...claim, status: "lost", mutationId: "lost-1" })
      ).toMatchObject({ updated: true });
      const before = await store.getWorkerDispatch(claim.sessionId);
      const result = await store.recordWorkerObservation(observation, recordedAt);
      expect(result).toMatchObject({
        recorded: true,
        replay: false,
        record: { kind: "completed", attemptId: "attempt-1", packetHash: claim.packetHash },
      });
      expect(await store.getWorkerDispatch(claim.sessionId)).toEqual(before);
      expect(await store.claimWorkerDispatch({ ...claim, now: recordedAt })).toMatchObject({
        recorded: false,
      });
      expect(
        await store.acknowledgeWorkerDispatch({
          ...claim,
          turnId: observation.turnId,
          now: recordedAt,
        })
      ).toMatchObject({ recorded: false });
    });
    it("deduplicates retry after lost persistence response and rejects changed evidence", async () => {
      const { store, claim, observation } = await setup(kind);
      await store.claimWorkerDispatch(claim);
      const results = await Promise.all([
        store.recordWorkerObservation(observation, recordedAt),
        store.recordWorkerObservation(observation, recordedAt),
      ]);
      expect(results.filter((x) => x.recorded && !x.replay)).toHaveLength(1);
      expect(
        await store.recordWorkerObservation(observation, "2026-08-12T12:06:00.000Z")
      ).toMatchObject({ recorded: true, replay: true, record: { recordedAt } });
      expect(
        await store.recordWorkerObservation({ ...observation, summary: "changed" }, recordedAt)
      ).toEqual({ recorded: false, reason: "observation_conflict" });
      const records = await store.listWorkerObservations(claim.sessionId);
      expect(records).toHaveLength(1);
      records[0].summary = "mutation";
      expect((await store.listWorkerObservations(claim.sessionId))[0].summary).toBe(
        observation.summary
      );
    });
    it("preserves contradictory reports without selecting a winning turn or outcome", async () => {
      const { store, claim, observation } = await setup(kind);
      await store.claimWorkerDispatch(claim);
      await store.acknowledgeWorkerDispatch({ ...claim, turnId: "acknowledged-turn" });
      await store.recordWorkerObservation(observation, recordedAt);
      await store.recordWorkerObservation(
        { ...observation, observationId: "contradiction", kind: "failed", turnId: "other-turn" },
        recordedAt
      );
      expect((await store.listWorkerObservations(claim.sessionId)).map((x) => x.kind)).toEqual([
        "completed",
        "failed",
      ]);
      expect((await store.getWorkerDispatch(claim.sessionId))?.acknowledgement?.turnId).toBe(
        "acknowledged-turn"
      );
    });
    it("rejects invalid times, unbounded summaries and invented verification fields", async () => {
      const { store, claim, observation } = await setup(kind);
      await store.claimWorkerDispatch(claim);
      expect(
        await store.recordWorkerObservation(
          { ...observation, observedAt: "2026-08-12T11:00:00.000Z" },
          recordedAt
        )
      ).toMatchObject({ recorded: false, reason: "invalid_time" });
      expect(await store.recordWorkerObservation(observation, claim.now)).toMatchObject({
        recorded: false,
        reason: "invalid_time",
      });
      await expect(
        store.recordWorkerObservation({ ...observation, summary: "x".repeat(8193) }, recordedAt)
      ).rejects.toThrow();
      await expect(
        store.recordWorkerObservation(
          { ...observation, verified: true } as WorkerObservationInput,
          recordedAt
        )
      ).rejects.toThrow();
    });
    it("caps new entries without evicting historical evidence or denying exact replay", async () => {
      const { store, claim, observation } = await setup(kind);
      await store.claimWorkerDispatch(claim);
      for (let i = 0; i < 128; i++)
        expect(
          await store.recordWorkerObservation(
            { ...observation, observationId: String(i) },
            recordedAt
          )
        ).toMatchObject({ recorded: true, replay: false });
      expect(await store.recordWorkerObservation(observation, recordedAt)).toEqual({
        recorded: false,
        reason: "observation_limit",
      });
      expect(
        await store.recordWorkerObservation({ ...observation, observationId: "0" }, recordedAt)
      ).toMatchObject({ recorded: true, replay: true });
      expect(await store.listWorkerObservations(claim.sessionId)).toHaveLength(128);
    });
    it("preserves canonical opaque identity domains", async () => {
      const { store, claim, observation } = await setup(kind, "worker/" + "α".repeat(17000));
      await store.claimWorkerDispatch(claim);
      expect(
        await store.recordWorkerObservation(
          { ...observation, turnId: "turn/" + "β".repeat(17000) },
          recordedAt
        )
      ).toMatchObject({ recorded: true });
    });
  });
it("serializes independent SQLite writers and survives reopen read-only", async () => {
  const { store, claim, observation, path } = await setup("sqlite");
  await store.claimWorkerDispatch(claim);
  const second = new SqliteWorkerObservationStore(path!);
  stores.push(second);
  const results = await Promise.all([
    store.recordWorkerObservation(observation, recordedAt),
    second.recordWorkerObservation({ ...observation, summary: "different writer" }, recordedAt),
  ]);
  expect(results.filter((x) => x.recorded)).toHaveLength(1);
  expect(results.filter((x) => !x.recorded && x.reason === "observation_conflict")).toHaveLength(1);
  await store.close();
  await second.close();
  stores.splice(0);
  const reader = new SqliteWorkerObservationStore(path!, { readOnly: true });
  stores.push(reader);
  expect(await reader.listWorkerObservations(claim.sessionId)).toHaveLength(1);
  expect((await reader.getWorkerDispatch(claim.sessionId))?.acknowledgement).toBeUndefined();
  await expect(
    reader.recordWorkerObservation({ ...observation, observationId: "new" }, recordedAt)
  ).rejects.toThrow();
});
