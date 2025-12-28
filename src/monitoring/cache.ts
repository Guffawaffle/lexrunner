/**
 * Ephemeral cache policy management
 * Handles cache directory purging at run start
 */

import * as fs from "fs";
import * as path from "path";

export interface CachePurgeOptions {
  profileDir: string;
  keepCache?: boolean;
}

export interface CachePurgeResult {
  purged: boolean;
  bytesFreed: number;
  path: string;
}

/**
 * Get directory size in bytes (recursive)
 */
function getDirSize(dirPath: string): number {
  let totalSize = 0;

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      totalSize += getDirSize(entryPath);
    } else if (entry.isFile()) {
      const stats = fs.statSync(entryPath);
      totalSize += stats.size;
    }
  }

  return totalSize;
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Purge cache directory if needed
 *
 * @param options - Cache purge options
 * @returns Result of the purge operation
 */
export function purgeCacheIfNeeded(options: CachePurgeOptions): CachePurgeResult {
  const cacheDir = path.join(options.profileDir, "runner", ".cache");

  if (options.keepCache) {
    return {
      purged: false,
      bytesFreed: 0,
      path: cacheDir,
    };
  }

  let bytesFreed = 0;

  if (fs.existsSync(cacheDir)) {
    bytesFreed = getDirSize(cacheDir);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  // Recreate empty cache directory
  fs.mkdirSync(cacheDir, { recursive: true });

  return {
    purged: true,
    bytesFreed,
    path: cacheDir,
  };
}

/**
 * Get cache directory path
 */
export function getCacheDir(profileDir: string): string {
  return path.join(profileDir, "runner", ".cache");
}

/**
 * Check if cache directory exists
 */
export function cacheExists(profileDir: string): boolean {
  const cacheDir = getCacheDir(profileDir);
  return fs.existsSync(cacheDir);
}

/**
 * Format cache purge result for display
 */
export function formatCachePurgeResult(result: CachePurgeResult): string {
  if (!result.purged) {
    return "ℹ️  Keeping existing cache (--keep-cache)";
  }

  if (result.bytesFreed === 0) {
    return "✓ Cache directory ready (was empty)";
  }

  return `🗑️  Purged cache (${formatBytes(result.bytesFreed)})`;
}
