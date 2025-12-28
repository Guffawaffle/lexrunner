/**
 * Tests for AI Conflict Resolution Strategy Integration
 *
 * Tests the complete workflow including caching, risk assessment,
 * abstention, and fallback behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveConflict,
  resolveConflictsBatch,
  getCacheStats,
  clearCache,
  ConflictResolutionCache,
} from "../src/ai/conflictStrategy.js";
import type { ConflictResolutionInput } from "../src/ai/conflictStrategySchema.js";

describe("AI Conflict Strategy Integration", () => {
  let cache: ConflictResolutionCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ConflictResolutionCache();
    clearCache(cache);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("resolveConflict", () => {
    it("should resolve trivial conflicts without abstention", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "import-order",
            message: "Import order conflict",
            confidence: 0.95,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.abstained).toBe(false);
      expect(result.strategy).toBe("auto-resolve");
      expect(result.risk).toBeLessThan(0.35);
      expect(result.ops).toHaveLength(1);
    });

    it("should abstain for high-risk conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: Array.from({ length: 5 }, (_, i) => `file${i}.ts`),
        hunkHashes: Array.from({ length: 5 }, () => "a".repeat(64)),
        symbols: [
          { name: "ClassA", type: "class", path: "src/file1.ts" },
          { name: "ClassB", type: "class", path: "src/file2.ts" },
        ],
        hints: [
          { type: "semantic", message: "Complex", confidence: 0.3 },
          {
            type: "structural",
            message: "Major change",
            confidence: 0.2,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.abstained).toBe(true);
      expect(result.risk).toBeGreaterThan(0.35);
      expect(result.fallbackMethod).toBe("heuristic");
    });

    it("should use cache for repeated requests", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      // First request - cache miss
      await resolveConflict(input, { cache, forceHeuristic: true });
      let stats = getCacheStats(cache);
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Second request - cache hit
      await resolveConflict(input, { cache, forceHeuristic: true });
      stats = getCacheStats(cache);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("should skip cache when requested", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      // First request
      await resolveConflict(input, { cache, forceHeuristic: true });

      // Second request with skipCache - skips reading but still writes
      await resolveConflict(input, {
        cache,
        skipCache: true,
        forceHeuristic: true,
      });

      const stats = getCacheStats(cache);
      expect(stats.hits).toBe(0); // No hits since skipCache was used
      expect(stats.misses).toBe(1); // Only first miss (second skipped cache read)
    });

    it("should use AI caller when provided", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      const mockAICaller = async (system: string, user: string): Promise<string> => {
        expect(system).toContain("conflict resolution expert");
        expect(user).toContain("src/file1.ts");

        return JSON.stringify({
          strategy: "auto-resolve",
          ops: [
            {
              type: "accept-ours",
              path: "src/file1.ts",
              hunkHash: "a".repeat(64),
              rationale: "Safe to accept our version",
            },
          ],
          risk: 0.15,
          explanation: "AI determined this is safe",
        });
      };

      const result = await resolveConflict(input, {
        cache,
        aiCaller: mockAICaller,
      });

      expect(result.strategy).toBe("auto-resolve");
      expect(result.risk).toBeLessThanOrEqual(0.35);
      expect(result.explanation).toContain("AI determined");
    });

    it("should fall back to heuristics when AI fails", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "whitespace",
            message: "Whitespace",
            confidence: 1.0,
          },
        ],
      };

      const failingAICaller = async (): Promise<string> => {
        throw new Error("AI service unavailable");
      };

      const result = await resolveConflict(input, {
        cache,
        aiCaller: failingAICaller,
      });

      expect(result.abstained).toBe(true);
      expect(result.fallbackMethod).toBe("heuristic");
      expect(result.explanation).toContain("AI resolution failed");
    });

    it("should respect cache TTL", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      const shortTTL = 1; // 1 second

      // First request with TTL
      await resolveConflict(input, {
        cache,
        cacheTTL: shortTTL,
        forceHeuristic: true,
      });

      // Immediate second request - should hit cache
      await resolveConflict(input, { cache, forceHeuristic: true });
      let stats = getCacheStats(cache);
      expect(stats.hits).toBe(1);

      // Wait for expiration - use 1500ms to ensure we're well past the 1000ms TTL
      // accounting for event loop jitter and timing uncertainty
      vi.advanceTimersByTime(1500);

      // Third request - cache should be expired
      await resolveConflict(input, { cache, forceHeuristic: true });
      stats = getCacheStats(cache);
      expect(stats.misses).toBe(2);
    });
  });

  describe("resolveConflictsBatch", () => {
    it("should resolve multiple conflicts", async () => {
      const inputs: ConflictResolutionInput[] = [
        {
          paths: ["src/file1.ts"],
          hunkHashes: ["a".repeat(64)],
          symbols: [],
          hints: [
            {
              type: "import-order",
              message: "Import",
              confidence: 0.9,
            },
          ],
        },
        {
          paths: ["src/file2.ts"],
          hunkHashes: ["b".repeat(64)],
          symbols: [],
          hints: [
            {
              type: "whitespace",
              message: "Whitespace",
              confidence: 1.0,
            },
          ],
        },
      ];

      const results = await resolveConflictsBatch(inputs, {
        cache,
        forceHeuristic: true,
      });

      expect(results).toHaveLength(2);
      expect(results[0].ops[0].path).toBe("src/file1.ts");
      expect(results[1].ops[0].path).toBe("src/file2.ts");
    });

    it("should share cache across batch", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      // Process same input twice in batch
      const inputs = [input, input];
      await resolveConflictsBatch(inputs, {
        cache,
        forceHeuristic: true,
      });

      const stats = getCacheStats(cache);
      expect(stats.hits).toBe(1); // Second request hits cache
      expect(stats.misses).toBe(1); // First request misses cache
    });
  });

  describe("Heuristic Fallback", () => {
    it("should handle import order conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "import-order",
            message: "Import order",
            confidence: 0.9,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.strategy).toBe("auto-resolve");
      expect(result.ops[0].type).toBe("merge-both");
      expect(result.risk).toBeLessThan(0.35);
    });

    it("should handle whitespace conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "whitespace",
            message: "Whitespace",
            confidence: 1.0,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.strategy).toBe("auto-resolve");
      expect(result.ops[0].type).toBe("accept-theirs");
      expect(result.risk).toBeLessThan(0.35);
    });

    it("should handle formatting conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "formatting",
            message: "Formatting",
            confidence: 1.0,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.strategy).toBe("auto-resolve");
      expect(result.ops[0].type).toBe("accept-theirs");
    });

    it("should require manual review for semantic conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "semantic",
            message: "Logic conflict",
            confidence: 0.7,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.strategy).toBe("manual-review");
      expect(result.ops[0].type).toBe("manual-review");
      expect(result.risk).toBeGreaterThanOrEqual(0.35);
    });

    it("should require manual review for structural conflicts", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [
          {
            type: "structural",
            message: "Class changes",
            confidence: 0.6,
          },
        ],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result.strategy).toBe("manual-review");
      expect(result.ops[0].type).toBe("manual-review");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty hints and symbols", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts"],
        hunkHashes: ["a".repeat(64)],
        symbols: [],
        hints: [],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result).toBeDefined();
      expect(result.ops).toHaveLength(1);
    });

    it("should handle multiple paths and hunks", async () => {
      const input: ConflictResolutionInput = {
        paths: ["src/file1.ts", "src/file2.ts"],
        hunkHashes: ["a".repeat(64), "b".repeat(64)],
        symbols: [],
        hints: [],
      };

      const result = await resolveConflict(input, {
        cache,
        forceHeuristic: true,
      });

      expect(result).toBeDefined();
      expect(result.ops.length).toBeGreaterThan(0);
    });
  });
});
