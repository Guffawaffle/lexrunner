/**
 * Tests for scripts/dogfood-merge-weave.sh
 * 
 * This test validates the generic dogfood merge-weave script behavior
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("scripts/dogfood-merge-weave.sh", () => {
	const scriptPath = path.join(process.cwd(), "scripts/dogfood-merge-weave.sh");
	let tempDir: string;

	beforeEach(() => {
		// Create a temporary directory for test artifacts
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dogfood-test-"));
	});

	afterEach(() => {
		// Cleanup temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should display help message", async () => {
		const { stdout, exitCode } = await execa("bash", [scriptPath, "--help"]);
		
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Generic Dogfood Merge-Weave Script");
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain("--plan");
		expect(stdout).toContain("--from-github");
		expect(stdout).toContain("--repo");
		expect(stdout).toContain("--artifacts");
		expect(stdout).toContain("--dry-run");
		expect(stdout).toContain("--execute");
	});

	it("should fail when no plan source is specified", async () => {
		try {
			await execa("bash", [scriptPath]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBe(1);
			expect(error.stderr || error.stdout).toContain("Either --plan or --from-github must be specified");
		}
	});

	it("should fail when plan file does not exist", async () => {
		const nonExistentPlan = path.join(tempDir, "nonexistent.json");
		
		try {
			await execa("bash", [scriptPath, "--plan", nonExistentPlan]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBe(1);
			expect(error.stderr || error.stdout).toContain("Plan file not found");
		}
	});

	it("should fail when --from-github is specified without required options", async () => {
		try {
			await execa("bash", [scriptPath, "--from-github"]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBe(1);
			expect(error.stderr || error.stdout).toContain("--owner and --repo-name are required");
		}
	});

	it("should validate repository directory exists", async () => {
		const testPlan = path.join(tempDir, "test-plan.json");
		fs.writeFileSync(testPlan, JSON.stringify({
			schemaVersion: "1.0.0",
			target: "main",
			items: []
		}));

		const nonExistentRepo = path.join(tempDir, "nonexistent-repo");

		try {
			await execa("bash", [
				scriptPath,
				"--plan", testPlan,
				"--repo", nonExistentRepo
			]);
			expect.fail("Should have thrown an error");
		} catch (error: any) {
			expect(error.exitCode).toBe(1);
			expect(error.stderr || error.stdout).toContain("Repository directory not found");
		}
	});

	it("should handle valid plan file with dry-run (default behavior)", async () => {
		// Use the existing test-plan.json in the repository
		const testPlan = path.join(process.cwd(), "test-plan.json");
		const artifactsDir = path.join(tempDir, "artifacts");

		// Run the script
		const { stdout, stderr, exitCode } = await execa("bash", [
			scriptPath,
			"--plan", testPlan,
			"--artifacts", artifactsDir
		], {
			cwd: process.cwd(),
			reject: false
		});

		// The script should complete successfully
		expect(exitCode).toBe(0);
		
		// Check output contains expected sections
		expect(stdout).toContain("DOGFOOD MERGE-WEAVE WORKFLOW");
		expect(stdout).toContain("Step 1: Plan Generation");
		expect(stdout).toContain("Step 2: Gate Validation");
		expect(stdout).toContain("Step 3: Merge Analysis");
		expect(stdout).toContain("Step 4: Merge Execution");
		expect(stdout).toContain("Step 5: Report Generation");
		expect(stdout).toContain("WORKFLOW COMPLETE");
		
		// Verify it's in dry-run mode
		expect(stdout).toContain("DRY-RUN");
		
		// Check artifacts were created
		expect(fs.existsSync(artifactsDir)).toBe(true);
		expect(fs.existsSync(path.join(artifactsDir, "dogfood-report.md"))).toBe(true);
	}, 60000); // 60 second timeout for this test

	it("should accept verbose flag", async () => {
		const testPlan = path.join(process.cwd(), "test-plan.json");
		const artifactsDir = path.join(tempDir, "artifacts-verbose");

		const { stdout, exitCode } = await execa("bash", [
			scriptPath,
			"--plan", testPlan,
			"--artifacts", artifactsDir,
			"--verbose",
			"--dry-run"
		], {
			cwd: process.cwd(),
			reject: false
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Configuration:");
	}, 60000);
});
