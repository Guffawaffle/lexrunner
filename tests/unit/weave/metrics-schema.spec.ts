/**
 * Model Tier Handoff Metrics Schema Tests
 */

import { describe, it, expect } from "vitest";
import {
	parseAuditEntry,
	safeParseAuditEntry,
	getInterventionById,
	getInterventionsByLevel,
	INTERVENTION_CATALOG,
	type InterventionAuditEntry,
} from "../../../src/weave/metrics/schema.js";

describe("Metrics Schema", () => {
	describe("parseAuditEntry", () => {
		it("parses valid audit entry", () => {
			const entry = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1",
				model_tier_used: "frontier",
				success: true,
				required_human_override: false,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
				run_id: "run-001",
			};

			const result = parseAuditEntry(entry);

			expect(result.intervention_id).toBe("INT-007");
			expect(result.success).toBe(true);
			expect(result.time_to_complete_ms).toBe(1234);
		});

		it("applies default for required_human_override", () => {
			const entry = {
				intervention_id: "INT-001",
				intervention_name: "PR Discovery",
				determinism_level: "D1",
				model_tier_used: "script",
				success: true,
				time_to_complete_ms: 100,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const result = parseAuditEntry(entry);
			expect(result.required_human_override).toBe(false);
		});

		it("accepts optional fields", () => {
			const entry = {
				intervention_id: "INT-012",
				intervention_name: "Admin Authority Decision",
				determinism_level: "D2",
				model_tier_used: "mid",
				success: false,
				time_to_complete_ms: 500,
				timestamp: "2025-12-19T05:00:00.000Z",
				error_message: "CI not green",
				context: { pr_number: 123 },
			};

			const result = parseAuditEntry(entry);
			expect(result.error_message).toBe("CI not green");
			expect(result.context?.pr_number).toBe(123);
		});
	});

	describe("safeParseAuditEntry", () => {
		it("returns success for valid entry", () => {
			const entry = {
				intervention_id: "INT-001",
				intervention_name: "Test",
				determinism_level: "D1",
				model_tier_used: "frontier",
				success: true,
				time_to_complete_ms: 100,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const result = safeParseAuditEntry(entry);
			expect(result.success).toBe(true);
		});

		it("returns error for invalid intervention ID format", () => {
			const entry = {
				intervention_id: "INVALID",
				intervention_name: "Test",
				determinism_level: "D1",
				model_tier_used: "frontier",
				success: true,
				time_to_complete_ms: 100,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const result = safeParseAuditEntry(entry);
			expect(result.success).toBe(false);
		});

		it("returns error for invalid determinism level", () => {
			const entry = {
				intervention_id: "INT-001",
				intervention_name: "Test",
				determinism_level: "D4",
				model_tier_used: "frontier",
				success: true,
				time_to_complete_ms: 100,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const result = safeParseAuditEntry(entry);
			expect(result.success).toBe(false);
		});
	});

	describe("INTERVENTION_CATALOG", () => {
		it("has 19 interventions", () => {
			expect(INTERVENTION_CATALOG.length).toBe(19);
		});

		it("has correct distribution of levels", () => {
			const d1 = INTERVENTION_CATALOG.filter(
				(i) => i.determinism_level === "D1"
			);
			const d2 = INTERVENTION_CATALOG.filter(
				(i) => i.determinism_level === "D2"
			);
			const d3 = INTERVENTION_CATALOG.filter(
				(i) => i.determinism_level === "D3"
			);

			expect(d1.length).toBe(14);
			expect(d2.length).toBe(3);
			expect(d3.length).toBe(2);
		});

		it("all interventions have valid IDs", () => {
			for (const intervention of INTERVENTION_CATALOG) {
				expect(intervention.id).toMatch(/^INT-\d{3}$/);
			}
		});
	});

	describe("getInterventionById", () => {
		it("finds existing intervention", () => {
			const result = getInterventionById("INT-007");

			expect(result).toBeDefined();
			expect(result?.name).toBe("Base Branch Verification");
			expect(result?.determinism_level).toBe("D1");
		});

		it("returns undefined for non-existent ID", () => {
			const result = getInterventionById("INT-999");
			expect(result).toBeUndefined();
		});
	});

	describe("getInterventionsByLevel", () => {
		it("returns D1 interventions", () => {
			const result = getInterventionsByLevel("D1");

			expect(result.length).toBe(14);
			expect(result.every((i) => i.determinism_level === "D1")).toBe(
				true
			);
		});

		it("returns D3 interventions", () => {
			const result = getInterventionsByLevel("D3");

			expect(result.length).toBe(2);
			expect(result.map((i) => i.id)).toEqual(["INT-006", "INT-010"]);
		});
	});
});
