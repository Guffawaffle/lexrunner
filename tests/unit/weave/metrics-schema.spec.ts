/**
 * Model Tier Handoff Metrics Schema Tests
 */

import { describe, it, expect } from "vitest";
import {
	parseAuditEntry,
	safeParseAuditEntry,
	getInterventionById,
	getInterventionsByLevel,
	computeTokenUsage,
	createAuditEntryWithTokens,
	TokenUsage,
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

	describe("TokenUsage schema", () => {
		it("validates correct structure", () => {
			const tokenUsage = {
				snapshot_tokens: 1000,
				agent_search_tokens: 500,
				output_tokens: 300,
				total: 1800,
			};

			const result = TokenUsage.parse(tokenUsage);
			
			expect(result.snapshot_tokens).toBe(1000);
			expect(result.agent_search_tokens).toBe(500);
			expect(result.output_tokens).toBe(300);
			expect(result.total).toBe(1800);
		});

		it("rejects negative values", () => {
			const invalidTokenUsage = {
				snapshot_tokens: -100,
				agent_search_tokens: 500,
				output_tokens: 300,
				total: 700,
			};

			const result = TokenUsage.safeParse(invalidTokenUsage);

			expect(result.success).toBe(false);
		});

		it("requires all fields", () => {
			const incompleteTokenUsage = {
				snapshot_tokens: 1000,
				agent_search_tokens: 500,
				// missing output_tokens and total
			};

			const result = TokenUsage.safeParse(incompleteTokenUsage);

			expect(result.success).toBe(false);
		});

		it("requires integers", () => {
			const invalidTokenUsage = {
				snapshot_tokens: 1000.5,
				agent_search_tokens: 500,
				output_tokens: 300,
				total: 1800.5,
			};

			const result = TokenUsage.safeParse(invalidTokenUsage);

			expect(result.success).toBe(false);
		});
	});

	describe("InterventionAuditEntry with token_usage", () => {
		it("accepts token_usage field", () => {
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
				token_usage: {
					snapshot_tokens: 1000,
					agent_search_tokens: 500,
					output_tokens: 300,
					total: 1800,
				},
			};

			const result = parseAuditEntry(entry);

			expect(result.token_usage).toBeDefined();
			expect(result.token_usage?.snapshot_tokens).toBe(1000);
			expect(result.token_usage?.agent_search_tokens).toBe(500);
			expect(result.token_usage?.output_tokens).toBe(300);
			expect(result.token_usage?.total).toBe(1800);
		});

		it("accepts task_id and snapshot_hash fields", () => {
			const entry = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1",
				model_tier_used: "frontier",
				success: true,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
				task_id: "task-123",
				snapshot_hash: "abc123def456",
			};

			const result = parseAuditEntry(entry);

			expect(result.task_id).toBe("task-123");
			expect(result.snapshot_hash).toBe("abc123def456");
		});

		it("is backward compatible (token_usage optional)", () => {
			const entry = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1",
				model_tier_used: "frontier",
				success: true,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
				// No token_usage field
			};

			const result = parseAuditEntry(entry);

			expect(result.token_usage).toBeUndefined();
			expect(result.intervention_id).toBe("INT-007");
		});
	});

	describe("computeTokenUsage", () => {
		it("calculates total correctly", () => {
			const result = computeTokenUsage(1000, 500, 300);

			expect(result.snapshot_tokens).toBe(1000);
			expect(result.agent_search_tokens).toBe(500);
			expect(result.output_tokens).toBe(300);
			expect(result.total).toBe(1800);
		});

		it("handles zero values", () => {
			const result = computeTokenUsage(0, 0, 0);

			expect(result.total).toBe(0);
		});

		it("handles agent not using search", () => {
			const result = computeTokenUsage(1000, 0, 300);

			expect(result.snapshot_tokens).toBe(1000);
			expect(result.agent_search_tokens).toBe(0);
			expect(result.output_tokens).toBe(300);
			expect(result.total).toBe(1300);
		});
	});

	describe("createAuditEntryWithTokens", () => {
		it("creates audit entry with token usage", () => {
			const base = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1" as const,
				model_tier_used: "frontier" as const,
				success: true,
				required_human_override: false,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const tokenUsage = computeTokenUsage(1000, 500, 300);
			const result = createAuditEntryWithTokens(base, tokenUsage);

			expect(result.token_usage).toEqual(tokenUsage);
			expect(result.intervention_id).toBe("INT-007");
		});

		it("includes task_id and snapshot_hash when provided", () => {
			const base = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1" as const,
				model_tier_used: "frontier" as const,
				success: true,
				required_human_override: false,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const tokenUsage = computeTokenUsage(1000, 500, 300);
			const result = createAuditEntryWithTokens(
				base,
				tokenUsage,
				"task-123",
				"abc123def456"
			);

			expect(result.token_usage).toEqual(tokenUsage);
			expect(result.task_id).toBe("task-123");
			expect(result.snapshot_hash).toBe("abc123def456");
		});

		it("omits optional task_id and snapshot_hash when not provided", () => {
			const base = {
				intervention_id: "INT-007",
				intervention_name: "Base Branch Verification",
				determinism_level: "D1" as const,
				model_tier_used: "frontier" as const,
				success: true,
				required_human_override: false,
				time_to_complete_ms: 1234,
				timestamp: "2025-12-19T05:00:00.000Z",
			};

			const tokenUsage = computeTokenUsage(1000, 500, 300);
			const result = createAuditEntryWithTokens(base, tokenUsage);

			expect(result.token_usage).toEqual(tokenUsage);
			expect(result.task_id).toBeUndefined();
			expect(result.snapshot_hash).toBeUndefined();
		});
	});
});
