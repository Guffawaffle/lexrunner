import { describe, expect, it, vi } from "vitest";

import {
  AttemptAwaitableSupervisor,
  type AttemptAwaitableNotifier,
  type AttemptAwaitableObserver,
} from "../../src/runs/attempt-awaitable-supervisor.js";
import {
  AxfExternalAwaitResult_v1,
  ExternalAwaitableDescriptor_v1,
  deliveryIdForAttemptAwaitable,
  type AttemptAwaitableCompletion_v1,
} from "../../src/runs/attempt-awaitable-contract.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { InMemoryAttemptAwaitableStore } from "../../src/store/inmemory/attempt-awaitable-store.js";

const T0 = "2026-08-12T12:00:00.000Z";
const T1 = "2026-08-12T12:00:01.000Z";
const T2 = "2026-08-12T12:00:02.000Z";

describe("AttemptAwaitableSupervisor", () => {
  it("registers without blocking and delivers the terminal AXF result", async () => {
    const store = await liveStore();
    const observation = deferred<ReturnType<typeof axfResult>>();
    let calls = 0;
    const observer: AttemptAwaitableObserver = {
      async observe() {
        calls += 1;
        return observation.promise;
      },
    };
    const completions: AttemptAwaitableCompletion_v1[] = [];
    const supervisor = createSupervisor(store, observer, {
      async deliver(completion) {
        completions.push(completion);
      },
    });

    const registration = await supervisor.register({
      awaitableId: "awaitable-async",
      attemptId: "attempt-1",
      descriptor: descriptor(),
      deadlineMs: 60_000,
      mutationId: "register-async",
    });
    expect(registration).toMatchObject({
      registration: { registered: true },
      attachment: "attached",
    });
    expect(calls).toBe(1);
    expect(await supervisor.get("awaitable-async")).toMatchObject({ status: "observing" });

    observation.resolve(axfResult("satisfied"));
    await supervisor.wait("awaitable-async");
    expect(await supervisor.get("awaitable-async")).toMatchObject({
      status: "satisfied",
      delivery: { status: "delivered", attempt_count: 1 },
    });
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      delivery_id: deliveryIdForAttemptAwaitable("awaitable-async"),
      attempt_id: "attempt-1",
      result: { source: "observer", outcome: "satisfied" },
    });
    await supervisor.shutdown();
    await store.close();
  });

  it("replays an unacknowledged notification at least once with the same delivery ID", async () => {
    const store = await liveStore();
    const firstDeliveries: string[] = [];
    const first = createSupervisor(store, immediateObserver("satisfied"), {
      async deliver(completion) {
        firstDeliveries.push(completion.delivery_id);
        throw new Error("continuation host unavailable");
      },
    });
    await first.register({
      awaitableId: "awaitable-replay",
      attemptId: "attempt-1",
      descriptor: descriptor(),
      deadlineMs: 60_000,
      mutationId: "register-replay",
    });
    await first.wait("awaitable-replay");
    expect(await first.get("awaitable-replay")).toMatchObject({
      delivery: { status: "pending", attempt_count: 1 },
    });
    await first.shutdown();

    const recoveredDeliveries: string[] = [];
    const recovered = createSupervisor(store, immediateObserver("satisfied"), {
      async deliver(completion) {
        recoveredDeliveries.push(completion.delivery_id);
      },
    });
    expect(await recovered.recover()).toMatchObject({
      observations: [],
      deliveries: ["awaitable-replay"],
    });
    await recovered.wait("awaitable-replay");
    expect(firstDeliveries).toEqual([deliveryIdForAttemptAwaitable("awaitable-replay")]);
    expect(recoveredDeliveries).toEqual([deliveryIdForAttemptAwaitable("awaitable-replay")]);
    expect(await recovered.get("awaitable-replay")).toMatchObject({
      delivery: { status: "delivered", attempt_count: 2 },
    });
    await recovered.shutdown();
    await store.close();
  });

  it("releases observation authority on shutdown so a later host can recover it", async () => {
    const store = await liveStore();
    const observer: AttemptAwaitableObserver = {
      observe({ signal }) {
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("interrupted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        });
      },
    };
    const first = createSupervisor(store, observer, noOpNotifier());
    await first.register({
      awaitableId: "awaitable-recover",
      attemptId: "attempt-1",
      descriptor: descriptor(),
      deadlineMs: 60_000,
      mutationId: "register-recover",
    });
    await first.shutdown();
    expect(await first.get("awaitable-recover")).toMatchObject({
      status: "registered",
      observer_lease: undefined,
    });

    const second = createSupervisor(
      store,
      immediateObserver("satisfied"),
      noOpNotifier(),
      "recovered"
    );
    expect(await second.recover()).toMatchObject({ observations: ["awaitable-recover"] });
    await second.wait("awaitable-recover");
    expect(await second.get("awaitable-recover")).toMatchObject({
      status: "satisfied",
      delivery: { status: "delivered" },
    });
    await second.shutdown();
    await store.close();
  });

  it("schedules one lease-expiry wake when restart happens before the dead host lease expires", async () => {
    vi.useFakeTimers();
    const store = await liveStore();
    try {
      const registered = await store.registerAttemptAwaitable({
        awaitableId: "awaitable-early-restart",
        attemptId: "attempt-1",
        descriptor: descriptor(),
        deadlineAt: "2026-08-12T12:01:00.000Z",
        mutationId: "register-early-restart",
        now: T0,
      });
      if (!registered.registered) throw new Error("registration failed");
      const abandoned = await store.claimAttemptAwaitableObservation({
        awaitableId: "awaitable-early-restart",
        expectedRevision: registered.record.revision,
        observerId: "dead-host",
        leaseId: "dead-host-lease",
        ttlMs: 1_000,
        mutationId: "dead-host-claim",
        now: T0,
      });
      if (!abandoned.claimed) throw new Error("abandoned claim failed");

      let current = T0;
      let observerCalls = 0;
      const recovered = new AttemptAwaitableSupervisor(
        store,
        {
          async observe({ deadlineMs }) {
            observerCalls += 1;
            return axfResult("satisfied", deadlineMs);
          },
        },
        noOpNotifier(),
        {
          observerId: "recovery-host",
          now: () => current,
          createLeaseId: () => "recovery-host-lease",
        }
      );
      expect(await recovered.recover()).toMatchObject({
        observations: [],
        heldByOther: ["awaitable-early-restart"],
      });
      expect(observerCalls).toBe(0);

      current = T2;
      await vi.advanceTimersByTimeAsync(1_001);
      await recovered.wait("awaitable-early-restart");
      expect(observerCalls).toBe(1);
      expect(await recovered.get("awaitable-early-restart")).toMatchObject({
        status: "satisfied",
        delivery: { status: "delivered" },
      });
      await recovered.shutdown();
    } finally {
      vi.useRealTimers();
      await store.close();
    }
  });

  it("turns an already elapsed durable deadline into a LexRunner-owned terminal event", async () => {
    const store = await liveStore();
    const registered = await store.registerAttemptAwaitable({
      awaitableId: "awaitable-deadline",
      attemptId: "attempt-1",
      descriptor: descriptor(),
      deadlineAt: T1,
      mutationId: "register-deadline",
      now: T0,
    });
    if (!registered.registered) throw new Error("registration failed");
    let observerCalls = 0;
    const supervisor = new AttemptAwaitableSupervisor(
      store,
      {
        async observe() {
          observerCalls += 1;
          return axfResult("satisfied");
        },
      },
      noOpNotifier(),
      {
        observerId: "observer-deadline",
        now: () => T2,
        createLeaseId: () => "lease-deadline",
      }
    );
    expect(await supervisor.attach("awaitable-deadline")).toBe("attached");
    await supervisor.wait("awaitable-deadline");
    expect(observerCalls).toBe(0);
    expect(await supervisor.get("awaitable-deadline")).toMatchObject({
      status: "deadline",
      result: {
        source: "lexrunner",
        outcome: "deadline",
        reason_code: "deadline_elapsed",
      },
      delivery: { status: "delivered" },
    });
    await supervisor.shutdown();
    await store.close();
  });

  it("treats explicit cancellation as terminal without cancelling the external operation", async () => {
    const store = await liveStore();
    const observer: AttemptAwaitableObserver = {
      observe({ signal }) {
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("host observation stopped")), {
            once: true,
          });
        });
      },
    };
    const supervisor = createSupervisor(store, observer, noOpNotifier());
    await supervisor.register({
      awaitableId: "awaitable-cancel",
      attemptId: "attempt-1",
      descriptor: descriptor(),
      deadlineMs: 60_000,
      mutationId: "register-cancel",
    });
    expect(await supervisor.cancel("awaitable-cancel", "cancel-1")).toMatchObject({
      updated: true,
      record: { status: "cancelled" },
    });
    await supervisor.wait("awaitable-cancel");
    expect(await supervisor.get("awaitable-cancel")).toMatchObject({
      status: "cancelled",
      result: { source: "lexrunner", reason_code: "operator_cancelled" },
      delivery: { status: "delivered" },
    });
    await supervisor.shutdown();
    await store.close();
  });
});

