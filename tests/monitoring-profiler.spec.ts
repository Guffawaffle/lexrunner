import { describe, it, expect, beforeEach } from "vitest";
import {
	PerformanceProfiler,
	profileAsync,
	profileSync,
} from "../src/monitoring/profiler";
import { metrics, METRICS } from "../src/monitoring/metrics";

describe("Monitoring - Profiler", () => {
	let profiler: PerformanceProfiler;

	beforeEach(() => {
		profiler = new PerformanceProfiler();
		metrics.reset();
	});

	describe("Performance Profiling", () => {
		it("should track operation duration", async () => {
			profiler.start("test_operation");
			await new Promise((resolve) => setTimeout(resolve, 50));
			const profile = profiler.end("test_operation");

			expect(profile).toBeTruthy();
			expect(profile?.duration).toBeGreaterThan(0);
			expect(profile?.duration).toBeGreaterThanOrEqual(0.04); // At least 40ms (tolerates system jitter)
		});

		it("should track memory usage", () => {
			profiler.start("test_operation");
			const arr = new Array(10000).fill("test"); // Allocate some memory
			const profile = profiler.end("test_operation");

			expect(profile).toBeTruthy();
			expect(profile?.memoryStart).toBeTruthy();
			expect(profile?.memoryEnd).toBeTruthy();
			expect(profile?.memoryDelta).toBeTruthy();
		});

		it("should handle multiple concurrent operations", () => {
			profiler.start("op1");
			profiler.start("op2");
			profiler.start("op3");

			const activeProfiles = profiler.getActiveProfiles();
			expect(activeProfiles).toHaveLength(3);

			profiler.end("op1");
			profiler.end("op2");

			const remainingProfiles = profiler.getActiveProfiles();
			expect(remainingProfiles).toHaveLength(1);
			expect(remainingProfiles[0].operation).toBe("op3");
		});

		it("should return null when ending non-existent operation", () => {
			const profile = profiler.end("non_existent");
			expect(profile).toBeNull();
		});
	});

	describe("Metric Integration", () => {
		it("should record gate execution time to metrics", () => {
			profiler.start("gate_lint");
			profiler.end("gate_lint", { gateType: "lint" });

			const json = metrics.exportJSON();
			// Check that histogram with labels exists
			const histogramKeys = Object.keys(json.histograms);
			const hasGateMetric = histogramKeys.some((key) =>
				key.startsWith(METRICS.GATE_EXECUTION_TIME)
			);
			expect(hasGateMetric).toBe(true);
		});

		it("should record plan execution time to metrics", () => {
			profiler.start("plan_execution");
			profiler.end("plan_execution");

			const json = metrics.exportJSON();
			expect(json.histograms[METRICS.PLAN_EXECUTION_TIME]).toBeTruthy();
		});

		it("should record merge execution time to metrics", () => {
			profiler.start("merge_operation");
			profiler.end("merge_operation");

			const json = metrics.exportJSON();
			expect(json.histograms[METRICS.MERGE_EXECUTION_TIME]).toBeTruthy();
		});

		it("should record memory usage to metrics", () => {
			profiler.start("test_operation");
			profiler.end("test_operation", { type: "test" });

			const json = metrics.exportJSON();
			// Check that memory gauge with labels exists
			const gaugeKeys = Object.keys(json.gauges);
			const hasMemoryMetric = gaugeKeys.some((key) =>
				key.startsWith(METRICS.MEMORY_USAGE_BYTES)
			);
			expect(hasMemoryMetric).toBe(true);
		});
	});

	describe("Async Profiling Helper", () => {
		it("should profile async operations", async () => {
			const result = await profileAsync(
				"gate_test",
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 50));
					return "success";
				},
				{ gateType: "test" }
			);

			expect(result).toBe("success");
			const json = metrics.exportJSON();
			const histogramKeys = Object.keys(json.histograms);
			const hasGateMetric = histogramKeys.some((key) =>
				key.startsWith(METRICS.GATE_EXECUTION_TIME)
			);
			expect(hasGateMetric).toBe(true);
		});

		it("should profile async operations that throw errors", async () => {
			await expect(
				profileAsync("gate_error", async () => {
					throw new Error("Test error");
				})
			).rejects.toThrow("Test error");

			// Should still record the metric even on error
			const json = metrics.exportJSON();
			const histogramKeys = Object.keys(json.histograms);
			const hasGateMetric = histogramKeys.some((key) =>
				key.startsWith(METRICS.GATE_EXECUTION_TIME)
			);
			expect(hasGateMetric).toBe(true);
		});
	});

	describe("Sync Profiling Helper", () => {
		it("should profile sync operations", () => {
			const result = profileSync(
				"dependency_check",
				() => {
					return "completed";
				},
				{ type: "dependency" }
			);

			expect(result).toBe("completed");
			const json = metrics.exportJSON();
			const histogramKeys = Object.keys(json.histograms);
			const hasDepMetric = histogramKeys.some((key) =>
				key.startsWith(METRICS.DEPENDENCY_RESOLUTION_TIME)
			);
			expect(hasDepMetric).toBe(true);
		});

		it("should profile sync operations that throw errors", () => {
			expect(() => {
				profileSync("dependency_error", () => {
					throw new Error("Test error");
				});
			}).toThrow("Test error");

			// Should still record the metric even on error
			const json = metrics.exportJSON();
			const histogramKeys = Object.keys(json.histograms);
			const hasDepMetric = histogramKeys.some((key) =>
				key.startsWith(METRICS.DEPENDENCY_RESOLUTION_TIME)
			);
			expect(hasDepMetric).toBe(true);
		});
	});

	describe("Profiler State Management", () => {
		it("should clear all profiles", () => {
			profiler.start("op1");
			profiler.start("op2");

			expect(profiler.getActiveProfiles()).toHaveLength(2);

			profiler.clear();

			expect(profiler.getActiveProfiles()).toHaveLength(0);
		});

		it("should preserve metadata in profiles", () => {
			profiler.start("test_op", {
				prNumber: 123,
				branch: "feature/test",
			});
			const profile = profiler.end("test_op");

			expect(profile?.metadata).toEqual({
				prNumber: 123,
				branch: "feature/test",
			});
		});
	});
});
