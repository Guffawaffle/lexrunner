/**
 * Cleanup utilities for test resources
 */

import * as tempDir from './tempDir.js';

/**
 * Cleanup manager for tracking and cleaning up test resources
 */
export class CleanupManager {
  private cleanupFns: Array<() => Promise<void>> = [];
  private tempDirs: string[] = [];

  /**
   * Register a cleanup function
   */
  register(fn: () => Promise<void>): void {
    this.cleanupFns.push(fn);
  }

  /**
   * Register a temporary directory for cleanup
   */
  registerTempDir(dir: string): void {
    this.tempDirs.push(dir);
  }

  /**
   * Run all cleanup functions
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    // Cleanup temp directories
    for (const dir of this.tempDirs) {
      try {
        await tempDir.cleanup(dir);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Run custom cleanup functions
    for (const fn of this.cleanupFns) {
      try {
        await fn();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Clear arrays
    this.cleanupFns = [];
    this.tempDirs = [];

    // Throw if there were errors
    if (errors.length > 0) {
      const messages = errors.map(e => e.message).join('; ');
      throw new Error(`Cleanup errors: ${messages}`);
    }
  }
}

/**
 * Create a cleanup manager for a test suite
 */
export function createCleanupManager(): CleanupManager {
  return new CleanupManager();
}

/**
 * Helper to ensure cleanup runs even if test fails
 */
export async function withCleanup<T>(
  fn: (cleanup: CleanupManager) => Promise<T>
): Promise<T> {
  const cleanup = createCleanupManager();
  try {
    return await fn(cleanup);
  } finally {
    await cleanup.cleanup();
  }
}
