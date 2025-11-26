import { defineConfig } from "vitest/config";

/**
 * Configuration for slow CLI tests.
 *
 * These tests are excluded from the default `npm test` CI lane
 * because they involve long-running operations (e.g., sleep commands, git operations).
 *
 * Run locally with:
 *   LEX_ENABLE_SLOW_CLI_TESTS=true npm run test:cli:slow
 *
 * In CI, these are run via a scheduled or manual workflow.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			// Slow CLI tests with sleep commands for progress indicators
			"**/tests/cli-progress.spec.ts",
		],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.smartergpt/**",
			"**/coverage/**",
		],
		// Limit concurrency to prevent resource exhaustion
		maxWorkers: 1,
		minWorkers: 1,
	},
});
