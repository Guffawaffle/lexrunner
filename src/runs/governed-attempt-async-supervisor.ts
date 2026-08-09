import type { AttemptExecutor } from "./governed-attempt-executor.js";
import {
  GovernedAttemptOperationService,
  type ObserveGovernedAttemptOperationResult,
} from "./governed-attempt-operation-service.js";
import type {
  GovernedAttemptOperationRecord_v1,
  GovernedAttemptOperationStore,
} from "../store/governed-attempt-operation-store.js";
import type { GovernedDelegationStore } from "../store/governed-delegation-store.js";

type GovernedOperationStore = GovernedAttemptOperationStore & GovernedDelegationStore;

export type GovernedAttemptExecutorResolver = (
  record: GovernedAttemptOperationRecord_v1
) => Promise<AttemptExecutor | null>;

export interface GovernedAttemptObservationNotice {
  operationId: string;
  result?: ObserveGovernedAttemptOperationResult;
  errorCode?: "executor_unavailable" | "observation_failed" | "verification_failed";
}

export interface GovernedAttemptAsyncSupervisorOptions {
  onNotice?: (notice: GovernedAttemptObservationNotice) => void | Promise<void>;
  verifyCompleted?: (operationId: string) => Promise<void>;
}

/**
 * Restart recovery and completion wake-up for governed operations. It performs
 * one durable inventory read at startup, then each live operation waits on its
 * executor's AsyncIterable. There is no heartbeat or status polling loop.
 */
export class GovernedAttemptAsyncSupervisor {
  private readonly observations = new Map<
    string,
    { controller: AbortController; completion: Promise<void> }
  >();
  private readonly service: GovernedAttemptOperationService;
  private stopping = false;

  constructor(
    private readonly store: GovernedOperationStore,
    private readonly resolveExecutor: GovernedAttemptExecutorResolver,
    private readonly options: GovernedAttemptAsyncSupervisorOptions = {}
  ) {
    this.service = new GovernedAttemptOperationService(store);
  }

  async recover(): Promise<{ attached: string[]; unavailable: string[] }> {
    if (this.stopping) return { attached: [], unavailable: [] };
    const attached: string[] = [];
    const unavailable: string[] = [];
    for (const record of await this.store.listRecoverableAttemptOperations()) {
      const outcome = await this.attach(record.operation_id);
      if (outcome === "attached" || outcome === "already_attached") {
        attached.push(record.operation_id);
      } else if (outcome === "executor_unavailable") {
        unavailable.push(record.operation_id);
      }
    }
    return { attached, unavailable };
  }

  async attach(
    operationId: string
  ): Promise<"attached" | "already_attached" | "not_recoverable" | "executor_unavailable"> {
    if (this.stopping) return "not_recoverable";
    if (this.observations.has(operationId)) return "already_attached";
    const record = await this.store.getAttemptOperation(operationId);
    if (
      !record ||
      (record.status !== "running" &&
        !(record.status === "completed" && !record.result) &&
        !(
          record.status === "completed" &&
          record.result &&
          record.verification_context &&
          !record.verification &&
          this.options.verifyCompleted
        ))
    ) {
      return "not_recoverable";
    }
    if (
      record.status === "completed" &&
      record.result &&
      record.verification_context &&
      !record.verification &&
      this.options.verifyCompleted
    ) {
      const completion = this.verify(operationId).finally(() => {
        this.observations.delete(operationId);
      });
      this.observations.set(operationId, { controller: new AbortController(), completion });
      return "attached";
    }
    const executor = await this.resolveExecutor(record);
    if (!executor) {
      await this.notice({ operationId, errorCode: "executor_unavailable" });
      return "executor_unavailable";
    }
    const controller = new AbortController();
    const completion = (
      record.status === "completed"
        ? this.collect(operationId, executor)
        : this.observe(operationId, executor, controller.signal)
    ).finally(() => {
      this.observations.delete(operationId);
    });
    this.observations.set(operationId, { controller, completion });
    return "attached";
  }

  isAttached(operationId: string): boolean {
    return this.observations.has(operationId);
  }

  async wait(operationId: string): Promise<void> {
    await this.observations.get(operationId)?.completion;
  }

  stop(): void {
    this.stopping = true;
    for (const observation of this.observations.values()) observation.controller.abort();
  }

  private async observe(
    operationId: string,
    executor: AttemptExecutor,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const result = await this.service.observeToTerminal(executor, operationId, signal);
      await this.notice({ operationId, result });
      if (result.terminal && result.status === "completed" && result.result) {
        await this.verify(operationId);
      }
    } catch {
      await this.notice({ operationId, errorCode: "observation_failed" });
    }
  }

  private async collect(operationId: string, executor: AttemptExecutor): Promise<void> {
    try {
      const result = await this.service.collectCompleted(executor, operationId);
      await this.notice({ operationId, result });
      if (result.terminal && result.status === "completed" && result.result) {
        await this.verify(operationId);
      }
    } catch {
      await this.notice({ operationId, errorCode: "observation_failed" });
    }
  }

  private async notice(notice: GovernedAttemptObservationNotice): Promise<void> {
    await this.options.onNotice?.(notice);
  }

  private async verify(operationId: string): Promise<void> {
    if (!this.options.verifyCompleted) return;
    try {
      await this.options.verifyCompleted(operationId);
    } catch {
      await this.notice({ operationId, errorCode: "verification_failed" });
    }
  }
}
