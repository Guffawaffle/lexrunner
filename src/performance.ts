/**
 * Performance utilities for high-throughput execution
 * Provides resource monitoring, throttling, and caching
 */

import { PerformanceConfig } from "./schema.js";
import { metrics, METRICS } from "./monitoring/metrics.js";
import { performance } from "node:perf_hooks";

/**
 * Memory monitor for tracking and throttling based on memory usage
 */
export class MemoryMonitor {
	private config: Partial<PerformanceConfig>;

	constructor(config: Partial<PerformanceConfig> = {}) {
		this.config = config;
	}

	/**
	 * Get current memory usage info
	 */
	getMemoryUsage(): NodeJS.MemoryUsage {
		return process.memoryUsage();
	}

	/**
	 * Check if memory usage exceeds threshold
	 */
	isMemoryHigh(): boolean {
		if (!this.config.maxMemoryMB) {
			return false;
		}

		const usage = this.getMemoryUsage();
		const usedMB = usage.heapUsed / (1024 * 1024);
		const maxMB = this.config.maxMemoryMB;
		const usagePercent = (usedMB / maxMB) * 100;

		// Update metrics
		metrics.setGauge(METRICS.MEMORY_USAGE_BYTES, usage.heapUsed, { type: 'heap_used' });

		return usagePercent >= (this.config.memoryThresholdPercent || 80);
	}

	/**
	 * Wait if memory is high (throttling)
	 */
	async throttleIfNeeded(): Promise<void> {
		if (this.config.throttleOnMemory === false) {
			return;
		}

		while (this.isMemoryHigh()) {
			// Force garbage collection if available
			if (global.gc) {
				global.gc();
			}

			// Wait before checking again
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * Get memory stats as percentage
	 */
	getMemoryStats(): { usedMB: number; maxMB: number; usagePercent: number } {
		const usage = this.getMemoryUsage();
		const usedMB = usage.heapUsed / (1024 * 1024);
		const maxMB = this.config.maxMemoryMB || usedMB * 2; // Default to 2x current
		const usagePercent = (usedMB / maxMB) * 100;

		return { usedMB, maxMB, usagePercent };
	}
}

/**
 * Generic cache for expensive operations
 */
export class OperationCache<T> {
	private cache: Map<string, { value: T; timestamp: number }> = new Map();
	private ttlMs: number;
	private enabled: boolean;

	constructor(ttlSeconds: number = 3600, enabled: boolean = true) {
		this.ttlMs = ttlSeconds * 1000;
		this.enabled = enabled;
	}

	/**
	 * Get cached value if available and not expired
	 */
	get(key: string): T | null {
		if (!this.enabled) {
			return null;
		}

		const entry = this.cache.get(key);
		if (!entry) {
			return null;
		}

		// Use a monotonic clock so tests or consumers mocking Date.now() don't
		// accidentally disable expiration semantics.
		const now = performance.now();
		if (now - entry.timestamp > this.ttlMs) {
			this.cache.delete(key);
			return null;
		}

		return entry.value;
	}

	/**
	 * Set cached value
	 */
	set(key: string, value: T): void {
		if (!this.enabled) {
			return;
		}

		this.cache.set(key, {
			value,
			timestamp: performance.now()
		});
	}

	/**
	 * Clear all cached values
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 */
	getStats(): { size: number; entries: string[] } {
		return {
			size: this.cache.size,
			entries: Array.from(this.cache.keys())
		};
	}

	/**
	 * Execute operation with caching
	 */
	async execute<R>(key: string, operation: () => Promise<R>): Promise<R> {
		const cached = this.get(key);
		if (cached !== null) {
			return cached as unknown as R;
		}

		const result = await operation();
		this.set(key, result as unknown as T);
		return result;
	}
}

/**
 * Batch processor for handling large plans efficiently
 */
export class BatchProcessor<T> {
	private batchSize: number;

	constructor(batchSize: number = 50) {
		this.batchSize = batchSize;
	}

	/**
	 * Process items in batches with concurrency control
	 */
	async processBatches<R>(
		items: T[],
		processor: (batch: T[]) => Promise<R[]>,
		onBatchComplete?: (results: R[], batchIndex: number) => void
	): Promise<R[]> {
		const results: R[] = [];
		const batches = this.createBatches(items);

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const batchResults = await processor(batch);
			results.push(...batchResults);

			if (onBatchComplete) {
				onBatchComplete(batchResults, i);
			}
		}

		return results;
	}

	/**
	 * Split items into batches
	 */
	private createBatches(items: T[]): T[][] {
		const batches: T[][] = [];

		for (let i = 0; i < items.length; i += this.batchSize) {
			batches.push(items.slice(i, i + this.batchSize));
		}

		return batches;
	}

	/**
	 * Get batch count for given items
	 */
	getBatchCount(itemCount: number): number {
		return Math.ceil(itemCount / this.batchSize);
	}
}

/**
 * Worker pool manager for tracking active workers
 */
export class WorkerPool {
	private maxWorkers: number;
	private activeWorkers: number = 0;

	constructor(maxWorkers: number) {
		this.maxWorkers = maxWorkers;
	}

	/**
	 * Check if pool has capacity
	 */
	hasCapacity(): boolean {
		return this.activeWorkers < this.maxWorkers;
	}

	/**
	 * Acquire worker slot
	 */
	acquire(): boolean {
		if (!this.hasCapacity()) {
			return false;
		}

		this.activeWorkers++;
		metrics.setGauge(METRICS.ACTIVE_WORKERS, this.activeWorkers);
		return true;
	}

	/**
	 * Release worker slot
	 */
	release(): void {
		if (this.activeWorkers > 0) {
			this.activeWorkers--;
			metrics.setGauge(METRICS.ACTIVE_WORKERS, this.activeWorkers);
		}
	}

	/**
	 * Get current worker count
	 */
	getActiveCount(): number {
		return this.activeWorkers;
	}

	/**
	 * Get max workers
	 */
	getMaxWorkers(): number {
		return this.maxWorkers;
	}

	/**
	 * Wait for capacity
	 */
	async waitForCapacity(pollMs: number = 50): Promise<void> {
		while (!this.hasCapacity()) {
			await new Promise(resolve => setTimeout(resolve, pollMs));
		}
	}
}
