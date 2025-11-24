import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { skipIfCliNotBuilt } from "./helpers/cli";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { canonicalJSONStringify } from "../src/util/canonicalJson";

const execAsync = promisify(exec);

/**
 * Comprehensive End-to-End Integration Tests
 *
 * Tests the complete automation pipeline from plan generation through execution.
 * Validates enterprise-grade reliability and complex dependency scenarios.
 *
 * Related: Issue #57, Epic #74 (Autopilot Levels)
 */
describe("Comprehensive E2E Automation Pipeline", () => {
	let tempDir: string;
	let projectDir: string;

	beforeEach(async (context) => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-comprehensive-"));
		projectDir = path.dirname(__dirname); // Root of the project
		if (skipIfCliNotBuilt({ skip: context.skip })) return;

		// Initialize git repository for all tests
		await execAsync("git init", { cwd: tempDir });
		await execAsync('git config user.email "e2e-test@lex-pr.dev"', {
			cwd: tempDir,
		});
		await execAsync('git config user.name "E2E Test Runner"', {
			cwd: tempDir,
		});
		await execAsync("git config commit.gpgsign false", {
			cwd: tempDir,
		});
		await execAsync('git commit --allow-empty -m "Initial commit"', {
			cwd: tempDir,
		});
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	const runCLI = async (
		args: string,
		cwd: string = tempDir
	): Promise<{ stdout: string; stderr: string }> => {
		const cliPath = path.join(projectDir, "dist/cli.js");
		return execAsync(`node ${cliPath} ${args}`, { cwd });
	};

	const createProfile = (
		role: "example" | "development" | "local" = "local"
	) => {
		const profileDir = path.join(tempDir, ".smartergpt");
		fs.mkdirSync(profileDir, { recursive: true });

		fs.writeFileSync(
			path.join(profileDir, "profile.yml"),
			`role: ${role}\nname: e2e-test\n`
		);

		// Basic scope configuration
		fs.writeFileSync(
			path.join(profileDir, "scope.yml"),
			`target: main\nfilters:\n  - "is:open"\n  - "label:ready"\n`
		);

		// Basic gates configuration
		fs.writeFileSync(
			path.join(profileDir, "gates.yml"),
			`gates:\n  lint:\n    run: "echo lint-pass"\n    timeout: 30\n  test:\n    run: "echo test-pass"\n    timeout: 60\n`
		);

		return profileDir;
	};

	const createPlan = (items: Array<{ name: string; deps: string[] }>) => {
		const plan = {
			schemaVersion: "1.0.0",
			target: "main",
			items: items.map((item) => ({
				name: item.name,
				deps: item.deps,
				gates: [
					{ name: "lint", run: "echo lint-pass", env: {} },
					{ name: "test", run: "echo test-pass", env: {} },
				],
			})),
		};

		const planPath = path.join(tempDir, "plan.json");
		fs.writeFileSync(planPath, canonicalJSONStringify(plan));
		return planPath;
	};

	describe("Complete Automation Workflow", () => {
		it("should execute full plan → autopilot → deliverables pipeline", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// 1. Setup profile
			const profileDir = createProfile("development");

			// 2. Create plan with dependencies
			const planPath = createPlan([
				{ name: "foundation", deps: [] },
				{ name: "feature-a", deps: ["foundation"] },
				{ name: "feature-b", deps: ["foundation"] },
			]);

			// 3. Validate plan structure
			const { stdout: validateOutput } = await runCLI(
				`schema validate ${planPath} --json`
			);
			const validation = JSON.parse(validateOutput);
			expect(validation.valid).toBe(true);

			// 4. Run autopilot Level 0 (analysis)
			const { stdout: level0Output } = await runCLI(
				`autopilot ${planPath} --level 0`
			);
			expect(level0Output).toContain("🔍 Merge-Weave Analysis");
			expect(level0Output).toContain("3 items in dependency graph");
			expect(level0Output).toContain("2 merge levels identified");

			// 5. Run autopilot Level 1 (artifact generation)
			const { stdout: level1Output } = await runCLI(
				`autopilot ${planPath} --level 1 --profile-dir ${profileDir}`
			);
			expect(level1Output).toContain(
				"Level 1: Artifact generation complete"
			);
			expect(level1Output).toContain("Generated 5 artifacts");

			// 6. Verify deliverables exist in timestamped directory
			const deliverables = path.join(profileDir, "deliverables");
			const deliverablesEntries = fs.readdirSync(deliverables);
			const timestampedDir = deliverablesEntries.find((entry) =>
				entry.startsWith("weave-")
			);
			expect(timestampedDir).toBeDefined();

			const actualDeliverables = path.join(deliverables, timestampedDir!);
			expect(
				fs.existsSync(path.join(actualDeliverables, "analysis.json"))
			).toBe(true);
			expect(
				fs.existsSync(path.join(actualDeliverables, "weave-report.md"))
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(actualDeliverables, "gate-predictions.json")
				)
			).toBe(true);

			// 7. Validate analysis.json structure
			const analysisPath = path.join(actualDeliverables, "analysis.json");
			const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
			expect(analysis).toHaveProperty("plan");
			expect(analysis).toHaveProperty("mergeOrder");
			expect(analysis).toHaveProperty("conflicts");
			expect(analysis.mergeOrder).toHaveLength(2); // Two levels
		});

		it("should handle complex dependency scenarios correctly", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			createProfile("local");

			// Diamond dependency: A → B,C → D
			const planPath = createPlan([
				{ name: "base", deps: [] },
				{ name: "left-branch", deps: ["base"] },
				{ name: "right-branch", deps: ["base"] },
				{ name: "merge-point", deps: ["left-branch", "right-branch"] },
			]);

			const { stdout } = await runCLI(
				`autopilot ${planPath} --level 0 --json`
			);
			const result = JSON.parse(stdout);

			expect(result.success).toBe(true);
			expect(result.message).toContain("4 items in dependency graph");
			expect(result.message).toContain("3 merge levels identified");
		});

		it("should detect and handle dependency cycles", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Create invalid plan with cycle: A → B → C → A
			const cyclePlan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: [
					{ name: "item-a", deps: ["item-c"], gates: [] },
					{ name: "item-b", deps: ["item-a"], gates: [] },
					{ name: "item-c", deps: ["item-b"], gates: [] },
				],
			};

			const planPath = path.join(tempDir, "cycle-plan.json");
			fs.writeFileSync(planPath, canonicalJSONStringify(cyclePlan));

			try {
				await runCLI(`autopilot ${planPath} --level 0`);
				expect.fail("Should have detected dependency cycle");
			} catch (error: any) {
				expect(error.stderr).toContain("cycle");
			}
		});
	});

	describe("Profile Resolution Integration", () => {
		it("should use profile precedence chain correctly", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Create .smartergpt.local with role: development
			const localDir = path.join(tempDir, ".smartergpt.local");
			fs.mkdirSync(localDir, { recursive: true });
			fs.writeFileSync(
				path.join(localDir, "profile.yml"),
				"role: development\n"
			);

			// Create .smartergpt with role: example
			const trackedDir = path.join(tempDir, ".smartergpt");
			fs.mkdirSync(trackedDir, { recursive: true });
			fs.writeFileSync(
				path.join(trackedDir, "profile.yml"),
				"role: example\n"
			);

			// Should prefer .smartergpt.local over .smartergpt
			let stdout, stderr;
			try {
				const result = await runCLI("doctor");
				stdout = result.stdout;
				stderr = result.stderr;
			} catch (error: any) {
				// Doctor might fail for environment reasons but should still show profile
				stdout = error.stdout || "";
				stderr = error.stderr || "";
			}

			const output = stderr + stdout; // Profile info may be in stderr
			expect(output).toContain(".smartergpt.local");
			expect(output).toContain("role: development");
		});

		it("should respect --profile-dir override", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const customDir = path.join(tempDir, "custom-profile");
			fs.mkdirSync(customDir, { recursive: true });
			fs.writeFileSync(
				path.join(customDir, "profile.yml"),
				"role: local\nname: custom\n"
			);

			// Use autopilot command which supports profile override
			const planPath = createPlan([{ name: "test", deps: [] }]);

			// Capture both stdout and stderr since profile info goes to stderr
			let stdout, stderr;
			try {
				const result = await runCLI(
					`autopilot ${planPath} --level 0 --profile-dir ${customDir}`
				);
				stdout = result.stdout;
				stderr = result.stderr;
			} catch (error: any) {
				stdout = error.stdout || "";
				stderr = error.stderr || "";
			}

			// Profile information is logged to stderr by the CLI
			const profileInfo = stderr || stdout;
			expect(profileInfo).toContain("custom");
			expect(profileInfo).toContain("role: local");
		});

		it("should validate write protection for example profiles", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Create example profile (read-only)
			const exampleDir = createProfile("example");

			const planPath = createPlan([{ name: "test-item", deps: [] }]);

			try {
				await runCLI(
					`autopilot ${planPath} --level 1 --profile-dir ${exampleDir}`
				);
				expect.fail("Should have failed due to write protection");
			} catch (error: any) {
				// The error should be due to write protection
				const allOutput =
					(error.stderr || "") +
					(error.stdout || "") +
					(error.message || "");
				expect(allOutput).toContain("example"); // Profile role should be mentioned
				// Just check that it failed and mentions write protection concept
				expect(allOutput.toLowerCase()).toMatch(
					/(read.?only|write.*protect|cannot.*write)/
				);
			}
		});
	});

	describe("Gate Execution Pipeline", () => {
		it("should execute gates in correct dependency order", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");

			// Create plan where execution order matters
			const planPath = createPlan([
				{ name: "setup", deps: [] },
				{ name: "build", deps: ["setup"] },
				{ name: "test", deps: ["build"] },
			]);

			const { stdout } = await runCLI(
				`merge --plan ${planPath} --dry-run`
			);

			expect(stdout).toContain("🔍 DRY RUN: Merge Execution Plan");
			expect(stdout).toContain("### Batch 1");
			expect(stdout).toContain("- Items: setup");
			expect(stdout).toContain("### Batch 2");
			expect(stdout).toContain("- Items: build");
			expect(stdout).toContain("- Dependencies: setup");
			expect(stdout).toContain("### Batch 3");
			expect(stdout).toContain("- Items: test");
			expect(stdout).toContain("- Dependencies: build");
		});

		it("should aggregate gate results correctly", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");

			// Create mock gate results
			const gateResultsDir = path.join(tempDir, "gate-results");
			fs.mkdirSync(gateResultsDir, { recursive: true });

			const mockResults = [
				{
					item: "item-1",
					gate: "lint",
					status: "pass",
					duration_ms: 1000,
					started_at: "2025-10-02T10:30:00Z",
				},
				{
					item: "item-1",
					gate: "test",
					status: "pass",
					duration_ms: 2000,
					started_at: "2025-10-02T10:30:01Z",
				},
			];

			mockResults.forEach((result, i) => {
				fs.writeFileSync(
					path.join(gateResultsDir, `result-${i}.json`),
					canonicalJSONStringify(result)
				);
			});

			const { stdout } = await runCLI(
				`report ${gateResultsDir} --out json`
			);
			const report = JSON.parse(stdout);

			// Adjust expectations based on actual report structure
			expect(report.allGreen).toBe(true);
			expect(report.items).toHaveLength(1);
			expect(report.items[0].gates).toHaveLength(2);
		});
	});

	describe("Error Recovery and Resilience", () => {
		it("should handle missing dependencies gracefully", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Plan with undefined dependency
			const badPlan = {
				schemaVersion: "1.0.0",
				target: "main",
				items: [{ name: "item-a", deps: ["nonexistent"], gates: [] }],
			};

			const planPath = path.join(tempDir, "bad-plan.json");
			fs.writeFileSync(planPath, canonicalJSONStringify(badPlan));

			try {
				await runCLI(`autopilot ${planPath} --level 0`);
				expect.fail("Should have failed due to unknown dependency");
			} catch (error: any) {
				expect(error.stderr).toContain("nonexistent");
				expect(error.stderr).toContain("dependency");
			}
		});

		it("should provide helpful error messages for common issues", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Test missing profile using autopilot command
			const planPath = createPlan([{ name: "test", deps: [] }]);
			try {
				await runCLI(
					`autopilot ${planPath} --level 0 --profile-dir /nonexistent/path`
				);
				expect.fail("Should have failed for missing profile");
			} catch (error: any) {
				expect(error.stderr).toContain("profile");
			}
		});

		it("should validate schema version compatibility", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			// Plan with unsupported schema version
			const futurePlan = {
				schemaVersion: "99.0.0",
				target: "main",
				items: [],
			};

			const planPath = path.join(tempDir, "future-plan.json");
			fs.writeFileSync(planPath, canonicalJSONStringify(futurePlan));

			try {
				await runCLI(`schema validate ${planPath} --json`);
				expect.fail(
					"Should have failed with unsupported schema version"
				);
			} catch (error: any) {
				const output = error.stdout || error.stderr;
				if (output) {
					const validation = JSON.parse(output);
					expect(validation.valid).toBe(false);
				} else {
					expect(error.message).toContain("schemaVersion");
				}
			}
		});
	});

	describe("Performance and Determinism", () => {
		it("should produce deterministic outputs across multiple runs", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");
			const planPath = createPlan([
				{ name: "a", deps: [] },
				{ name: "b", deps: ["a"] },
				{ name: "c", deps: ["a"] },
			]);

			// Run autopilot twice
			const { stdout: run1 } = await runCLI(
				`autopilot ${planPath} --level 0 --json --profile-dir ${profileDir}`
			);
			const { stdout: run2 } = await runCLI(
				`autopilot ${planPath} --level 0 --json --profile-dir ${profileDir}`
			);

			// Parse and compare (ignoring timestamps if any)
			const result1 = JSON.parse(run1);
			const result2 = JSON.parse(run2);

			expect(result1.level).toBe(result2.level);
			expect(result1.success).toBe(result2.success);
			// Message should be identical (no timestamps in Level 0)
			expect(result1.message).toBe(result2.message);
		});

		it("should handle large plans efficiently", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");

			// Create a larger plan (50 items with various dependencies)
			const largeItems = [];
			for (let i = 0; i < 50; i++) {
				const deps = i === 0 ? [] : [`item-${i - 1}`]; // Linear chain
				largeItems.push({ name: `item-${i}`, deps });
			}

			const planPath = createPlan(largeItems);

			const startTime = Date.now();
			const { stdout } = await runCLI(
				`autopilot ${planPath} --level 0 --profile-dir ${profileDir}`
			);
			const duration = Date.now() - startTime;

			expect(stdout).toContain("50 items in dependency graph");
			expect(stdout).toContain("50 merge levels identified"); // Linear chain
			expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
		});
	});

	describe("Integration with External Tools", () => {
		it("should generate machine-readable outputs for CI/CD integration", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");
			const planPath = createPlan([
				{ name: "item-1", deps: [] },
				{ name: "item-2", deps: ["item-1"] },
			]);

			// Test JSON output mode with merge command
			const { stdout } = await runCLI(
				`merge --plan ${planPath} --dry-run --json`
			);
			const result = JSON.parse(stdout);

			expect(result).toHaveProperty("summary");
			expect(result).toHaveProperty("batches");
			expect(result).toHaveProperty("prs");
			expect(result).toHaveProperty("checks");
			expect(result.batches).toBeInstanceOf(Array);
			expect(result.batches).toHaveLength(2);
			expect(result.summary.totalItems).toBe(2);
		});

		it("should support status reporting format", async (ctx) => {
			if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

			const profileDir = createProfile("local");
			const planPath = createPlan([{ name: "test-item", deps: [] }]);

			// Test that plan items appear in dry-run output
			const { stdout } = await runCLI(
				`merge --plan ${planPath} --dry-run`
			);

			expect(stdout).toContain("test-item"); // Item should appear in output
		});
	});
});
