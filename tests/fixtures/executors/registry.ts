/**
 * ExecutorRegistry Test Fixture
 *
 * This is a test fixture for executor lifecycle tests.
 * Currently, executors are loaded via direct TypeScript imports.
 *
 * Note: A production registry was considered but is not currently planned.
 * The direct import approach is sufficient for the current executor count.
 * If dynamic loading becomes needed in the future, a production registry
 * could be implemented in src/executors/registry.ts.
 *
 * See docs/architecture/executors.md for registry architecture details.
 */

import type { Executor, ExecutorRegistry as IExecutorRegistry } from "./types.js";

export class ExecutorRegistry implements IExecutorRegistry {
  private executors: Map<string, Executor> = new Map();

  /**
   * Register an executor
   */
  register(executor: Executor): void {
    this.executors.set(executor.id, executor);
  }

  /**
   * Load an executor by ID
   */
  async load(executorId: string): Promise<Executor> {
    const executor = this.executors.get(executorId);
    if (!executor) {
      throw new Error(`Executor not found: ${executorId}`);
    }
    return executor;
  }

  /**
   * List all registered executor IDs
   */
  list(): string[] {
    return Array.from(this.executors.keys());
  }

  /**
   * Clear all registered executors (for testing)
   */
  clear(): void {
    this.executors.clear();
  }
}
