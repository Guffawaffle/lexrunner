/**
 * Caching layer for AI conflict resolution strategies
 *
 * Uses SHA-256 hashing of input parameters to cache resolution strategies.
 * Provides cache hit/miss tracking and TTL support.
 */

import { createHash } from "crypto";
import type {
  ConflictResolutionInput,
  ConflictResolutionOutput,
  CachedResolution,
} from "./conflictStrategySchema.js";

/**
 * Generate cache key from conflict resolution input
 *
 * Creates a deterministic SHA-256 hash from:
 * - Sorted file paths
 * - Sorted hunk hashes
 * - Sorted symbols (by name, type, path)
 * - Sorted hints (by type, message)
 *
 * @param input - Conflict resolution input
 * @returns SHA-256 hash (64 hex characters)
 */
export function generateCacheKey(input: ConflictResolutionInput): string {
  // Create deterministic canonical representation
  const canonical = JSON.stringify({
    paths: [...input.paths].sort(),
    hunkHashes: [...input.hunkHashes].sort(),
    symbols: [...input.symbols].sort((a, b) => {
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.path.localeCompare(b.path);
    }),
    hints: [...input.hints].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.message.localeCompare(b.message);
    }),
  });

  // Generate SHA-256 hash
  const hash = createHash("sha256");
  hash.update(canonical);
  return hash.digest("hex");
}

/**
 * In-memory cache for conflict resolutions
 *
 * Production implementation should use persistent storage
 * (e.g., Redis, filesystem, database)
 */
export class ConflictResolutionCache {
  private cache: Map<string, CachedResolution> = new Map();
  private hits = 0;
  private misses = 0;

  /**
   * Get cached resolution if available and not expired
   *
   * @param cacheKey - SHA-256 cache key
   * @returns Cached resolution or null if miss/expired
   */
  get(cacheKey: string): ConflictResolutionOutput | null {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL if specified
    if (entry.ttl) {
      const entryTime = new Date(entry.timestamp).getTime();
      const now = Date.now();
      const age = (now - entryTime) / 1000; // seconds

      if (age > entry.ttl) {
        // Expired, remove from cache
        this.cache.delete(cacheKey);
        this.misses++;
        return null;
      }
    }

    this.hits++;
    return entry.resolution;
  }

  /**
   * Store resolution in cache
   *
   * @param cacheKey - SHA-256 cache key
   * @param resolution - Resolution output to cache
   * @param ttl - Optional TTL in seconds
   */
  set(cacheKey: string, resolution: ConflictResolutionOutput, ttl?: number): void {
    const entry: CachedResolution = {
      cacheKey,
      resolution,
      timestamp: new Date().toISOString(),
      ttl,
    };

    this.cache.set(cacheKey, entry);
  }

  /**
   * Check if cache contains valid entry
   *
   * @param cacheKey - SHA-256 cache key
   * @returns true if valid entry exists
   */
  has(cacheKey: string): boolean {
    return this.get(cacheKey) !== null;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Remove expired entries
   */
  cleanup(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl) {
        const entryTime = new Date(entry.timestamp).getTime();
        const age = (now - entryTime) / 1000;

        if (age > entry.ttl) {
          this.cache.delete(key);
        }
      }
    }
  }
}

/**
 * Global singleton cache instance
 */
export const globalConflictCache = new ConflictResolutionCache();
