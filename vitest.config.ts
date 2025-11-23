import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// WSL2-safe configuration: use threads instead of child processes
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: false,
				isolate: true,
				// Limit concurrent threads to reduce file system pressure in WSL2
				maxThreads: 4,
				minThreads: 1,
			},
		},
		// Longer timeouts for WSL2 file system latency
		testTimeout: 15000,
		hookTimeout: 15000,
		// Reduce file system churn by limiting reporters
		reporters: ["default"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.smartergpt/**",
			"**/coverage/**",
		],
	},
});
