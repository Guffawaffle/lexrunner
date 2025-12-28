/**
 * Tests for MCP Status Governance Integration
 */

import { describe, it, expect } from "vitest";
import {
  buildGovernanceStatus,
  formatGovernanceStatus,
  governanceStatusToJSON,
} from "../../src/governance/mcpStatus.js";
import type { TierMetrics } from "../../src/tiers/metrics.js";
import type { HostilityScore } from "../../src/hostility/score.js";
import type { TurnCostSummary } from "../../src/metrics/turncost.js";

// Helper to create mock TierMetrics
function createMockTierMetrics(
  escalationRate: number = 0.05,
  tierMatchRate: number = 0.95
): TierMetrics {
  return {
    totalTasks: 10,
    byTier: { senior: 2, mid: 5, junior: 3 },
    byActualTier: { senior: 3, mid: 4, junior: 3 },
    escalations: Math.round(escalationRate * 10),
    mismatches: Math.round((1 - tierMatchRate) * 10),
    tierMatchRate,
    escalationRate,
  };
}

// Helper to create mock HostilityScore
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
    recommendations: total > 0.3 ? ["Improve constraints", "Add docs"] : [],
  };
}

// Helper to create mock TurnCostSummary
function createMockTurnCostSummary(
  weightedScore: number = 1.0,
  eventCount: number = 5
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
  };
}

