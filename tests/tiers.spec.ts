import { describe, it, expect } from "vitest";
import {
	CapabilityTier,
	TierAssignment,
	parseTierOverride,
	parseTierOverrides,
} from "../src/tiers/schema.js";
import {
	suggestTier,
	createTierAssignment,
	suggestTiersForPlan,
	isDeterministicGate,
	isLintOnly,
	isFormatOnly,
	touchesContracts,
	hasHighConflictPrediction,
	hasComplexDependencies,
} from "../src/tiers/suggest.js";
import {
	calculateTierMetrics,
	meetsGovernanceTargets,
	formatTierMetrics,
	tierMetricsToJSON,
	TIER_METRIC_TARGETS,
} from "../src/tiers/metrics.js";
import type { PlanItem, Gate } from "../src/schema.js";

describe("Capability Tier Schema", () => {
	describe("CapabilityTier", () => {
		it("should accept valid tier values", () => {
			expect(CapabilityTier.parse("senior")).toBe("senior");
			expect(CapabilityTier.parse("mid")).toBe("mid");
			expect(CapabilityTier.parse("junior")).toBe("junior");
		});

		it("should reject invalid tier values", () => {
			expect(() => CapabilityTier.parse("invalid")).toThrow();
			expect(() => CapabilityTier.parse("SENIOR")).toThrow();
		});
	});

	describe("TierAssignment", () => {
		it("should parse valid assignment", () => {
			const assignment = TierAssignment.parse({
				suggested: "mid",
				actual: "senior",
				escalated: true,
				escalationReason: "Complex conflict",
				mismatch: true,
			});

			expect(assignment.suggested).toBe("mid");
			expect(assignment.actual).toBe("senior");
			expect(assignment.escalated).toBe(true);
			expect(assignment.escalationReason).toBe("Complex conflict");
			expect(assignment.mismatch).toBe(true);
		});

		it("should apply defaults", () => {
			const assignment = TierAssignment.parse({
				suggested: "junior",
			});

			expect(assignment.suggested).toBe("junior");
			expect(assignment.escalated).toBe(false);
			expect(assignment.actual).toBeUndefined();
		});
	});

	describe("parseTierOverride", () => {
		it("should parse valid override", () => {
			const result = parseTierOverride("PR-123=senior");
			expect(result).toEqual({ itemName: "PR-123", tier: "senior" });
		});

		it("should handle case insensitive tier", () => {
			const result = parseTierOverride("item-1=SENIOR");
			expect(result).toEqual({ itemName: "item-1", tier: "senior" });
		});

		it("should return null for invalid format", () => {
			expect(parseTierOverride("invalid")).toBeNull();
			expect(parseTierOverride("")).toBeNull();
			expect(parseTierOverride("item=invalid-tier")).toBeNull();
		});

		it("should handle whitespace in item name", () => {
			const result = parseTierOverride("  PR-123  =mid");
			expect(result).toEqual({ itemName: "PR-123", tier: "mid" });
		});
	});

	describe("parseTierOverrides", () => {
		it("should parse comma-separated overrides", () => {
			const result = parseTierOverrides("PR-1=senior,PR-2=mid,PR-3=junior");
			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ itemName: "PR-1", tier: "senior" });
			expect(result[1]).toEqual({ itemName: "PR-2", tier: "mid" });
			expect(result[2]).toEqual({ itemName: "PR-3", tier: "junior" });
		});

		it("should parse array of overrides", () => {
			const result = parseTierOverrides(["PR-1=senior", "PR-2=mid"]);
			expect(result).toHaveLength(2);
		});

		it("should skip invalid overrides", () => {
			const result = parseTierOverrides("valid=senior,invalid,also-valid=junior");
			expect(result).toHaveLength(2);
		});
	});
});

