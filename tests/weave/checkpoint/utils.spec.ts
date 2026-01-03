/**
 * Tests for checkpoint utilities
 */

import { describe, it, expect } from "vitest";
import {
  stateToPhase,
  createCheckpointFromContext,
  validateCheckpointForResume,
  formatCheckpoint,
  formatCheckpointList,
} from "../../../src/weave/checkpoint/utils.js";
import { WeaveState } from "../../../src/weave/types.js";
import { createWeaveContext } from "../../../src/weave/stateMachine.js";
import type { WeaveCheckpoint } from "../../../src/weave/checkpoint/types.js";

describe("Checkpoint Utilities", () => {
  describe("stateToPhase", () => {
    it("should map IDLE to discovery", () => {
      expect(stateToPhase(WeaveState.IDLE)).toBe("discovery");
    });

    it("should map PLANNING to discovery", () => {
      expect(stateToPhase(WeaveState.PLANNING)).toBe("discovery");
    });

    it("should map READY to gates", () => {
      expect(stateToPhase(WeaveState.READY)).toBe("gates");
    });

    it("should map VALIDATING to gates", () => {
      expect(stateToPhase(WeaveState.VALIDATING)).toBe("gates");
    });

    it("should map MERGING to merge", () => {
      expect(stateToPhase(WeaveState.MERGING)).toBe("merge");
    });

    it("should map COMPLETED to complete", () => {
      expect(stateToPhase(WeaveState.COMPLETED)).toBe("complete");
    });

    it("should map FAILED to gates", () => {
      expect(stateToPhase(WeaveState.FAILED)).toBe("gates");
    });
  });

  describe("createCheckpointFromContext", () => {
    it("should create valid checkpoint from context", () => {
      const plan = {
        target: "main",
        items: [
          { name: "item1", sha: "abc", dependencies: [] },
          { name: "item2", sha: "def", dependencies: [] },
        ],
      };
      const context = createWeaveContext(plan, [], "test-hash");
      context.state = WeaveState.MERGING;

      const checkpoint = createCheckpointFromContext(context, ["item1"], ["item2"], []);

      expect(checkpoint.runId).toBe(context.runId);
      expect(checkpoint.state).toBe(WeaveState.MERGING);
      expect(checkpoint.phase).toBe("merge");
      expect(checkpoint.completedItems).toEqual(["item1"]);
      expect(checkpoint.pendingItems).toEqual(["item2"]);
      expect(checkpoint.failedItems).toEqual([]);
      expect(checkpoint.plan).toEqual(plan);
    });

    it("should include metadata", () => {
      const plan = { target: "develop", items: [] };
      const context = createWeaveContext(plan, [], "test-hash");

      const checkpoint = createCheckpointFromContext(context, [], [], []);

      expect(checkpoint.metadata?.target).toBe("develop");
    });
  });

  describe("validateCheckpointForResume", () => {
    const createTestCheckpoint = (overrides: Partial<WeaveCheckpoint> = {}): WeaveCheckpoint => ({
      runId: "test-run",
      timestamp: new Date().toISOString(),
      phase: "merge",
      state: WeaveState.MERGING,
      planHash: "abc123",
      plan: { target: "main", items: [{ name: "item1", sha: "abc", dependencies: [] }] },
      completedItems: [],
      pendingItems: ["item1"],
      failedItems: [],
      currentBatchIndex: 0,
      totalBatches: 1,
      successfulMerges: 0,
      failedMerges: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      ...overrides,
    });

    it("should validate resumable checkpoint", () => {
      const checkpoint = createTestCheckpoint();
      const result = validateCheckpointForResume(checkpoint);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject completed checkpoint", () => {
      const checkpoint = createTestCheckpoint({ state: WeaveState.COMPLETED });
      const result = validateCheckpointForResume(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("completed");
    });

    it("should reject failed checkpoint", () => {
      const checkpoint = createTestCheckpoint({ state: WeaveState.FAILED });
      const result = validateCheckpointForResume(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("failed");
    });

    it("should reject checkpoint with empty plan", () => {
      const checkpoint = createTestCheckpoint({
        plan: { target: "main", items: [] },
      });
      const result = validateCheckpointForResume(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty plan");
    });

    it("should reject checkpoint with invalid batch index", () => {
      const checkpoint = createTestCheckpoint({
        currentBatchIndex: 5,
        totalBatches: 2,
      });
      const result = validateCheckpointForResume(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("batch index");
    });
  });

  describe("formatCheckpoint", () => {
    it("should format checkpoint for display", () => {
      const checkpoint: WeaveCheckpoint = {
        runId: "test-run-123",
        timestamp: new Date().toISOString(),
        phase: "merge",
        state: WeaveState.MERGING,
        planHash: "abc123",
        plan: { target: "main", items: [] },
        completedItems: ["item1", "item2"],
        pendingItems: ["item3"],
        failedItems: [],
        lastSuccessfulSha: "abcdef1234567890",
        currentBatchIndex: 1,
        totalBatches: 3,
        successfulMerges: 2,
        failedMerges: 0,
        startedAt: "2024-01-01T00:00:00Z",
        lastUpdatedAt: "2024-01-01T01:00:00Z",
        metadata: {
          target: "main",
        },
      };

      const formatted = formatCheckpoint(checkpoint);

      expect(formatted).toContain("test-run-123");
      expect(formatted).toContain("merge");
      expect(formatted).toContain("2/3 batches");
      expect(formatted).toContain("Completed: 2 items");
      expect(formatted).toContain("Pending: 1 items");
      expect(formatted).toContain("abcdef12");
      expect(formatted).toContain("Target Branch: main");
    });
  });

  describe("formatCheckpointList", () => {
    it("should format empty list", () => {
      const formatted = formatCheckpointList([]);
      expect(formatted).toBe("No checkpoints found");
    });

    it("should format list of entries", () => {
      const entries = [
        {
          runId: "run-1",
          timestamp: new Date().toISOString(),
          phase: "merge" as const,
          state: WeaveState.MERGING,
          completedItems: 2,
          pendingItems: 1,
          failedItems: 0,
          startedAt: new Date().toISOString(),
        },
        {
          runId: "run-2",
          timestamp: new Date().toISOString(),
          phase: "gates" as const,
          state: WeaveState.VALIDATING,
          completedItems: 1,
          pendingItems: 2,
          failedItems: 0,
          startedAt: new Date().toISOString(),
        },
      ];

      const formatted = formatCheckpointList(entries);

      expect(formatted).toContain("run-1");
      expect(formatted).toContain("run-2");
      expect(formatted).toContain("merge");
      expect(formatted).toContain("gates");
      expect(formatted).toContain("2 completed, 1 pending");
      expect(formatted).toContain("1 completed, 2 pending");
    });
  });
});
