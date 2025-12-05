/**
 * Tests for hostility scoring integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	runEnvironmentQualityCheck,
	formatHostilityReport,
} from "../../src/hostility/index.js";

describe("Hostility Integration", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hostility-integration-"));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe("runEnvironmentQualityCheck", () => {
		it("returns a complete hostility score", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });

			expect(score.total).toBeGreaterThanOrEqual(0);
			expect(score.total).toBeLessThanOrEqual(1);
			expect(["low", "medium", "high"]).toContain(score.status);
			expect(score.components).toBeDefined();
			expect(Array.isArray(score.recommendations)).toBe(true);
		});

		it("returns low hostility for well-configured environment", () => {
			// Create a well-configured environment
			fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "# Agent Instructions");
			fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "# Claude Instructions");
			fs.mkdirSync(path.join(tempDir, ".github"), { recursive: true });
			fs.writeFileSync(
				path.join(tempDir, ".github", "copilot-instructions.md"),
				"# Copilot"
			);
			fs.writeFileSync(path.join(tempDir, "lexmap.policy.json"), "{}");

			fs.mkdirSync(path.join(tempDir, ".smartergpt"), { recursive: true });
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "scope.yml"),
				"target: main"
			);
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "intent.md"),
				"# Intent"
			);
			fs.writeFileSync(
				path.join(tempDir, ".smartergpt", "gates.yml"),
				"gates:\n  - name: lint"
			);

			const plan = {
				schemaVersion: "1.0",
				items: Array(5).fill({ name: "item", gates: [] }),
			};
			fs.writeFileSync(path.join(tempDir, "plan.json"), JSON.stringify(plan));

			fs.writeFileSync(path.join(tempDir, "HANDOFF.md"), "# Handoff Protocol");
			fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });

			const score = runEnvironmentQualityCheck({
				cwd: tempDir,
				planPath: path.join(tempDir, "plan.json"),
				profileDir: path.join(tempDir, ".smartergpt"),
			});

			expect(score.total).toBeLessThan(0.3);
			expect(score.status).toBe("low");
		});

		it("returns high hostility for unconfigured environment", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });

			expect(score.total).toBeGreaterThan(0.3);
			expect(score.recommendations.length).toBeGreaterThan(0);
		});
	});

	describe("formatHostilityReport", () => {
		it("formats report with correct header", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });
			const report = formatHostilityReport(score);

			expect(report).toContain("Environment Quality Report");
			expect(report).toContain("==========================");
		});

		it("includes overall score and status", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });
			const report = formatHostilityReport(score);

			expect(report).toContain("Overall Hostility Score:");
			expect(report).toMatch(/\d+\.\d+/); // Contains decimal score
		});

		it("includes component breakdown", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });
			const report = formatHostilityReport(score);

			expect(report).toContain("Component Breakdown:");
			expect(report).toContain("Constraint Clarity");
			expect(report).toContain("Requirement Explicitness");
			expect(report).toContain("Problem Boundedness");
			expect(report).toContain("Receipt Completeness");
			expect(report).toContain("Error Recoverability");
			expect(report).toContain("State Coherence");
			expect(report).toContain("Model Continuity");
		});

		it("includes recommendations when present", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });
			const report = formatHostilityReport(score);

			if (score.recommendations.length > 0) {
				expect(report).toContain("Recommendations:");
			}
		});

		it("uses status icons correctly", () => {
			const score = runEnvironmentQualityCheck({ cwd: tempDir });
			const report = formatHostilityReport(score);

			// Should contain at least one status icon
			expect(report).toMatch(/[✓~✗]/);
		});
	});
});
