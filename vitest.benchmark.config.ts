import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["**/tests/benchmarks/**/*.bench.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.smartergpt/**",
			"**/coverage/**",
		],
		benchmark: {
			include: ["**/tests/benchmarks/**/*.bench.ts"],
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
			],
		},
		// Run benchmarks sequentially for stable results
		maxWorkers: 1,
		minWorkers: 1,
	},
});
