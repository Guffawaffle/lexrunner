/**
 * Tests for Gate Timeout Adjustment based on Environmental Hostility
 */

import { describe, it, expect } from "vitest";
import {
	calculateHostilityAdjustedTimeout,
	logTimeoutAdjustment,
	getAdjustedTimeout,
	DEFAULT_GATE_TIMEOUT_MS,
	MAX_TIMEOUT_MULTIPLIER,
	MIN_TIMEOUT_MULTIPLIER,
} from "../../src/governance/timeoutAdjustment.js";
import type { HostilityScore } from "../../src/hostility/score.js";

// Helper to create a mock HostilityScore
function createMockHostilityScore(
	total: number,
	status: "low" | "medium" | "high"
): HostilityScore {
	return {
		total,
		status,
		components: {
			constraintClarity: { score: total, status: "good", details: "test" },
			requirementExplicitness: { score: total, status: "good", details: "test" },
			problemBoundedness: { score: total, status: "good", details: "test" },
			receiptCompleteness: { score: total, status: "good", details: "test" },
			errorRecoverability: { score: total, status: "good", details: "test" },
			stateCoherence: { score: total, status: "good", details: "test" },
			modelContinuity: { score: total, status: "good", details: "test" },
		},
		recommendations: [],
	};
}

describe("Timeout Adjustment", () => {
	describe("calculateHostilityAdjustedTimeout", () => {
		it("should not adjust timeout for low hostility", () => {
			const hostility = createMockHostilityScore(0.2, "low");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			expect(result.multiplier).toBe(1.0);
			expect(result.adjustedTimeoutMs).toBe(30000);
			expect(result.reason).toContain("standard timeout");
		});

		it("should increase timeout 1.5x for medium hostility", () => {
			const hostility = createMockHostilityScore(0.45, "medium");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			expect(result.multiplier).toBe(1.5);
			expect(result.adjustedTimeoutMs).toBe(45000);
			expect(result.reason).toContain("needs attention");
		});

		it("should increase timeout for high hostility", () => {
			const hostility = createMockHostilityScore(0.7, "high");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			// At 0.7, multiplier should be 2.0 + ((0.7 - 0.6) / 0.4) * 1.0 = 2.25
			expect(result.multiplier).toBeCloseTo(2.25);
			expect(result.adjustedTimeoutMs).toBe(67500);
			expect(result.reason).toContain("High environment hostility");
		});

		it("should cap multiplier at MAX_TIMEOUT_MULTIPLIER", () => {
			const hostility = createMockHostilityScore(1.0, "high");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			expect(result.multiplier).toBe(MAX_TIMEOUT_MULTIPLIER);
			expect(result.adjustedTimeoutMs).toBe(30000 * MAX_TIMEOUT_MULTIPLIER);
		});

		it("should preserve original timeout in result", () => {
			const hostility = createMockHostilityScore(0.6, "high");
			const result = calculateHostilityAdjustedTimeout(45000, hostility);

			expect(result.originalTimeoutMs).toBe(45000);
		});

		it("should include hostility status in result", () => {
			const hostility = createMockHostilityScore(0.35, "medium");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			expect(result.hostilityStatus).toBe("medium");
			expect(result.hostilityScore).toBe(0.35);
		});
	});

	describe("getAdjustedTimeout", () => {
		it("should return base timeout when no hostility score provided", () => {
			const result = getAdjustedTimeout(30000);
			expect(result).toBe(30000);
		});

		it("should adjust timeout when hostility score provided", () => {
			const hostility = createMockHostilityScore(0.5, "medium");
			const result = getAdjustedTimeout(30000, hostility);

			expect(result).toBe(45000);
		});
	});

	describe("Constants", () => {
		it("should have correct default timeout", () => {
			expect(DEFAULT_GATE_TIMEOUT_MS).toBe(30000);
		});

		it("should have correct multiplier bounds", () => {
			expect(MIN_TIMEOUT_MULTIPLIER).toBe(1.0);
			expect(MAX_TIMEOUT_MULTIPLIER).toBe(3.0);
		});
	});

	describe("Edge Cases", () => {
		it("should handle exactly 0.3 as medium hostility threshold", () => {
			const hostility = createMockHostilityScore(0.3, "medium");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			// 0.3 is exactly at the medium threshold
			expect(result.multiplier).toBe(1.5);
		});

		it("should handle exactly 0.6 as high hostility threshold", () => {
			const hostility = createMockHostilityScore(0.6, "high");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			// At 0.6, multiplier should be 2.0
			expect(result.multiplier).toBe(2.0);
		});

		it("should handle hostility score of 0", () => {
			const hostility = createMockHostilityScore(0, "low");
			const result = calculateHostilityAdjustedTimeout(30000, hostility);

			expect(result.multiplier).toBe(1.0);
			expect(result.adjustedTimeoutMs).toBe(30000);
		});

		it("should round adjusted timeout to whole milliseconds", () => {
			// Create a scenario that would produce a non-integer result
			const hostility = createMockHostilityScore(0.75, "high");
			const result = calculateHostilityAdjustedTimeout(1000, hostility);

			expect(Number.isInteger(result.adjustedTimeoutMs)).toBe(true);
		});
	});
});
