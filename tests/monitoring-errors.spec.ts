import { describe, it, expect, beforeEach } from "vitest";
import { ErrorAggregator } from "../src/monitoring/errors";

describe("Monitoring - Error Aggregation", () => {
  let aggregator: ErrorAggregator;

  beforeEach(() => {
    aggregator = new ErrorAggregator();
  });

  describe("Error Recording", () => {
    it("should record errors with context", () => {
      const error = new Error("Test error");
      aggregator.recordError(error, { prId: "PR-101" });

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].errorType).toBe("Error");
      expect(groups[0].message).toBe("Test error");
      expect(groups[0].count).toBe(1);
      expect(groups[0].context[0]).toHaveProperty("prId", "PR-101");
    });

    it("should group similar errors", () => {
      aggregator.recordError(new Error("Failed to execute gate 1"));
      aggregator.recordError(new Error("Failed to execute gate 2"));
      aggregator.recordError(new Error("Failed to execute gate 3"));

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(3);
    });

    it("should track different error types separately", () => {
      class ValidationError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "ValidationError";
        }
      }

      aggregator.recordError(new Error("General error"));
      aggregator.recordError(new ValidationError("Validation error"));

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(2);

      const errorTypes = groups.map((g) => g.errorType).sort();
      expect(errorTypes).toEqual(["Error", "ValidationError"]);
    });

    it("should handle non-Error objects", () => {
      aggregator.recordError("String error");
      aggregator.recordError({ message: "Object error" });

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(2);
      expect(groups.some((g) => g.errorType === "UnknownError")).toBe(true);
    });
  });

  describe("Error Grouping Logic", () => {
    it("should normalize numeric values in messages", () => {
      aggregator.recordError(new Error("Timeout after 1000ms"));
      aggregator.recordError(new Error("Timeout after 2000ms"));
      aggregator.recordError(new Error("Timeout after 5000ms"));

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(3);
    });

    it("should normalize string literals in messages", () => {
      aggregator.recordError(new Error('File "test1.txt" not found'));
      aggregator.recordError(new Error('File "test2.txt" not found'));

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(2);
    });

    it("should normalize file paths in messages", () => {
      aggregator.recordError(new Error("Cannot read /path/to/file1"));
      aggregator.recordError(new Error("Cannot read /path/to/file2"));

      const groups = aggregator.getErrorGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(2);
    });
  });

  describe("Error Tracking", () => {
    it("should track first and last seen timestamps", () => {
      aggregator.recordError(new Error("Test error"));
      const groups1 = aggregator.getErrorGroups();
      const firstSeen = groups1[0].firstSeen;

      // Record same error again
      aggregator.recordError(new Error("Test error"));
      const groups2 = aggregator.getErrorGroups();
      const lastSeen = groups2[0].lastSeen;

      expect(groups2[0].firstSeen).toBe(firstSeen);
      expect(new Date(lastSeen).getTime()).toBeGreaterThanOrEqual(new Date(firstSeen).getTime());
    });

    it("should capture stack trace", () => {
      const error = new Error("Test error");
      aggregator.recordError(error);

      const groups = aggregator.getErrorGroups();
      expect(groups[0].stackTrace).toBeTruthy();
      expect(groups[0].stackTrace).toContain("Error: Test error");
    });

    it("should store context for each occurrence", () => {
      aggregator.recordError(new Error("Test error"), { attempt: 1 });
      aggregator.recordError(new Error("Test error"), { attempt: 2 });
      aggregator.recordError(new Error("Test error"), { attempt: 3 });

      const groups = aggregator.getErrorGroups();
      expect(groups[0].context).toHaveLength(3);
      expect(groups[0].context[0]).toHaveProperty("attempt", 1);
      expect(groups[0].context[1]).toHaveProperty("attempt", 2);
      expect(groups[0].context[2]).toHaveProperty("attempt", 3);
    });
  });

  describe("Error Summary", () => {
    it("should provide error summary", () => {
      aggregator.recordError(new Error("Connection timeout"));
      aggregator.recordError(new Error("Connection timeout"));
      aggregator.recordError(new Error("Parse error"));

      const summary = aggregator.getSummary();
      expect(summary.totalErrors).toBe(3);
      expect(summary.uniqueErrors).toBe(2);
      expect(summary.topErrors).toHaveLength(2);
    });

    it("should sort errors by count in summary", () => {
      aggregator.recordError(new Error("Rare error"));
      aggregator.recordError(new Error("Common error"));
      aggregator.recordError(new Error("Common error"));
      aggregator.recordError(new Error("Common error"));

      const summary = aggregator.getSummary();
      expect(summary.topErrors[0].count).toBe(3);
      expect(summary.topErrors[0].message).toBe("Common error");
    });

    it("should limit top errors to 5", () => {
      aggregator.recordError(new Error("Network error"));
      aggregator.recordError(new Error("Timeout error"));
      aggregator.recordError(new Error("Parse error"));
      aggregator.recordError(new Error("Validation error"));
      aggregator.recordError(new Error("Permission error"));
      aggregator.recordError(new Error("Not found error"));
      aggregator.recordError(new Error("Server error"));

      const summary = aggregator.getSummary();
      expect(summary.topErrors.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Export", () => {
    it("should export errors as JSON", () => {
      aggregator.recordError(new Error("Test error alpha"));
      aggregator.recordError(new Error("Test error beta"));

      const json = aggregator.exportJSON();
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(1);
      expect(json[0]).toHaveProperty("errorType");
      expect(json[0]).toHaveProperty("message");
      expect(json[0]).toHaveProperty("count");
    });
  });

  describe("Clear", () => {
    it("should clear all recorded errors", () => {
      aggregator.recordError(new Error("Error alpha"));
      aggregator.recordError(new Error("Error beta"));

      expect(aggregator.getErrorGroups().length).toBeGreaterThanOrEqual(1);

      aggregator.clear();

      expect(aggregator.getErrorGroups()).toHaveLength(0);
      expect(aggregator.getSummary().totalErrors).toBe(0);
    });
  });
});
