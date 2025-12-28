import { describe, it, expect, beforeEach } from "vitest";
import { createLogger, generateCorrelationId, Logger } from "../src/monitoring/logger";

describe("Monitoring - Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger({ format: "json" });
  });

  describe("Structured Logging", () => {
    it("should log messages in JSON format", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      logger.info("test_event", { key: "value" });

      console.log = originalLog;

      expect(logs).toHaveLength(1);
      const logEntry = JSON.parse(logs[0]);
      expect(logEntry).toHaveProperty("timestamp");
      expect(logEntry).toHaveProperty("level", "info");
      expect(logEntry).toHaveProperty("event", "test_event");
      expect(logEntry).toHaveProperty("key", "value");
    });

    it("should include correlation ID when set", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      const correlationId = "test-123";
      logger.setCorrelationId(correlationId);
      logger.info("test_event");

      console.log = originalLog;

      const logEntry = JSON.parse(logs[0]);
      expect(logEntry).toHaveProperty("correlationId", correlationId);
    });

    it("should respect log levels", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      const warnLogger = createLogger({ format: "json", minLevel: "warn" });
      warnLogger.debug("debug_event");
      warnLogger.info("info_event");
      warnLogger.warn("warn_event");
      warnLogger.error("error_event");

      console.log = originalLog;

      expect(logs).toHaveLength(2); // Only warn and error
      expect(JSON.parse(logs[0])).toHaveProperty("level", "warn");
      expect(JSON.parse(logs[1])).toHaveProperty("level", "error");
    });

    it("should generate unique correlation IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it("should clear correlation ID", () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      logger.setCorrelationId("test-123");
      logger.info("event1");
      logger.clearCorrelationId();
      logger.info("event2");

      console.log = originalLog;

      const log1 = JSON.parse(logs[0]);
      const log2 = JSON.parse(logs[1]);

      expect(log1).toHaveProperty("correlationId", "test-123");
      expect(log2).not.toHaveProperty("correlationId");
    });
  });

  describe("Environment Detection", () => {
    it("should detect JSON format from environment", () => {
      const originalEnv = process.env.LOG_FORMAT;
      process.env.LOG_FORMAT = "json";

      const autoLogger = createLogger();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      autoLogger.info("test_event");

      console.log = originalLog;
      process.env.LOG_FORMAT = originalEnv;

      expect(() => JSON.parse(logs[0])).not.toThrow();
    });

    it("should detect JSON format in CI environment", () => {
      const originalCI = process.env.CI;
      process.env.CI = "true";

      const autoLogger = createLogger();
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      autoLogger.info("test_event");

      console.log = originalLog;
      process.env.CI = originalCI;

      expect(() => JSON.parse(logs[0])).not.toThrow();
    });
  });

  describe("Human-Readable Format", () => {
    it("should format logs for human consumption", () => {
      const humanLogger = createLogger({ format: "human" });
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      humanLogger.info("test_event", { prId: "PR-101" });

      console.log = originalLog;

      expect(logs[0]).toContain("test_event");
      expect(logs[0]).toContain("prId");
      expect(logs[0]).toContain("PR-101");
    });

    it("should route error logs to console.error", () => {
      const humanLogger = createLogger({ format: "human" });
      const logs: string[] = [];
      const originalError = console.error;
      console.error = (msg: string) => logs.push(msg);

      humanLogger.error("error_event");

      console.error = originalError;

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain("error_event");
    });
  });
});
