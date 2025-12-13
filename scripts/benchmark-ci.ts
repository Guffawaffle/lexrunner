#!/usr/bin/env tsx
/**
 * Benchmark CI script
 * Runs benchmarks and compares against baseline, failing if regressions detected
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type {
	BenchmarkResult,
	BaselineResult,
} from "../tests/benchmarks/utils/reporter.js";
import {
	compareResults,
	generateMarkdownReport,
	generateJSONReport,
	hasRegressions,
} from "../tests/benchmarks/utils/reporter.js";

const BASELINE_PATH = path.join(
	process.cwd(),
	"tests/benchmarks/baselines/baseline.json"
);
const RESULTS_DIR = path.join(process.cwd(), "tests/benchmarks/results");
const MARKDOWN_PATH = path.join(RESULTS_DIR, "latest.md");
const JSON_PATH = path.join(RESULTS_DIR, "latest.json");
const RAW_RESULTS_PATH = "/tmp/bench-results.json";

type PackageJson = {
	version?: string;
};

type BenchmarkMode = "smoke" | "compare";

function getArgValue(name: string): string | undefined {
	const prefix = `${name}=`;
	for (const arg of process.argv.slice(2)) {
		if (arg.startsWith(prefix)) {
			return arg.slice(prefix.length);
		}
	}

	const idx = process.argv.indexOf(name);
	if (idx !== -1 && idx + 1 < process.argv.length) {
		return process.argv[idx + 1];
	}

	return undefined;
}

function coerceBenchmarkMode(
	value: string | undefined
): BenchmarkMode | undefined {
	if (!value) {
		return undefined;
	}

	if (value === "smoke" || value === "compare") {
		return value;
	}

	return undefined;
}

function generateSmokeMarkdownReport(results: BenchmarkResult[]): string {
	const lines: string[] = [];

	lines.push("# Performance Benchmark Results\n");
	lines.push("**Mode:** smoke (no baseline comparison)\n");
	lines.push(`**Benchmarks:** ${results.length}\n`);
	lines.push("");

	if (results.length === 0) {
		lines.push("No benchmark results were produced.");
		lines.push("\nTip: run `npm run benchmark` locally to debug.");
		return lines.join("\n");
	}

	lines.push("| Suite | Operation | Mean | Samples |");
	lines.push("|------:|-----------|------|--------:|");

	const sorted = [...results].sort((a, b) => {
		if (a.suite !== b.suite) {
			return a.suite.localeCompare(b.suite);
		}
		return a.name.localeCompare(b.name);
	});

	for (const r of sorted) {
		lines.push(
			`| ${r.suite} | ${r.name} | ${formatTime(r.meanTime)} | ${
				r.samples
			} |`
		);
	}

	lines.push("");
	lines.push("---");
	lines.push(
		"To check regressions locally, run: `npm run benchmark:compare`."
	);

	return lines.join("\n");
}

function generateSmokeJSONReport(results: BenchmarkResult[]): string {
	return JSON.stringify(
		{
			metadata: {
				mode: "smoke",
				timestamp: new Date().toISOString(),
				totalBenchmarks: results.length,
			},
			results,
		},
		null,
		2
	);
}

function formatTime(ms: number): string {
	if (ms < 1) {
		return `${(ms * 1000).toFixed(2)}μs`;
	}

	if (ms < 1000) {
		return `${ms.toFixed(2)}ms`;
	}

	return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
	const mode: BenchmarkMode =
		coerceBenchmarkMode(getArgValue("--mode")) ??
		(process.env.CI ? "smoke" : "compare");

	console.log("📊 Running performance benchmarks...\n");
	console.log(`Mode: ${mode}\n`);

	// Ensure results directory exists
	if (!fs.existsSync(RESULTS_DIR)) {
		fs.mkdirSync(RESULTS_DIR, { recursive: true });
	}

	// Run benchmarks
	try {
		execSync(
			`npm run benchmark -- --run --outputJson=${RAW_RESULTS_PATH}`,
			{
				stdio: "inherit",
			}
		);
	} catch (error) {
		console.error("❌ Benchmark execution failed");
		process.exit(1);
	}

	// Load current results
	if (!fs.existsSync(RAW_RESULTS_PATH)) {
		console.error("❌ Benchmark results not found");
		process.exit(1);
	}

	const currentRaw = JSON.parse(fs.readFileSync(RAW_RESULTS_PATH, "utf-8"));

	// Parse Vitest benchmark results format
	const current: BenchmarkResult[] = parseBenchmarkResults(currentRaw);

	if (current.length === 0) {
		console.warn("⚠️ No benchmark results produced");
		process.exit(0);
	}

	if (mode === "smoke") {
		const markdownReport = generateSmokeMarkdownReport(current);
		const jsonReport = generateSmokeJSONReport(current);

		fs.writeFileSync(MARKDOWN_PATH, markdownReport);
		fs.writeFileSync(JSON_PATH, jsonReport);

		console.log("\n📊 Benchmark Results (smoke)\n");
		console.log(markdownReport);
		console.log("\n✅ Benchmark smoke run completed");
		process.exit(0);
	}

	// compare mode
	if (!fs.existsSync(BASELINE_PATH)) {
		console.warn(
			"⚠️ No baseline found. Run `npm run benchmark:baseline` to create one."
		);
		console.log("✅ Benchmarks completed (no comparison available)");
		process.exit(0);
	}

	const baseline: BaselineResult[] = JSON.parse(
		fs.readFileSync(BASELINE_PATH, "utf-8")
	);

	// Compare results
	const comparisons = compareResults(current, baseline);

	// Generate reports
	const pkg: PackageJson = JSON.parse(
		fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
	);

	const baselineMtime = fs.statSync(BASELINE_PATH).mtime;
	const baselineDate = baselineMtime.toISOString().slice(0, 10);

	const metadata = {
		baselineVersion: pkg.version ? `v${pkg.version}` : "unknown",
		currentVersion: "current",
		baselineDate,
		timestamp: new Date().toISOString(),
	};

	const markdownReport = generateMarkdownReport(comparisons, metadata);
	const jsonReport = generateJSONReport(comparisons, metadata);

	// Write reports
	fs.writeFileSync(MARKDOWN_PATH, markdownReport);
	fs.writeFileSync(JSON_PATH, jsonReport);

	console.log("\n📊 Benchmark Results\n");
	console.log(markdownReport);

	// Check for regressions
	if (hasRegressions(comparisons)) {
		console.error(
			"\n❌ Performance regressions detected! See report above."
		);
		console.error(`\nReports saved to:`);
		console.error(`  - ${MARKDOWN_PATH}`);
		console.error(`  - ${JSON_PATH}`);
		process.exit(1);
	} else {
		console.log("\n✅ No performance regressions detected");
		console.log(`\nReports saved to:`);
		console.log(`  - ${MARKDOWN_PATH}`);
		console.log(`  - ${JSON_PATH}`);
		process.exit(0);
	}
}

/**
 * Parse Vitest benchmark results into our format
 */
