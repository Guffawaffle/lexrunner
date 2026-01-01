import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  emitMergeWeaveFrame,
  setFrameEmissionEnabled,
  isFrameEmissionEnabled,
} from "../../src/frames/controller.js";
import { metrics } from "../../src/monitoring/metrics.js";
import { getFrameEmissionStats } from "../../src/telemetry/frames.js";
import * as fs from "fs";
import * as path from "path";

describe("Frame Emission Controller", () => {
  const testBaseDir = path.join(process.cwd(), ".test-frames-controller");

  beforeEach(() => {
    // Reset frame emission to enabled
    setFrameEmissionEnabled(true);
    // Reset metrics
    metrics.reset();
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

  describe("setFrameEmissionEnabled / isFrameEmissionEnabled", () => {
    it("should enable frame emission by default", () => {
      expect(isFrameEmissionEnabled()).toBe(true);
    });

    it("should allow disabling frame emission", () => {
      setFrameEmissionEnabled(false);
      expect(isFrameEmissionEnabled()).toBe(false);
    });

    it("should allow enabling frame emission", () => {
      setFrameEmissionEnabled(false);
      setFrameEmissionEnabled(true);
      expect(isFrameEmissionEnabled()).toBe(true);
    });
  });

  describe("emitMergeWeaveFrame with flag control", () => {
    const input = {
      runId: "test-run-1",
      mergedPRs: ["#123", "#124"],
      conflictsResolved: 0,
      gatesPassed: ["lint", "test"],
      durationMs: 1000,
      outcome: "success" as const,
      targetBranch: "main",
    };

    it("should emit frame when enabled", async () => {
      setFrameEmissionEnabled(true);
      const result = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      expect(result.success).toBe(true);
      expect(result.frameId).toBeDefined();

      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(1);
    });

    it("should not emit frame when disabled", async () => {
      setFrameEmissionEnabled(false);
      const result = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");

      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]["disabled"]).toBe(1);
    });

    it("should track telemetry when disabled", async () => {
      setFrameEmissionEnabled(false);
      await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]["disabled"]).toBe(1);
    });

    it("should store frame when emission succeeds", async () => {
      setFrameEmissionEnabled(true);
      const result = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      expect(result.success).toBe(true);

      // Check that frame was stored
      const framesDir = path.join(testBaseDir, ".lexrunner/frames");
      expect(fs.existsSync(framesDir)).toBe(true);

      const files = fs.readdirSync(framesDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it("should not store frame when disabled", async () => {
      setFrameEmissionEnabled(false);
      const result = await emitMergeWeaveFrame(input, { baseDir: testBaseDir });

      expect(result.success).toBe(false);

      // Check that no frame was stored
      const framesDir = path.join(testBaseDir, ".lexrunner/frames");
      if (fs.existsSync(framesDir)) {
        const files = fs.readdirSync(framesDir);
        expect(files.length).toBe(0);
      }
    });
  });

  describe("integration with telemetry", () => {
    it("should track successful emissions with metrics", async () => {
      // Reset metrics to ensure clean state
      metrics.reset();
      setFrameEmissionEnabled(true);

      await emitMergeWeaveFrame(
        {
          runId: "test-1",
          mergedPRs: ["#1"],
          conflictsResolved: 0,
          gatesPassed: [],
          durationMs: 100,
          outcome: "success",
          targetBranch: "main",
        },
        { baseDir: testBaseDir }
      );

      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(1);
      // Duration should be tracked (actual time may vary)
      expect(stats.avgDurationMs["merge-weave"]).toBeGreaterThanOrEqual(0);
    });

    it("should track disabled emissions as failures", async () => {
      setFrameEmissionEnabled(false);

      await emitMergeWeaveFrame(
        {
          runId: "test-1",
          mergedPRs: ["#1"],
          conflictsResolved: 0,
          gatesPassed: [],
          durationMs: 100,
          outcome: "success",
          targetBranch: "main",
        },
        { baseDir: testBaseDir }
      );

      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]["disabled"]).toBe(1);
    });
  });
});
