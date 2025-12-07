/**
 * LexSona Integration Tests
 *
 * Tests for LexRunner ↔ LexSona shadow governance integration.
 * Version Contract v0.1: Shadow mode only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	getLexSonaConfig,
	isLexSonaEnabled,
	deriveShadowConstraints,
	formatShadowGovernanceSummary,
	createGovernanceComparisonLog,
	type LexSonaWorkflowContext,
	type LexSonaShadowResult,
	type RunnerGovernanceSignals,
} from "../src/lexsona/index.js";

describe("LexSona Integration", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		// Reset environment for each test
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("getLexSonaConfig", () => {
		it("returns off mode by default", () => {
			delete process.env.LEXSONA_MODE;
			delete process.env.LEXSONA_PERSONA;

			const config = getLexSonaConfig();

			expect(config.mode).toBe("off");
			expect(config.personaId).toBeNull();
			expect(config.hasLexConnection).toBe(false);
		});

		it("reads shadow mode from environment", () => {
			process.env.LEXSONA_MODE = "shadow";
			process.env.LEXSONA_PERSONA = "quality-first_engineering";

			const config = getLexSonaConfig();

			expect(config.mode).toBe("shadow");
			expect(config.personaId).toBe("quality-first_engineering");
		});

		it("detects Lex connection from LEX_DB_PATH", () => {
			process.env.LEX_DB_PATH = "/path/to/lex.db";

			const config = getLexSonaConfig();

			expect(config.hasLexConnection).toBe(true);
		});
	});

	describe("isLexSonaEnabled", () => {
		it("returns false when mode is off", () => {
			const config = {
				mode: "off" as const,
				personaId: "test",
				hasLexConnection: false,
			};

			expect(isLexSonaEnabled(config)).toBe(false);
		});

		it("returns false when no persona is set", () => {
			const config = {
				mode: "shadow" as const,
				personaId: null,
				hasLexConnection: false,
			};

			expect(isLexSonaEnabled(config)).toBe(false);
		});

		it("returns true when shadow mode with persona", () => {
			const config = {
				mode: "shadow" as const,
				personaId: "quality-first_engineering",
				hasLexConnection: false,
			};

			expect(isLexSonaEnabled(config)).toBe(true);
		});
	});

	describe("deriveShadowConstraints", () => {
		it("returns disabled result when LexSona is off", async () => {
			const context: LexSonaWorkflowContext = {
				workflowId: "merge-weave",
				stepKind: "execute",
			};
			const config = {
				mode: "off" as const,
				personaId: null,
				hasLexConnection: false,
			};

			const result = await deriveShadowConstraints(context, config);

			expect(result.success).toBe(false);
			expect(result.error).toContain("disabled");
			expect(result.constraintSet).toBeNull();
		});

		it("includes derivedAt timestamp", async () => {
			const context: LexSonaWorkflowContext = {
				workflowId: "merge-weave",
				stepKind: "execute",
			};
			const config = {
				mode: "off" as const,
				personaId: null,
				hasLexConnection: false,
			};

			const result = await deriveShadowConstraints(context, config);

			expect(result.derivedAt).toBeDefined();
			expect(new Date(result.derivedAt).getTime()).toBeLessThanOrEqual(
				Date.now()
			);
		});
	});

	describe("createGovernanceComparisonLog", () => {
		it("creates valid log entry", () => {
			const context: LexSonaWorkflowContext = {
				workflowId: "merge-weave",
				stepKind: "execute",
				repo: "test-repo",
				branch: "main",
			};

			const lexsona: LexSonaShadowResult = {
				success: true,
				personaId: "quality-first_engineering",
				constraintSet: {
					constraintCount: 5,
					topConstraints: [
						{
							id: "rule-1",
							description: "Test constraint",
							severity: "must",
							confidence: 0.9,
						},
					],
					principleCount: 2,
					metadata: {
						rulesConsidered: 10,
						rulesFiltered: 5,
						confidenceThreshold: 0.3,
						offlineMode: true,
						confidenceCeiling: 0.7,
					},
				},
				offlineMode: true,
				confidenceCeiling: 0.7,
				derivedAt: new Date().toISOString(),
			};

			const runner = {
				gatesRequired: ["lint", "typecheck", "test"],
				mergeEligible: true,
			};

			const log = createGovernanceComparisonLog(
				context,
				lexsona,
				runner,
				"shadow"
			);

			expect(log.schemaVersion).toBe("1.0.0");
			expect(log.id).toMatch(/^gov-/);
			expect(log.timestamp).toBeDefined();
			expect(log.context.workflowId).toBe("merge-weave");
			expect(log.lexsona.success).toBe(true);
			expect(log.runner.gatesRequired).toEqual([
				"lint",
				"typecheck",
				"test",
			]);
			expect(log.mode).toBe("shadow");
		});
	});

	describe("formatShadowGovernanceSummary (QOL-003)", () => {
		it("formats successful result with agreement", () => {
			const shadowResult: LexSonaShadowResult = {
				success: true,
				personaId: "quality-first_engineering",
				constraintSet: {
					constraintCount: 0,
					topConstraints: [],
					principleCount: 2,
					metadata: {
						rulesConsidered: 10,
						rulesFiltered: 5,
						confidenceThreshold: 0.3,
						offlineMode: false,
					},
				},
				offlineMode: false,
				derivedAt: new Date().toISOString(),
			};

			const runnerSignals: RunnerGovernanceSignals = {
				mergeEligible: true,
			};

			const summary = formatShadowGovernanceSummary(
				shadowResult,
				runnerSignals,
				{ noColor: true }
			);

			expect(summary).toContain("quality-first_engineering");
			expect(summary).toContain("0 constraints");
			expect(summary).toContain("AGREES");
			expect(summary).toContain("runner: allow");
		});

		it("formats result with disagreement (LexSona blocks)", () => {
			const shadowResult: LexSonaShadowResult = {
				success: true,
				personaId: "quality-first_engineering",
				constraintSet: {
					constraintCount: 3,
					topConstraints: [
						{
							id: "rule-1",
							description: "Run full test suite before merge",
							severity: "must",
							confidence: 0.85,
						},
						{
							id: "rule-2",
							description: "Verify no TODOs in diff",
							severity: "should",
							confidence: 0.72,
						},
					],
					principleCount: 2,
					metadata: {
						rulesConsidered: 10,
						rulesFiltered: 7,
						confidenceThreshold: 0.3,
						offlineMode: false,
					},
				},
				offlineMode: false,
				derivedAt: new Date().toISOString(),
			};

			const runnerSignals: RunnerGovernanceSignals = {
				mergeEligible: true,
			};

			const summary = formatShadowGovernanceSummary(
				shadowResult,
				runnerSignals,
				{ noColor: true }
			);

			expect(summary).toContain("3 constraints");
			expect(summary).toContain("WOULD BLOCK");
			expect(summary).toContain("Run full test suite before merge");
			expect(summary).toContain("85%");
		});

		it("shows offline mode warning", () => {
			const shadowResult: LexSonaShadowResult = {
				success: true,
				personaId: "quality-first_engineering",
				constraintSet: {
					constraintCount: 0,
					topConstraints: [],
					principleCount: 0,
					metadata: {
						rulesConsidered: 0,
						rulesFiltered: 0,
						confidenceThreshold: 0.3,
						offlineMode: true,
					},
				},
				offlineMode: true,
				derivedAt: new Date().toISOString(),
			};

			const runnerSignals: RunnerGovernanceSignals = {
				mergeEligible: true,
			};

			const summary = formatShadowGovernanceSummary(
				shadowResult,
				runnerSignals,
				{ noColor: true }
			);

			expect(summary).toContain("offline mode - no Lex DB");
		});

		it("formats error result", () => {
			const shadowResult: LexSonaShadowResult = {
				success: false,
				personaId: "quality-first_engineering",
				constraintSet: null,
				error: "LexSona module not available",
				offlineMode: true,
				derivedAt: new Date().toISOString(),
			};

			const runnerSignals: RunnerGovernanceSignals = {
				mergeEligible: true,
			};

			const summary = formatShadowGovernanceSummary(
				shadowResult,
				runnerSignals,
				{ noColor: true }
			);

			expect(summary).toContain("ERROR");
			expect(summary).toContain("LexSona module not available");
		});
	});
});
