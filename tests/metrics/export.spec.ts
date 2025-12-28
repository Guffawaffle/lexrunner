/**
 * Tests for Governance Metrics Export (Wave 3)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  GovernanceMetricsCollector,
  createMetricsCollector,
  getGlobalMetricsCollector,
  resetGlobalMetricsCollector,
  METRIC_DEFINITIONS,
  type MetricsSnapshot,
} from "../../src/metrics/export.js";
import type { TurnCostSummary, TurnCostComponents } from "../../src/metrics/turncost.js";
import type { TierMetrics } from "../../src/tiers/metrics.js";
import type { BudgetSummary } from "../../src/budget/tracker.js";

describe("GovernanceMetricsCollector", () => {
  let collector: GovernanceMetricsCollector;

  beforeEach(() => {
    collector = createMetricsCollector();
  });

  describe("Session Management", () => {
    it("should generate a unique session ID", () => {
      const sessionId = collector.getSessionId();
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("should use provided session ID", () => {
      const customSessionId = "test-session-123";
      const customCollector = createMetricsCollector(customSessionId);
      expect(customCollector.getSessionId()).toBe(customSessionId);
    });
  });

  describe("Turn Cost Metrics", () => {
    it("should record Turn Cost metrics", () => {
      const turnCostSummary: TurnCostSummary = {
        components: {
          latencyMs: 1500,
          contextResetTokens: 0,
          renegotiationCount: 2,
          tokenBloat: 100,
          attentionSwitchCount: 1,
        },
        weightedScore: 3.5,
        eventCount: 5,
      };

      collector.recordTurnCost(turnCostSummary);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.turnCost).not.toBeNull();
      expect(snapshot.metrics.turnCost?.total).toBe(3.5);
      expect(snapshot.metrics.turnCost?.eventCount).toBe(5);
      expect(snapshot.metrics.turnCost?.components.latencyMs).toBe(1500);
    });
  });

  describe("Tier Distribution Metrics", () => {
    it("should record tier distribution metrics", () => {
      const tierMetrics: TierMetrics = {
        totalTasks: 10,
        byTier: { senior: 2, mid: 5, junior: 3 },
        byActualTier: { senior: 3, mid: 4, junior: 3 },
        escalations: 1,
        mismatches: 1,
        tierMatchRate: 0.9,
        escalationRate: 0.1,
      };

      collector.recordTierDistribution(tierMetrics);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.tierDistribution).not.toBeNull();
      expect(snapshot.metrics.tierDistribution?.byTier.senior).toBe(3);
      expect(snapshot.metrics.tierDistribution?.byTier.mid).toBe(4);
      expect(snapshot.metrics.tierDistribution?.byTier.junior).toBe(3);
      expect(snapshot.metrics.tierDistribution?.tierMatchRate).toBe(0.9);
      expect(snapshot.metrics.tierDistribution?.escalationRate).toBe(0.1);
    });
  });

  describe("Failure Rate Metrics", () => {
    it("should record failure rate metrics", () => {
      collector.recordFailureRate(2, 10);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.failureRate).not.toBeNull();
      expect(snapshot.metrics.failureRate?.gateFailures).toBe(2);
      expect(snapshot.metrics.failureRate?.totalGates).toBe(10);
      expect(snapshot.metrics.failureRate?.failureRate).toBe(0.2);
    });

    it("should handle zero total gates", () => {
      collector.recordFailureRate(0, 0);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.failureRate?.failureRate).toBe(0);
    });
  });

  describe("Budget Remaining Metrics", () => {
    it("should record budget remaining metrics", () => {
      const budgetSummary: BudgetSummary = {
        prompts: 2,
        tokens_estimated: 3000,
        tokenBudget: 5000,
        maxPrompts: 5,
        tokenBudgetExceeded: false,
        promptBudgetExceeded: false,
      };

      collector.recordBudgetRemaining(budgetSummary);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.budgetRemaining).not.toBeNull();
      expect(snapshot.metrics.budgetRemaining?.tokensRemaining).toBe(2000);
      expect(snapshot.metrics.budgetRemaining?.promptsRemaining).toBe(3);
      expect(snapshot.metrics.budgetRemaining?.tokenBudget).toBe(5000);
      expect(snapshot.metrics.budgetRemaining?.maxPrompts).toBe(5);
    });

    it("should cap remaining at zero when exceeded", () => {
      const budgetSummary: BudgetSummary = {
        prompts: 10,
        tokens_estimated: 10000,
        tokenBudget: 5000,
        maxPrompts: 5,
        tokenBudgetExceeded: true,
        promptBudgetExceeded: true,
      };

      collector.recordBudgetRemaining(budgetSummary);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.budgetRemaining?.tokensRemaining).toBe(0);
      expect(snapshot.metrics.budgetRemaining?.promptsRemaining).toBe(0);
    });

    it("should calculate utilization correctly", () => {
      const budgetSummary: BudgetSummary = {
        prompts: 2,
        tokens_estimated: 2500,
        tokenBudget: 5000,
        maxPrompts: 4,
        tokenBudgetExceeded: false,
        promptBudgetExceeded: false,
      };

      collector.recordBudgetRemaining(budgetSummary);

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.budgetRemaining?.tokenUtilization).toBe(0.5);
      expect(snapshot.metrics.budgetRemaining?.promptUtilization).toBe(0.5);
    });
  });

  describe("Prometheus Export", () => {
    it("should export empty metrics", () => {
      const prometheus = collector.exportPrometheus();
      expect(prometheus).toBe("\n");
    });

    it("should export Turn Cost metrics in Prometheus format", () => {
      const turnCostSummary: TurnCostSummary = {
        components: {
          latencyMs: 1000,
          contextResetTokens: 0,
          renegotiationCount: 1,
          tokenBloat: 50,
          attentionSwitchCount: 0,
        },
        weightedScore: 2.5,
        eventCount: 3,
      };

      collector.recordTurnCost(turnCostSummary);

      const prometheus = collector.exportPrometheus();
      expect(prometheus).toContain("# HELP lex_turn_cost_total");
      expect(prometheus).toContain("# TYPE lex_turn_cost_total counter");
      expect(prometheus).toContain("lex_turn_cost_total 2.5");
    });

    it("should export tier distribution with labels", () => {
      const tierMetrics: TierMetrics = {
        totalTasks: 6,
        byTier: { senior: 1, mid: 2, junior: 3 },
        byActualTier: { senior: 2, mid: 2, junior: 2 },
        escalations: 1,
        mismatches: 0,
        tierMatchRate: 1.0,
        escalationRate: 0.167,
      };

      collector.recordTierDistribution(tierMetrics);

      const prometheus = collector.exportPrometheus();
      expect(prometheus).toContain('lex_tier_distribution{tier="senior"} 2');
      expect(prometheus).toContain('lex_tier_distribution{tier="mid"} 2');
      expect(prometheus).toContain('lex_tier_distribution{tier="junior"} 2');
      expect(prometheus).toContain("lex_tier_match_rate 1");
    });

    it("should export budget remaining with type labels", () => {
      const budgetSummary: BudgetSummary = {
        prompts: 1,
        tokens_estimated: 1000,
        tokenBudget: 5000,
        maxPrompts: 3,
        tokenBudgetExceeded: false,
        promptBudgetExceeded: false,
      };

      collector.recordBudgetRemaining(budgetSummary);

      const prometheus = collector.exportPrometheus();
      expect(prometheus).toContain('lex_budget_remaining{type="tokens"} 4000');
      expect(prometheus).toContain('lex_budget_remaining{type="prompts"} 2');
    });
  });

  describe("Metric Filtering", () => {
    beforeEach(() => {
      // Add some metrics
      collector.recordTurnCost({
        components: {
          latencyMs: 1000,
          contextResetTokens: 0,
          renegotiationCount: 1,
          tokenBloat: 50,
          attentionSwitchCount: 0,
        },
        weightedScore: 2.5,
        eventCount: 3,
      });

      collector.recordFailureRate(1, 10);

      collector.recordBudgetRemaining({
        prompts: 1,
        tokens_estimated: 1000,
        tokenBudget: 5000,
        maxPrompts: 3,
        tokenBudgetExceeded: false,
        promptBudgetExceeded: false,
      });
    });

    it("should filter by turn_cost pattern", () => {
      const snapshot = collector.getMetricsByName("turn_cost");

      expect(snapshot.metrics.turnCost).not.toBeNull();
      expect(snapshot.metrics.failureRate).toBeNull();
      expect(snapshot.metrics.budgetRemaining).toBeNull();
    });

    it("should filter by failure pattern", () => {
      const snapshot = collector.getMetricsByName("failure");

      expect(snapshot.metrics.turnCost).toBeNull();
      expect(snapshot.metrics.failureRate).not.toBeNull();
      expect(snapshot.metrics.budgetRemaining).toBeNull();
    });

    it("should filter by budget pattern", () => {
      const snapshot = collector.getMetricsByName("budget");

      expect(snapshot.metrics.turnCost).toBeNull();
      expect(snapshot.metrics.failureRate).toBeNull();
      expect(snapshot.metrics.budgetRemaining).not.toBeNull();
    });

    it("should be case insensitive", () => {
      const snapshot = collector.getMetricsByName("TURN_COST");
      expect(snapshot.metrics.turnCost).not.toBeNull();
    });
  });

  describe("Metric Values Array", () => {
    it("should return empty array for empty collector", () => {
      const values = collector.getMetricValues();
      expect(values).toHaveLength(0);
    });

    it("should return all metric values with timestamps", () => {
      collector.recordTurnCost({
        components: {
          latencyMs: 1000,
          contextResetTokens: 0,
          renegotiationCount: 1,
          tokenBloat: 50,
          attentionSwitchCount: 0,
        },
        weightedScore: 2.5,
        eventCount: 3,
      });

      collector.recordFailureRate(1, 10);

      const values = collector.getMetricValues();
      expect(values.length).toBeGreaterThan(0);
      expect(values[0]).toHaveProperty("name");
      expect(values[0]).toHaveProperty("value");
      expect(values[0]).toHaveProperty("timestamp");
    });

    it("should include labels for labeled metrics", () => {
      const tierMetrics: TierMetrics = {
        totalTasks: 3,
        byTier: { senior: 1, mid: 1, junior: 1 },
        byActualTier: { senior: 1, mid: 1, junior: 1 },
        escalations: 0,
        mismatches: 0,
        tierMatchRate: 1.0,
        escalationRate: 0,
      };

      collector.recordTierDistribution(tierMetrics);

      const values = collector.getMetricValues();
      const labeledValues = values.filter((v) => v.labels !== undefined);
      expect(labeledValues.length).toBeGreaterThan(0);

      const seniorValue = values.find(
        (v) => v.name === "lex_tier_distribution" && v.labels?.tier === "senior"
      );
      expect(seniorValue).toBeDefined();
    });
  });

  describe("Reset", () => {
    it("should clear all metrics", () => {
      collector.recordTurnCost({
        components: {
          latencyMs: 1000,
          contextResetTokens: 0,
          renegotiationCount: 1,
          tokenBloat: 50,
          attentionSwitchCount: 0,
        },
        weightedScore: 2.5,
        eventCount: 3,
      });

      collector.recordFailureRate(1, 10);

      collector.reset();

      const snapshot = collector.getSnapshot();
      expect(snapshot.metrics.turnCost).toBeNull();
      expect(snapshot.metrics.failureRate).toBeNull();
    });
  });

  describe("Snapshot Structure", () => {
    it("should include timestamp and session ID", () => {
      const snapshot = collector.getSnapshot();

      expect(snapshot).toHaveProperty("timestamp");
      expect(snapshot).toHaveProperty("sessionId");
      expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(snapshot.sessionId).toBe(collector.getSessionId());
    });

    it("should have consistent structure for empty and filled snapshots", () => {
      const emptySnapshot = collector.getSnapshot();
      expect(emptySnapshot.metrics).toHaveProperty("turnCost");
      expect(emptySnapshot.metrics).toHaveProperty("tierDistribution");
      expect(emptySnapshot.metrics).toHaveProperty("failureRate");
      expect(emptySnapshot.metrics).toHaveProperty("budgetRemaining");
    });
  });
});

describe("METRIC_DEFINITIONS", () => {
  it("should define lex_turn_cost_total", () => {
    expect(METRIC_DEFINITIONS.lex_turn_cost_total).toBeDefined();
    expect(METRIC_DEFINITIONS.lex_turn_cost_total.type).toBe("counter");
  });

  it("should define lex_tier_distribution with labels", () => {
    expect(METRIC_DEFINITIONS.lex_tier_distribution).toBeDefined();
    expect(METRIC_DEFINITIONS.lex_tier_distribution.type).toBe("gauge");
    expect(METRIC_DEFINITIONS.lex_tier_distribution.labels).toContain("tier");
  });

  it("should define lex_failure_rate", () => {
    expect(METRIC_DEFINITIONS.lex_failure_rate).toBeDefined();
    expect(METRIC_DEFINITIONS.lex_failure_rate.type).toBe("gauge");
  });

  it("should define lex_budget_remaining with labels", () => {
    expect(METRIC_DEFINITIONS.lex_budget_remaining).toBeDefined();
    expect(METRIC_DEFINITIONS.lex_budget_remaining.type).toBe("gauge");
    expect(METRIC_DEFINITIONS.lex_budget_remaining.labels).toContain("type");
  });

  it("should have help text for all metrics", () => {
    for (const [name, def] of Object.entries(METRIC_DEFINITIONS)) {
      expect(def.help).toBeDefined();
      expect(def.help.length).toBeGreaterThan(0);
    }
  });
});

describe("Global Metrics Collector", () => {
  beforeEach(() => {
    resetGlobalMetricsCollector();
  });

  it("should return the same instance on multiple calls", () => {
    const first = getGlobalMetricsCollector();
    const second = getGlobalMetricsCollector();
    expect(first).toBe(second);
  });

  it("should return a new instance after reset", () => {
    const first = getGlobalMetricsCollector();
    const firstId = first.getSessionId();

    resetGlobalMetricsCollector();

    const second = getGlobalMetricsCollector();
    expect(second.getSessionId()).not.toBe(firstId);
  });

  it("should preserve metrics until reset", () => {
    const collector = getGlobalMetricsCollector();
    collector.recordFailureRate(5, 10);

    const sameCollector = getGlobalMetricsCollector();
    const snapshot = sameCollector.getSnapshot();
    expect(snapshot.metrics.failureRate?.failureRate).toBe(0.5);

    resetGlobalMetricsCollector();

    const newCollector = getGlobalMetricsCollector();
    const newSnapshot = newCollector.getSnapshot();
    expect(newSnapshot.metrics.failureRate).toBeNull();
  });
});
