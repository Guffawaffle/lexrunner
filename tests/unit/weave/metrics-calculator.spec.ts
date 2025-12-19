/**
 * Handoff Calculator Tests
 */

import { describe, it, expect } from "vitest";
import {
	calculateInterventionStats,
	calculateAllStats,
	calculateLevelStats,
	assessTierReadiness,
	generateHandoffReport,
	formatHandoffReport,
} from "../../../src/weave/metrics/calculator.js";
import type { InterventionAuditEntry } from "../../../src/weave/metrics/schema.js";

describe("Metrics Calculator", () => {
	// Test fixtures
	const createEntry = (
		overrides: Partial<InterventionAuditEntry>
	): InterventionAuditEntry => ({
		intervention_id: "INT-001",
		intervention_name: "Test",
		determinism_level: "D1",
		model_tier_used: "frontier",
		success: true,
		required_human_override: false,
		time_to_complete_ms: 100,
		timestamp: "2025-12-19T05:00:00.000Z",
		...overrides,
	});

	describe("calculateInterventionStats", () => {
		it("calculates stats for single intervention", () => {
			const entries = [
				createEntry({ intervention_id: "INT-007", success: true, time_to_complete_ms: 100 }),
				createEntry({ intervention_id: "INT-007", success: true, time_to_complete_ms: 200 }),
				createEntry({ intervention_id: "INT-007", success: false, time_to_complete_ms: 300 }),
			];

			const result = calculateInterventionStats("INT-007", entries);

			expect(result).not.toBeNull();
			expect(result?.total_executions).toBe(3);
			expect(result?.successful_executions).toBe(2);
			expect(result?.success_rate).toBeCloseTo(0.667, 2);
			expect(result?.avg_time_ms).toBe(200);
		});

		it("returns null for non-existent intervention", () => {
			const entries = [createEntry({ intervention_id: "INT-001" })];
			const result = calculateInterventionStats("INT-999", entries);
			expect(result).toBeNull();
		});

		it("counts human overrides", () => {
			const entries = [
				createEntry({ intervention_id: "INT-012", required_human_override: true }),
				createEntry({ intervention_id: "INT-012", required_human_override: false }),
			];

			const result = calculateInterventionStats("INT-012", entries);
			expect(result?.human_overrides).toBe(1);
		});
	});

	describe("calculateAllStats", () => {
		it("calculates stats for all interventions", () => {
			const entries = [
				createEntry({ intervention_id: "INT-001" }),
				createEntry({ intervention_id: "INT-007" }),
				createEntry({ intervention_id: "INT-001" }),
			];

			const result = calculateAllStats(entries);

			expect(result.length).toBe(2);
			expect(result.find((s) => s.intervention_id === "INT-001")?.total_executions).toBe(2);
			expect(result.find((s) => s.intervention_id === "INT-007")?.total_executions).toBe(1);
		});

		it("returns empty array for no entries", () => {
			const result = calculateAllStats([]);
			expect(result).toEqual([]);
		});
	});

	describe("calculateLevelStats", () => {
		it("calculates D1 level stats", () => {
			const entries = [
				createEntry({ determinism_level: "D1", success: true }),
				createEntry({ determinism_level: "D1", success: true }),
				createEntry({ determinism_level: "D1", success: false }),
				createEntry({ determinism_level: "D2", success: true }),
			];

			const result = calculateLevelStats(entries, "D1");

			expect(result.count).toBe(1); // unique interventions
			expect(result.total_executions).toBe(3);
			expect(result.successful_executions).toBe(2);
			expect(result.success_rate).toBeCloseTo(0.667, 2);
		});

		it("returns zeros for empty level", () => {
			const entries = [createEntry({ determinism_level: "D1" })];

			const result = calculateLevelStats(entries, "D3");

			expect(result.count).toBe(0);
			expect(result.success_rate).toBe(0);
		});
	});

	describe("assessTierReadiness", () => {
		it("marks junior tier ready with high D1 success", () => {
			// Create 15 successful D1 entries (exceeds 10 required)
			const entries = Array.from({ length: 15 }, () =>
				createEntry({ determinism_level: "D1", success: true })
			);

			const result = assessTierReadiness(entries);
			const junior = result.find((t) => t.tier === "junior");

			expect(junior?.ready).toBe(true);
			expect(junior?.success_rate).toBe(1);
		});

		it("marks junior tier not ready with failures", () => {
			const entries = [
				...Array.from({ length: 8 }, () =>
					createEntry({ determinism_level: "D1", success: true })
				),
				...Array.from({ length: 5 }, () =>
					createEntry({ determinism_level: "D1", success: false })
				),
			];

			const result = assessTierReadiness(entries);
			const junior = result.find((t) => t.tier === "junior");

			expect(junior?.ready).toBe(false);
			expect(junior?.blocking_interventions.length).toBeGreaterThan(0);
		});

		it("marks mid tier ready with high D2 success", () => {
			const entries = Array.from({ length: 15 }, () =>
				createEntry({ determinism_level: "D2", success: true })
			);

			const result = assessTierReadiness(entries);
			const mid = result.find((t) => t.tier === "mid");

			expect(mid?.ready).toBe(true);
		});

		it("includes blocking interventions in assessment", () => {
			const entries = [
				createEntry({ intervention_id: "INT-007", determinism_level: "D1", success: false }),
				createEntry({ intervention_id: "INT-008", determinism_level: "D1", success: true }),
			];

			const result = assessTierReadiness(entries);
			const junior = result.find((t) => t.tier === "junior");

			expect(junior?.blocking_interventions).toContain("INT-007");
		});
	});

	describe("generateHandoffReport", () => {
		it("generates complete report", () => {
			const entries = [
				createEntry({ intervention_id: "INT-001", determinism_level: "D1" }),
				createEntry({ intervention_id: "INT-012", determinism_level: "D2" }),
				createEntry({ intervention_id: "INT-010", determinism_level: "D3" }),
			];

			const report = generateHandoffReport(entries);

			expect(report.total_interventions).toBe(3);
			expect(report.by_level.D1.count).toBe(1);
			expect(report.by_level.D2.count).toBe(1);
			expect(report.by_level.D3.count).toBe(1);
			expect(report.by_level.D3.ready_for_handoff).toBe(false); // Always false
			expect(report.tier_readiness.length).toBe(3);
			expect(report.recommendations.length).toBeGreaterThan(0);
		});

		it("handles empty entries", () => {
			const report = generateHandoffReport([]);

			expect(report.total_interventions).toBe(0);
			expect(report.by_level.D1.count).toBe(0);
			expect(report.intervention_stats).toEqual([]);
		});
	});

	describe("formatHandoffReport", () => {
		it("formats report for console", () => {
			const entries = Array.from({ length: 5 }, (_, i) =>
				createEntry({
					intervention_id: `INT-00${i + 1}`,
					determinism_level: i < 3 ? "D1" : "D2",
				})
			);

			const report = generateHandoffReport(entries);
			const formatted = formatHandoffReport(report);

			expect(formatted).toContain("HANDOFF READINESS REPORT");
			expect(formatted).toContain("DETERMINISM LEVEL SUMMARY");
			expect(formatted).toContain("TIER HANDOFF READINESS");
			expect(formatted).toContain("D1 Interventions");
			expect(formatted).toContain("D2 Interventions");
		});
	});
});
