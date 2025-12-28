/**
 * Tests for Turn Cost tracking
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MergeWeaveTurnCost,
  createTurnCostTracker,
  DEFAULT_TURN_COST_WEIGHTS,
} from "../../src/metrics/turncost.js";

describe("MergeWeaveTurnCost", () => {
  let tracker: MergeWeaveTurnCost;

  beforeEach(() => {
    tracker = new MergeWeaveTurnCost();
  });

  describe("Latency Tracking", () => {
    it("should accumulate latency values", () => {
      tracker.recordLatency(1000);
      tracker.recordLatency(500);
      tracker.recordLatency(250);

      const components = tracker.getComponents();
      expect(components.latencyMs).toBe(1750);
    });

    it("should record latency events", () => {
      tracker.recordLatency(1000, "pr-123");

      const events = tracker.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("latency");
      expect(events[0].details.durationMs).toBe(1000);
      expect(events[0].details.itemName).toBe("pr-123");
    });
  });

  describe("Renegotiation Tracking", () => {
    it("should count renegotiation events", () => {
      tracker.recordRenegotiation("conflict in feature-1");
      tracker.recordRenegotiation("conflict in feature-2");
      tracker.recordRenegotiation("retry after timeout");

      const components = tracker.getComponents();
      expect(components.renegotiationCount).toBe(3);
    });

    it("should record renegotiation events with details", () => {
      tracker.recordRenegotiation("merge conflict", "pr-456");

      const events = tracker.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("renegotiation");
      expect(events[0].details.reason).toBe("merge conflict");
      expect(events[0].details.itemName).toBe("pr-456");
    });
  });

  describe("Token Bloat Tracking", () => {
    it("should accumulate token bloat", () => {
      tracker.recordTokenBloat(1000, 1500); // +500
      tracker.recordTokenBloat(500, 800); // +300

      const components = tracker.getComponents();
      expect(components.tokenBloat).toBe(800);
    });

    it("should not count negative bloat", () => {
      tracker.recordTokenBloat(1000, 500); // actual < expected, no bloat

      const components = tracker.getComponents();
      expect(components.tokenBloat).toBe(0);
    });

    it("should record token bloat events", () => {
      tracker.recordTokenBloat(1000, 1500, "pr-789");

      const events = tracker.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("token_bloat");
      expect(events[0].details.expectedTokens).toBe(1000);
      expect(events[0].details.actualTokens).toBe(1500);
    });
  });

  describe("Attention Switch Tracking", () => {
    it("should count attention switches", () => {
      tracker.recordAttentionSwitch("manual conflict resolution");
      tracker.recordAttentionSwitch("user intervention required");

      const components = tracker.getComponents();
      expect(components.attentionSwitchCount).toBe(2);
    });

    it("should record attention switch events", () => {
      tracker.recordAttentionSwitch("manual review needed", "pr-101");

      const events = tracker.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("attention_switch");
      expect(events[0].details.reason).toBe("manual review needed");
    });
  });

  describe("Weighted Score Calculation", () => {
    it("should calculate weighted score with default weights", () => {
      // λ * (latencyMs / 1000) + γ * contextResetTokens + ρ * renegotiationCount + τ * tokenBloat + α * attentionSwitchCount
      // 0.1 * 1 + 0.2 * 0 + 0.3 * 2 + 0.1 * 100 + 0.3 * 1 = 0.1 + 0.6 + 10 + 0.3 = 11

      tracker.recordLatency(1000); // 1 second
      tracker.recordRenegotiation("conflict 1");
      tracker.recordRenegotiation("conflict 2");
      tracker.recordTokenBloat(0, 100); // 100 token bloat
      tracker.recordAttentionSwitch("manual fix");

      const score = tracker.getWeightedScore();
      const expected =
        DEFAULT_TURN_COST_WEIGHTS.lambda * 1 +
        DEFAULT_TURN_COST_WEIGHTS.gamma * 0 +
        DEFAULT_TURN_COST_WEIGHTS.rho * 2 +
        DEFAULT_TURN_COST_WEIGHTS.tau * 100 +
        DEFAULT_TURN_COST_WEIGHTS.alpha * 1;

      expect(score).toBeCloseTo(expected);
    });

    it("should use custom weights when provided", () => {
      const customWeights = {
        lambda: 1.0,
        gamma: 0,
        rho: 0,
        tau: 0,
        alpha: 0,
      };

      const trackerWithCustom = new MergeWeaveTurnCost(customWeights);
      trackerWithCustom.recordLatency(2000); // 2 seconds

      // With lambda = 1.0, score should be 2.0
      expect(trackerWithCustom.getWeightedScore()).toBe(2.0);
    });

    it("should return 0 for empty tracker", () => {
      expect(tracker.getWeightedScore()).toBe(0);
    });
  });

  describe("toJSON Output", () => {
    it("should return summary object", () => {
      tracker.recordLatency(1000);
      tracker.recordRenegotiation("test");

      const summary = tracker.toJSON();

      expect(summary).toHaveProperty("components");
      expect(summary).toHaveProperty("weightedScore");
      expect(summary).toHaveProperty("eventCount");
      expect(summary.eventCount).toBe(2);
    });

    it("should include prior run comparison when provided", () => {
      tracker.recordRenegotiation("test");

      const summary = tracker.toJSON(5.0);

      expect(summary.priorRunScore).toBe(5.0);
      expect(summary.improvement).toBeDefined();
    });

    it("should calculate negative improvement for better score", () => {
      tracker.recordLatency(100); // Very small latency = low score

      // Prior run had score of 10, current is much lower
      const summary = tracker.toJSON(10.0);

      expect(summary.improvement).toMatch(/-\d+%/);
    });

    it("should round weighted score to 2 decimal places", () => {
      tracker.recordLatency(1234); // Creates non-integer score

      const summary = tracker.toJSON();
      const decimalPlaces = (summary.weightedScore.toString().split(".")[1] || "").length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  describe("Reset", () => {
    it("should clear all tracked values", () => {
      tracker.recordLatency(1000);
      tracker.recordRenegotiation("test");
      tracker.recordTokenBloat(0, 100);
      tracker.recordAttentionSwitch("test");

      tracker.reset();

      const components = tracker.getComponents();
      expect(components.latencyMs).toBe(0);
      expect(components.renegotiationCount).toBe(0);
      expect(components.tokenBloat).toBe(0);
      expect(components.attentionSwitchCount).toBe(0);
      expect(tracker.getEvents()).toHaveLength(0);
    });
  });

  describe("Merge", () => {
    it("should merge another tracker into this one", () => {
      tracker.recordLatency(1000);
      tracker.recordRenegotiation("conflict 1");

      const other = new MergeWeaveTurnCost();
      other.recordLatency(500);
      other.recordRenegotiation("conflict 2");
      other.recordAttentionSwitch("manual");

      tracker.merge(other);

      const components = tracker.getComponents();
      expect(components.latencyMs).toBe(1500);
      expect(components.renegotiationCount).toBe(2);
      expect(components.attentionSwitchCount).toBe(1);
      expect(tracker.getEvents()).toHaveLength(5);
    });
  });

  describe("Factory Function", () => {
    it("should create tracker with createTurnCostTracker", () => {
      const t = createTurnCostTracker();
      expect(t).toBeInstanceOf(MergeWeaveTurnCost);
    });

    it("should accept custom weights", () => {
      const customWeights = {
        lambda: 0.5,
        gamma: 0.1,
        rho: 0.1,
        tau: 0.1,
        alpha: 0.2,
      };

      const t = createTurnCostTracker(customWeights);
      t.recordLatency(2000); // 2 seconds

      // With lambda = 0.5, score should be 1.0
      expect(t.getWeightedScore()).toBe(1.0);
    });
  });

  describe("Context Reset Tokens", () => {
    it("should always be 0 for deterministic runner", () => {
      // Context reset tokens are N/A for the runner (deterministic)
      // but we track the field for schema compatibility with Lex
      const components = tracker.getComponents();
      expect(components.contextResetTokens).toBe(0);
    });
  });

  describe("Event Timestamps", () => {
    it("should include ISO timestamps in events", () => {
      tracker.recordLatency(100);

      const events = tracker.getEvents();
      expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("Immutability", () => {
    it("should return copies of components", () => {
      tracker.recordLatency(1000);
      const components1 = tracker.getComponents();
      components1.latencyMs = 9999;

      const components2 = tracker.getComponents();
      expect(components2.latencyMs).toBe(1000);
    });

    it("should return copies of events", () => {
      tracker.recordLatency(1000);
      const events1 = tracker.getEvents();
      events1.pop();

      const events2 = tracker.getEvents();
      expect(events2).toHaveLength(1);
    });
  });
});

describe("DEFAULT_TURN_COST_WEIGHTS", () => {
  it("should have all required weight properties", () => {
    expect(DEFAULT_TURN_COST_WEIGHTS).toHaveProperty("lambda");
    expect(DEFAULT_TURN_COST_WEIGHTS).toHaveProperty("gamma");
    expect(DEFAULT_TURN_COST_WEIGHTS).toHaveProperty("rho");
    expect(DEFAULT_TURN_COST_WEIGHTS).toHaveProperty("tau");
    expect(DEFAULT_TURN_COST_WEIGHTS).toHaveProperty("alpha");
  });

  it("should have weights that sum to 1.0", () => {
    const sum =
      DEFAULT_TURN_COST_WEIGHTS.lambda +
      DEFAULT_TURN_COST_WEIGHTS.gamma +
      DEFAULT_TURN_COST_WEIGHTS.rho +
      DEFAULT_TURN_COST_WEIGHTS.tau +
      DEFAULT_TURN_COST_WEIGHTS.alpha;

    expect(sum).toBe(1.0);
  });
});
