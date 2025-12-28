import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFileLogger, FileLogger } from "../src/monitoring/fileLogger";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("FileLogger", () => {
  let testProfileDir: string;
  let logger: FileLogger;

  beforeEach(() => {
    // Create temporary profile directory for tests
    testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-filelogger-test-"));
    logger = createFileLogger({ profileDir: testProfileDir });
  });

  afterEach(async () => {
    // Close logger and cleanup
    await logger.close();
    fs.rmSync(testProfileDir, { recursive: true, force: true });
  });

  describe("Directory Creation", () => {
    it("should create logs directory automatically", async () => {
      const logsDir = path.join(testProfileDir, "runner", "logs");
      expect(fs.existsSync(logsDir)).toBe(true);
    });

    it("should create runner.log.ndjson file on first write", async () => {
      logger.info("test message");
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      expect(fs.existsSync(logFile)).toBe(true);
    });
  });

  describe("NDJSON Format", () => {
    it("should write valid NDJSON entries", async () => {
      logger.info("test message 1");
      logger.info("test message 2");
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);

      expect(entry1.message).toBe("test message 1");
      expect(entry2.message).toBe("test message 2");
    });

    it("should include all required fields", async () => {
      logger.info("test", {
        module: "test/module",
        operation: "testOperation",
        duration_ms: 123,
        metadata: { key: "value" },
      });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("level", "info");
      expect(entry).toHaveProperty("message", "test");
      expect(entry).toHaveProperty("module", "test/module");
      expect(entry).toHaveProperty("operation", "testOperation");
      expect(entry).toHaveProperty("duration_ms", 123);
      expect(entry).toHaveProperty("metadata");
      expect(entry.metadata).toEqual({ key: "value" });
    });

    it("should format timestamp as ISO 8601", async () => {
      logger.info("test");
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Should be a valid date
      expect(new Date(entry.timestamp).toString()).not.toBe("Invalid Date");
    });
  });

  describe("Log Levels", () => {
    it("should support all log levels", async () => {
      logger.trace("trace message");
      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");
      logger.fatal("fatal message");
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      // trace and debug should be filtered out by default (minLevel: info)
      expect(lines).toHaveLength(4);

      const levels = lines.map((line) => JSON.parse(line).level);
      expect(levels).toEqual(["info", "warn", "error", "fatal"]);
    });

    it("should respect minLevel setting", async () => {
      const warnLogger = createFileLogger({
        profileDir: testProfileDir,
        minLevel: "warn",
      });

      warnLogger.trace("trace");
      warnLogger.debug("debug");
      warnLogger.info("info");
      warnLogger.warn("warn");
      warnLogger.error("error");
      warnLogger.fatal("fatal");
      await warnLogger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(3);

      const levels = lines.map((line) => JSON.parse(line).level);
      expect(levels).toEqual(["warn", "error", "fatal"]);
    });

    it("should log all levels with trace minLevel", async () => {
      const traceLogger = createFileLogger({
        profileDir: testProfileDir,
        minLevel: "trace",
      });

      traceLogger.trace("trace");
      traceLogger.debug("debug");
      traceLogger.info("info");
      await traceLogger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(3);

      const levels = lines.map((line) => JSON.parse(line).level);
      expect(levels).toEqual(["trace", "debug", "info"]);
    });
  });

  describe("Error Handling", () => {
    it("should serialize Error objects", async () => {
      const testError = new Error("Test error");
      testError.stack = "Error: Test error\n  at Test (test.ts:1:1)";

      logger.error("Error occurred", { error: testError });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.error).toEqual({
        message: "Test error",
        stack: "Error: Test error\n  at Test (test.ts:1:1)",
        code: undefined,
      });
    });

    it("should handle error strings", async () => {
      logger.error("Error occurred", { error: "Simple error string" });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.error).toBe("Simple error string");
    });

    it("should handle errors with custom properties", async () => {
      const customError: any = new Error("Custom error");
      customError.code = "ENOENT";

      logger.error("File not found", { error: customError });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.error.code).toBe("ENOENT");
    });
  });

  describe("Metadata", () => {
    it("should include arbitrary metadata", async () => {
      logger.info("Operation complete", {
        metadata: {
          userId: "user123",
          requestId: "req456",
          nested: {
            value: 42,
          },
        },
      });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.metadata).toEqual({
        userId: "user123",
        requestId: "req456",
        nested: {
          value: 42,
        },
      });
    });
  });

  describe("Append Mode", () => {
    it("should append to existing log file", async () => {
      logger.info("first message");
      await logger.close();

      // Create new logger with same profile dir
      const logger2 = createFileLogger({ profileDir: testProfileDir });
      logger2.info("second message");
      await logger2.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe("first message");
      expect(JSON.parse(lines[1]).message).toBe("second message");
    });
  });

  describe("Disabled Logger", () => {
    it("should not write when disabled", async () => {
      const disabledLogger = createFileLogger({
        profileDir: testProfileDir,
        enabled: false,
      });

      disabledLogger.info("test message");
      await disabledLogger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      expect(fs.existsSync(logFile)).toBe(false);
    });
  });

  describe("Example Log Entries", () => {
    it("should match gate execution example format", async () => {
      const startTime = Date.now();

      // Simulate gate execution
      logger.info("Gate completed", {
        module: "gates/executor",
        operation: "executeGate",
        duration_ms: 2341,
        metadata: {
          gate: "typecheck",
          result: "pass",
        },
      });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe("info");
      expect(entry.module).toBe("gates/executor");
      expect(entry.operation).toBe("executeGate");
      expect(entry.duration_ms).toBe(2341);
      expect(entry.metadata.gate).toBe("typecheck");
      expect(entry.metadata.result).toBe("pass");
    });

    it("should match config loader warning example format", async () => {
      logger.warn("Using legacy flat structure", {
        module: "config/loader",
        operation: "loadScope",
        metadata: {
          path_source: "flat (legacy)",
        },
      });
      await logger.close();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe("warn");
      expect(entry.module).toBe("config/loader");
      expect(entry.operation).toBe("loadScope");
      expect(entry.message).toBe("Using legacy flat structure");
      expect(entry.metadata.path_source).toBe("flat (legacy)");
    });
  });
});
