import { InMemoryWorkspaceLifecycleStore } from "./workspace-lifecycle-store.js";
import {
  dispatchWorkerInput,
  reduceWorkerDispatch,
  type WorkerDispatchStore,
  type WorkerDispatchRecord,
  type ClaimWorkerDispatchInput,
  type AcknowledgeWorkerDispatchInput,
  type WorkerDispatchResult,
} from "../worker-dispatch-store.js";

export class InMemoryWorkerDispatchStore
  extends InMemoryWorkspaceLifecycleStore
  implements WorkerDispatchStore
{
  private readonly dispatches = new Map<string, WorkerDispatchRecord>();

  async getWorkerDispatch(sessionId: string): Promise<WorkerDispatchRecord | null> {
    return structuredClone(this.dispatches.get(sessionId) ?? null);
  }
  async claimWorkerDispatch(input: ClaimWorkerDispatchInput): Promise<WorkerDispatchResult> {
    return this.mutateDispatch(input);
  }
  async acknowledgeWorkerDispatch(
    input: AcknowledgeWorkerDispatchInput
  ): Promise<WorkerDispatchResult> {
    return this.mutateDispatch(input, { turnId: input.turnId });
  }
  private mutateDispatch(
    input: ClaimWorkerDispatchInput,
    acknowledgement?: { turnId: string }
  ): WorkerDispatchResult {
    const result = this.withLiveWorkerSession(dispatchWorkerInput(input), (session) => {
      const result = reduceWorkerDispatch(
        input,
        session,
        this.dispatches.get(session.sessionId) ?? null,
        acknowledgement
      );
      if (result.recorded) this.dispatches.set(session.sessionId, structuredClone(result.record));
      return result;
    });
    return "updated" in result ? { recorded: false, reason: result.reason } : result;
  }
}