describe("Tier Suggestion Heuristics", () => {
	const createGate = (name: string): Gate => ({
		name,
		run: `npm run ${name}`,
		env: {},
		runtime: "local",
		artifacts: [],
	});

	const createItem = (
		name: string,
		deps: string[] = [],
		gates: Gate[] = []
	): PlanItem => ({
		name,
		deps,
		gates,
	});

	describe("isDeterministicGate", () => {
		it("should identify deterministic gates", () => {
			expect(isDeterministicGate(createGate("lint"))).toBe(true);
			expect(isDeterministicGate(createGate("format"))).toBe(true);
			expect(isDeterministicGate(createGate("typecheck"))).toBe(true);
			expect(isDeterministicGate(createGate("prettier"))).toBe(true);
			expect(isDeterministicGate(createGate("eslint"))).toBe(true);
		});

		it("should identify non-deterministic gates", () => {
			expect(isDeterministicGate(createGate("test"))).toBe(false);
			expect(isDeterministicGate(createGate("build"))).toBe(false);
			expect(isDeterministicGate(createGate("e2e"))).toBe(false);
		});

		it("should handle compound gate names", () => {
			expect(isDeterministicGate(createGate("eslint-check"))).toBe(true);
			expect(isDeterministicGate(createGate("run-prettier"))).toBe(true);
		});
	});

	describe("isLintOnly", () => {
		it("should return true for lint-only items", () => {
			const item = createItem("lint-task", [], [createGate("lint")]);
			expect(isLintOnly(item)).toBe(true);
		});

		it("should return true for multiple deterministic gates", () => {
			const item = createItem("check-task", [], [
				createGate("lint"),
				createGate("typecheck"),
			]);
			expect(isLintOnly(item)).toBe(true);
		});

		it("should return false if any non-deterministic gate", () => {
			const item = createItem("mixed-task", [], [
				createGate("lint"),
				createGate("test"),
			]);
			expect(isLintOnly(item)).toBe(false);
		});

		it("should return false for empty gates", () => {
			const item = createItem("no-gates", []);
			expect(isLintOnly(item)).toBe(false);
		});
	});

	describe("touchesContracts", () => {
		it("should detect contract-related names", () => {
			expect(touchesContracts(createItem("update-contract"))).toBe(true);
			expect(touchesContracts(createItem("agents-config"))).toBe(true);
			expect(touchesContracts(createItem("policy-update"))).toBe(true);
			expect(touchesContracts(createItem("governance-rules"))).toBe(true);
		});

		it("should not flag regular items", () => {
			expect(touchesContracts(createItem("feature-add"))).toBe(false);
			expect(touchesContracts(createItem("bugfix-123"))).toBe(false);
		});
	});

	describe("hasHighConflictPrediction", () => {
		it("should return true for items with many deps", () => {
			const item = createItem("complex", ["a", "b", "c", "d"]);
			expect(hasHighConflictPrediction(item)).toBe(true);
		});

		it("should return false for items with few deps", () => {
			const item = createItem("simple", ["a", "b"]);
			expect(hasHighConflictPrediction(item)).toBe(false);
		});
	});

	describe("hasComplexDependencies", () => {
		it("should return true for items with >5 deps", () => {
			const item = createItem("complex", ["a", "b", "c", "d", "e", "f"]);
			expect(hasComplexDependencies(item)).toBe(true);
		});

		it("should return false for items with <=5 deps", () => {
			const item = createItem("normal", ["a", "b", "c", "d", "e"]);
			expect(hasComplexDependencies(item)).toBe(false);
		});
	});

	describe("suggestTier", () => {
		it("should suggest senior for high conflict prediction", () => {
			const item = createItem("complex", ["a", "b", "c", "d"]);
			expect(suggestTier(item)).toBe("senior");
		});

		it("should suggest senior for complex dependencies", () => {
			const item = createItem("many-deps", ["a", "b", "c", "d", "e", "f"]);
			expect(suggestTier(item)).toBe("senior");
		});

		it("should suggest senior for contract-related items", () => {
			const item = createItem("update-contract", []);
			expect(suggestTier(item)).toBe("senior");
		});

		it("should suggest junior for lint-only items", () => {
			const item = createItem("lint-task", [], [createGate("lint")]);
			expect(suggestTier(item)).toBe("junior");
		});

		it("should suggest junior for format-only items", () => {
			const item = createItem("format-task", [], [createGate("prettier")]);
			expect(suggestTier(item)).toBe("junior");
		});

		it("should suggest mid for standard items", () => {
			const item = createItem("feature-add", ["base"], [createGate("test")]);
			expect(suggestTier(item)).toBe("mid");
		});

		it("should prioritize senior indicators over junior", () => {
			// Item with lint gate but many deps should be senior
			const item = createItem(
				"complex-lint",
				["a", "b", "c", "d"],
				[createGate("lint")]
			);
			expect(suggestTier(item)).toBe("senior");
		});
	});

	describe("createTierAssignment", () => {
		it("should create assignment without override", () => {
			const item = createItem("simple", [], [createGate("test")]);
			const assignment = createTierAssignment(item);

			expect(assignment.suggested).toBe("mid");
			expect(assignment.actual).toBeUndefined();
			expect(assignment.escalated).toBe(false);
		});

		it("should apply override when matched", () => {
			const item = createItem("simple", [], [createGate("lint")]);
			const overrides = [{ itemName: "simple", tier: "senior" as const }];
			const assignment = createTierAssignment(item, overrides);

			expect(assignment.suggested).toBe("junior");
			expect(assignment.actual).toBe("senior");
			expect(assignment.escalated).toBe(true);
			expect(assignment.mismatch).toBe(true);
		});

		it("should not apply override when not matched", () => {
			const item = createItem("simple", [], [createGate("lint")]);
			const overrides = [{ itemName: "other", tier: "senior" as const }];
			const assignment = createTierAssignment(item, overrides);

			expect(assignment.suggested).toBe("junior");
			expect(assignment.actual).toBeUndefined();
		});
	});

	describe("suggestTiersForPlan", () => {
		it("should create assignments for all items", () => {
			const items: PlanItem[] = [
				createItem("lint-task", [], [createGate("lint")]),
				createItem("feature", [], [createGate("test")]),
				createItem("complex", ["a", "b", "c", "d"]),
			];

			const assignments = suggestTiersForPlan(items);

			expect(assignments.size).toBe(3);
			expect(assignments.get("lint-task")?.suggested).toBe("junior");
			expect(assignments.get("feature")?.suggested).toBe("mid");
			expect(assignments.get("complex")?.suggested).toBe("senior");
		});
	});
});

