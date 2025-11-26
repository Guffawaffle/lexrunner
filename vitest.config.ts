import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.smartergpt/**",
			"**/coverage/**",
			// Exclude tests that perform git commits (require LEX_GIT_MODE=live)
			"**/tests/release-prepare.spec.ts",
			"**/tests/e2e-comprehensive.test.ts",
			"**/tests/autopilot-e2e-level3-4.spec.ts",
			"**/tests/deterministic-build.test.ts",
			"**/tests/preflightConflicts.spec.ts",
			// Exclude slow CLI tests (run via test:cli:slow with LEX_ENABLE_SLOW_CLI_TESTS=true)
			"**/tests/cli-progress.spec.ts",
		],
		// Limit concurrency to prevent WSL2 resource exhaustion/crashes
		maxWorkers: 1,
		minWorkers: 1,
	},
});
