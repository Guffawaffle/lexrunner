/**
 * Attribution Tracking Tests - LR-TSF-001
 */

import { describe, it, expect } from "vitest";
import {
  AttributionTracker,
  createAttributionTracker,
  type ConstraintAttribution,
  type AttributionLogEntry,
  type FrameAttribution,
} from "../../../src/runs/attribution.js";

describe("AttributionTracker", () => {
  describe("logAttribution", () => {
    it("logs a single attribution", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate on PR-123",
        "PR-123"
      );

      const attributions = tracker.getAttributions();
      expect(attributions).toHaveLength(1);
      expect(attributions[0].constraintId).toBe("merge-gates-required");
      expect(attributions[0].statement).toBe("All PRs must pass lint gate");
      expect(attributions[0].source).toBe("baseline");
      expect(attributions[0].action).toBe("ran lint gate on PR-123");
      expect(attributions[0].target).toBe("PR-123");
      expect(attributions[0].appliedAt).toBeDefined();
    });

    it("logs multiple attributions", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate on PR-123",
        "PR-123"
      );

      tracker.logAttribution(
        "no-force-push",
        "Never use force push",
        "persona",
        "used merge instead of rebase",
        "PR-124"
      );

      const attributions = tracker.getAttributions();
      expect(attributions).toHaveLength(2);
      expect(attributions[0].constraintId).toBe("merge-gates-required");
      expect(attributions[1].constraintId).toBe("no-force-push");
    });

    it("supports attributions without target", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate"
      );

      const attributions = tracker.getAttributions();
      expect(attributions).toHaveLength(1);
      expect(attributions[0].target).toBeUndefined();
    });
  });

  describe("getFrameAttributions", () => {
    it("returns simplified attributions for frames", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate on PR-123",
        "PR-123"
      );

      tracker.logAttribution(
        "no-force-push",
        "Never use force push",
        "persona",
        "used merge instead of rebase"
      );

      const frameAttrs = tracker.getFrameAttributions();
      expect(frameAttrs).toHaveLength(2);

      expect(frameAttrs[0]).toEqual({
        constraintId: "merge-gates-required",
        source: "baseline",
        action: "ran lint gate on PR-123",
      });

      expect(frameAttrs[1]).toEqual({
        constraintId: "no-force-push",
        source: "persona",
        action: "used merge instead of rebase",
      });
    });

    it("returns empty array when no attributions logged", () => {
      const tracker = createAttributionTracker();
      const frameAttrs = tracker.getFrameAttributions();
      expect(frameAttrs).toEqual([]);
    });
  });

  describe("getLogEntries", () => {
    it("returns log entries for NDJSON storage", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate on PR-123",
        "PR-123"
      );

      const logEntries = tracker.getLogEntries();
      expect(logEntries).toHaveLength(1);

      expect(logEntries[0].timestamp).toBeDefined();
      expect(logEntries[0].constraintId).toBe("merge-gates-required");
      expect(logEntries[0].action).toBe("ran lint gate on PR-123");
      expect(logEntries[0].target).toBe("PR-123");
      expect(logEntries[0].source).toBe("baseline");
      expect(logEntries[0].statement).toBe("All PRs must pass lint gate");
    });
  });

  describe("clear", () => {
    it("clears all attributions", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution(
        "merge-gates-required",
        "All PRs must pass lint gate",
        "baseline",
        "ran lint gate on PR-123",
        "PR-123"
      );

      expect(tracker.getAttributions()).toHaveLength(1);

      tracker.clear();

      expect(tracker.getAttributions()).toEqual([]);
      expect(tracker.getFrameAttributions()).toEqual([]);
      expect(tracker.getLogEntries()).toEqual([]);
    });
  });

  describe("constraint sources", () => {
    it("supports baseline source", () => {
      const tracker = createAttributionTracker();
      tracker.logAttribution("test-constraint", "Test statement", "baseline", "test action");

      expect(tracker.getAttributions()[0].source).toBe("baseline");
    });

    it("supports persona source", () => {
      const tracker = createAttributionTracker();
      tracker.logAttribution("test-constraint", "Test statement", "persona", "test action");

      expect(tracker.getAttributions()[0].source).toBe("persona");
    });

    it("supports learned source", () => {
      const tracker = createAttributionTracker();
      tracker.logAttribution("test-constraint", "Test statement", "learned", "test action");

      expect(tracker.getAttributions()[0].source).toBe("learned");
    });
  });

  describe("getAttributions immutability", () => {
    it("returns a copy of attributions array", () => {
      const tracker = createAttributionTracker();

      tracker.logAttribution("test-constraint", "Test statement", "baseline", "test action");

      const attrs1 = tracker.getAttributions();
      const attrs2 = tracker.getAttributions();

      // Should be different array instances
      expect(attrs1).not.toBe(attrs2);
      // But with same content
      expect(attrs1).toEqual(attrs2);
    });
  });
});
