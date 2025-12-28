/**
 * SqliteRunStore Unit Tests
 *
 * Tests the SQLite implementation of the RunStore interface.
 * Uses in-memory SQLite (":memory:") for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteRunStore } from "../../../src/store/sqlite/run-store.js";
import type { RunRecord, StepOutcome, Receipt } from "../../../src/store/run-store.js";

describe("SqliteRunStore", () => {
  let store: SqliteRunStore;

  beforeEach(() => {
    // Use in-memory database for speed and isolation
    store = new SqliteRunStore(":memory:");
  });

  afterEach(async () => {
    await store.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Schema Initialization
  // ─────────────────────────────────────────────────────────────────────────

  describe("schema initialization", () => {
    it("should create tables on first use", async () => {
      // If we can create a run, tables exist
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      const retrieved = await store.getRun("run-001");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.runId).toBe("run-001");
    });

    it("should be idempotent (safe to call multiple times)", async () => {
      // Create two stores pointing to same in-memory DB - not possible with :memory:
      // But we can create multiple runs to verify schema is stable
      const run1: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };
      const run2: RunRecord = {
        runId: "run-002",
        planHash: "sha256:def456",
        state: "running",
        startedAt: "2024-01-15T10:31:00.000Z",
      };

      await store.createRun(run1);
      await store.createRun(run2);

      const runs = await store.listRuns();
      expect(runs).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Run CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────

  describe("createRun", () => {
    it("should create a run with all required fields", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      const retrieved = await store.getRun("run-001");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.runId).toBe("run-001");
      expect(retrieved!.planHash).toBe("sha256:abc123");
      expect(retrieved!.state).toBe("pending");
      expect(retrieved!.startedAt).toBe("2024-01-15T10:30:00.000Z");
    });

    it("should create a run with optional completedAt", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "completed",
        startedAt: "2024-01-15T10:30:00.000Z",
        completedAt: "2024-01-15T10:35:00.000Z",
      };

      await store.createRun(run);
      const retrieved = await store.getRun("run-001");

      expect(retrieved!.completedAt).toBe("2024-01-15T10:35:00.000Z");
    });

    it("should create a run with optional metadata", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
        metadata: { prNumber: 42, author: "alice" },
      };

      await store.createRun(run);
      const retrieved = await store.getRun("run-001");

      expect(retrieved!.metadata).toEqual({ prNumber: 42, author: "alice" });
    });

    it("should throw error for duplicate runId", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);

      await expect(store.createRun(run)).rejects.toThrow("already exists");
    });
  });

  describe("getRun", () => {
    it("should return null for non-existent runId", async () => {
      const retrieved = await store.getRun("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should return the correct run by ID", async () => {
      const run1: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };
      const run2: RunRecord = {
        runId: "run-002",
        planHash: "sha256:def456",
        state: "running",
        startedAt: "2024-01-15T10:31:00.000Z",
      };

      await store.createRun(run1);
      await store.createRun(run2);

      const retrieved = await store.getRun("run-002");
      expect(retrieved!.runId).toBe("run-002");
      expect(retrieved!.planHash).toBe("sha256:def456");
    });
  });

  describe("updateRun", () => {
    it("should update run state", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      await store.updateRun("run-001", { state: "running" });

      const retrieved = await store.getRun("run-001");
      expect(retrieved!.state).toBe("running");
    });

    it("should update completedAt", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      await store.updateRun("run-001", {
        state: "completed",
        completedAt: "2024-01-15T10:35:00.000Z",
      });

      const retrieved = await store.getRun("run-001");
      expect(retrieved!.state).toBe("completed");
      expect(retrieved!.completedAt).toBe("2024-01-15T10:35:00.000Z");
    });

    it("should update metadata", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      await store.updateRun("run-001", { metadata: { updated: true } });

      const retrieved = await store.getRun("run-001");
      expect(retrieved!.metadata).toEqual({ updated: true });
    });

    it("should throw error for non-existent runId", async () => {
      await expect(store.updateRun("non-existent", { state: "running" })).rejects.toThrow(
        "not found"
      );
    });

    it("should handle empty updates gracefully", async () => {
      const run: RunRecord = {
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      };

      await store.createRun(run);
      await store.updateRun("run-001", {});

      const retrieved = await store.getRun("run-001");
      expect(retrieved!.state).toBe("pending");
    });
  });

  describe("listRuns", () => {
    beforeEach(async () => {
      // Create some test runs
      const runs: RunRecord[] = [
        {
          runId: "run-001",
          planHash: "sha256:abc123",
          state: "completed",
          startedAt: "2024-01-15T10:30:00.000Z",
        },
        {
          runId: "run-002",
          planHash: "sha256:def456",
          state: "running",
          startedAt: "2024-01-15T10:31:00.000Z",
        },
        {
          runId: "run-003",
          planHash: "sha256:ghi789",
          state: "failed",
          startedAt: "2024-01-15T10:32:00.000Z",
        },
        {
          runId: "run-004",
          planHash: "sha256:jkl012",
          state: "running",
          startedAt: "2024-01-15T10:33:00.000Z",
        },
      ];

      for (const run of runs) {
        await store.createRun(run);
      }
    });

    it("should list all runs when no options", async () => {
      const runs = await store.listRuns();
      expect(runs).toHaveLength(4);
    });

    it("should order runs by startedAt descending", async () => {
      const runs = await store.listRuns();
      expect(runs[0].runId).toBe("run-004"); // Most recent first
      expect(runs[3].runId).toBe("run-001"); // Oldest last
    });

    it("should filter by state", async () => {
      const runs = await store.listRuns({ state: "running" });
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.state === "running")).toBe(true);
    });

    it("should apply limit", async () => {
      const runs = await store.listRuns({ limit: 2 });
      expect(runs).toHaveLength(2);
    });

    it("should apply offset", async () => {
      const runs = await store.listRuns({ offset: 2 });
      expect(runs).toHaveLength(2);
      expect(runs[0].runId).toBe("run-002");
    });

    it("should combine limit and offset for pagination", async () => {
      const page1 = await store.listRuns({ limit: 2, offset: 0 });
      const page2 = await store.listRuns({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].runId).not.toBe(page2[0].runId);
    });

    it("should combine state filter with pagination", async () => {
      const runs = await store.listRuns({ state: "running", limit: 1 });
      expect(runs).toHaveLength(1);
      expect(runs[0].state).toBe("running");
    });

    it("should return empty array when no runs match", async () => {
      const runs = await store.listRuns({ state: "aborted" });
      expect(runs).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step Outcomes
  // ─────────────────────────────────────────────────────────────────────────

  describe("appendStep", () => {
    beforeEach(async () => {
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });
    });

    it("should append a step with required fields", async () => {
      const step: StepOutcome = {
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "lint",
        status: "pass",
        durationMs: 1234,
        timestamp: "2024-01-15T10:30:05.000Z",
      };

      await store.appendStep(step);
      const steps = await store.getStepsForRun("run-001");

      expect(steps).toHaveLength(1);
      expect(steps[0].stepId).toBe("step-001");
      expect(steps[0].gateName).toBe("lint");
      expect(steps[0].status).toBe("pass");
    });

    it("should append a step with optional logs", async () => {
      const step: StepOutcome = {
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "lint",
        status: "fail",
        durationMs: 1234,
        logs: "ESLint found 5 errors",
        timestamp: "2024-01-15T10:30:05.000Z",
      };

      await store.appendStep(step);
      const steps = await store.getStepsForRun("run-001");

      expect(steps[0].logs).toBe("ESLint found 5 errors");
    });

    it("should append a step with optional artifacts", async () => {
      const step: StepOutcome = {
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "test",
        status: "pass",
        durationMs: 5000,
        artifacts: ["coverage/lcov.info", "reports/junit.xml"],
        timestamp: "2024-01-15T10:30:05.000Z",
      };

      await store.appendStep(step);
      const steps = await store.getStepsForRun("run-001");

      expect(steps[0].artifacts).toEqual(["coverage/lcov.info", "reports/junit.xml"]);
    });
  });

  describe("getStepsForRun", () => {
    beforeEach(async () => {
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });
    });

    it("should return empty array for run with no steps", async () => {
      const steps = await store.getStepsForRun("run-001");
      expect(steps).toEqual([]);
    });

    it("should return steps ordered by timestamp ascending", async () => {
      const steps: StepOutcome[] = [
        {
          stepId: "step-003",
          runId: "run-001",
          nodeId: "pr-42",
          gateName: "test",
          status: "pass",
          durationMs: 3000,
          timestamp: "2024-01-15T10:30:15.000Z",
        },
        {
          stepId: "step-001",
          runId: "run-001",
          nodeId: "pr-42",
          gateName: "lint",
          status: "pass",
          durationMs: 1000,
          timestamp: "2024-01-15T10:30:05.000Z",
        },
        {
          stepId: "step-002",
          runId: "run-001",
          nodeId: "pr-42",
          gateName: "typecheck",
          status: "pass",
          durationMs: 2000,
          timestamp: "2024-01-15T10:30:10.000Z",
        },
      ];

      // Insert in non-chronological order
      for (const step of steps) {
        await store.appendStep(step);
      }

      const retrieved = await store.getStepsForRun("run-001");

      expect(retrieved[0].stepId).toBe("step-001"); // Earliest
      expect(retrieved[1].stepId).toBe("step-002");
      expect(retrieved[2].stepId).toBe("step-003"); // Latest
    });

    it("should return empty array for non-existent run", async () => {
      const steps = await store.getStepsForRun("non-existent");
      expect(steps).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Receipts
  // ─────────────────────────────────────────────────────────────────────────

  describe("saveReceipt", () => {
    beforeEach(async () => {
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });
    });

    it("should save a receipt with required fields", async () => {
      const receipt: Receipt = {
        receiptId: "receipt-001",
        runId: "run-001",
        reason: "Scope expanded beyond initial plan",
        timestamp: "2024-01-15T10:31:00.000Z",
      };

      await store.saveReceipt(receipt);
      const receipts = await store.getReceiptsForRun("run-001");

      expect(receipts).toHaveLength(1);
      expect(receipts[0].receiptId).toBe("receipt-001");
      expect(receipts[0].reason).toBe("Scope expanded beyond initial plan");
    });

    it("should save a receipt with optional approver", async () => {
      const receipt: Receipt = {
        receiptId: "receipt-001",
        runId: "run-001",
        reason: "Scope expanded beyond initial plan",
        approver: "alice@example.com",
        timestamp: "2024-01-15T10:31:00.000Z",
      };

      await store.saveReceipt(receipt);
      const receipts = await store.getReceiptsForRun("run-001");

      expect(receipts[0].approver).toBe("alice@example.com");
    });
  });

  describe("getReceiptsForRun", () => {
    beforeEach(async () => {
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });
    });

    it("should return empty array for run with no receipts", async () => {
      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts).toEqual([]);
    });

    it("should return receipts ordered by timestamp", async () => {
      const receipts: Receipt[] = [
        {
          receiptId: "receipt-002",
          runId: "run-001",
          reason: "Second escalation",
          timestamp: "2024-01-15T10:32:00.000Z",
        },
        {
          receiptId: "receipt-001",
          runId: "run-001",
          reason: "First escalation",
          timestamp: "2024-01-15T10:31:00.000Z",
        },
      ];

      for (const receipt of receipts) {
        await store.saveReceipt(receipt);
      }

      const retrieved = await store.getReceiptsForRun("run-001");

      expect(retrieved[0].receiptId).toBe("receipt-001"); // Earlier
      expect(retrieved[1].receiptId).toBe("receipt-002"); // Later
    });

    it("should return empty array for non-existent run", async () => {
      const receipts = await store.getReceiptsForRun("non-existent");
      expect(receipts).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────────────────────

  describe("getRunCount", () => {
    beforeEach(async () => {
      const runs: RunRecord[] = [
        {
          runId: "run-001",
          planHash: "sha256:abc",
          state: "completed",
          startedAt: "2024-01-15T10:30:00.000Z",
        },
        {
          runId: "run-002",
          planHash: "sha256:def",
          state: "running",
          startedAt: "2024-01-15T10:31:00.000Z",
        },
        {
          runId: "run-003",
          planHash: "sha256:ghi",
          state: "running",
          startedAt: "2024-01-15T10:32:00.000Z",
        },
      ];

      for (const run of runs) {
        await store.createRun(run);
      }
    });

    it("should return total count when no filter", async () => {
      const count = await store.getRunCount();
      expect(count).toBe(3);
    });

    it("should return filtered count by state", async () => {
      const count = await store.getRunCount("running");
      expect(count).toBe(2);
    });

    it("should return 0 when no matches", async () => {
      const count = await store.getRunCount("aborted");
      expect(count).toBe(0);
    });
  });

  describe("close", () => {
    it("should close without error", async () => {
      await expect(store.close()).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Transaction Support
  // ─────────────────────────────────────────────────────────────────────────

  describe("transaction", () => {
    it("should execute operations atomically", () => {
      const result = store.transaction(() => {
        const run: RunRecord = {
          runId: "run-001",
          planHash: "sha256:abc123",
          state: "pending",
          startedAt: "2024-01-15T10:30:00.000Z",
        };

        // Create run synchronously within transaction
        store["db"]
          .prepare(
            `
					INSERT INTO runs (runId, planHash, state, startedAt, completedAt, metadata)
					VALUES (?, ?, ?, ?, ?, ?)
				`
          )
          .run(run.runId, run.planHash, run.state, run.startedAt, null, null);

        return "success";
      });

      expect(result).toBe("success");
    });

    it("should rollback on error", async () => {
      try {
        store.transaction(() => {
          store["db"]
            .prepare(
              `
						INSERT INTO runs (runId, planHash, state, startedAt, completedAt, metadata)
						VALUES (?, ?, ?, ?, ?, ?)
					`
            )
            .run("run-001", "sha256:abc123", "pending", "2024-01-15T10:30:00.000Z", null, null);

          throw new Error("Simulated error");
        });
      } catch {
        // Expected
      }

      // Verify rollback occurred
      const run = await store.getRun("run-001");
      expect(run).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Foreign Key / Cascade Delete
  // ─────────────────────────────────────────────────────────────────────────

  describe("cascade delete", () => {
    it("should delete steps when run is deleted", async () => {
      // Create run
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });

      // Add step
      await store.appendStep({
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "lint",
        status: "pass",
        durationMs: 1000,
        timestamp: "2024-01-15T10:30:05.000Z",
      });

      // Delete run directly (bypassing interface - for testing cascade)
      store["db"].prepare("DELETE FROM runs WHERE runId = ?").run("run-001");

      // Steps should be gone too
      const steps = await store.getStepsForRun("run-001");
      expect(steps).toEqual([]);
    });

    it("should delete receipts when run is deleted", async () => {
      // Create run
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });

      // Add receipt
      await store.saveReceipt({
        receiptId: "receipt-001",
        runId: "run-001",
        reason: "Test escalation",
        timestamp: "2024-01-15T10:31:00.000Z",
      });

      // Delete run directly
      store["db"].prepare("DELETE FROM runs WHERE runId = ?").run("run-001");

      // Receipts should be gone too
      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Timestamp Format Compliance
  // ─────────────────────────────────────────────────────────────────────────

  describe("timestamp format", () => {
    it("should preserve UTC ISO 8601 timestamps for runs", async () => {
      const timestamp = "2024-01-15T10:30:00.000Z";
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: timestamp,
      });

      const run = await store.getRun("run-001");
      expect(run!.startedAt).toBe(timestamp);
    });

    it("should preserve UTC ISO 8601 timestamps for steps", async () => {
      const timestamp = "2024-01-15T10:30:05.000Z";
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });

      await store.appendStep({
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "lint",
        status: "pass",
        durationMs: 1000,
        timestamp,
      });

      const steps = await store.getStepsForRun("run-001");
      expect(steps[0].timestamp).toBe(timestamp);
    });

    it("should preserve UTC ISO 8601 timestamps for receipts", async () => {
      const timestamp = "2024-01-15T10:31:00.000Z";
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "running",
        startedAt: "2024-01-15T10:30:00.000Z",
      });

      await store.saveReceipt({
        receiptId: "receipt-001",
        runId: "run-001",
        reason: "Test",
        timestamp,
      });

      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts[0].timestamp).toBe(timestamp);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration: Full Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  describe("integration: full lifecycle", () => {
    it("should handle complete run lifecycle", async () => {
      // 1. Create run
      await store.createRun({
        runId: "run-001",
        planHash: "sha256:abc123",
        state: "pending",
        startedAt: "2024-01-15T10:30:00.000Z",
      });

      // 2. Update to running
      await store.updateRun("run-001", { state: "running" });

      // 3. Add steps
      await store.appendStep({
        stepId: "step-001",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "lint",
        status: "pass",
        durationMs: 1000,
        timestamp: "2024-01-15T10:30:05.000Z",
      });

      await store.appendStep({
        stepId: "step-002",
        runId: "run-001",
        nodeId: "pr-42",
        gateName: "test",
        status: "pass",
        durationMs: 5000,
        timestamp: "2024-01-15T10:30:10.000Z",
      });

      // 4. Add receipt (scope escalation)
      await store.saveReceipt({
        receiptId: "receipt-001",
        runId: "run-001",
        reason: "Extended test coverage",
        approver: "alice@example.com",
        timestamp: "2024-01-15T10:30:08.000Z",
      });

      // 5. Complete run
      await store.updateRun("run-001", {
        state: "completed",
        completedAt: "2024-01-15T10:31:00.000Z",
      });

      // Verify final state
      const run = await store.getRun("run-001");
      expect(run!.state).toBe("completed");
      expect(run!.completedAt).toBe("2024-01-15T10:31:00.000Z");

      const steps = await store.getStepsForRun("run-001");
      expect(steps).toHaveLength(2);
      expect(steps.every((s) => s.status === "pass")).toBe(true);

      const receipts = await store.getReceiptsForRun("run-001");
      expect(receipts).toHaveLength(1);
      expect(receipts[0].approver).toBe("alice@example.com");

      // Verify counts
      expect(await store.getRunCount()).toBe(1);
      expect(await store.getRunCount("completed")).toBe(1);
    });
  });
});
