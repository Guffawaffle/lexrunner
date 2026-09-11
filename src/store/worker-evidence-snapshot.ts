import type { WorkerDispatchRecord } from "./worker-dispatch-store.js";
import type { WorkerObservationRecord } from "./worker-observation-store.js";

/** One store view. Does not attest to external capture completeness or current authority. */
export interface WorkerEvidenceSnapshot {
  dispatch: WorkerDispatchRecord;
  observations: WorkerObservationRecord[];
  artifacts: Array<{ observationId: string; notificationJson: string }>;
}
export interface WorkerEvidenceSnapshotStore {
  getWorkerEvidenceSnapshot(sessionId: string): Promise<WorkerEvidenceSnapshot | null>;
}
