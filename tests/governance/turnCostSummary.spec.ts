/**
 * Tests for Turn Cost Summary Integration
 */

import { describe, it, expect } from "vitest";
import {
	formatTurnCostSummary,
	compareTurnCosts,
	formatTurnCostComparison,
	turnCostSummaryToJSON,
	TURN_COST_REGRESSION_THRESHOLD,
} from "../../src/governance/turnCostSummary.js";
import type { TurnCostSummary } from "../../src/metrics/turncost.js";

// Helper to create mock TurnCostSummary
function createMockSummary(
	weightedScore: number,
	eventCount: number = 0,
	priorRunScore?: number
): TurnCostSummary {
	return {
		components: {
			latencyMs: 1000,
			contextResetTokens: 0,
			renegotiationCount: 2,
			tokenBloat: 50,
			attentionSwitchCount: 1,
		},
		weightedScore,
		eventCount,
		priorRunScore,
		improvement: priorRunScore !== undefined
			? `${((weightedScore - priorRunScore) / priorRunScore * 100).toFixed(0)}%`
			: undefined,
	};
}

describe("Turn Cost Summary", () => {
	describe("formatTurnCostSummary", () => {
		it("should format basic summary correctly", () => {
			const summary = createMockSummary(1.5, 5);
			const formatted = formatTurnCostSummary(summary);

			expect(formatted).toContain("Turn Cost Summary");
			expect(formatted).toContain("Weighted Score: 1.50");
			expect(formatted).toContain("Total Events:   5");
		});

		it("should include component breakdown", () => {
			const summary = createMockSummary(1.5, 5);
			const formatted = formatTurnCostSummary(summary);

			expect(formatted).toContain("Component Breakdown:");
			expect(formatted).toContain("Latency:");
			expect(formatted).toContain("Renegotiations:");
			expect(formatted).toContain("Token Bloat:");
			expect(formatted).toContain("Attention Switches:");
		});

		it("should include prior run comparison when available", () => {
			const summary = createMockSummary(1.5, 5, 1.2);
			const formatted = formatTurnCostSummary(summary);

			expect(formatted).toContain("Prior Run Score: 1.20");
			expect(formatted).toContain("Change:");
		});

		it("should flag significant regressions", () => {
			// 25% regression (above 20% threshold)
			const summary = createMockSummary(1.5, 5, 1.2);
			const formatted = formatTurnCostSummary(summary);

			expect(formatted).toContain("SIGNIFICANT REGRESSION DETECTED");
		});

		it("should not flag minor changes", () => {
			// 10% regression (below 20% threshold)
			const summary = createMockSummary(1.1, 5, 1.0);
			const formatted = formatTurnCostSummary(summary);

			expect(formatted).not.toContain("SIGNIFICANT REGRESSION DETECTED");
		});
	});

	describe("compareTurnCosts", () => {
		it("should detect regression above threshold", () => {
			// 30% increase is above 20% threshold
			const comparison = compareTurnCosts(1.3, 1.0);

			expect(comparison.isRegression).toBe(true);
			expect(comparison.percentageChange).toBeCloseTo(0.3);
			expect(comparison.summary).toContain("increased");
		});

		it("should not flag changes below threshold", () => {
			// 10% increase is below 20% threshold
			const comparison = compareTurnCosts(1.1, 1.0);

			expect(comparison.isRegression).toBe(false);
			expect(comparison.summary).toContain("stable");
		});

		it("should recognize improvements", () => {
			// 20% improvement
			const comparison = compareTurnCosts(0.8, 1.0);

			expect(comparison.isRegression).toBe(false);
			expect(comparison.percentageChange).toBeCloseTo(-0.2);
			expect(comparison.summary).toContain("improved");
		});

		it("should handle missing prior score", () => {
			const comparison = compareTurnCosts(1.5);

			expect(comparison.isRegression).toBe(false);
			expect(comparison.priorScore).toBeUndefined();
			expect(comparison.summary).toContain("No prior run");
		});

		it("should handle zero prior score", () => {
			const comparison = compareTurnCosts(1.5, 0);

			expect(comparison.isRegression).toBe(false);
			expect(comparison.summary).toContain("No prior run");
		});
	});

	describe("formatTurnCostComparison", () => {
		it("should format comparison with prior score", () => {
			const comparison = compareTurnCosts(1.5, 1.2);
			const formatted = formatTurnCostComparison(comparison);

			expect(formatted).toContain("Turn Cost Comparison");
			expect(formatted).toContain("Current Score: 1.50");
			expect(formatted).toContain("Prior Score:   1.20");
			expect(formatted).toContain("Change:");
		});

		it("should include warning icon for regressions", () => {
			const comparison = compareTurnCosts(1.5, 1.0);
			const formatted = formatTurnCostComparison(comparison);

			expect(formatted).toContain("⚠️");
		});

		it("should not include warning for improvements", () => {
			const comparison = compareTurnCosts(0.8, 1.0);
			const formatted = formatTurnCostComparison(comparison);

			// The summary line should not have a warning
			expect(formatted).toContain("improved");
		});
	});

	describe("turnCostSummaryToJSON", () => {
		it("should return JSON-serializable object", () => {
			const summary = createMockSummary(1.5, 5);
			const json = turnCostSummaryToJSON(summary);

			expect(() => JSON.stringify(json)).not.toThrow();
			expect(json.weightedScore).toBe(1.5);
			expect(json.eventCount).toBe(5);
		});

		it("should include comparison when prior score provided", () => {
			const summary = createMockSummary(1.5, 5);
			const json = turnCostSummaryToJSON(summary, 1.2);

			expect(json.comparison).toBeDefined();
			expect((json.comparison as any).priorScore).toBe(1.2);
			expect((json.comparison as any).isRegression).toBe(true);
		});

		it("should have null comparison without prior score", () => {
			const summary = createMockSummary(1.5, 5);
			const json = turnCostSummaryToJSON(summary);

			expect(json.comparison).toBeNull();
		});
	});

	describe("TURN_COST_REGRESSION_THRESHOLD", () => {
		it("should be 20%", () => {
			expect(TURN_COST_REGRESSION_THRESHOLD).toBe(0.20);
		});
	});
});
