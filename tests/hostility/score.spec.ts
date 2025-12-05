/**
 * Tests for hostility scoring module
 */

import { describe, it, expect } from "vitest";
import {
	computeStatus,
	computeOverallStatus,
	createComponent,
	aggregateScore,
	HOSTILITY_COMPONENT_NAMES,
	COMPONENT_LABELS,
	HostilityComponentSchema,
	HostilityScoreSchema,
} from "../../src/hostility/score.js";

describe("Hostility Score Module", () => {
	describe("computeStatus", () => {
		it("returns 'good' for scores below 0.3", () => {
			expect(computeStatus(0)).toBe("good");
			expect(computeStatus(0.1)).toBe("good");
			expect(computeStatus(0.29)).toBe("good");
		});

		it("returns 'warning' for scores between 0.3 and 0.6", () => {
			expect(computeStatus(0.3)).toBe("warning");
			expect(computeStatus(0.45)).toBe("warning");
			expect(computeStatus(0.59)).toBe("warning");
		});

		it("returns 'critical' for scores 0.6 and above", () => {
			expect(computeStatus(0.6)).toBe("critical");
			expect(computeStatus(0.8)).toBe("critical");
			expect(computeStatus(1.0)).toBe("critical");
		});
	});

	describe("computeOverallStatus", () => {
		it("returns 'low' for totals below 0.3", () => {
			expect(computeOverallStatus(0)).toBe("low");
			expect(computeOverallStatus(0.15)).toBe("low");
			expect(computeOverallStatus(0.29)).toBe("low");
		});

		it("returns 'medium' for totals between 0.3 and 0.6", () => {
			expect(computeOverallStatus(0.3)).toBe("medium");
			expect(computeOverallStatus(0.45)).toBe("medium");
			expect(computeOverallStatus(0.59)).toBe("medium");
		});

		it("returns 'high' for totals 0.6 and above", () => {
			expect(computeOverallStatus(0.6)).toBe("high");
			expect(computeOverallStatus(0.8)).toBe("high");
			expect(computeOverallStatus(1.0)).toBe("high");
		});
	});

	describe("createComponent", () => {
		it("creates a valid component with all fields", () => {
			const component = createComponent(0.5, "test details", "test recommendation");

			expect(component.score).toBe(0.5);
			expect(component.status).toBe("warning");
			expect(component.details).toBe("test details");
			expect(component.recommendation).toBe("test recommendation");
		});

		it("creates a component without recommendation", () => {
			const component = createComponent(0.1, "good state");

			expect(component.score).toBe(0.1);
			expect(component.status).toBe("good");
			expect(component.details).toBe("good state");
			expect(component.recommendation).toBeUndefined();
		});

		it("clamps scores to valid range", () => {
			const lowComponent = createComponent(-0.5, "test");
			expect(lowComponent.score).toBe(0);

			const highComponent = createComponent(1.5, "test");
			expect(highComponent.score).toBe(1);
		});

		it("validates against schema", () => {
			const component = createComponent(0.5, "test", "recommendation");
			const result = HostilityComponentSchema.safeParse(component);
			expect(result.success).toBe(true);
		});
	});

	describe("aggregateScore", () => {
		it("computes average of all component scores", () => {
			const components = {
				constraintClarity: createComponent(0.2, "test"),
				requirementExplicitness: createComponent(0.3, "test"),
				problemBoundedness: createComponent(0.4, "test"),
				receiptCompleteness: createComponent(0.1, "test"),
				errorRecoverability: createComponent(0.2, "test"),
				stateCoherence: createComponent(0.1, "test"),
				modelContinuity: createComponent(0.4, "test"),
			};

			const score = aggregateScore(components);

			// Average of 0.2, 0.3, 0.4, 0.1, 0.2, 0.1, 0.4 = 1.7/7 ≈ 0.243
			expect(score.total).toBeCloseTo(0.243, 2);
			expect(score.status).toBe("low");
		});

		it("collects recommendations from all components", () => {
			const components = {
				constraintClarity: createComponent(0.5, "test", "fix constraints"),
				requirementExplicitness: createComponent(0.3, "test"),
				problemBoundedness: createComponent(0.4, "test", "split plan"),
				receiptCompleteness: createComponent(0.1, "test"),
				errorRecoverability: createComponent(0.2, "test"),
				stateCoherence: createComponent(0.1, "test"),
				modelContinuity: createComponent(0.4, "test"),
			};

			const score = aggregateScore(components);

			expect(score.recommendations).toHaveLength(2);
			expect(score.recommendations).toContain("fix constraints");
			expect(score.recommendations).toContain("split plan");
		});

		it("validates against schema", () => {
			const components = {
				constraintClarity: createComponent(0.2, "test"),
				requirementExplicitness: createComponent(0.3, "test"),
				problemBoundedness: createComponent(0.4, "test"),
				receiptCompleteness: createComponent(0.1, "test"),
				errorRecoverability: createComponent(0.2, "test"),
				stateCoherence: createComponent(0.1, "test"),
				modelContinuity: createComponent(0.4, "test"),
			};

			const score = aggregateScore(components);
			const result = HostilityScoreSchema.safeParse(score);
			expect(result.success).toBe(true);
		});
	});

	describe("HOSTILITY_COMPONENT_NAMES", () => {
		it("contains all expected component names", () => {
			expect(HOSTILITY_COMPONENT_NAMES).toContain("constraintClarity");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("requirementExplicitness");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("problemBoundedness");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("receiptCompleteness");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("errorRecoverability");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("stateCoherence");
			expect(HOSTILITY_COMPONENT_NAMES).toContain("modelContinuity");
		});

		it("has exactly 7 components", () => {
			expect(HOSTILITY_COMPONENT_NAMES).toHaveLength(7);
		});
	});

	describe("COMPONENT_LABELS", () => {
		it("has labels for all component names", () => {
			for (const name of HOSTILITY_COMPONENT_NAMES) {
				expect(COMPONENT_LABELS[name]).toBeDefined();
				expect(typeof COMPONENT_LABELS[name]).toBe("string");
			}
		});

		it("has human-readable labels", () => {
			expect(COMPONENT_LABELS.constraintClarity).toBe("Constraint Clarity");
			expect(COMPONENT_LABELS.problemBoundedness).toBe("Problem Boundedness");
		});
	});
});
