import { describe, it, expect, beforeEach } from "vitest";
import {
  trackFrameEmitted,
  trackFrameEmissionFailed,
  trackFrameEmissionDuration,
  measureFrameEmission,
  getFrameEmissionStats,
  type FrameEventType,
  type FrameFailureReason,
} from "../../src/telemetry/frames.js";
import { metrics } from "../../src/monitoring/metrics.js";

describe("Frame Emission Telemetry", () => {
  beforeEach(() => {
    // Reset metrics before each test
    metrics.reset();
  });

  describe("trackFrameEmitted", () => {
    it("should track successful frame emission", () => {
      trackFrameEmitted("merge-weave");
      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(1);
    });

    it("should track multiple frame emissions", () => {
      trackFrameEmitted("merge-weave");
      trackFrameEmitted("merge-weave");
      trackFrameEmitted("gate");
      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(2);
      expect(stats.emitted["gate"]).toBe(1);
    });
  });

  describe("trackFrameEmissionFailed", () => {
    it("should track failed frame emission", () => {
      trackFrameEmissionFailed("merge-weave", "validation-error");
      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]).toBeDefined();
      expect(stats.failed["merge-weave"]["validation-error"]).toBe(1);
    });

    it("should track multiple failures with different reasons", () => {
      trackFrameEmissionFailed("merge-weave", "validation-error");
      trackFrameEmissionFailed("merge-weave", "storage-error");
      trackFrameEmissionFailed("gate", "network-error");
      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]["validation-error"]).toBe(1);
      expect(stats.failed["merge-weave"]["storage-error"]).toBe(1);
      expect(stats.failed["gate"]["network-error"]).toBe(1);
    });
  });

  describe("trackFrameEmissionDuration", () => {
    it("should track frame emission duration", () => {
      trackFrameEmissionDuration("merge-weave", 100);
      const stats = getFrameEmissionStats();
      expect(stats.avgDurationMs["merge-weave"]).toBe(100);
    });

    it("should calculate average duration for multiple emissions", () => {
      trackFrameEmissionDuration("merge-weave", 100);
      trackFrameEmissionDuration("merge-weave", 200);
      const stats = getFrameEmissionStats();
      expect(stats.avgDurationMs["merge-weave"]).toBe(150);
    });
  });

  describe("measureFrameEmission", () => {
    it("should measure and track successful operation", async () => {
      const result = await measureFrameEmission("merge-weave", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "success";
      });

      expect(result).toBe("success");
      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(1);
      expect(stats.avgDurationMs["merge-weave"]).toBeGreaterThan(0);
    });

    it("should track failed operation", async () => {
      try {
        await measureFrameEmission("merge-weave", async () => {
          throw new Error("test error");
        });
      } catch (error) {
        expect(error).toBeDefined();
      }

      const stats = getFrameEmissionStats();
      expect(stats.failed["merge-weave"]["unknown"]).toBe(1);
    });
  });

  describe("getFrameEmissionStats", () => {
    it("should return empty stats when no frames emitted", () => {
      const stats = getFrameEmissionStats();
      expect(Object.keys(stats.emitted).length).toBe(0);
      expect(Object.keys(stats.failed).length).toBe(0);
      expect(Object.keys(stats.avgDurationMs).length).toBe(0);
    });

    it("should return comprehensive stats for mixed operations", () => {
      trackFrameEmitted("merge-weave");
      trackFrameEmitted("gate");
      trackFrameEmissionFailed("executor", "storage-error");
      trackFrameEmissionDuration("merge-weave", 150);
      trackFrameEmissionDuration("gate", 50);

      const stats = getFrameEmissionStats();
      expect(stats.emitted["merge-weave"]).toBe(1);
      expect(stats.emitted["gate"]).toBe(1);
      expect(stats.failed["executor"]["storage-error"]).toBe(1);
      expect(stats.avgDurationMs["merge-weave"]).toBe(150);
      expect(stats.avgDurationMs["gate"]).toBe(50);
    });
  });
});
