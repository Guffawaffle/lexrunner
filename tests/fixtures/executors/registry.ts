/**
 * ExecutorRegistry Test Fixture
 * 
 * This is a simplified test fixture for executor lifecycle tests.
 * A production registry in src/executors/registry.ts does not currently exist;
 * executors are loaded via direct TypeScript imports instead.
 * 
 * See docs/architecture/executors.md for registry architecture details.
 */

import type { Executor, ExecutorRegistry as IExecutorRegistry } from './types.js';

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
