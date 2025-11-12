/**
 * Tests for Conflict Resolution Cache
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	ConflictResolutionCache,
	generateCacheKey
} from "../src/ai/conflictStrategyCache.js";
import type { ConflictResolutionInput, ConflictResolutionOutput } from "../src/ai/conflictStrategySchema.js";

describe("Conflict Resolution Cache", () => {
	describe("generateCacheKey", () => {
		it("should generate SHA-256 hash", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: []
			};

			const key = generateCacheKey(input);
			expect(key).toMatch(/^[a-f0-9]{64}$/);
		});

		it("should be deterministic for same input", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64)],
				symbols: [
					{ name: "MyClass", type: "class", path: "src/file1.ts" }
				],
				hints: [
					{ type: "import-order", message: "test", confidence: 0.9 }
				]
			};

			const key1 = generateCacheKey(input);
			const key2 = generateCacheKey(input);

			expect(key1).toBe(key2);
		});

		it("should be deterministic regardless of input order", () => {
			const input1: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64)],
				symbols: [],
				hints: []
			};

			const input2: ConflictResolutionInput = {
				paths: ["src/file2.ts", "src/file1.ts"],
				hunkHashes: ["b".repeat(64), "a".repeat(64)],
				symbols: [],
				hints: []
			};

			const key1 = generateCacheKey(input1);
			const key2 = generateCacheKey(input2);

			expect(key1).toBe(key2);
		});

		it("should produce different keys for different inputs", () => {
			const input1: ConflictResolutionInput = {
				paths: ["src/file1.ts"],
				hunkHashes: ["a".repeat(64)],
				symbols: [],
				hints: []
			};

			const input2: ConflictResolutionInput = {
				paths: ["src/file2.ts"],
				hunkHashes: ["b".repeat(64)],
				symbols: [],
				hints: []
			};

			const key1 = generateCacheKey(input1);
			const key2 = generateCacheKey(input2);

			expect(key1).not.toBe(key2);
		});

		it("should handle complex inputs with symbols and hints", () => {
			const input: ConflictResolutionInput = {
				paths: ["src/file1.ts", "src/file2.ts"],
				hunkHashes: ["a".repeat(64), "b".repeat(64)],
				symbols: [
					{ name: "ClassA", type: "class", path: "src/file1.ts" },
					{ name: "funcB", type: "function", path: "src/file2.ts" }
				],
				hints: [
					{ type: "semantic", message: "Complex conflict", confidence: 0.5 },
					{ type: "import-order", message: "Import conflict", confidence: 0.9 }
				]
			};

			const key = generateCacheKey(input);
			expect(key).toMatch(/^[a-f0-9]{64}$/);
		});
	});

	describe("ConflictResolutionCache", () => {
		let cache: ConflictResolutionCache;
		let testResolution: ConflictResolutionOutput;
		let testKey: string;

		beforeEach(() => {
			cache = new ConflictResolutionCache();
			testKey = "a".repeat(64);
			testResolution = {
				strategy: "auto-resolve",
				ops: [],
				risk: 0.25,
				abstained: false
			};
		});

		it("should return null for cache miss", () => {
			const result = cache.get(testKey);
			expect(result).toBeNull();
		});

		it("should return cached value for cache hit", () => {
			cache.set(testKey, testResolution);
			const result = cache.get(testKey);
			
			expect(result).not.toBeNull();
			expect(result?.strategy).toBe("auto-resolve");
			expect(result?.risk).toBe(0.25);
		});

		it("should track cache hits and misses", () => {
			// Initial state
			let stats = cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);

			// Cache miss
			cache.get(testKey);
			stats = cache.getStats();
			expect(stats.misses).toBe(1);
			expect(stats.hits).toBe(0);

			// Cache set + hit
			cache.set(testKey, testResolution);
			cache.get(testKey);
			stats = cache.getStats();
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
		});

		it("should calculate hit rate correctly", () => {
			cache.set(testKey, testResolution);
			
			cache.get(testKey); // hit
			cache.get("different-key"); // miss
			cache.get(testKey); // hit

			const stats = cache.getStats();
			expect(stats.hitRate).toBe(2 / 3);
		});

		it("should respect TTL", async () => {
			const shortTTL = 1; // 1 second
			cache.set(testKey, testResolution, shortTTL);

			// Immediate get should work
			let result = cache.get(testKey);
			expect(result).not.toBeNull();

			// Wait for TTL to expire
			await new Promise(resolve => setTimeout(resolve, 1100));

			// Should be expired
			result = cache.get(testKey);
			expect(result).toBeNull();
		});

		it("should not expire entries without TTL", async () => {
			cache.set(testKey, testResolution); // No TTL

			// Wait a bit
			await new Promise(resolve => setTimeout(resolve, 500));

			// Should still be cached
			const result = cache.get(testKey);
			expect(result).not.toBeNull();
		});

		it("should clear all entries", () => {
			cache.set(testKey, testResolution);
			cache.set("key2", testResolution);
			
			let stats = cache.getStats();
			expect(stats.size).toBe(2);

			cache.clear();

			stats = cache.getStats();
			expect(stats.size).toBe(0);
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);
		});

		it("should support has() method", () => {
			expect(cache.has(testKey)).toBe(false);

			cache.set(testKey, testResolution);
			expect(cache.has(testKey)).toBe(true);
		});

		it("should cleanup expired entries", async () => {
			const shortTTL = 1; // 1 second
			cache.set("key1", testResolution, shortTTL);
			cache.set("key2", testResolution); // No TTL

			// Wait for first entry to expire
			await new Promise(resolve => setTimeout(resolve, 1100));

			// Before cleanup
			let stats = cache.getStats();
			expect(stats.size).toBe(2);

			// After cleanup
			cache.cleanup();
			stats = cache.getStats();
			expect(stats.size).toBe(1);
		});

		it("should handle multiple concurrent accesses", () => {
			const promises = Array.from({ length: 100 }, (_, i) => {
				const key = `key-${i}`;
				cache.set(key, testResolution);
				return cache.get(key);
			});

			const results = promises.every(r => r !== null);
			expect(results).toBe(true);
		});
	});
});
