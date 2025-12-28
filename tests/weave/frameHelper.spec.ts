/**
 * Tests for weave Frame helper
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  emitWeaveCompletionFrame,
  extractMergedPRs,
  calculateWeaveDuration,
} from "../../src/weave/frameHelper.js";
import { WeaveState, type WeaveContext, type BatchState } from "../../src/weave/types.js";
import { listFrameIds, readFrame } from "../../src/frames/storage.js";

describe("emitWeaveCompletionFrame", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "weave-frame-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should emit successful merge-weave frame", async () => {
    const completedBatch: BatchState = {
      batchNumber: 0,
      items: ["PR-101", "PR-102"],
      state: "completed",
      startedAt: "2025-12-01T10:00:00Z",
      completedAt: "2025-12-01T10:01:00Z",
    };

    const context: WeaveContext = {
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [completedBatch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:01:00Z",
      completedAt: "2025-12-01T10:01:00Z",
      successfulMerges: 2,
      failedMerges: 0,
      metadata: {
        planHash: "abc123",
        targetBranch: "main",
        dryRun: false,
      },
    };

    const result = await emitWeaveCompletionFrame(context);

    expect(result.success).toBe(true);
    expect(result.frame).toBeDefined();
    expect(result.frame!.type).toBe("merge-weave");
    expect(result.frame!.outcome).toBe("success");
    expect(result.frame!.module_scope).toEqual(["PR-101", "PR-102"]);
    expect(result.frame!.metadata?.run_id).toBe("01JFZG7X2T3K4M5N6P7Q8R9S0W");
    expect(result.frame!.metadata?.plan_hash).toBe("abc123");
  });

  it("should emit failed merge-weave frame", async () => {
    const failedBatch: BatchState = {
      batchNumber: 0,
      items: ["PR-101"],
      state: "failed",
      startedAt: "2025-12-01T10:00:00Z",
      completedAt: "2025-12-01T10:00:30Z",
      error: "Merge conflict",
    };

    const context: WeaveContext = {
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0X",
      state: WeaveState.FAILED,
      plan: {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-101", deps: [], gates: [] }],
      },
      prHeads: [],
      batches: [failedBatch],
      currentBatchIndex: 0,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:00:30Z",
      successfulMerges: 0,
      failedMerges: 1,
      metadata: {
        planHash: "def456",
        targetBranch: "develop",
        dryRun: false,
      },
    };

    const result = await emitWeaveCompletionFrame(context);

    expect(result.success).toBe(true);
    expect(result.frame).toBeDefined();
    expect(result.frame!.type).toBe("merge-weave");
    expect(result.frame!.outcome).toBe("failure");
    expect(result.frame!.module_scope).toEqual(["PR-101"]);
  });

  it("should emit partial merge-weave frame", async () => {
    const completedBatch: BatchState = {
      batchNumber: 0,
      items: ["PR-101"],
      state: "completed",
    };
    const failedBatch: BatchState = {
      batchNumber: 1,
      items: ["PR-102"],
      state: "failed",
    };

    const context: WeaveContext = {
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0Y",
      state: WeaveState.FAILED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [completedBatch, failedBatch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:02:00Z",
      successfulMerges: 1,
      failedMerges: 1,
      metadata: {
        planHash: "ghi789",
        targetBranch: "main",
        dryRun: false,
      },
    };

    const result = await emitWeaveCompletionFrame(context);

    expect(result.success).toBe(true);
    expect(result.frame).toBeDefined();
    expect(result.frame!.type).toBe("merge-weave");
    expect(result.frame!.outcome).toBe("partial");
    // Only completed batches are in scope
    expect(result.frame!.module_scope).toEqual(["PR-101"]);
  });
});

describe("extractMergedPRs", () => {
  it("should extract PRs from completed batches only", async () => {
    const context: WeaveContext = {
      runId: "test",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [
        { batchNumber: 0, items: ["PR-1", "PR-2"], state: "completed" },
        { batchNumber: 1, items: ["PR-3"], state: "failed" },
        { batchNumber: 2, items: ["PR-4"], state: "pending" },
      ],
      currentBatchIndex: 2,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:00:00Z",
      successfulMerges: 2,
      failedMerges: 1,
      metadata: { planHash: "test", targetBranch: "main", dryRun: false },
    };

    const prs = extractMergedPRs(context);

    expect(prs).toEqual(["PR-1", "PR-2"]);
  });

  it("should return empty array if no completed batches", async () => {
    const context: WeaveContext = {
      runId: "test",
      state: WeaveState.FAILED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [{ batchNumber: 0, items: ["PR-1"], state: "failed" }],
      currentBatchIndex: 0,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:00:00Z",
      successfulMerges: 0,
      failedMerges: 1,
      metadata: { planHash: "test", targetBranch: "main", dryRun: false },
    };

    const prs = extractMergedPRs(context);

    expect(prs).toEqual([]);
  });
});

describe("calculateWeaveDuration", () => {
  it("should calculate duration from start to completion", async () => {
    const context: WeaveContext = {
      runId: "test",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [],
      currentBatchIndex: 0,
      startedAt: "2025-12-01T10:00:00.000Z",
      lastUpdatedAt: "2025-12-01T10:01:00.000Z",
      completedAt: "2025-12-01T10:01:00.000Z",
      successfulMerges: 0,
      failedMerges: 0,
      metadata: { planHash: "test", targetBranch: "main", dryRun: false },
    };

    const duration = calculateWeaveDuration(context);

    expect(duration).toBe(60000); // 1 minute
  });

  it("should calculate duration to now if not completed", async () => {
    const now = Date.now();
    const startTime = now - 30000; // 30 seconds ago

    const context: WeaveContext = {
      runId: "test",
      state: WeaveState.MERGING,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [],
      currentBatchIndex: 0,
      startedAt: new Date(startTime).toISOString(),
      lastUpdatedAt: new Date(now).toISOString(),
      successfulMerges: 0,
      failedMerges: 0,
      metadata: { planHash: "test", targetBranch: "main", dryRun: false },
    };

    const duration = calculateWeaveDuration(context);

    // Should be approximately 30 seconds (allowing for small timing differences)
    expect(duration).toBeGreaterThan(29000);
    expect(duration).toBeLessThan(32000);
  });
});

describe("emitWeaveCompletionFrame with persistence", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "weave-frame-persist-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should persist Frame to disk when persist=true", async () => {
    const batch: BatchState = {
      batchNumber: 0,
      items: ["PR-101", "PR-102"],
      state: "completed",
      startedAt: "2025-12-01T10:00:00Z",
      completedAt: "2025-12-01T10:01:00Z",
    };

    const context: WeaveContext = {
      runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [batch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:01:00Z",
      completedAt: "2025-12-01T10:01:00Z",
      successfulMerges: 2,
      failedMerges: 0,
      metadata: {
        planHash: "abc123",
        targetBranch: "main",
        dryRun: false,
      },
    };

    const result = await emitWeaveCompletionFrame(context, { baseDir: testDir, persist: true });

    expect(result.success).toBe(true);
    expect(result.frameId).toBeDefined();

    // Verify Frame was persisted
    const frameIds = listFrameIds(testDir);
    expect(frameIds).toHaveLength(1);

    const storedFrame = readFrame(frameIds[0], testDir);
    expect(storedFrame).not.toBeNull();
    expect(storedFrame!.type).toBe("merge-weave");
    expect(storedFrame!.outcome).toBe("success");
    expect(storedFrame!.stored_at).toBeDefined();
  });

  it("should not persist Frame when persist=false", async () => {
    const batch: BatchState = {
      batchNumber: 0,
      items: ["PR-101"],
      state: "completed",
    };

    const context: WeaveContext = {
      runId: "test-no-persist",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [batch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:01:00Z",
      completedAt: "2025-12-01T10:01:00Z",
      successfulMerges: 1,
      failedMerges: 0,
      metadata: {
        planHash: "test",
        targetBranch: "main",
        dryRun: false,
      },
    };

    const result = await emitWeaveCompletionFrame(context, { baseDir: testDir, persist: false });

    expect(result.success).toBe(true);

    // Verify Frame was NOT persisted
    const frameIds = listFrameIds(testDir);
    expect(frameIds).toHaveLength(0);
  });

  it("should persist by default (persist option not specified)", async () => {
    const batch: BatchState = {
      batchNumber: 0,
      items: ["PR-201"],
      state: "completed",
    };

    const context: WeaveContext = {
      runId: "test-default-persist",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [batch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:01:00Z",
      completedAt: "2025-12-01T10:01:00Z",
      successfulMerges: 1,
      failedMerges: 0,
      metadata: {
        planHash: "test",
        targetBranch: "develop",
        dryRun: false,
      },
    };

    // Only provide baseDir, no persist option
    const result = await emitWeaveCompletionFrame(context, { baseDir: testDir });

    expect(result.success).toBe(true);

    // Verify Frame was persisted (default behavior)
    const frameIds = listFrameIds(testDir);
    expect(frameIds).toHaveLength(1);
  });

  it("should include Turn Cost data in persisted Frame", async () => {
    const batch: BatchState = {
      batchNumber: 0,
      items: ["PR-301", "PR-302"],
      state: "completed",
    };

    const context: WeaveContext = {
      runId: "test-turncost-persist",
      state: WeaveState.COMPLETED,
      plan: { schemaVersion: "1.0.0", target: "main", items: [] },
      prHeads: [],
      batches: [batch],
      currentBatchIndex: 1,
      startedAt: "2025-12-01T10:00:00Z",
      lastUpdatedAt: "2025-12-01T10:01:00Z",
      completedAt: "2025-12-01T10:01:00Z",
      successfulMerges: 2,
      failedMerges: 0,
      metadata: {
        planHash: "test-turncost",
        targetBranch: "main",
        dryRun: false,
      },
      turnCost: {
        components: {
          latencyMs: 12500,
          contextResetTokens: 0,
          renegotiationCount: 1,
          tokenBloat: 2400,
          attentionSwitchCount: 0,
        },
        weightedScore: 3.2,
        eventCount: 4,
        priorRunScore: 5.8,
        improvement: "-45%",
      },
    };

    const result = await emitWeaveCompletionFrame(context, { baseDir: testDir, persist: true });

    expect(result.success).toBe(true);

    // Verify Frame was persisted with Turn Cost
    const frameIds = listFrameIds(testDir);
    expect(frameIds).toHaveLength(1);

    const storedFrame = readFrame(frameIds[0], testDir);
    expect(storedFrame).not.toBeNull();
    expect(storedFrame!.metadata?.turn_cost).toBeDefined();
    expect(storedFrame!.metadata?.turn_cost?.weightedScore).toBe(3.2);
    expect(storedFrame!.metadata?.turn_cost?.improvement).toBe("-45%");
    expect(storedFrame!.metadata?.turn_cost?.components.latencyMs).toBe(12500);
  });
});