describe("Tier Metrics", () => {
	describe("calculateTierMetrics", () => {
		it("should calculate metrics from array", () => {
			const assignments: TierAssignment[] = [
				{ suggested: "senior", escalated: false },
				{ suggested: "mid", escalated: false },
				{ suggested: "mid", actual: "senior", escalated: true, mismatch: true },
				{ suggested: "junior", escalated: false },
			];

			const metrics = calculateTierMetrics(assignments);

			expect(metrics.totalTasks).toBe(4);
			expect(metrics.byTier.senior).toBe(1);
			expect(metrics.byTier.mid).toBe(2);
			expect(metrics.byTier.junior).toBe(1);
			expect(metrics.escalations).toBe(1);
			expect(metrics.mismatches).toBe(1);
			expect(metrics.tierMatchRate).toBe(0.75);
			expect(metrics.escalationRate).toBe(0.25);
		});

		it("should calculate metrics from Map", () => {
			const assignments = new Map<string, TierAssignment>([
				["item1", { suggested: "senior", escalated: false }],
				["item2", { suggested: "mid", escalated: false }],
			]);

			const metrics = calculateTierMetrics(assignments);

			expect(metrics.totalTasks).toBe(2);
		});

		it("should handle empty assignments", () => {
			const metrics = calculateTierMetrics([]);

			expect(metrics.totalTasks).toBe(0);
			expect(metrics.tierMatchRate).toBe(1);
			expect(metrics.escalationRate).toBe(0);
		});

		it("should track actual tier distribution", () => {
			const assignments: TierAssignment[] = [
				{ suggested: "junior", actual: "mid", escalated: true, mismatch: true },
				{ suggested: "mid", actual: "senior", escalated: true, mismatch: true },
				{ suggested: "senior", escalated: false },
			];

			const metrics = calculateTierMetrics(assignments);

			expect(metrics.byTier.junior).toBe(1);
			expect(metrics.byTier.mid).toBe(1);
			expect(metrics.byTier.senior).toBe(1);

			// Actual distribution: 0 junior (overridden), 1 mid, 2 senior
			expect(metrics.byActualTier.junior).toBe(0);
			expect(metrics.byActualTier.mid).toBe(1);
			expect(metrics.byActualTier.senior).toBe(2);
		});
	});

	describe("meetsGovernanceTargets", () => {
		it("should pass when metrics meet targets", () => {
			const metrics = {
				totalTasks: 100,
				byTier: { senior: 20, mid: 50, junior: 30 },
				byActualTier: { senior: 22, mid: 48, junior: 30 },
				escalations: 5,
				mismatches: 5,
				tierMatchRate: 0.95,
				escalationRate: 0.05,
			};

			const result = meetsGovernanceTargets(metrics);

			expect(result.meetsAll).toBe(true);
			expect(result.tierMatchRate).toBe(true);
			expect(result.escalationRate).toBe(true);
		});

		it("should fail when tier match rate is low", () => {
			const metrics = {
				totalTasks: 100,
				byTier: { senior: 20, mid: 50, junior: 30 },
				byActualTier: { senior: 40, mid: 40, junior: 20 },
				escalations: 5,
				mismatches: 20,
				tierMatchRate: 0.8,
				escalationRate: 0.05,
			};

			const result = meetsGovernanceTargets(metrics);

			expect(result.meetsAll).toBe(false);
			expect(result.tierMatchRate).toBe(false);
			expect(result.escalationRate).toBe(true);
		});

		it("should fail when escalation rate is high", () => {
			const metrics = {
				totalTasks: 100,
				byTier: { senior: 20, mid: 50, junior: 30 },
				byActualTier: { senior: 35, mid: 45, junior: 20 },
				escalations: 15,
				mismatches: 5,
				tierMatchRate: 0.95,
				escalationRate: 0.15,
			};

			const result = meetsGovernanceTargets(metrics);

			expect(result.meetsAll).toBe(false);
			expect(result.tierMatchRate).toBe(true);
			expect(result.escalationRate).toBe(false);
		});
	});

	describe("formatTierMetrics", () => {
		it("should format metrics as readable string", () => {
			const metrics = {
				totalTasks: 10,
				byTier: { senior: 2, mid: 5, junior: 3 },
				byActualTier: { senior: 3, mid: 4, junior: 3 },
				escalations: 1,
				mismatches: 1,
				tierMatchRate: 0.9,
				escalationRate: 0.1,
			};

			const formatted = formatTierMetrics(metrics);

			expect(formatted).toContain("Total Tasks: 10");
			expect(formatted).toContain("Senior: 2");
			expect(formatted).toContain("Tier Match Rate:   90.0%");
			expect(formatted).toContain("Escalation Rate:   10.0%");
		});
	});

	describe("tierMetricsToJSON", () => {
		it("should convert metrics to JSON format", () => {
			const metrics = {
				totalTasks: 10,
				byTier: { senior: 2, mid: 5, junior: 3 },
				byActualTier: { senior: 3, mid: 4, junior: 3 },
				escalations: 1,
				mismatches: 1,
				tierMatchRate: 0.9,
				escalationRate: 0.1,
			};

			const json = tierMetricsToJSON(metrics);

			expect(json.totalTasks).toBe(10);
			expect(json.tierMatchRate).toBe(0.9);
			expect(json.governance).toEqual({
				meetsAll: true,
				tierMatchRate: true,
				escalationRate: true,
			});
		});
	});

	describe("TIER_METRIC_TARGETS", () => {
		it("should have expected target values", () => {
			expect(TIER_METRIC_TARGETS.tierMatchRate).toBe(0.9);
			expect(TIER_METRIC_TARGETS.escalationRate).toBe(0.1);
			expect(TIER_METRIC_TARGETS.costEfficiency).toBe(1.2);
		});
	});
});
