/**
 * InMemoryRunStore Unit Tests
 *
 * Verifies the InMemoryRunStore implements the RunStore contract correctly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRunStore } from "../../../src/store/inmemory/index.js";
import type { RunRecord, StepOutcome, Receipt } from "../../../src/store/run-store.js";

describe("InMemoryRunStore", () => {
  let store: InMemoryRunStore;

  // Helper to create valid run records
  const createRunRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    planHash: "sha256:abc123",
    state: "pending",
    startedAt: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create valid step outcomes
  const createStepOutcome = (overrides: Partial<StepOutcome> = {}): StepOutcome => ({
    stepId: `step-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    runId: "run-001",
    nodeId: "node-1",
    gateName: "lint",
    status: "pass",
    durationMs: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create valid receipts
  const createReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
    receiptId: `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    runId: "run-001",
    reason: "Scope expanded beyond initial plan",
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryRunStore();
  });

  describe("constructor", () => {
    it("should create an empty store by default", async () => {
      expect(await store.getRunCount()).toBe(0);
    });

    it("should pre-populate with runs", async () => {
      const runs = [createRunRecord({ runId: "run-1" }), createRunRecord({ runId: "run-2" })];
      store = new InMemoryRunStore({ runs });

      expect(await store.getRunCount()).toBe(2);
      expect(await store.getRun("run-1")).not.toBeNull();
      expect(await store.getRun("run-2")).not.toBeNull();
    });

    it("should pre-populate with steps", async () => {
      const steps = [
        createStepOutcome({ stepId: "step-1", runId: "run-1" }),
        createStepOutcome({ stepId: "step-2", runId: "run-1" }),
      ];
      store = new InMemoryRunStore({ steps });

      const runSteps = await store.getStepsForRun("run-1");
      expect(runSteps).toHaveLength(2);
    });

    it("should pre-populate with receipts", async () => {
      const receipts = [createReceipt({ receiptId: "receipt-1", runId: "run-1" })];
      store = new InMemoryRunStore({ receipts });

      const runReceipts = await store.getReceiptsForRun("run-1");
      expect(runReceipts).toHaveLength(1);
    });

    it("should pre-populate with all data types", async () => {
      const runs = [createRunRecord({ runId: "run-1" })];
      const steps = [createStepOutcome({ runId: "run-1" })];
      const receipts = [createReceipt({ runId: "run-1" })];

      store = new InMemoryRunStore({ runs, steps, receipts });

      expect(await store.getRunCount()).toBe(1);
      expect(await store.getStepsForRun("run-1")).toHaveLength(1);
      expect(await store.getReceiptsForRun("run-1")).toHaveLength(1);
    });
  });

  describe("createRun", () => {
    it("should create a new run", async () => {
      const run = createRunRecord({ runId: "run-001" });

      await store.createRun(run);

      const retrieved = await store.getRun("run-001");
      expect(retrieved).toEqual(run);
    });

    it("should throw error for duplicate runId", async () => {
      const run = createRunRecord({ runId: "run-001" });

      await store.createRun(run);

      await expect(store.createRun(run)).rejects.toThrow('Run with runId "run-001" already exists');
    });
  });

  describe("getRun", () => {
    it("should return run record by ID", async () => {
      const run = createRunRecord({ runId: "run-001" });
      await store.createRun(run);

      const retrieved = await store.getRun("run-001");

      expect(retrieved).toEqual(run);
    });

    it("should return null for unknown runId", async () => {
      const retrieved = await store.getRun("unknown-run");

      expect(retrieved).toBeNull();
    });
  });

  describe("updateRun", () => {
    it("should update run state", async () => {
      const run = createRunRecord({ runId: "run-001", state: "pending" });
      await store.createRun(run);

      await store.updateRun("run-001", { state: "running" });

      const updated = await store.getRun("run-001");
      expect(updated?.state).toBe("running");
    });

    it("should preserve unchanged fields", async () => {
      const run = createRunRecord({
        runId: "run-001",
        state: "pending",
        planHash: "sha256:original",
      });
      await store.createRun(run);

      await store.updateRun("run-001", { state: "running" });

      const updated = await store.getRun("run-001");
      expect(updated?.planHash).toBe("sha256:original");
      expect(updated?.startedAt).toBe(run.startedAt);
    });

    it("should update completedAt", async () => {
      const run = createRunRecord({ runId: "run-001", state: "pending" });
      await store.createRun(run);
      const completedAt = new Date().toISOString();

      await store.updateRun("run-001", { state: "completed", completedAt });

      const updated = await store.getRun("run-001");
      expect(updated?.state).toBe("completed");
      expect(updated?.completedAt).toBe(completedAt);
    });

    it("should throw error for unknown runId", async () => {
      await expect(store.updateRun("unknown-run", { state: "running" })).rejects.toThrow(
        'Run with runId "unknown-run" not found'
      );
    });
  });

  describe("listRuns", () => {
    it("should list all runs when no options", async () => {
      await store.createRun(createRunRecord({ runId: "run-1" }));
      await store.createRun(createRunRecord({ runId: "run-2" }));
      await store.createRun(createRunRecord({ runId: "run-3" }));

      const runs = await store.listRuns();

      expect(runs).toHaveLength(3);
    });

    it("should filter by state", async () => {
      await store.createRun(createRunRecord({ runId: "run-1", state: "pending" }));
      await store.createRun(createRunRecord({ runId: "run-2", state: "running" }));
      await store.createRun(createRunRecord({ runId: "run-3", state: "pending" }));

      const runs = await store.listRuns({ state: "pending" });

      expect(runs).toHaveLength(2);
      runs.forEach((run) => expect(run.state).toBe("pending"));
    });

    it("should apply limit", async () => {
      await store.createRun(createRunRecord({ runId: "run-1" }));
      await store.createRun(createRunRecord({ runId: "run-2" }));
      await store.createRun(createRunRecord({ runId: "run-3" }));

      const runs = await store.listRuns({ limit: 2 });

      expect(runs).toHaveLength(2);
    });

    it("should apply offset", async () => {
      await store.createRun(
        createRunRecord({
          runId: "run-1",
          startedAt: "2024-01-01T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-2",
          startedAt: "2024-01-02T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-3",
          startedAt: "2024-01-03T10:00:00.000Z",
        })
      );

      const runs = await store.listRuns({ offset: 1 });

      expect(runs).toHaveLength(2);
      // Sorted by startedAt descending, so run-3 first, then skip 1
      expect(runs[0].runId).toBe("run-2");
      expect(runs[1].runId).toBe("run-1");
    });

    it("should apply both limit and offset", async () => {
      await store.createRun(
        createRunRecord({
          runId: "run-1",
          startedAt: "2024-01-01T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-2",
          startedAt: "2024-01-02T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-3",
          startedAt: "2024-01-03T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-4",
          startedAt: "2024-01-04T10:00:00.000Z",
        })
      );

      const runs = await store.listRuns({ offset: 1, limit: 2 });

      expect(runs).toHaveLength(2);
      expect(runs[0].runId).toBe("run-3");
      expect(runs[1].runId).toBe("run-2");
    });

    it("should return empty array when no runs exist", async () => {
      const runs = await store.listRuns();

      expect(runs).toEqual([]);
    });

    it("should return runs sorted by startedAt descending", async () => {
      await store.createRun(
        createRunRecord({
          runId: "run-1",
          startedAt: "2024-01-01T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-2",
          startedAt: "2024-01-03T10:00:00.000Z",
        })
      );
      await store.createRun(
        createRunRecord({
          runId: "run-3",
          startedAt: "2024-01-02T10:00:00.000Z",
        })
      );

      const runs = await store.listRuns();

      expect(runs[0].runId).toBe("run-2"); // newest
      expect(runs[1].runId).toBe("run-3");
      expect(runs[2].runId).toBe("run-1"); // oldest
    });
  });

  describe("appendStep", () => {
    it("should append step to run", async () => {
      const step = createStepOutcome({ runId: "run-001" });

      await store.appendStep(step);

      const steps = await store.getStepsForRun("run-001");
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual(step);
    });

    it("should append multiple steps to same run", async () => {
      const step1 = createStepOutcome({ stepId: "step-1", runId: "run-001" });
      const step2 = createStepOutcome({ stepId: "step-2", runId: "run-001" });

      await store.appendStep(step1);
      await store.appendStep(step2);

      const steps = await store.getStepsForRun("run-001");
      expect(steps).toHaveLength(2);
    });

    it("should keep steps for different runs separate", async () => {
      const step1 = createStepOutcome({ runId: "run-001" });
      const step2 = createStepOutcome({ runId: "run-002" });

      await store.appendStep(step1);
      await store.appendStep(step2);

      expect(await store.getStepsForRun("run-001")).toHaveLength(1);
      expect(await store.getStepsForRun("run-002")).toHaveLength(1);
    });
  });

  describe("getStepsForRun", () => {
    it("should return steps for run", async () => {
      const step = createStepOutcome({ runId: "run-001" });
      await store.appendStep(step);

      const steps = await store.getStepsForRun("run-001");

      expect(steps).toEqual([step]);
    });

    it("should return empty array for unknown runId", async () => {
      const steps = await store.getStepsForRun("unknown-run");

      expect(steps).toEqual([]);
    });
  });

  describe("saveReceipt", () => {
    it("should save receipt", async () => {
      const receipt = createReceipt({ runId: "run-001" });

      await store.saveReceipt(receipt);

      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toEqual(receipt);
    });

    it("should save multiple receipts for same run", async () => {
      const receipt1 = createReceipt({ receiptId: "r1", runId: "run-001" });
      const receipt2 = createReceipt({ receiptId: "r2", runId: "run-001" });

      await store.saveReceipt(receipt1);
      await store.saveReceipt(receipt2);

      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts).toHaveLength(2);
    });
  });

  describe("getReceiptsForRun", () => {
    it("should return receipts for run", async () => {
      const receipt = createReceipt({ runId: "run-001" });
      await store.saveReceipt(receipt);

      const receipts = await store.getReceiptsForRun("run-001");

      expect(receipts).toEqual([receipt]);
    });

    it("should return empty array for unknown runId", async () => {
      const receipts = await store.getReceiptsForRun("unknown-run");

      expect(receipts).toEqual([]);
    });
  });

  describe("getRunCount", () => {
    it("should return total count when no state filter", async () => {
      await store.createRun(createRunRecord({ runId: "run-1", state: "pending" }));
      await store.createRun(createRunRecord({ runId: "run-2", state: "running" }));

      const count = await store.getRunCount();

      expect(count).toBe(2);
    });

    it("should return filtered count when state provided", async () => {
      await store.createRun(createRunRecord({ runId: "run-1", state: "pending" }));
      await store.createRun(createRunRecord({ runId: "run-2", state: "running" }));
      await store.createRun(createRunRecord({ runId: "run-3", state: "pending" }));

      const count = await store.getRunCount("pending");

      expect(count).toBe(2);
    });

    it("should return 0 when no runs exist", async () => {
      const count = await store.getRunCount();

      expect(count).toBe(0);
    });
  });

  describe("close", () => {
    it("should be a no-op (does not throw)", async () => {
      await expect(store.close()).resolves.not.toThrow();
    });
  });

  describe("clear (test helper)", () => {
    it("should clear all data", async () => {
      await store.createRun(createRunRecord({ runId: "run-001" }));
      await store.appendStep(createStepOutcome({ runId: "run-001" }));
      await store.saveReceipt(createReceipt({ runId: "run-001" }));

      store.clear();

      expect(await store.getRunCount()).toBe(0);
      expect(await store.getStepsForRun("run-001")).toEqual([]);
      expect(await store.getReceiptsForRun("run-001")).toEqual([]);
    });
  });

  describe("snapshot (test helper)", () => {
    it("should return current state snapshot", async () => {
      const run = createRunRecord({ runId: "run-001" });
      const step = createStepOutcome({ runId: "run-001" });
      const receipt = createReceipt({ runId: "run-001" });

      await store.createRun(run);
      await store.appendStep(step);
      await store.saveReceipt(receipt);

      const snapshot = store.snapshot();

      expect(snapshot.runs).toEqual([run]);
      expect(snapshot.steps.get("run-001")).toEqual([step]);
      expect(snapshot.receipts.get("run-001")).toEqual([receipt]);
    });
  });

  describe("contract compliance", () => {
    it("should implement full RunStore lifecycle", async () => {
      // Create run
      const run = createRunRecord({
        runId: "lifecycle-test",
        state: "pending",
        planHash: "sha256:test123",
      });
      await store.createRun(run);

      // Update to running
      await store.updateRun("lifecycle-test", { state: "running" });
      let retrieved = await store.getRun("lifecycle-test");
      expect(retrieved?.state).toBe("running");

      // Append steps
      await store.appendStep(
        createStepOutcome({
          stepId: "step-1",
          runId: "lifecycle-test",
          gateName: "lint",
          status: "pass",
        })
      );
      await store.appendStep(
        createStepOutcome({
          stepId: "step-2",
          runId: "lifecycle-test",
          gateName: "test",
          status: "pass",
        })
      );

      // Save receipt
      await store.saveReceipt(
        createReceipt({
          receiptId: "r-1",
          runId: "lifecycle-test",
          reason: "Scope change approved",
        })
      );

      // Update to completed
      const completedAt = new Date().toISOString();
      await store.updateRun("lifecycle-test", {
        state: "completed",
        completedAt,
      });

      // Verify final state
      retrieved = await store.getRun("lifecycle-test");
      expect(retrieved?.state).toBe("completed");
      expect(retrieved?.completedAt).toBe(completedAt);

      const steps = await store.getStepsForRun("lifecycle-test");
      expect(steps).toHaveLength(2);

      const receipts = await store.getReceiptsForRun("lifecycle-test");
      expect(receipts).toHaveLength(1);

      // List runs
      const runs = await store.listRuns();
      expect(runs).toHaveLength(1);

      // Get run count
      const count = await store.getRunCount("completed");
      expect(count).toBe(1);

      // Close (no-op)
      await store.close();

      // Data should still be accessible after close for in-memory
      expect(await store.getRun("lifecycle-test")).not.toBeNull();
    });
  });
});