function createSupervisor(
  store: InMemoryAttemptAwaitableStore,
  observer: AttemptAwaitableObserver,
  notifier: AttemptAwaitableNotifier,
  identity = "primary"
) {
  return new AttemptAwaitableSupervisor(store, observer, notifier, {
    observerId: `observer-${identity}`,
    now: () => T0,
    createLeaseId: (awaitableId) => `${awaitableId}:lease:${identity}`,
  });
}

function descriptor() {
  return ExternalAwaitableDescriptor_v1.parse({
    schemaVersion: "axf/awaitable/v1",
    kind: "github.required-checks",
    subject: { repository: "owner/repo", headSha: "a".repeat(40) },
    condition: {
      type: "all-required-checks-terminal",
      requiredChecks: [{ source: "check-run", name: "Windows" }],
    },
  });
}

function axfResult(outcome: "satisfied" | "terminal-failed", effectiveDeadlineMs = 60_000) {
  return AxfExternalAwaitResult_v1.parse({
    schemaVersion: "axf/await-result/v1",
    provider: "github.required-checks",
    outcome,
    terminal: true,
    durability: "process-bound",
    authorityModel: "host-provided",
    underlyingCancellation: false,
    effectiveDeadlineMs,
    observationCount: 1,
    evidence: { headSha: "a".repeat(40) },
  });
}

function immediateObserver(outcome: "satisfied" | "terminal-failed"): AttemptAwaitableObserver {
  return {
    async observe({ deadlineMs }) {
      return axfResult(outcome, deadlineMs);
    },
  };
}

function noOpNotifier(): AttemptAwaitableNotifier {
  return { async deliver() {} };
}

async function liveStore(): Promise<InMemoryAttemptAwaitableStore> {
  const store = new InMemoryAttemptAwaitableStore();
  const acquired = await store.acquireControllerLease({
    runId: "run-1",
    controllerId: "controller-1",
    leaseId: "controller-lease-1",
    now: T0,
    ttlMs: 60_000,
    initialState: {},
  });
  if (!acquired.acquired) throw new Error("controller setup failed");
  const created = await store.createAttempt({
    runId: "run-1",
    controller: acquired.lease,
    expectedRunRevision: 0,
    mutationId: "create-attempt-1",
    now: T0,
    attemptId: "attempt-1",
    workItemId: "work-1",
    workItemRevision: 1,
    packetId: "packet-1",
    packetHash: computeCanonicalHash({ packet: 1 }),
    baseSha: "a".repeat(40),
  });
  if (!created.updated) throw new Error("attempt setup failed");
  return store;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
