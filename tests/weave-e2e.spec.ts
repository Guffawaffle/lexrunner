/**
 * End-to-end integration test for merge-weave workflow
 * 
 * Tests the complete workflow: discover → plan → apply (dry-run)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../dist/cli.js");

describe("Merge-Weave End-to-End Workflow", () => {
	const TEST_DIR = path.join(__dirname, "../tmp/weave-e2e-test");
	const PLAN_FILE = path.join(TEST_DIR, "plan.json");

	beforeEach(() => {
		// Create test directory
		if (!fs.existsSync(TEST_DIR)) {
			fs.mkdirSync(TEST_DIR, { recursive: true });
		}
	});

	afterEach(() => {
		// Cleanup
		if (fs.existsSync(PLAN_FILE)) {
			fs.unlinkSync(PLAN_FILE);
		}
	});

	it("should show weave command help", async () => {
		const result = await execa("node", [CLI_PATH, "weave", "--help"]);
		
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Merge-weave workflow");
		expect(result.stdout).toContain("discover");
		expect(result.stdout).toContain("plan");
		expect(result.stdout).toContain("apply");
	});

	it("should show weave discover help", async () => {
		const result = await execa("node", [CLI_PATH, "weave", "discover", "--help"]);
		
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Discover open pull requests");
		expect(result.stdout).toContain("--owner");
		expect(result.stdout).toContain("--repo");
	});

	it("should show weave plan help", async () => {
		const result = await execa("node", [CLI_PATH, "weave", "plan", "--help"]);
		
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Generate merge plan");
		expect(result.stdout).toContain("--from-github");
		expect(result.stdout).toContain("--output");
	});

	it("should show weave apply help", async () => {
		const result = await execa("node", [CLI_PATH, "weave", "apply", "--help"]);
		
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Execute merge pyramid");
		expect(result.stdout).toContain("--plan");
		expect(result.stdout).toContain("--dry-run");
	});

	it("should fail plan without --from-github flag", async () => {
		try {
			await execa("node", [
				CLI_PATH,
				"weave",
				"plan",
				"--output",
				PLAN_FILE,
			]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBeGreaterThan(0);
			expect(error.stderr).toContain("--from-github is required");
		}
	});

	it("should fail apply without plan file", async () => {
		try {
			await execa("node", [
				CLI_PATH,
				"weave",
				"apply",
				"--plan",
				"/nonexistent/plan.json",
			]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBeGreaterThan(0);
			expect(error.stderr).toContain("Plan file not found");
		}
	});

	it("should dry-run with valid plan file", async () => {
		// Create a minimal valid plan matching the actual schema
		const minimalPlan = {
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: ["lint"],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" },
			},
			items: [
				{
					name: "test-item-1",
					deps: [],
					gates: [
						{
							name: "lint",
							run: "echo 'linting'",
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
				{
					name: "test-item-2",
					deps: ["test-item-1"],
					gates: [
						{
							name: "lint",
							run: "echo 'linting'",
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
			],
		};

		fs.writeFileSync(PLAN_FILE, JSON.stringify(minimalPlan, null, 2));

		const result = await execa("node", [
			CLI_PATH,
			"weave",
			"apply",
			"--plan",
			PLAN_FILE,
			"--dry-run",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Merge-Weave Dry Run");
		expect(result.stdout).toContain("Level 1");
		expect(result.stdout).toContain("test-item-1");
		expect(result.stdout).toContain("Level 2");
		expect(result.stdout).toContain("test-item-2");
		expect(result.stdout).toContain("Gates to run");
		expect(result.stdout).toContain("lint");
	});

	it("should output JSON format for dry-run", async () => {
		// Create a minimal valid plan matching the actual schema
		const minimalPlan = {
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: ["lint"],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" },
			},
			items: [
				{
					name: "test-item",
					deps: [],
					gates: [
						{
							name: "lint",
							run: "echo 'linting'",
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
			],
		};

		fs.writeFileSync(PLAN_FILE, JSON.stringify(minimalPlan, null, 2));

		const result = await execa("node", [
			CLI_PATH,
			"weave",
			"apply",
			"--plan",
			PLAN_FILE,
			"--dry-run",
			"--json",
		]);

		expect(result.exitCode).toBe(0);
		
		// Parse JSON output
		const output = JSON.parse(result.stdout);
		expect(output.dryRun).toBe(true);
		expect(output.levels).toBeDefined();
		expect(output.totalItems).toBe(1);
		expect(output.maxParallelism).toBeGreaterThan(0);
	});

	it("should validate plan with merge-order before dry-run", async () => {
		// Create a plan with proper dependency structure
		const planWithDeps = {
			schemaVersion: "1.0.0",
			target: "main",
			policy: {
				requiredGates: ["lint"],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: "strict-required" },
			},
			items: [
				{
					name: "base",
					deps: [],
					gates: [
						{
							name: "lint",
							run: "echo 'linting'",
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
				{
					name: "dependent",
					deps: ["base"],
					gates: [
						{
							name: "lint",
							run: "echo 'linting'",
							env: {},
							runtime: "local",
							artifacts: [],
						},
					],
				},
			],
		};

		fs.writeFileSync(PLAN_FILE, JSON.stringify(planWithDeps, null, 2));

		// First, verify merge order is correct
		const orderResult = await execa("node", [
			CLI_PATH,
			"merge-order",
			PLAN_FILE,
			"--json",
		]);

		expect(orderResult.exitCode).toBe(0);
		const orderOutput = JSON.parse(orderResult.stdout);
		expect(orderOutput.levels).toBeDefined();
		expect(orderOutput.levels.length).toBe(2);

		// Then dry-run should work
		const dryRunResult = await execa("node", [
			CLI_PATH,
			"weave",
			"apply",
			"--plan",
			PLAN_FILE,
			"--dry-run",
		]);

		expect(dryRunResult.exitCode).toBe(0);
		expect(dryRunResult.stdout).toContain("Level 1");
		expect(dryRunResult.stdout).toContain("base");
		expect(dryRunResult.stdout).toContain("Level 2");
		expect(dryRunResult.stdout).toContain("dependent");
	});
});
