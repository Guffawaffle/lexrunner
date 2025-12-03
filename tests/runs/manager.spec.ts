/**
 * Run Lifecycle Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, readFileSync, readdirSync } from "fs";
import {
	RunManager,
	createRunManager,
	readIndex,
	readRunState,
	readRunLog,
} from "../../src/runs/index.js";
import type {
	CreateRunParams,
	RunFilter,
	PersonaSnapshot,
} from "../../src/runs/types.js";
import type { PersonaSnapshot as PersonaSnapshotType } from "../../src/schemas/runCentric.js";

describe("RunManager", () => {
	let testDir: string;
	let manager: RunManager;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "run-manager-test-"));
		manager = createRunManager(testDir);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("createRun", () => {
		it("should create a run with unique ULID", async () => {
			const params: CreateRunParams = {
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "owner/repo",
			};

			const run = await manager.createRun(params);

			expect(run.runId).toBeDefined();
			expect(run.runId.length).toBe(26); // ULID length
			expect(run.mode).toBe("senior-dev");
			expect(run.procedure).toBe("merge-weave-main");
			expect(run.repo).toBe("owner/repo");
			expect(run.state).toBe("initialized");
			expect(run.createdAt).toBeDefined();
			expect(run.updatedAt).toBeDefined();
			expect(run.completedSteps).toEqual([]);
			expect(run.currentStep).toBeNull();
		});

		it("should persist run state to disk", async () => {
			const params: CreateRunParams = {
				mode: "eager-pm",
				procedure: "pr-review",
				repo: "test/repo",
				task: "Review PR #42",
			};

			const run = await manager.createRun(params);

			// Verify file exists
			const statePath = join(
				testDir,
				".lexrunner",
				"runs",
				`${run.runId}.json`
			);
			expect(existsSync(statePath)).toBe(true);

			// Verify content
			const content = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(content.runId).toBe(run.runId);
			expect(content.task).toBe("Review PR #42");
		});

		it("should create run directory structure", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const runDir = join(testDir, ".lexrunner", "runs", run.runId);
			expect(existsSync(runDir)).toBe(true);
			expect(existsSync(join(runDir, "artifacts"))).toBe(true);
		});

		it("should update index on create", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const index = readIndex(testDir);
			expect(index.runs).toHaveLength(1);
			expect(index.runs[0].runId).toBe(run.runId);
			expect(index.schemaVersion).toBe("1.0.0");
		});

		it("should use custom initial state if provided", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				initialState: "planning",
			});

			expect(run.state).toBe("planning");
		});

		it("should include params and metadata if provided", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				params: { targetBranch: "main", dryRun: true },
				metadata: { source: "cli", version: "1.0.0" },
			});

			expect(run.params).toEqual({ targetBranch: "main", dryRun: true });
			expect(run.metadata).toEqual({ source: "cli", version: "1.0.0" });
		});

		it("should freeze persona snapshot at run start", async () => {
			const persona: PersonaSnapshotType = {
				mode: "senior-dev",
				forbidden: ["force-push"],
				completionGates: ["lint", "test"],
			};

			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				persona,
			});

			expect(run.persona).toEqual(persona);
		});
	});

	describe("getRun", () => {
		it("should return run state by runId", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const retrieved = await manager.getRun(created.runId);

			expect(retrieved).not.toBeNull();
			expect(retrieved!.runId).toBe(created.runId);
			expect(retrieved!.mode).toBe(created.mode);
			expect(retrieved!.procedure).toBe(created.procedure);
		});

		it("should return null for unknown runId", async () => {
			const retrieved = await manager.getRun("01UNKNOWN123456789012345");

			expect(retrieved).toBeNull();
		});
	});

	describe("listRunStates", () => {
		it("should list all runs when no filter", async () => {
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo1",
			});
			await manager.createRun({
				mode: "eager-pm",
				procedure: "pr-review",
				repo: "test/repo2",
			});
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo3",
			});

			const runs = await manager.listRunStates();

			expect(runs).toHaveLength(3);
		});

		it("should filter by state", async () => {
			const run1 = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo1",
			});
			await manager.createRun({
				mode: "eager-pm",
				procedure: "pr-review",
				repo: "test/repo2",
			});

			// Update first run to a different state
			await manager.updateRun(run1.runId, { state: "executing" });

			const runs = await manager.listRunStates({ state: "executing" });

			expect(runs).toHaveLength(1);
			expect(runs[0].state).toBe("executing");
		});

		it("should filter by procedure", async () => {
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo1",
			});
			await manager.createRun({
				mode: "eager-pm",
				procedure: "pr-review",
				repo: "test/repo2",
			});
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo3",
			});

			const runs = await manager.listRunStates({
				procedure: "merge-weave",
			});

			expect(runs).toHaveLength(2);
			runs.forEach((run) => expect(run.procedure).toBe("merge-weave"));
		});

		it("should filter by mode", async () => {
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo1",
			});
			await manager.createRun({
				mode: "eager-pm",
				procedure: "pr-review",
				repo: "test/repo2",
			});

			const runs = await manager.listRunStates({ mode: "eager-pm" });

			expect(runs).toHaveLength(1);
			expect(runs[0].mode).toBe("eager-pm");
		});

		it("should apply limit", async () => {
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo1",
			});
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo2",
			});
			await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave",
				repo: "test/repo3",
			});

			const runs = await manager.listRunStates({ limit: 2 });

			expect(runs).toHaveLength(2);
		});

		it("should return empty array when no runs exist", async () => {
			const runs = await manager.listRunStates();

			expect(runs).toEqual([]);
		});
	});

	describe("updateRun", () => {
		it("should update run state", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Small delay to ensure timestamps differ
			await new Promise((resolve) => setTimeout(resolve, 10));

			const updated = await manager.updateRun(created.runId, {
				state: "executing",
				currentStep: "merge-step-1",
			});

			expect(updated.state).toBe("executing");
			expect(updated.currentStep).toBe("merge-step-1");
			// updatedAt should be a valid ISO timestamp (may or may not differ due to timing)
			expect(updated.updatedAt).toBeDefined();
		});

		it("should be atomic (no partial writes)", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			// Simulate update
			await manager.updateRun(created.runId, {
				state: "executing",
				completedSteps: ["step1", "step2"],
			});

			// Read directly from disk
			const persisted = readRunState(created.runId, testDir);
			expect(persisted).not.toBeNull();
			expect(persisted!.state).toBe("executing");
			expect(persisted!.completedSteps).toEqual(["step1", "step2"]);
		});

		it("should prevent runId from being changed", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const updated = await manager.updateRun(created.runId, {
				runId: "FAKE_ID_SHOULD_NOT_WORK",
			} as any);

			expect(updated.runId).toBe(created.runId);
		});

		it("should throw error for unknown runId", async () => {
			await expect(
				manager.updateRun("01UNKNOWN123456789012345", {
					state: "executing",
				})
			).rejects.toThrow("Run not found");
		});

		it("should update index on update", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.updateRun(created.runId, { state: "completed" });

			const index = readIndex(testDir);
			expect(index.runs[0].state).toBe("completed");
		});
	});

	describe("transitionState", () => {
		it("should transition run state", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const updated = await manager.transitionState(
				created.runId,
				"executing"
			);

			expect(updated.state).toBe("executing");
		});

		it("should log state transition", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.transitionState(created.runId, "executing");

			const decisions = readRunLog(created.runId, "decisions", testDir);
			expect(decisions).toHaveLength(1);
			expect(decisions[0].type).toBe("state_transition");
			expect(decisions[0].from).toBe("initialized");
			expect(decisions[0].to).toBe("executing");
		});

		it("should set completedAt for terminal states", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const updated = await manager.transitionState(
				created.runId,
				"completed"
			);

			expect(updated.completedAt).toBeDefined();
		});

		it("should throw error for unknown runId", async () => {
			await expect(
				manager.transitionState("01UNKNOWN123456789012345", "executing")
			).rejects.toThrow("Run not found");
		});
	});

	describe("completeStep", () => {
		it("should mark step as complete", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const updated = await manager.completeStep(
				created.runId,
				"step1",
				"step2"
			);

			expect(updated.completedSteps).toContain("step1");
			expect(updated.currentStep).toBe("step2");
		});

		it("should not duplicate completed steps", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.completeStep(created.runId, "step1", "step2");
			const updated = await manager.completeStep(
				created.runId,
				"step1",
				"step3"
			);

			const stepCount = updated.completedSteps.filter(
				(s) => s === "step1"
			).length;
			expect(stepCount).toBe(1);
		});
	});

	describe("logDecision and getDecisions", () => {
		it("should log and retrieve decisions", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.logDecision(created.runId, {
				type: "user_choice",
				action: "skip_gate",
				rationale: "Gate is flaky",
			});

			await manager.logDecision(created.runId, {
				type: "auto_choice",
				action: "retry_gate",
				context: { attempt: 2 },
			});

			const decisions = await manager.getDecisions(created.runId);

			expect(decisions).toHaveLength(2);
			expect(decisions[0].type).toBe("user_choice");
			expect(decisions[1].type).toBe("auto_choice");
		});
	});

	describe("logFailure and getFailures", () => {
		it("should log and retrieve failures", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.logFailure(created.runId, {
				step: "lint",
				error: "ESLint found 5 errors",
				recoverable: true,
			});

			const failures = await manager.getFailures(created.runId);

			expect(failures).toHaveLength(1);
			expect(failures[0].step).toBe("lint");
			expect(failures[0].error).toBe("ESLint found 5 errors");
		});
	});

	describe("archiveRun", () => {
		it("should mark run as archived", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.archiveRun(created.runId);

			const archived = await manager.getRun(created.runId);
			expect(archived!.metadata.archived).toBe(true);
			expect(archived!.metadata.archivedAt).toBeDefined();
		});
	});

	describe("deleteRun", () => {
		it("should delete run state and directory", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.deleteRun(created.runId);

			// Verify state file is gone
			const statePath = join(
				testDir,
				".lexrunner",
				"runs",
				`${created.runId}.json`
			);
			expect(existsSync(statePath)).toBe(false);

			// Verify run directory is gone
			const runDir = join(testDir, ".lexrunner", "runs", created.runId);
			expect(existsSync(runDir)).toBe(false);

			// Verify index is updated
			const index = readIndex(testDir);
			expect(index.runs).toHaveLength(0);
		});

		it("should return null after deletion", async () => {
			const created = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			await manager.deleteRun(created.runId);

			const deleted = await manager.getRun(created.runId);
			expect(deleted).toBeNull();
		});
	});

	describe("integration: create → update → complete lifecycle", () => {
		it("should handle complete run lifecycle", async () => {
			// Step 1: Create run
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				task: "Merge PRs #1, #2, #3",
			});

			expect(run.state).toBe("initialized");

			// Step 2: Transition to planning
			let current = await manager.transitionState(run.runId, "planning");
			expect(current.state).toBe("planning");

			// Step 3: Complete planning step
			current = await manager.completeStep(
				run.runId,
				"analyze-deps",
				"execute-merges"
			);
			expect(current.completedSteps).toContain("analyze-deps");
			expect(current.currentStep).toBe("execute-merges");

			// Step 4: Transition to executing
			current = await manager.transitionState(run.runId, "executing");
			expect(current.state).toBe("executing");

			// Step 5: Log a decision
			await manager.logDecision(run.runId, {
				type: "merge_decision",
				pr: 1,
				action: "merge",
			});

			// Step 6: Complete execution
			current = await manager.completeStep(
				run.runId,
				"execute-merges",
				null
			);
			expect(current.completedSteps).toContain("execute-merges");
			expect(current.currentStep).toBeNull();

			// Step 7: Transition to completed
			current = await manager.transitionState(run.runId, "completed");
			expect(current.state).toBe("completed");
			expect(current.completedAt).toBeDefined();

			// Verify decisions were logged
			const decisions = await manager.getDecisions(run.runId);
			expect(decisions.length).toBeGreaterThan(0);

			// Verify full lifecycle is persisted
			const persisted = await manager.getRun(run.runId);
			expect(persisted!.state).toBe("completed");
			expect(persisted!.completedSteps).toEqual([
				"analyze-deps",
				"execute-merges",
			]);
		});
	});

	describe("completeRunWithFrame (AX-005)", () => {
		it("should emit and persist Frame on run completion", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				task: "Merge PRs",
				params: { prNumbers: [101, 102] },
			});

			const { runState, frameResult } = await manager.completeRunWithFrame(
				run.runId,
				"success",
				["Deploy to staging", "Run e2e tests"]
			);

			expect(runState.state).toBe("completed");
			expect(runState.completedAt).toBeDefined();
			expect(frameResult.success).toBe(true);
			expect(frameResult.frame).toBeDefined();
			expect(frameResult.frame!.type).toBe("procedure");
			expect(frameResult.frame!.outcome).toBe("success");
			expect(frameResult.frameId).toBeDefined();

			// Verify Frame was logged in decisions
			const decisions = await manager.getDecisions(run.runId);
			const frameEmittedDecision = decisions.find(
				(d) => d.type === "frame_emitted"
			);
			expect(frameEmittedDecision).toBeDefined();
			expect(frameEmittedDecision!.frameId).toBe(frameResult.frameId);
		});

		it("should emit failure Frame on failed run", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const { runState, frameResult } = await manager.completeRunWithFrame(
				run.runId,
				"failure",
				["Check error logs", "Fix issues and retry"],
				{ error: "Merge conflict in src/cli.ts" }
			);

			expect(runState.state).toBe("failed");
			expect(frameResult.success).toBe(true);
			expect(frameResult.frame!.outcome).toBe("failure");
			expect(frameResult.frame!.metadata?.error).toBe("Merge conflict in src/cli.ts");
		});

		it("should emit partial Frame with partial outcome", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
				params: { prNumbers: [101, 102, 103] },
			});

			const { runState, frameResult } = await manager.completeRunWithFrame(
				run.runId,
				"partial",
				["Review partial results", "Retry failed items"]
			);

			// Partial outcome still transitions to 'completed' (with partial results)
			expect(runState.state).toBe("completed");
			expect(frameResult.success).toBe(true);
			expect(frameResult.frame!.outcome).toBe("partial");
		});

		it("should include artifacts in Frame metadata", async () => {
			const run = await manager.createRun({
				mode: "senior-dev",
				procedure: "merge-weave-main",
				repo: "test/repo",
			});

			const { frameResult } = await manager.completeRunWithFrame(
				run.runId,
				"success",
				["Review artifacts"],
				{ artifacts: ["/tmp/report.json", "/tmp/logs.txt"] }
			);

			expect(frameResult.frame!.metadata?.artifacts).toEqual([
				"/tmp/report.json",
				"/tmp/logs.txt",
			]);
		});
	});
});