describe("MCP Governance Status", () => {
  describe("buildGovernanceStatus", () => {
    it("should build healthy status when all metrics are good", () => {
      const tierMetrics = createMockTierMetrics(0.05, 0.95);
      const hostilityScore = createMockHostilityScore(0.2, "low");
      const turnCostSummary = createMockTurnCostSummary(1.0, 5);

      const status = buildGovernanceStatus(tierMetrics, turnCostSummary, hostilityScore);

      expect(status.health).toBe("healthy");
      expect(status.warnings).toHaveLength(0);
    });

    it("should warn on high escalation rate", () => {
      const tierMetrics = createMockTierMetrics(0.15, 0.95); // 15% escalation > 10% threshold

      const status = buildGovernanceStatus(tierMetrics);

      expect(status.health).toBe("warning");
      expect(status.warnings.some((w) => w.includes("Escalation rate"))).toBe(true);
    });

    it("should warn on low tier match rate", () => {
      const tierMetrics = createMockTierMetrics(0.05, 0.85); // 85% match < 90% threshold

      const status = buildGovernanceStatus(tierMetrics);

      expect(status.health).toBe("warning");
      expect(status.warnings.some((w) => w.includes("Tier match rate"))).toBe(true);
    });

    it("should warn on Turn Cost regression", () => {
      const turnCostSummary = createMockTurnCostSummary(1.5, 5);
      const priorScore = 1.0; // 50% regression

      const status = buildGovernanceStatus(undefined, turnCostSummary, undefined, priorScore);

      expect(status.health).toBe("warning");
      expect(status.warnings.some((w) => w.includes("Turn Cost regression"))).toBe(true);
    });

    it("should warn on high hostility", () => {
      const hostilityScore = createMockHostilityScore(0.65, "high");

      const status = buildGovernanceStatus(undefined, undefined, hostilityScore);

      expect(status.health).toBe("warning");
      expect(status.warnings.some((w) => w.includes("hostility is high"))).toBe(true);
    });

    it("should be critical on very high hostility", () => {
      const hostilityScore = createMockHostilityScore(0.85, "high");

      const status = buildGovernanceStatus(undefined, undefined, hostilityScore);

      expect(status.health).toBe("critical");
    });

    it("should be critical with many warnings", () => {
      const tierMetrics = createMockTierMetrics(0.15, 0.85);
      const hostilityScore = createMockHostilityScore(0.65, "high");
      const turnCostSummary = createMockTurnCostSummary(1.5, 5);

      const status = buildGovernanceStatus(tierMetrics, turnCostSummary, hostilityScore, 1.0);

      // Should have 4+ warnings: escalation rate, tier match, hostility, turn cost
      expect(status.warnings.length).toBeGreaterThanOrEqual(4);
      expect(status.health).toBe("critical");
    });

    it("should include tier distribution", () => {
      const tierMetrics = createMockTierMetrics();

      const status = buildGovernanceStatus(tierMetrics);

      expect(status.tiers).toBeDefined();
      expect(status.tiers!.distribution.senior).toBe(3);
      expect(status.tiers!.distribution.mid).toBe(4);
      expect(status.tiers!.distribution.junior).toBe(3);
    });

    it("should include Turn Cost data", () => {
      const turnCostSummary = createMockTurnCostSummary(1.5, 10);

      const status = buildGovernanceStatus(undefined, turnCostSummary, undefined, 1.0);

      expect(status.turnCost).toBeDefined();
      expect(status.turnCost!.weightedScore).toBe(1.5);
      expect(status.turnCost!.eventCount).toBe(10);
      expect(status.turnCost!.priorRunScore).toBe(1.0);
    });

    it("should include hostility data", () => {
      const hostilityScore = createMockHostilityScore(0.35, "medium");

      const status = buildGovernanceStatus(undefined, undefined, hostilityScore);

      expect(status.hostility).toBeDefined();
      expect(status.hostility!.score).toBe(0.35);
      expect(status.hostility!.status).toBe("medium");
      expect(status.hostility!.recommendationCount).toBe(2);
    });

    it("should handle empty input", () => {
      const status = buildGovernanceStatus();

      expect(status.health).toBe("healthy");
      expect(status.warnings).toHaveLength(0);
      expect(status.tiers).toBeUndefined();
      expect(status.turnCost).toBeUndefined();
      expect(status.hostility).toBeUndefined();
    });
  });

  describe("formatGovernanceStatus", () => {
    it("should format healthy status", () => {
      const status = buildGovernanceStatus();
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("Governance Status");
      expect(formatted).toContain("Overall Health:");
      expect(formatted).toContain("✅");
      expect(formatted).toContain("HEALTHY");
    });

    it("should format warning status with icon", () => {
      const tierMetrics = createMockTierMetrics(0.15, 0.95);
      const status = buildGovernanceStatus(tierMetrics);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("⚠️");
      expect(formatted).toContain("WARNING");
    });

    it("should format critical status with icon", () => {
      const hostilityScore = createMockHostilityScore(0.85, "high");
      const status = buildGovernanceStatus(undefined, undefined, hostilityScore);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("CRITICAL");
    });

    it("should include tier distribution when present", () => {
      const tierMetrics = createMockTierMetrics();
      const status = buildGovernanceStatus(tierMetrics);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("Tier Distribution:");
      expect(formatted).toContain("Senior: 3");
      expect(formatted).toContain("Mid:    4");
      expect(formatted).toContain("Junior: 3");
    });

    it("should include Turn Cost when present", () => {
      const turnCostSummary = createMockTurnCostSummary(1.5, 10);
      const status = buildGovernanceStatus(undefined, turnCostSummary);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("Turn Cost:");
      expect(formatted).toContain("Weighted Score: 1.50");
      expect(formatted).toContain("Event Count:    10");
    });

    it("should include hostility when present", () => {
      const hostilityScore = createMockHostilityScore(0.35, "medium");
      const status = buildGovernanceStatus(undefined, undefined, hostilityScore);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("Environment Hostility:");
      expect(formatted).toContain("Score:  35%");
      expect(formatted).toContain("Status: medium");
    });

    it("should list warnings", () => {
      const tierMetrics = createMockTierMetrics(0.15, 0.85);
      const status = buildGovernanceStatus(tierMetrics);
      const formatted = formatGovernanceStatus(status);

      expect(formatted).toContain("Warnings:");
    });
  });

  describe("governanceStatusToJSON", () => {
    it("should produce JSON-serializable output", () => {
      const tierMetrics = createMockTierMetrics();
      const hostilityScore = createMockHostilityScore(0.35, "medium");
      const turnCostSummary = createMockTurnCostSummary(1.5, 10);

      const status = buildGovernanceStatus(tierMetrics, turnCostSummary, hostilityScore, 1.0);

      const json = governanceStatusToJSON(status);

      expect(() => JSON.stringify(json)).not.toThrow();
      expect(json.health).toBe(status.health);
      expect(json.warnings).toEqual(status.warnings);
    });

    it("should include all sections when present", () => {
      const tierMetrics = createMockTierMetrics();
      const status = buildGovernanceStatus(tierMetrics);
      const json = governanceStatusToJSON(status);

      expect(json.tiers).toBeDefined();
    });
  });
});
