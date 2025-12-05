/**
 * Tests for hostility check functions
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	checkConstraintClarity,
	checkRequirementExplicitness,
	checkProblemBoundedness,
	checkReceiptCompleteness,
	checkErrorRecoverability,
	checkStateCoherence,
	checkModelContinuity,
	runAllChecks,
} from "../../src/hostility/checks.js";

describe("Hostility Check Functions", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostility-test-"));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe("checkConstraintClarity", () => {
		it("returns high score when no constraint files exist", () => {
			const result = checkConstraintClarity({ cwd: tempDir });

			expect(result.score).toBe(1);
			expect(result.status).toBe("critical");
			expect(result.details).toContain("No constraint files found");
		});

		it("returns lower score when AGENTS.md exists", () => {
			fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Agent Instructions");

			const result = checkConstraintClarity({ cwd: tempDir });

			expect(result.score).toBeLessThan(1);
			expect(result.details).toContain("AGENTS.md");
		});

		it("returns lowest score when all constraint files exist", () => {
			fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Agent Instructions");
			fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "# Claude Instructions");
			fs.mkdirSync(path.join(tempDir, ".github"), { recursive: true });
			fs.writeFileSync(
				path.join(tempDir, ".github", "copilot-instructions.md"),
				"# Copilot"
			);
			fs.writeFileSync(
				path.join(tempDir, "lexmap.policy.json"),
				JSON.stringify({})
			);

			const result = checkConstraintClarity({ cwd: tempDir });

			expect(result.score).toBe(0);
			expect(result.status).toBe("good");
		});
	});

	describe("checkRequirementExplicitness", () => {
		it("returns moderate score when no scope files exist", () => {
			const result = checkRequirementExplicitness({ cwd: tempDir });

			expect(result.score).toBeGreaterThan(0.3);
			expect(result.details).toContain("No scope or plan files found");
		});

		it("returns lower score when scope files exist", () => {
			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
			fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), "target: main");

			const result = checkRequirementExplicitness({
				cwd: tempDir,
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(result.score).toBeLessThan(0.5);
			expect(result.details).toContain("Scope files found");
		});

		it("returns lowest score when plan.json is valid", () => {
			const plan = {
				schemaVersion: "1.0",
				items: [{ name: "item1", gates: [] }],
			};
			fs.writeFileSync(path.join(tempDir, "plan.json"), JSON.stringify(plan));
			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
			fs.writeFileSync(path.join(tempDir, ".smartergpt", "scope.yml"), "target: main");

			const result = checkRequirementExplicitness({
				cwd: tempDir,
				planPath: path.join(tempDir, "plan.json"),
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(result.score).toBeLessThan(0.3);
			expect(result.details).toContain("Plan validated");
		});
	});

	describe("checkProblemBoundedness", () => {
		it("returns moderate score when no plan exists", () => {
			const result = checkProblemBoundedness({ cwd: tempDir });

			expect(result.score).toBe(0.5);
			expect(result.status).toBe("warning");
			expect(result.details).toContain("No plan.json found");
		});

		it("returns low score for plans with few items", () => {
			const plan = {
				items: Array(5).fill({ name: "item", gates: [] }),
			};
			fs.writeFileSync(path.join(tempDir, "plan.json"), JSON.stringify(plan));

			const result = checkProblemBoundedness({
				cwd: tempDir,
				planPath: path.join(tempDir, "plan.json"),
			});

			expect(result.score).toBe(0);
			expect(result.status).toBe("good");
		});

		it("returns higher score for plans with many items", () => {
			const plan = {
				items: Array(15).fill({ name: "item", gates: [] }),
			};
			fs.writeFileSync(path.join(tempDir, "plan.json"), JSON.stringify(plan));

			const result = checkProblemBoundedness({
				cwd: tempDir,
				planPath: path.join(tempDir, "plan.json"),
			});

			expect(result.score).toBe(0.5);
			expect(result.status).toBe("warning");
			expect(result.recommendation).toContain("Split plan");
		});

		it("returns maximum score for very large plans", () => {
			const plan = {
				items: Array(25).fill({ name: "item", gates: [] }),
			};
			fs.writeFileSync(path.join(tempDir, "plan.json"), JSON.stringify(plan));

			const result = checkProblemBoundedness({
				cwd: tempDir,
				planPath: path.join(tempDir, "plan.json"),
			});

			expect(result.score).toBe(1);
			expect(result.status).toBe("critical");
		});
	});

	describe("checkReceiptCompleteness", () => {
		it("returns moderate score without receipts", () => {
			const result = checkReceiptCompleteness({ cwd: tempDir });

			// Frame emission is enabled by default (env var not set to 'false')
			expect(result.score).toBeLessThanOrEqual(0.5);
		});

		it("returns lower score when deliverables directory exists", () => {
			fs.mkdirSync(path.join(tempDir, ".smartergpt", "deliverables"), {
				recursive: true,
			});

			const result = checkReceiptCompleteness({
				cwd: tempDir,
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(result.score).toBeLessThan(0.5);
		});
	});

	describe("checkErrorRecoverability", () => {
		it("returns moderate score without gates configuration", () => {
			const result = checkErrorRecoverability({ cwd: tempDir });

			expect(result.score).toBeGreaterThan(0.2);
		});

		it("returns lower score when gates.yml exists", () => {
			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "gates.yml"),
				"gates:\n  - name: lint"
			);

			const result = checkErrorRecoverability({
				cwd: tempDir,
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(result.score).toBeLessThan(0.5);
		});

		it("returns lower score when git is available", () => {
			fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });

			const result = checkErrorRecoverability({ cwd: tempDir });

			expect(result.score).toBeLessThanOrEqual(0.5);
		});
	});

	describe("checkStateCoherence", () => {
		it("returns baseline score with no directories", () => {
			const result = checkStateCoherence({ cwd: tempDir });

			expect(result.score).toBeGreaterThan(0);
			expect(result.details).toContain("No state directories found");
		});

		it("returns lower score with expected directories", () => {
			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });

			const result = checkStateCoherence({ cwd: tempDir });

			expect(result.score).toBeLessThan(0.3);
			expect(result.details).toContain("expected locations");
		});

		it("returns higher score with unexpected directories", () => {
			fs.mkdirSync(path.join(tempDir, "temp"), { recursive: true });

			const result = checkStateCoherence({ cwd: tempDir });

			expect(result.score).toBeGreaterThan(0.3);
			expect(result.details).toContain("non-standard locations");
			expect(result.recommendation).toContain("Consolidate");
		});
	});

	describe("checkModelContinuity", () => {
		it("returns moderate score without continuity files", () => {
			const result = checkModelContinuity({ cwd: tempDir });

			expect(result.score).toBe(0.5);
			expect(result.status).toBe("warning");
		});

		it("returns lower score when intent.md exists", () => {
			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "intent.md"),
				"# Project Intent"
			);

			const result = checkModelContinuity({
				cwd: tempDir,
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(result.score).toBeLessThan(0.5);
		});

		it("returns lowest score when HANDOFF.md exists", () => {
			fs.writeFileSync(path.join(tempDir, "HANDOFF.md"), "# Handoff Protocol");

			const result = checkModelContinuity({ cwd: tempDir });

			expect(result.score).toBeLessThan(0.3);
			expect(result.status).toBe("good");
			expect(result.details).toContain("Continuity protocol documented");
		});
	});

	describe("runAllChecks", () => {
		it("returns all component checks", () => {
			const results = runAllChecks({ cwd: tempDir });

			expect(results.constraintClarity).toBeDefined();
			expect(results.requirementExplicitness).toBeDefined();
			expect(results.problemBoundedness).toBeDefined();
			expect(results.receiptCompleteness).toBeDefined();
			expect(results.errorRecoverability).toBeDefined();
			expect(results.stateCoherence).toBeDefined();
			expect(results.modelContinuity).toBeDefined();
		});

		it("returns valid components for all checks", () => {
			const results = runAllChecks({ cwd: tempDir });

			for (const [name, component] of Object.entries(results)) {
				expect(component.score).toBeGreaterThanOrEqual(0);
				expect(component.score).toBeLessThanOrEqual(1);
				expect(["good", "warning", "critical"]).toContain(component.status);
				expect(typeof component.details).toBe("string");
			}
		});
	});
});
