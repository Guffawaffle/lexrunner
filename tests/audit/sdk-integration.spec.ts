/**
 * Tests for audit SDK (Phase 3A)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseAuditEventLine,
  readAuditNDJSON,
  readAuditNDJSONSync,
  parseAuditNDJSONString,
  validateAuditManifest,
  validateAuditManifestSafe,
  isSchemaCompatible,
  filterEvents,
  computeStatistics,
  EventQuery,
  type AuditEvent,
} from "../../src/sdk/index.js";
import type { GateFinishedEvent } from "../../src/audit/schema/events.js";

describe("Audit SDK (Phase 3A)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sdk-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("parseAuditEventLine", () => {
    const validLine = JSON.stringify({
      schema_version: "1.0.0",
      event: "gate_finished",
      ts: "2024-11-02T12:00:00.000Z",
      level: "info",
      session_id: "session-123",
      run_id: "run-456",
      tool: { name: "lexrunner", version: "0.1.0" },
      actor: { type: "cli" },
      repo: {},
      payload: { item: 123, gate: "lint", duration_ms: 1000, status: "pass" },
    });

    it("should parse valid NDJSON line", () => {
      const event = parseAuditEventLine(validLine);
      expect(event.event).toBe("gate_finished");
      expect((event as GateFinishedEvent).payload.status).toBe("pass");
    });

    it("should throw on empty line", () => {
      expect(() => parseAuditEventLine("")).toThrow("Empty line");
    });

    it("should throw on whitespace-only line", () => {
      expect(() => parseAuditEventLine("   \n  ")).toThrow("Empty line");
    });

    it("should throw on invalid JSON", () => {
      expect(() => parseAuditEventLine("not json")).toThrow("Invalid JSON");
    });

    it("should throw on invalid event structure", () => {
      const invalid = JSON.stringify({ invalid: "event" });
      expect(() => parseAuditEventLine(invalid)).toThrow();
    });
  });

  describe("readAuditNDJSON", () => {
    it("should read all events from file", async () => {
      const events = [
        {
          schema_version: "1.0.0",
          event: "gate_started",
          ts: "2024-11-02T12:00:00.000Z",
          level: "info",
          session_id: "session-123",
          run_id: "run-456",
          tool: { name: "lexrunner", version: "0.1.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 123, gate: "lint" },
        },
        {
          schema_version: "1.0.0",
          event: "gate_finished",
          ts: "2024-11-02T12:00:01.000Z",
          level: "info",
          session_id: "session-123",
          run_id: "run-456",
          tool: { name: "lexrunner", version: "0.1.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 123, gate: "lint", duration_ms: 1000, status: "pass" },
        },
      ];

      const filePath = path.join(tmpDir, "audit.ndjson");
      fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join("\n"));

      const readEvents: AuditEvent[] = [];
      for await (const event of readAuditNDJSON(filePath)) {
        readEvents.push(event);
      }

      expect(readEvents).toHaveLength(2);
      expect(readEvents[0].event).toBe("gate_started");
      expect(readEvents[1].event).toBe("gate_finished");
    });

    it("should skip empty lines", async () => {
      const content = [
        JSON.stringify({
          schema_version: "1.0.0",
          event: "gate_started",
          ts: "2024-11-02T12:00:00.000Z",
          level: "info",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 1, gate: "g" },
        }),
        "",
        JSON.stringify({
          schema_version: "1.0.0",
          event: "gate_finished",
          ts: "2024-11-02T12:00:01.000Z",
          level: "info",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 1, gate: "g", duration_ms: 100, status: "pass" },
        }),
        "   ",
        "",
      ].join("\n");

      const filePath = path.join(tmpDir, "audit.ndjson");
      fs.writeFileSync(filePath, content);

      const readEvents: AuditEvent[] = [];
      for await (const event of readAuditNDJSON(filePath)) {
        readEvents.push(event);
      }

      expect(readEvents).toHaveLength(2);
    });
  });

  describe("readAuditNDJSONSync", () => {
    it("should read all events into array", async () => {
      const events = [
        {
          schema_version: "1.0.0",
          event: "command_invocation",
          ts: "2024-11-02T12:00:00.000Z",
          level: "info",
          session_id: "session-123",
          run_id: "run-456",
          tool: { name: "lexrunner", version: "0.1.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { argv: ["lex-pr", "run"], cwd: "/home/user" },
        },
      ];

      const filePath = path.join(tmpDir, "audit.ndjson");
      fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join("\n"));

      const readEvents = await readAuditNDJSONSync(filePath);
      expect(readEvents).toHaveLength(1);
      expect(readEvents[0].event).toBe("command_invocation");
    });
  });

  describe("parseAuditNDJSONString", () => {
    it("should parse NDJSON string", () => {
      const content = [
        JSON.stringify({
          schema_version: "1.0.0",
          event: "gate_started",
          ts: "2024-11-02T12:00:00.000Z",
          level: "info",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 1, gate: "g" },
        }),
        JSON.stringify({
          schema_version: "1.0.0",
          event: "gate_finished",
          ts: "2024-11-02T12:00:01.000Z",
          level: "info",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { item: 1, gate: "g", duration_ms: 100, status: "pass" },
        }),
      ].join("\n");

      const events = parseAuditNDJSONString(content);
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("gate_started");
      expect(events[1].event).toBe("gate_finished");
    });

    it("should skip empty lines in string", () => {
      const content = [
        JSON.stringify({
          schema_version: "1.0.0",
          event: "error",
          ts: "2024-11-02T12:00:00.000Z",
          level: "error",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: { code: "E001", message: "test" },
        }),
        "",
        JSON.stringify({
          schema_version: "1.0.0",
          event: "run_summary",
          ts: "2024-11-02T12:00:01.000Z",
          level: "info",
          session_id: "s",
          run_id: "r",
          tool: { name: "test", version: "1.0.0" },
          actor: { type: "cli" },
          repo: {},
          payload: {
            totals: { items: 1, gates: 1, passed: 1, failed: 0 },
            pass_fail_matrix: {},
            final_status: "success",
          },
        }),
      ].join("\n");

      const events = parseAuditNDJSONString(content);
      expect(events).toHaveLength(2);
    });
  });

  describe("validateAuditManifest", () => {
    const validManifest = {
      schemaVersion: "1.0.0",
      timestamp: "2024-11-02T12:00:00.000Z",
      files: [
        {
          file: "audit.ndjson",
          sha256: "a".repeat(64),
          bytes: 1024,
        },
      ],
      totalBytes: 1024,
    };

    it("should validate correct manifest", () => {
      expect(() => validateAuditManifest(validManifest)).not.toThrow();
    });

    it("should return typed manifest", () => {
      const manifest = validateAuditManifest(validManifest);
      expect(manifest.schemaVersion).toBe("1.0.0");
      expect(manifest.files).toHaveLength(1);
    });

    it("should throw on invalid manifest", () => {
      const invalid = { ...validManifest };
      delete (invalid as any).schemaVersion;
      expect(() => validateAuditManifest(invalid)).toThrow();
    });

    it("should validate sha256 format", () => {
      const invalid = {
        ...validManifest,
        files: [{ file: "test.ndjson", sha256: "invalid", bytes: 100 }],
      };
      expect(() => validateAuditManifest(invalid)).toThrow();
    });

    it("should reject negative bytes", () => {
      const invalid = {
        ...validManifest,
        files: [{ file: "test.ndjson", sha256: "a".repeat(64), bytes: -1 }],
      };
      expect(() => validateAuditManifest(invalid)).toThrow();
    });
  });

  describe("validateAuditManifestSafe", () => {
    it("should return success for valid manifest", () => {
      const manifest = {
        schemaVersion: "1.0.0",
        timestamp: "2024-11-02T12:00:00.000Z",
        files: [],
        totalBytes: 0,
      };
      const result = validateAuditManifestSafe(manifest);
      expect(result.success).toBe(true);
    });

    it("should return error for invalid manifest", () => {
      const result = validateAuditManifestSafe({ invalid: "manifest" });
      expect(result.success).toBe(false);
    });
  });

  describe("isSchemaCompatible", () => {
    it("should accept compatible versions", () => {
      expect(isSchemaCompatible("1.0.0", 1)).toBe(true);
      expect(isSchemaCompatible("1.2.3", 1)).toBe(true);
      expect(isSchemaCompatible("1.99.99", 1)).toBe(true);
    });

    it("should reject incompatible major versions", () => {
      expect(isSchemaCompatible("2.0.0", 1)).toBe(false);
      expect(isSchemaCompatible("0.9.9", 1)).toBe(false);
      expect(isSchemaCompatible("3.0.0", 1)).toBe(false);
    });

    it("should reject invalid version formats", () => {
      expect(isSchemaCompatible("invalid", 1)).toBe(false);
      expect(isSchemaCompatible("1.0", 1)).toBe(false);
      expect(isSchemaCompatible("v1.0.0", 1)).toBe(false);
    });

    it("should default to major version 1", () => {
      expect(isSchemaCompatible("1.0.0")).toBe(true);
      expect(isSchemaCompatible("2.0.0")).toBe(false);
    });
  });

  describe("filterEvents", () => {
    const events: AuditEvent[] = [
      {
        schema_version: "1.0.0",
        event: "gate_started",
        ts: "2024-11-02T12:00:00.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, gate: "lint" },
      },
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:01.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, gate: "lint", duration_ms: 1000, status: "pass" },
      },
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:02.000Z",
        level: "warn",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 456, gate: "test", duration_ms: 2000, status: "fail" },
      },
    ];

    it("should filter by event type", () => {
      const filtered = filterEvents(events, { eventType: "gate_finished" });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.event === "gate_finished")).toBe(true);
    });

    it("should filter by multiple event types", () => {
      const filtered = filterEvents(events, {
        eventType: ["gate_started", "gate_finished"],
      });
      expect(filtered).toHaveLength(3);
    });

    it("should filter by level", () => {
      const filtered = filterEvents(events, { level: "warn" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].level).toBe("warn");
    });

    it("should filter by gate status", () => {
      const filtered = filterEvents(events, { gateStatus: "fail" });
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as GateFinishedEvent).payload.status).toBe("fail");
    });

    it("should filter by gate name", () => {
      const filtered = filterEvents(events, { gate: "lint" });
      expect(filtered).toHaveLength(2);
    });

    it("should filter by item", () => {
      const filtered = filterEvents(events, { item: 123 });
      expect(filtered).toHaveLength(2);
    });

    it("should combine multiple filters", () => {
      const filtered = filterEvents(events, {
        eventType: "gate_finished",
        gateStatus: "pass",
      });
      expect(filtered).toHaveLength(1);
      expect((filtered[0] as GateFinishedEvent).payload.gate).toBe("lint");
    });
  });

  describe("EventQuery", () => {
    const events: AuditEvent[] = [
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:00.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, gate: "lint", duration_ms: 1000, status: "pass" },
      },
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:01.000Z",
        level: "error",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 456, gate: "test", duration_ms: 2000, status: "fail" },
      },
    ];

    it("should build query with fluent API", () => {
      const results = new EventQuery(events)
        .byEventType("gate_finished")
        .byGateStatus("fail")
        .execute();

      expect(results).toHaveLength(1);
      expect((results[0] as GateFinishedEvent).payload.gate).toBe("test");
    });

    it("should count matching events", () => {
      const count = new EventQuery(events).byEventType("gate_finished").count();

      expect(count).toBe(2);
    });

    it("should get first matching event", () => {
      const first = new EventQuery(events).byGateStatus("pass").first();

      expect(first).toBeDefined();
      expect((first as GateFinishedEvent).payload.gate).toBe("lint");
    });

    it("should check if events exist", () => {
      const exists = new EventQuery(events).byGateStatus("fail").exists();

      expect(exists).toBe(true);
    });

    it("should support chaining multiple filters", () => {
      const results = new EventQuery(events)
        .byEventType("gate_finished")
        .byLevel("error")
        .byGate("test")
        .execute();

      expect(results).toHaveLength(1);
    });
  });

  describe("computeStatistics", () => {
    const events: AuditEvent[] = [
      {
        schema_version: "1.0.0",
        event: "gate_started",
        ts: "2024-11-02T12:00:00.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, gate: "lint" },
      },
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:01.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, gate: "lint", duration_ms: 1000, status: "pass" },
      },
      {
        schema_version: "1.0.0",
        event: "gate_finished",
        ts: "2024-11-02T12:00:02.000Z",
        level: "warn",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 456, gate: "test", duration_ms: 2000, status: "fail" },
      },
      {
        schema_version: "1.0.0",
        event: "merge_finished",
        ts: "2024-11-02T12:00:03.000Z",
        level: "info",
        session_id: "session-123",
        run_id: "run-456",
        tool: { name: "lexrunner", version: "0.1.0" },
        actor: { type: "cli" },
        repo: {},
        payload: { item: 123, status: "success", commit: "abc123" },
      },
    ];

    it("should compute total event count", () => {
      const stats = computeStatistics(events);
      expect(stats.totalEvents).toBe(4);
    });

    it("should count events by type", () => {
      const stats = computeStatistics(events);
      expect(stats.eventTypes["gate_started"]).toBe(1);
      expect(stats.eventTypes["gate_finished"]).toBe(2);
      expect(stats.eventTypes["merge_finished"]).toBe(1);
    });

    it("should count events by level", () => {
      const stats = computeStatistics(events);
      expect(stats.levels.info).toBe(3);
      expect(stats.levels.warn).toBe(1);
      expect(stats.levels.error).toBe(0);
    });

    it("should compute gate statistics", () => {
      const stats = computeStatistics(events);
      expect(stats.gateStats.total).toBe(2);
      expect(stats.gateStats.passed).toBe(1);
      expect(stats.gateStats.failed).toBe(1);
    });

    it("should compute merge statistics", () => {
      const stats = computeStatistics(events);
      expect(stats.mergeStats.total).toBe(1);
      expect(stats.mergeStats.success).toBe(1);
    });

    it("should compute time range", () => {
      const stats = computeStatistics(events);
      expect(stats.timeRange.start).toBe("2024-11-02T12:00:00.000Z");
      expect(stats.timeRange.end).toBe("2024-11-02T12:00:03.000Z");
    });

    it("should handle empty event array", () => {
      const stats = computeStatistics([]);
      expect(stats.totalEvents).toBe(0);
      expect(stats.gateStats.total).toBe(0);
    });
  });
});
