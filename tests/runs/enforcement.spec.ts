/**
 * Enforcement Module Tests
 *
 * Tests for tool-grounded mode enforcement, including violation detection,
 * logging, and risk flag generation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
	ViolationType,
	ViolationSeverity,
	EnforcementMode,
	DEFAULT_ENFORCEMENT_CONFIG,
	requiresEnforcement,
	detectGitViolation,
	detectGhViolation,
	detectCiConfigViolation,
	getViolationSeverity,
	logViolation,
	getViolations,
	countViolationsBySeverity,
	generateViolationRiskFlags,
	checkAndLogViolation,
} from "../../src/runs/enforcement.js";
import { createRunManager } from "../../src/runs/manager.js";

describe("Enforcement Module", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "enforcement-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("requiresEnforcement", () => {
		it("should return true for senior-dev mode", () => {
			expect(requiresEnforcement("senior-dev")).toBe(true);
		});

		it("should return true for tool-grounded mode", () => {
			expect(requiresEnforcement("tool-grounded")).toBe(true);
		});

		it("should return false for eager-pm mode", () => {
			expect(requiresEnforcement("eager-pm")).toBe(false);
		});

		it("should return false for unknown modes", () => {
			expect(requiresEnforcement("unknown")).toBe(false);
		});

		it("should respect custom config", () => {
			const config = {
				...DEFAULT_ENFORCEMENT_CONFIG,
				enforcedModes: ["custom-mode"],
			};
			expect(requiresEnforcement("custom-mode", config)).toBe(true);
			expect(requiresEnforcement("senior-dev", config)).toBe(false);
		});
	});

	describe("detectGitViolation", () => {
		it("should detect git merge", () => {
			expect(detectGitViolation("git merge main")).toBe(
				ViolationType.DIRECT_MERGE
			);
		});

		it("should detect git push", () => {
			expect(detectGitViolation("git push origin main")).toBe(
				ViolationType.DIRECT_GIT_COMMAND
			);
		});

		it("should detect git rebase", () => {
			expect(detectGitViolation("git rebase main")).toBe(
				ViolationType.DIRECT_GIT_COMMAND
			);
		});

		it("should detect git cherry-pick", () => {
			expect(detectGitViolation("git cherry-pick abc123")).toBe(
				ViolationType.DIRECT_GIT_COMMAND
			);
		});

		it("should detect git reset --hard", () => {
			expect(detectGitViolation("git reset --hard HEAD~1")).toBe(
				ViolationType.DIRECT_GIT_COMMAND
			);
		});

		it("should detect git checkout -B", () => {
			expect(detectGitViolation("git checkout -B new-branch")).toBe(
				ViolationType.DIRECT_GIT_COMMAND
			);
		});

		it("should allow git status", () => {
			expect(detectGitViolation("git status")).toBeNull();
		});

		it("should allow git log", () => {
			expect(detectGitViolation("git log --oneline")).toBeNull();
		});

		it("should allow git diff", () => {
			expect(detectGitViolation("git diff HEAD~1")).toBeNull();
		});

		it("should be case-insensitive", () => {
			expect(detectGitViolation("GIT MERGE main")).toBe(
				ViolationType.DIRECT_MERGE
			);
		});
	});

	describe("detectGhViolation", () => {
		it("should detect gh pr merge", () => {
			expect(detectGhViolation("gh pr merge 42")).toBe(
				ViolationType.DIRECT_MERGE
			);
		});

		it("should detect gh pr close", () => {
			expect(detectGhViolation("gh pr close 42")).toBe(
				ViolationType.DIRECT_GH_COMMAND
			);
		});

		it("should detect gh pr create", () => {
			expect(detectGhViolation("gh pr create --title 'Test'")).toBe(
				ViolationType.DIRECT_GH_COMMAND
			);
		});

		it("should allow gh pr view", () => {
			expect(detectGhViolation("gh pr view 42")).toBeNull();
		});

		it("should allow gh pr list", () => {
			expect(detectGhViolation("gh pr list")).toBeNull();
		});

		it("should be case-insensitive", () => {
			expect(detectGhViolation("GH PR MERGE 42")).toBe(
				ViolationType.DIRECT_MERGE
			);
		});
	});

	describe("detectCiConfigViolation", () => {
		it("should detect .github/workflows modifications", () => {
			expect(
				detectCiConfigViolation(".github/workflows/ci.yml")
			).toBe(ViolationType.MODIFY_CI_CONFIG);
		});

		it("should detect .gitlab-ci.yml modifications", () => {
			expect(detectCiConfigViolation(".gitlab-ci.yml")).toBe(
				ViolationType.MODIFY_CI_CONFIG
			);
		});

		it("should detect Jenkinsfile modifications", () => {
			expect(detectCiConfigViolation("Jenkinsfile")).toBe(
				ViolationType.MODIFY_CI_CONFIG
			);
		});

		it("should detect .circleci modifications", () => {
			expect(detectCiConfigViolation(".circleci/config.yml")).toBe(
				ViolationType.MODIFY_CI_CONFIG
			);
		});

		it("should detect azure-pipelines.yml modifications", () => {
			expect(detectCiConfigViolation("azure-pipelines.yml")).toBe(
				ViolationType.MODIFY_CI_CONFIG
			);
		});

		it("should allow regular source files", () => {
			expect(detectCiConfigViolation("src/index.ts")).toBeNull();
		});

		it("should allow test files", () => {
			expect(detectCiConfigViolation("tests/test.spec.ts")).toBeNull();
		});
	});

	describe("getViolationSeverity", () => {
		it("should return warning for DIRECT_GIT_COMMAND", () => {
			expect(getViolationSeverity(ViolationType.DIRECT_GIT_COMMAND)).toBe(
				ViolationSeverity.WARNING
			);
		});

		it("should return warning for DIRECT_GH_COMMAND", () => {
			expect(getViolationSeverity(ViolationType.DIRECT_GH_COMMAND)).toBe(
				ViolationSeverity.WARNING
			);
		});

		it("should return error for DIRECT_MERGE", () => {
			expect(getViolationSeverity(ViolationType.DIRECT_MERGE)).toBe(
				ViolationSeverity.ERROR
			);
		});

		it("should return error for BYPASS_GATES", () => {
			expect(getViolationSeverity(ViolationType.BYPASS_GATES)).toBe(
				ViolationSeverity.ERROR
			);
		});

		it("should return critical for MODIFY_CI_CONFIG", () => {
			expect(getViolationSeverity(ViolationType.MODIFY_CI_CONFIG)).toBe(
				ViolationSeverity.CRITICAL
			);
		});

		it("should return critical for FORBIDDEN_ACTION", () => {
			expect(getViolationSeverity(ViolationType.FORBIDDEN_ACTION)).toBe(
				ViolationSeverity.CRITICAL
			);
		});

		it("should return warning for SKIP_POLICY", () => {
			expect(getViolationSeverity(ViolationType.SKIP_POLICY)).toBe(
				ViolationSeverity.WARNING
			);
		});
	});

	describe("logViolation", () => {
		it("should log a violation entry", async () => {
			// Create a run first
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Log a violation
			const entry = logViolation(
				run.runId,
				ViolationType.DIRECT_GIT_COMMAND,
				{
					command: "git push origin main",
					context: "Test context",
				},
				testDir
			);

			expect(entry.runId).toBe(run.runId);
			expect(entry.violation).toBe(ViolationType.DIRECT_GIT_COMMAND);
			expect(entry.command).toBe("git push origin main");
			expect(entry.context).toBe("Test context");
			expect(entry.severity).toBe("warning");
			expect(entry.timestamp).toBeDefined();
		});

		it("should persist violation to failures.ndjson", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(
				run.runId,
				ViolationType.DIRECT_MERGE,
				{ command: "git merge main" },
				testDir
			);

			// Read back
			const violations = getViolations(run.runId, testDir);
			expect(violations).toHaveLength(1);
			expect(violations[0].violation).toBe(ViolationType.DIRECT_MERGE);
		});
	});

	describe("getViolations", () => {
		it("should return empty array for run with no violations", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const violations = getViolations(run.runId, testDir);
			expect(violations).toEqual([]);
		});

		it("should return all violations for a run", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(run.runId, ViolationType.DIRECT_GIT_COMMAND, {}, testDir);
			logViolation(run.runId, ViolationType.DIRECT_MERGE, {}, testDir);
			logViolation(run.runId, ViolationType.BYPASS_GATES, {}, testDir);

			const violations = getViolations(run.runId, testDir);
			expect(violations).toHaveLength(3);
		});

		it("should filter out non-violation entries", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Log a violation
			logViolation(run.runId, ViolationType.DIRECT_GIT_COMMAND, {}, testDir);

			// Log a regular failure (not a violation)
			await manager.logFailure(run.runId, {
				step: "lint",
				error: "ESLint failed",
			});

			const violations = getViolations(run.runId, testDir);
			expect(violations).toHaveLength(1);
			expect(violations[0].violation).toBe(ViolationType.DIRECT_GIT_COMMAND);
		});
	});

	describe("countViolationsBySeverity", () => {
		it("should count violations by severity", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Log violations of different severities
			logViolation(
				run.runId,
				ViolationType.DIRECT_GIT_COMMAND,
				{},
				testDir
			); // warning
			logViolation(
				run.runId,
				ViolationType.DIRECT_GH_COMMAND,
				{},
				testDir
			); // warning
			logViolation(run.runId, ViolationType.DIRECT_MERGE, {}, testDir); // error
			logViolation(
				run.runId,
				ViolationType.MODIFY_CI_CONFIG,
				{},
				testDir
			); // critical

			const violations = getViolations(run.runId, testDir);
			const counts = countViolationsBySeverity(violations);

			expect(counts.warning).toBe(2);
			expect(counts.error).toBe(1);
			expect(counts.critical).toBe(1);
		});

		it("should return zeros for empty array", () => {
			const counts = countViolationsBySeverity([]);
			expect(counts.warning).toBe(0);
			expect(counts.error).toBe(0);
			expect(counts.critical).toBe(0);
		});
	});

	describe("generateViolationRiskFlags", () => {
		it("should return empty array for no violations", () => {
			const flags = generateViolationRiskFlags([]);
			expect(flags).toEqual([]);
		});

		it("should include total violation count", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(
				run.runId,
				ViolationType.DIRECT_GIT_COMMAND,
				{},
				testDir
			);
			logViolation(
				run.runId,
				ViolationType.DIRECT_GH_COMMAND,
				{},
				testDir
			);

			const violations = getViolations(run.runId, testDir);
			const flags = generateViolationRiskFlags(violations);

			expect(flags).toContain("violations:2");
		});

		it("should include critical count when present", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(
				run.runId,
				ViolationType.MODIFY_CI_CONFIG,
				{},
				testDir
			);

			const violations = getViolations(run.runId, testDir);
			const flags = generateViolationRiskFlags(violations);

			expect(flags).toContain("violations:1");
			expect(flags).toContain("critical-violations:1");
			expect(flags).toContain("ci-config-modified");
		});

		it("should include error count when present", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(run.runId, ViolationType.DIRECT_MERGE, {}, testDir);

			const violations = getViolations(run.runId, testDir);
			const flags = generateViolationRiskFlags(violations);

			expect(flags).toContain("violations:1");
			expect(flags).toContain("error-violations:1");
			expect(flags).toContain("direct-merge-attempted");
		});

		it("should include gates-bypassed flag", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			logViolation(run.runId, ViolationType.BYPASS_GATES, {}, testDir);

			const violations = getViolations(run.runId, testDir);
			const flags = generateViolationRiskFlags(violations);

			expect(flags).toContain("gates-bypassed");
		});
	});

	describe("checkAndLogViolation", () => {
		it("should detect and log git violations", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "git push origin main", {
				mode: "senior-dev",
				baseDir: testDir,
			});

			expect(entry).not.toBeNull();
			expect(entry!.violation).toBe(ViolationType.DIRECT_GIT_COMMAND);

			// Verify logged
			const violations = getViolations(run.runId, testDir);
			expect(violations).toHaveLength(1);
		});

		it("should detect and log gh violations", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "gh pr merge 42", {
				mode: "senior-dev",
				baseDir: testDir,
			});

			expect(entry).not.toBeNull();
			expect(entry!.violation).toBe(ViolationType.DIRECT_MERGE);
		});

		it("should return null for non-enforced modes", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "eager-pm",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "git push origin main", {
				mode: "eager-pm",
				baseDir: testDir,
			});

			expect(entry).toBeNull();
		});

		it("should return null for allowed commands", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "git status", {
				mode: "senior-dev",
				baseDir: testDir,
			});

			expect(entry).toBeNull();
		});

		it("should skip logging when log: false", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "git push origin main", {
				mode: "senior-dev",
				log: false,
				baseDir: testDir,
			});

			expect(entry).not.toBeNull();

			// Verify NOT logged
			const violations = getViolations(run.runId, testDir);
			expect(violations).toHaveLength(0);
		});

		it("should set blocked: true in hard mode", async () => {
			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const entry = checkAndLogViolation(run.runId, "git push origin main", {
				mode: "senior-dev",
				config: { ...DEFAULT_ENFORCEMENT_CONFIG, mode: "hard" },
				baseDir: testDir,
			});

			expect(entry).not.toBeNull();
			expect(entry!.blocked).toBe(true);
		});
	});

	describe("StatusResponse integration", () => {
		it("should include violation risk flags in status", async () => {
			const { buildStatusResponse } = await import(
				"../../src/runs/statusBuilder.js"
			);

			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Log some violations
			logViolation(run.runId, ViolationType.DIRECT_MERGE, {}, testDir);
			logViolation(
				run.runId,
				ViolationType.MODIFY_CI_CONFIG,
				{},
				testDir
			);

			// Get status with baseDir
			const status = buildStatusResponse(run, { baseDir: testDir });

			expect(status.riskFlags).toBeDefined();
			expect(status.riskFlags).toContain("violations:2");
			expect(status.riskFlags).toContain("error-violations:1");
			expect(status.riskFlags).toContain("critical-violations:1");
		});

		it("should not include risk flags when no violations", async () => {
			const { buildStatusResponse } = await import(
				"../../src/runs/statusBuilder.js"
			);

			const manager = createRunManager(testDir);
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const status = buildStatusResponse(run, { baseDir: testDir });

			expect(status.riskFlags).toBeUndefined();
		});
	});
});
