import { describe, expect, it } from "vitest";
import {
  reconcileWorkerTurn,
  type WorkerTurnReconciliationInput,
} from "../../src/runs/worker-turn-reconciliation.js";
import {
  reduceWorkerObservation,
  type WorkerObservationInput,
} from "../../src/store/worker-observation-store.js";
import { turnEvidenceHash } from "../../src/store/worker-turn-evidence.js";
import type { WorkerDispatchRecord } from "../../src/store/worker-dispatch-store.js";

const hash = "sha256:" + "a".repeat(64);
function snapshot(): WorkerTurnReconciliationInput {
  const dispatch: WorkerDispatchRecord = {
    schemaVersion: "1.0.0",
    sessionId: "session/α",
    attemptId: "attempt",
    runId: "run",
    claimId: "claim",
    packetId: "packet",
    packetHash: hash,
    envelopeId: "envelope",
    envelopeHash: hash,
    requestHash: hash,
    workerId: "worker/α",
    workspaceLeaseId: "workspace",
    workspaceLeaseRevision: 0,
    controllerId: "controller",
    controllerLeaseId: "lease",
    fencingToken: 1,
    claimedAt: "2026-09-01T00:00:00Z",
    acknowledgement: { turnId: "turn/α", observedAt: "2026-09-01T00:00:01Z" },
  };
  return { dispatch, observations: [], artifacts: [], captureDisposition: "drained" };
}
function add(
  s: WorkerTurnReconciliationInput,
  id = "observation-1",
  patch: Partial<WorkerObservationInput> = {},
  body = "birds"
) {
  const turnId = patch.turnId ?? "turn/α",
    kind = patch.kind ?? "completed";
  const notificationJson = JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: s.dispatch.workerId,
      turn: { id: turnId, status: kind, items: [{ text: body }] },
    },
  });
  const report: WorkerObservationInput = {
    sessionId: s.dispatch.sessionId,
    claimId: s.dispatch.claimId,
    requestHash: s.dispatch.requestHash,
    workerId: s.dispatch.workerId,
    observationId: id,
    observerId: "observer",
    turnId,
    kind,
    observedAt: "2026-09-01T00:01:00Z",
    evidenceHash: turnEvidenceHash(notificationJson),
    summary: "provider report",
    ...patch,
  };
  const result = reduceWorkerObservation(report, "2026-09-01T00:01:01Z", s.dispatch, []);
  if (!result.recorded) throw new Error("fixture rejected");
  s.observations.push(result.record);
  if (kind !== "acknowledged") s.artifacts.push({ observationId: id, notificationJson });
  return s;
}
describe("read-only worker turn reconciliation", () => {
  it.each(["completed", "failed", "interrupted"] as const)(
    "reports %s without verifying it or mutating inputs",
    (kind) => {
      const input = add(snapshot(), "obs", { kind });
      const before = structuredClone(input);
      expect(reconcileWorkerTurn(input)).toMatchObject({
        scope: "supplied_snapshot",
        state: "reported_terminal",
        verification: "not_performed",
        blockers: [],
        candidate: { turnId: "turn/α", reportedOutcome: kind, observationIds: ["obs"] },
      });
      expect(input).toEqual(before);
    }
  );
  it("does not manufacture an acknowledgment from a late terminal report", () => {
    const input = add(snapshot());
    delete input.dispatch.acknowledgement;
    expect(reconcileWorkerTurn(input)).toMatchObject({
      state: "unresolved",
      blockers: ["acknowledgement_missing"],
      acknowledgedTurnId: null,
      candidate: null,
    });
  });
  it("does not convert generic acknowledged observations into terminal evidence", () => {
    const input = add(snapshot(), "ack", { kind: "acknowledged" });
    expect(reconcileWorkerTurn(input)).toMatchObject({
      state: "unresolved",
      blockers: ["terminal_report_missing"],
      candidate: null,
    });
  });
  it.each(["unknown", "incomplete"] as const)(
    "retains %s capture disposition as a blocker",
    (captureDisposition) => {
      expect(reconcileWorkerTurn({ ...add(snapshot()), captureDisposition })).toMatchObject({
        state: "unresolved",
        blockers: ["capture_unsettled"],
        candidate: null,
      });
    }
  );
  it("refuses an outcome when the referenced artifact is unavailable", () => {
    const input = add(snapshot());
    input.artifacts = [];
    expect(reconcileWorkerTurn(input)).toMatchObject({
      state: "unresolved",
      blockers: ["artifact_missing"],
      candidate: null,
    });
  });
  it("preserves conflicting turns, outcomes and evidence without last-writer selection", () => {
    const input = add(add(snapshot()), "later", { turnId: "other-turn", kind: "failed" });
    const result = reconcileWorkerTurn(input);
    expect(result).toMatchObject({
      state: "unresolved",
      blockers: ["evidence_conflict", "outcome_conflict", "turn_conflict"],
      candidate: null,
    });
    expect(
      reconcileWorkerTurn({
        ...input,
        observations: [...input.observations].reverse(),
        artifacts: [...input.artifacts].reverse(),
      })
    ).toEqual(result);
  });
  it("does not choose between different artifacts claiming the same outcome", () => {
    const input = add(add(snapshot()), "other", {}, "different output");
    expect(reconcileWorkerTurn(input).blockers).toEqual(["evidence_conflict"]);
  });
  it("retains exact duplicate evidence with distinct provenance and stable order", () => {
    const input = add(add(snapshot(), "z"), "a");
    const result = reconcileWorkerTurn(input);
    expect(result.candidate?.observationIds).toEqual(["a", "z"]);
    expect(
      reconcileWorkerTurn({
        ...input,
        observations: [...input.observations].reverse(),
        artifacts: [...input.artifacts].reverse(),
      })
    ).toEqual(result);
    const changed = structuredClone(input);
    changed.dispatch.acknowledgement!.observedAt = "2026-09-01T00:00:02Z";
    expect(reconcileWorkerTurn(changed).snapshotHash).not.toBe(result.snapshotHash);
  });
  it("rejects altered report hashes and copied bindings", () => {
    const input = add(snapshot());
    input.observations[0].summary = "rewritten";
    expect(() => reconcileWorkerTurn(input)).toThrow("observation_hash_mismatch");
    const mismatched = add(snapshot());
    mismatched.observations[0].attemptId = "other";
    expect(() => reconcileWorkerTurn(mismatched)).toThrow("observation_binding_mismatch");
  });
  it("rejects corrupt, duplicated and orphaned artifacts", () => {
    const input = add(snapshot());
    input.artifacts[0].notificationJson = "{}";
    expect(() => reconcileWorkerTurn(input)).toThrow("artifact_hash_mismatch");
    const duplicate = add(snapshot());
    duplicate.artifacts.push(duplicate.artifacts[0]);
    expect(() => reconcileWorkerTurn(duplicate)).toThrow("duplicate_artifact");
    const orphan = add(snapshot());
    orphan.artifacts[0].observationId = "other";
    expect(() => reconcileWorkerTurn(orphan)).toThrow("orphan_artifact");
    const reports = add(snapshot());
    reports.observations.push(reports.observations[0]);
    expect(() => reconcileWorkerTurn(reports)).toThrow("duplicate_observation");
  });
  it("rejects an artifact whose digest matches but whose event contradicts the report", () => {
    const input = add(snapshot(), "obs", {
      evidenceHash: turnEvidenceHash(
        JSON.stringify({
          method: "turn/completed",
          params: { threadId: "other", turn: { id: "turn/α", status: "completed" } },
        })
      ),
    });
    input.artifacts[0].notificationJson = JSON.stringify({
      method: "turn/completed",
      params: { threadId: "other", turn: { id: "turn/α", status: "completed" } },
    });
    expect(() => reconcileWorkerTurn(input)).toThrow("artifact_observation_mismatch");
  });
  it("rejects invalid chronology and oversized snapshots", () => {
    const input = add(snapshot());
    input.dispatch.acknowledgement!.observedAt = "2026-08-01T00:00:00Z";
    expect(() => reconcileWorkerTurn(input)).toThrow("invalid_acknowledgement_time");
    const oversized = add(snapshot());
    oversized.artifacts[0].notificationJson = "🐦".repeat(300000);
    expect(() => reconcileWorkerTurn(oversized)).toThrow("reconciliation_evidence_limit");
    const many = add(snapshot());
    many.observations = Array(129).fill(many.observations[0]);
    expect(() => reconcileWorkerTurn(many)).toThrow("invalid_reconciliation_snapshot");
  });
});