function parseBenchmarkResults(raw: any): BenchmarkResult[] {
	const results: BenchmarkResult[] = [];

	// Vitest bench JSON output: { files: [{ filepath, groups: [{ fullName, benchmarks: [...] }] }] }
	if (raw?.files && Array.isArray(raw.files)) {
		for (const file of raw.files) {
			for (const group of file?.groups || []) {
				const suite = normalizeSuiteName(
					group?.fullName || group?.name || ""
				);
				for (const bench of group?.benchmarks || []) {
					const samples = Array.isArray(bench?.samples)
						? bench.samples.length
						: typeof bench?.df === "number"
						? bench.df
						: 0;

					results.push({
						name: bench?.name || "Unknown",
						suite: suite || "Unknown",
						meanTime:
							typeof bench?.mean === "number" ? bench.mean : 0,
						minTime: typeof bench?.min === "number" ? bench.min : 0,
						maxTime: typeof bench?.max === "number" ? bench.max : 0,
						stdDev: typeof bench?.sd === "number" ? bench.sd : 0,
						samples,
					});
				}
			}
		}

		return results;
	}

	// Vitest benchmark format varies, this is a basic parser
	// Adjust based on actual Vitest output format
	if (raw.testResults) {
		for (const testFile of raw.testResults) {
			for (const assertionResult of testFile.assertionResults || []) {
				if (assertionResult.duration !== undefined) {
					const fullName =
						assertionResult.fullName || assertionResult.title || "";
					const parts = fullName.split(" > ");
					const suite = parts.slice(0, -1).join(" > ") || "Unknown";
					const name = parts[parts.length - 1] || "Unknown";

					results.push({
						name,
						suite,
						meanTime: assertionResult.duration,
						minTime: assertionResult.duration,
						maxTime: assertionResult.duration,
						stdDev: 0,
						samples: 1,
					});
				}
			}
		}
	}

	// Fallback: try to parse as array of results
	if (results.length === 0 && Array.isArray(raw)) {
		return raw;
	}

	return results;
}

function normalizeSuiteName(fullName: string): string {
	const parts = fullName
		.split(" > ")
		.map((s) => s.trim())
		.filter(Boolean);

	if (parts.length <= 1) {
		return fullName.trim();
	}

	// Drop the leading file path segment when present:
	// "tests/.../foo.bench.ts > Suite > Case" -> "Suite > Case"
	if (
		parts[0].endsWith(".bench.ts") ||
		parts[0].includes("/tests/benchmarks/")
	) {
		return parts.slice(1).join(" > ");
	}

	return parts.join(" > ");
}

main().catch((error) => {
	console.error("❌ Benchmark CI script failed:", error);
	process.exit(1);
});
