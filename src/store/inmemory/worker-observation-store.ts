import { InMemoryWorkerDispatchStore } from "./worker-dispatch-store.js";
import {
  parseWorkerObservation,
  reduceWorkerObservation,
  type WorkerObservationStore,
  type WorkerObservationInput,
  type WorkerObservationRecord,
  type WorkerObservationResult,
} from "../worker-observation-store.js";

export class InMemoryWorkerObservationStore
  extends InMemoryWorkerDispatchStore
  implements WorkerObservationStore
{
  private readonly observations = new Map<string, WorkerObservationRecord[]>();
  async listWorkerObservations(sessionId: string): Promise<WorkerObservationRecord[]> {
    return structuredClone(this.observations.get(sessionId) ?? []);
  }
  async recordWorkerObservation(
    input: WorkerObservationInput,
    recordedAt: string
  ): Promise<WorkerObservationResult> {
    const parsed = parseWorkerObservation(input, recordedAt);
    const dispatch = await this.getWorkerDispatch(parsed.sessionId);
    // No await from the journal read through append. Dispatch identity cannot change.
    const prior = this.observations.get(parsed.sessionId) ?? [];
    const result = reduceWorkerObservation(parsed, recordedAt, dispatch, prior);
    if (result.recorded && !result.replay)
      this.observations.set(parsed.sessionId, [...prior, structuredClone(result.record)]);
    return result;
  }
}
