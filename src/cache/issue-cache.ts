/**
 * TTL (Time To Live) cache for GitHub issues
 * Provides in-memory caching with automatic expiration
 */

import type { GitHubIssue } from "../github/types.js";

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * TTL Cache configuration
 */
export interface TTLCacheOptions {
  /** Time to live in milliseconds (default: 60000 = 1 minute) */
  ttl?: number;
  /** Maximum cache size (default: 1000) */
  maxSize?: number;
}

/**
 * Simple TTL cache implementation
 */
export class TTLCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private ttl: number;
  private maxSize: number;

  constructor(options: TTLCacheOptions = {}) {
    this.ttl = options.ttl ?? 60_000; // Default 1 minute
    this.maxSize = options.maxSize ?? 1000;
  }

  /**
   * Set a value in the cache with TTL
   */
  set(key: K, value: V): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Get a value from the cache
   * Returns undefined if not found or expired
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    // Clean up expired entries before returning size
    this.cleanExpired();
    return this.cache.size;
  }

  /**
   * Remove all expired entries
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Global issue cache instance
 */
let globalIssueCache: TTLCache<string, GitHubIssue> | null = null;

/**
 * Get or create the global issue cache
 */
export function getIssueCache(options?: TTLCacheOptions): TTLCache<string, GitHubIssue> {
  if (!globalIssueCache) {
    globalIssueCache = new TTLCache<string, GitHubIssue>(options);
  }
  return globalIssueCache;
}

/**
 * Reset the global issue cache (mainly for testing)
 */
export function resetIssueCache(): void {
  globalIssueCache = null;
}
