import { describe, it, expect, beforeEach } from "vitest";
import { AuditTrail } from "../src/monitoring/audit";

describe("Monitoring - Audit Trail", () => {
  let audit: AuditTrail;
  let consoleLogs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    audit = new AuditTrail();
    consoleLogs = [];
    originalLog = console.log;
    console.log = (msg: string) => consoleLogs.push(msg);
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe("Audit Logging", () => {
    it("should log audit entries", () => {
      audit.log("gate_execution", "passed", { gateType: "lint", prId: "PR-101" });

      const entries = audit.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toHaveProperty("operation", "gate_execution");
      expect(entries[0]).toHaveProperty("decision", "passed");
      expect(entries[0]).toHaveProperty("metadata");
      expect(entries[0].metadata).toEqual({ gateType: "lint", prId: "PR-101" });
    });

    it("should include timestamp", () => {
      audit.log("test_operation", "completed");

      const entries = audit.getEntries();
      expect(entries[0]).toHaveProperty("timestamp");
      expect(() => new Date(entries[0].timestamp)).not.toThrow();
    });

    it("should include correlation ID when provided", () => {
      audit.log("test_operation", "completed", {}, "corr-123");

      const entries = audit.getEntries();
      expect(entries[0]).toHaveProperty("correlationId", "corr-123");
    });

    it("should capture actor from environment", () => {
      const originalActor = process.env.GITHUB_ACTOR;
      process.env.GITHUB_ACTOR = "test-user";

      audit.log("test_operation", "completed");

      const entries = audit.getEntries();
      expect(entries[0]).toHaveProperty("actor", "test-user");

      process.env.GITHUB_ACTOR = originalActor;
    });

    it("should log to console for real-time visibility", () => {
      audit.log("test_operation", "completed", { key: "value" });

      expect(consoleLogs).toHaveLength(1);
      expect(consoleLogs[0]).toContain("[AUDIT]");
      expect(consoleLogs[0]).toContain("test_operation");
      expect(consoleLogs[0]).toContain("completed");
    });
  });

  describe("Entry Retrieval", () => {
    beforeEach(() => {
      audit.log("operation1", "decision1", {}, "corr-1");
      audit.log("operation2", "decision2", {}, "corr-1");
      audit.log("operation3", "decision3", {}, "corr-2");
      audit.log("operation1", "decision4", {}, "corr-2");
    });

    it("should get all entries", () => {
      const entries = audit.getEntries();
      expect(entries).toHaveLength(4);
    });

    it("should return copy to maintain immutability", () => {
      const entries1 = audit.getEntries();
      entries1.push({
        timestamp: new Date().toISOString(),
        operation: "fake",
        decision: "fake",
        metadata: {},
      });

      const entries2 = audit.getEntries();
      expect(entries2).toHaveLength(4); // Original count
    });

    it("should filter by correlation ID", () => {
      const entries = audit.getEntriesByCorrelationId("corr-1");
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.correlationId === "corr-1")).toBe(true);
    });

    it("should filter by operation", () => {
      const entries = audit.getEntriesByOperation("operation1");
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.operation === "operation1")).toBe(true);
    });
  });

  describe("Export", () => {
    it("should export as JSON array", () => {
      audit.log("op1", "decision1", { key1: "value1" });
      audit.log("op2", "decision2", { key2: "value2" });

      const json = audit.exportJSON();
      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(2);
      expect(json[0]).toHaveProperty("operation", "op1");
      expect(json[1]).toHaveProperty("operation", "op2");
    });

    it("should export as JSONL format", () => {
      audit.log("op1", "decision1");
      audit.log("op2", "decision2");

      const jsonl = audit.exportJSONL();
      const lines = jsonl.split("\n");

      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
      expect(() => JSON.parse(lines[1])).not.toThrow();

      const entry1 = JSON.parse(lines[0]);
      expect(entry1).toHaveProperty("operation", "op1");
    });
  });

  describe("Clear", () => {
    it("should clear all entries", () => {
      audit.log("op1", "decision1");
      audit.log("op2", "decision2");

      expect(audit.getEntries()).toHaveLength(2);

      audit.clear();

      expect(audit.getEntries()).toHaveLength(0);
    });
  });

  describe("Real-world Scenarios", () => {
    it("should track gate execution flow", () => {
      const correlationId = "exec-123";

      audit.log("gate_start", "initiated", { gateType: "lint", prId: "PR-101" }, correlationId);
      audit.log("gate_execution", "running", { gateType: "lint" }, correlationId);
      audit.log("gate_completion", "passed", { gateType: "lint", duration: 2.5 }, correlationId);

      const entries = audit.getEntriesByCorrelationId(correlationId);
      expect(entries).toHaveLength(3);
      expect(entries[0].decision).toBe("initiated");
      expect(entries[1].decision).toBe("running");
      expect(entries[2].decision).toBe("passed");
    });

    it("should track merge decisions", () => {
      audit.log("merge_eligibility", "evaluated", {
        prId: "PR-101",
        eligible: true,
        reason: "all gates passed",
      });
      audit.log("merge_execution", "approved", { prId: "PR-101" });
      audit.log("merge_completion", "success", {
        prId: "PR-101",
        commit: "abc123",
      });

      const mergeEntries = audit.getEntriesByOperation("merge_eligibility");
      expect(mergeEntries).toHaveLength(1);
      expect(mergeEntries[0].metadata.eligible).toBe(true);
    });
  });
});
