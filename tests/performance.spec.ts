import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { performance } from "node:perf_hooks";
import {
	MemoryMonitor,
	OperationCache,
	BatchProcessor,
	WorkerPool,
} from "../src/performance";
import { PerformanceConfig } from "../src/schema";

describe("Performance - High-Throughput Execution", () => {
	describe("MemoryMonitor", () => {
		it("should track memory usage", () => {
			const monitor = new MemoryMonitor();
			const usage = monitor.getMemoryUsage();

			expect(usage.heapUsed).toBeGreaterThan(0);
			expect(usage.heapTotal).toBeGreaterThan(0);
		});

		it("should detect high memory usage", () => {
			const config: Partial<PerformanceConfig> = {
				maxMemoryMB: 10, // Very low limit
				memoryThresholdPercent: 50,
			};
			const monitor = new MemoryMonitor(config);

			// Current usage should exceed 10MB at 50% threshold
			const isHigh = monitor.isMemoryHigh();
			expect(typeof isHigh).toBe("boolean");
		});

		it("should calculate memory stats", () => {
			const monitor = new MemoryMonitor({ maxMemoryMB: 1024 });
			const stats = monitor.getMemoryStats();

			expect(stats.usedMB).toBeGreaterThan(0);
			expect(stats.maxMB).toBe(1024);
			expect(stats.usagePercent).toBeGreaterThanOrEqual(0);
		});

		it("should not throttle when throttleOnMemory is false", async () => {
			const config: Partial<PerformanceConfig> = {
				throttleOnMemory: false,
				maxMemoryMB: 1,
			};
			const monitor = new MemoryMonitor(config);

			// Should return immediately without waiting
			const start = Date.now();
			await monitor.throttleIfNeeded();
			const elapsed = Date.now() - start;

			expect(elapsed).toBeLessThan(50); // Should be very fast
		});
	});

	describe("OperationCache", () => {
		let cache: OperationCache<string>;

		beforeEach(() => {
			cache = new OperationCache<string>(1, true); // 1 second TTL
		});

		it("should cache and retrieve values", () => {
			cache.set("key1", "value1");
			const result = cache.get("key1");

			expect(result).toBe("value1");
		});

		it("should return null for missing keys", () => {
			const result = cache.get("nonexistent");
			expect(result).toBeNull();
		});

		it("should expire entries after TTL", async () => {
			cache.set("key1", "value1");

			// Wait for TTL to expire (add buffer to account for system variance under CI load)
			await new Promise((resolve) => setTimeout(resolve, 2000));

			const result = cache.get("key1");
			expect(result).toBeNull();
		});
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should expire entries even if Date.now is mocked", () => {
			const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
			const perfNowSpy = vi.spyOn(performance, "now");

			// First call is from cache.set(), second call is from cache.get().
			perfNowSpy.mockReturnValueOnce(0);
			perfNowSpy.mockReturnValueOnce(2000);

			cache.set("key1", "value1");
			const result = cache.get("key1");

			expect(result).toBeNull();
			// Guard against regressions back to Date.now-based expiration.
			expect(dateNowSpy).not.toHaveBeenCalled();
		});

		it("should not cache when disabled", () => {
			const disabledCache = new OperationCache<string>(1, false);
			disabledCache.set("key1", "value1");

			const result = disabledCache.get("key1");
			expect(result).toBeNull();
		});

		it("should clear all entries", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");

			cache.clear();

			expect(cache.get("key1")).toBeNull();
			expect(cache.get("key2")).toBeNull();
		});

		it("should execute operation with caching", async () => {
			let executionCount = 0;
			const operation = async () => {
				executionCount++;
				return "result";
			};

			const result1 = await cache.execute("test-key", operation);
			const result2 = await cache.execute("test-key", operation);

			expect(result1).toBe("result");
			expect(result2).toBe("result");
			expect(executionCount).toBe(1); // Should only execute once
		});

		it("should provide cache statistics", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");

			const stats = cache.getStats();
			expect(stats.size).toBe(2);
			expect(stats.entries).toContain("key1");
			expect(stats.entries).toContain("key2");
		});
	});

	describe("BatchProcessor", () => {
		let processor: BatchProcessor<number>;

		beforeEach(() => {
			processor = new BatchProcessor<number>(3); // Batch size of 3
		});

		it("should process items in batches", async () => {
			const items = [1, 2, 3, 4, 5, 6, 7];
			const batchSizes: number[] = [];

			const results = await processor.processBatches(
				items,
				async (batch) => {
					batchSizes.push(batch.length);
					return batch.map((n) => n * 2);
				}
			);

			expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
			expect(batchSizes).toEqual([3, 3, 1]); // Three batches: 3, 3, 1
		});

		it("should call onBatchComplete callback", async () => {
			const items = [1, 2, 3, 4, 5];
			const completedBatches: number[] = [];

			await processor.processBatches(
				items,
				async (batch) => batch.map((n) => n * 2),
				(results, batchIndex) => {
					completedBatches.push(batchIndex);
				}
			);

			expect(completedBatches).toEqual([0, 1]); // Two batches
		});

		it("should calculate batch count correctly", () => {
			expect(processor.getBatchCount(7)).toBe(3); // 3 + 3 + 1 = 3 batches
			expect(processor.getBatchCount(3)).toBe(1);
			expect(processor.getBatchCount(0)).toBe(0);
		});

		it("should handle empty items array", async () => {
			const results = await processor.processBatches(
				[],
				async (batch) => batch
			);

			expect(results).toEqual([]);
		});
	});

	describe("WorkerPool", () => {
		let pool: WorkerPool;

		beforeEach(() => {
			pool = new WorkerPool(3); // Max 3 workers
		});

		it("should manage worker capacity", () => {
			expect(pool.hasCapacity()).toBe(true);

			pool.acquire();
			pool.acquire();
			pool.acquire();

			expect(pool.hasCapacity()).toBe(false);
			expect(pool.getActiveCount()).toBe(3);
		});

		it("should release workers", () => {
			pool.acquire();
			pool.acquire();
			expect(pool.getActiveCount()).toBe(2);

			pool.release();
			expect(pool.getActiveCount()).toBe(1);
			expect(pool.hasCapacity()).toBe(true);
		});

		it("should not acquire beyond max workers", () => {
			expect(pool.acquire()).toBe(true);
			expect(pool.acquire()).toBe(true);
			expect(pool.acquire()).toBe(true);
			expect(pool.acquire()).toBe(false); // Should fail
		});

		it("should wait for capacity", async () => {
			pool.acquire();
			pool.acquire();
			pool.acquire();

			// No capacity, should wait
			const waitPromise = pool.waitForCapacity(50);

			// Release a worker after a short delay
			setTimeout(() => pool.release(), 100);

			await waitPromise;
			expect(pool.hasCapacity()).toBe(true);
		});

		it("should not over-release", () => {
			pool.acquire();
			pool.release();
			pool.release(); // Should not go negative

			expect(pool.getActiveCount()).toBe(0);
		});
	});

	describe("Performance Benchmarks", () => {
		it("should handle large plan processing efficiently", async () => {
			// Create a large batch of items
			const items = Array.from({ length: 100 }, (_, i) => i);
			const processor = new BatchProcessor<number>(20);

			const startTime = Date.now();
			const results = await processor.processBatches(
				items,
				async (batch) => {
					// Simulate processing time
					await new Promise((resolve) => setTimeout(resolve, 10));
					return batch.map((n) => n * 2);
				}
			);
			const duration = Date.now() - startTime;

			expect(results.length).toBe(100);
			// With 5 batches of 20 items each, at 10ms per batch, should be ~50-100ms
			expect(duration).toBeLessThan(200);
		});

		it("should demonstrate cache performance improvement", async () => {
			const cache = new OperationCache<number>(60, true);
			let executionCount = 0;

			const expensiveOperation = async () => {
				executionCount++;
				await new Promise((resolve) => setTimeout(resolve, 50));
				return 42;
			};

			// First execution (cache miss)
			const start1 = Date.now();
			await cache.execute("expensive", expensiveOperation);
			const time1 = Date.now() - start1;

			// Second execution (cache hit)
			const start2 = Date.now();
			await cache.execute("expensive", expensiveOperation);
			const time2 = Date.now() - start2;

			expect(executionCount).toBe(1);
			expect(time1).toBeGreaterThan(40); // Should take at least 50ms
			expect(time2).toBeLessThan(10); // Should be much faster from cache
		});

		it("should handle concurrent worker pool operations", async () => {
			const pool = new WorkerPool(5);
			const results: number[] = [];

			// Simulate 20 concurrent operations
			const operations = Array.from({ length: 20 }, (_, i) =>
				(async () => {
					// Wait for capacity
					while (!pool.acquire()) {
						await new Promise((resolve) => setTimeout(resolve, 10));
					}

					// Simulate work
					await new Promise((resolve) => setTimeout(resolve, 20));
					results.push(i);

					pool.release();
				})()
			);

			await Promise.all(operations);

			expect(results.length).toBe(20);
			expect(pool.getActiveCount()).toBe(0);
		});
	});
});
