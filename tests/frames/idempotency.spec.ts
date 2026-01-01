import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitMergeWeaveFrame } from "../../src/frames/emitter.js";
import { storeFrameResult, deleteFrame, listFrameIds } from "../../src/frames/storage.js";
import * as fs from "fs";
import * as path from "path";

describe("Frame Emission Idempotency", () => {
  const testBaseDir = path.join(process.cwd(), ".test-frames");

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testBaseDir)) {
      fs.mkdirSync(testBaseDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  describe("emitMergeWeaveFrame idempotency", () => {
    it("should return the same frame ID for duplicate content", async () => {
      const input = {
        runId: "test-run-1",
        mergedPRs: ["#123", "#124"],
        conflictsResolved: 0,
        gatesPassed: ["lint", "test"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      // First emission
      const result1 = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });
      expect(result1.success).toBe(true);
      expect(result1.frameId).toBeDefined();

      // Store the first frame
      if (result1.frameId) {
        storeFrameResult(result1, testBaseDir);
      }

      // Second emission with same content (on same day)
      const result2 = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });
      expect(result2.success).toBe(true);

      // Should return existing frame (content hash matches)
      // Note: This test may fail if the frames are emitted on different days
      // because timestamp bucket is part of the hash
      expect(result2.frameId).toBe(result1.frameId);
    });

    it("should create different frames for different content", async () => {
      const input1 = {
        runId: "test-run-1",
        mergedPRs: ["#123"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      const input2 = {
        runId: "test-run-2",
        mergedPRs: ["#124"], // Different PR
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      // First emission
      const result1 = await emitMergeWeaveFrame(input1, { baseDir: testBaseDir });
      expect(result1.success).toBe(true);

      if (result1.frameId) {
        storeFrameResult(result1, testBaseDir);
      }

      // Second emission with different content
      const result2 = await emitMergeWeaveFrame(input2, { baseDir: testBaseDir });
      expect(result2.success).toBe(true);

      // Should create a new frame (different content hash)
      expect(result2.frameId).not.toBe(result1.frameId);
    });

    it("should create different frames for different target branches", async () => {
      const input1 = {
        runId: "test-run-1",
        mergedPRs: ["#123"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      const input2 = {
        runId: "test-run-1",
        mergedPRs: ["#123"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "develop", // Different target branch
      };

      // First emission
      const result1 = await emitMergeWeaveFrame(input1, { baseDir: testBaseDir });
      expect(result1.success).toBe(true);

      if (result1.frameId) {
        storeFrameResult(result1, testBaseDir);
      }

      // Second emission with different target branch
      const result2 = await emitMergeWeaveFrame(input2, { baseDir: testBaseDir });
      expect(result2.success).toBe(true);

      // Should create a new frame (different keywords due to different branch)
      expect(result2.frameId).not.toBe(result1.frameId);
    });
  });

  describe("content-based hashing", () => {
    it("should generate consistent frame IDs for same inputs", async () => {
      const input = {
        runId: "test-run-1",
        mergedPRs: ["#123", "#124"],
        conflictsResolved: 0,
        gatesPassed: ["lint", "test"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      const result1 = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });
      const result2 = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      expect(result1.frameId).toBe(result2.frameId);
    });

    it("should handle PR order differences (sorted module scope)", async () => {
      const input1 = {
        runId: "test-run-1",
        mergedPRs: ["#123", "#124"],
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      const input2 = {
        runId: "test-run-1",
        mergedPRs: ["#124", "#123"], // Different order
        conflictsResolved: 0,
        gatesPassed: ["lint"],
        durationMs: 1000,
        outcome: "success" as const,
        targetBranch: "main",
      };

      const result1 = await emitMergeWeaveFrame(input1, { baseDir: testBaseDir });
      const result2 = await emitMergeWeaveFrame(input2, { baseDir: testBaseDir });

      // Should generate same hash due to sorted module scope
      expect(result1.frameId).toBe(result2.frameId);
    });
  });
});
