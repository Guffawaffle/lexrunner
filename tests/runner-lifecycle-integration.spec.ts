import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  purgeCache,
  acquireRunnerLock,
  releaseRunnerLock,
  initializeFileLogger,
  closeFileLogger,
} from "../src/cli/runnerLifecycle";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Runner Lifecycle Integration", () => {
  let testProfileDir: string;

  beforeEach(() => {
    // Create temporary profile directory for tests
    testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-lifecycle-test-"));

    // Create minimal profile structure with profile.yml
    fs.mkdirSync(path.join(testProfileDir, "runner"), { recursive: true });

    // Create profile.yml manifest
    fs.writeFileSync(path.join(testProfileDir, "profile.yml"), "role: test\nname: test-profile\n");
  });

  afterEach(async () => {
    // Cleanup
    releaseRunnerLock();
    await closeFileLogger();
    fs.rmSync(testProfileDir, { recursive: true, force: true });
  });

  describe("Cache Management", () => {
    it("should purge cache by default", () => {
      // Create some cache data
      const cacheDir = path.join(testProfileDir, "runner", ".cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "test.dat"), "data");

      // Capture console output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      purgeCache(testProfileDir, false);

      console.log = originalLog;

      // Verify cache was purged
      expect(fs.existsSync(cacheDir)).toBe(true);
      expect(fs.readdirSync(cacheDir)).toHaveLength(0);

      // Verify message was logged
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain("Purged cache");
    });

    it("should keep cache with --keep-cache flag", () => {
      // Create some cache data
      const cacheDir = path.join(testProfileDir, "runner", ".cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      const testFile = path.join(cacheDir, "test.dat");
      fs.writeFileSync(testFile, "preserved");

      // Capture console output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      purgeCache(testProfileDir, true);

      console.log = originalLog;

      // Verify cache was kept
      expect(fs.existsSync(testFile)).toBe(true);
      expect(fs.readFileSync(testFile, "utf-8")).toBe("preserved");

      // Verify message was logged
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain("Keeping existing cache");
    });
  });

  describe("Lock Management", () => {
    it("should acquire and release lock successfully", async () => {
      await acquireRunnerLock(testProfileDir);

      const lockFile = path.join(testProfileDir, "runner", "locks", "runner.lock");
      expect(fs.existsSync(lockFile)).toBe(true);

      releaseRunnerLock();

      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it("should prevent concurrent lock acquisition", async () => {
      await acquireRunnerLock(testProfileDir);

      // Try to acquire again
      await expect(acquireRunnerLock(testProfileDir)).rejects.toThrow("Another runner is active");

      releaseRunnerLock();
    });

    it("should handle lock cleanup on error", async () => {
      await acquireRunnerLock(testProfileDir);

      const lockFile = path.join(testProfileDir, "runner", "locks", "runner.lock");
      expect(fs.existsSync(lockFile)).toBe(true);

      // Simulate error and cleanup
      releaseRunnerLock();

      expect(fs.existsSync(lockFile)).toBe(false);
    });
  });

  describe("File Logger Integration", () => {
    it("should initialize and write to log file", async () => {
      const logger = initializeFileLogger(testProfileDir, { enabled: true });

      logger.info("Test message", {
        module: "integration/test",
        operation: "testOp",
      });

      await closeFileLogger();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      expect(fs.existsSync(logFile)).toBe(true);

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.message).toBe("Test message");
      expect(entry.module).toBe("integration/test");
      expect(entry.operation).toBe("testOp");
    });

    it("should support disabled logger", async () => {
      const logger = initializeFileLogger(testProfileDir, { enabled: false });

      logger.info("Should not be written");

      await closeFileLogger();

      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      expect(fs.existsSync(logFile)).toBe(false);
    });
  });

  describe("Full Lifecycle Integration", () => {
    it("should handle complete runner lifecycle", async () => {
      // Step 1: Purge cache
      const cacheDir = path.join(testProfileDir, "runner", ".cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "old.dat"), "old data");

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      purgeCache(testProfileDir, false);

      console.log = originalLog;

      expect(fs.readdirSync(cacheDir)).toHaveLength(0);

      // Step 2: Acquire lock
      await acquireRunnerLock(testProfileDir);

      const lockFile = path.join(testProfileDir, "runner", "locks", "runner.lock");
      expect(fs.existsSync(lockFile)).toBe(true);

      // Step 3: Initialize logger and log operations
      const logger = initializeFileLogger(testProfileDir, { enabled: true });

      logger.info("Runner started", { module: "lifecycle", operation: "start" });
      logger.info("Processing item", { module: "lifecycle", operation: "process" });
      logger.info("Runner completed", { module: "lifecycle", operation: "complete" });

      // Step 4: Cleanup
      await closeFileLogger();
      releaseRunnerLock();

      // Verify cleanup
      expect(fs.existsSync(lockFile)).toBe(false);

      // Verify logs were written
      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      expect(fs.existsSync(logFile)).toBe(true);

      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);

      const entries = lines.map((line) => JSON.parse(line));
      expect(entries[0].message).toBe("Runner started");
      expect(entries[1].message).toBe("Processing item");
      expect(entries[2].message).toBe("Runner completed");
    });

    it("should handle errors gracefully during lifecycle", async () => {
      // Acquire lock
      await acquireRunnerLock(testProfileDir);

      // Initialize logger
      const logger = initializeFileLogger(testProfileDir, { enabled: true });

      logger.info("Before error");

      // Simulate error
      let errorOccurred = false;
      try {
        throw new Error("Simulated failure");
      } catch (error) {
        errorOccurred = true;
        logger.error("Error occurred", { error: error as Error });
      } finally {
        // Cleanup should happen even on error
        await closeFileLogger();
        releaseRunnerLock();
      }

      expect(errorOccurred).toBe(true);

      // Verify cleanup happened
      const lockFile = path.join(testProfileDir, "runner", "locks", "runner.lock");
      expect(fs.existsSync(lockFile)).toBe(false);

      // Verify error was logged
      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      const errorEntry = JSON.parse(lines[1]);
      expect(errorEntry.level).toBe("error");
      expect(errorEntry.message).toBe("Error occurred");
      expect(errorEntry.error).toHaveProperty("message", "Simulated failure");
    });

    it("should support multiple sequential runs with cache purge", async () => {
      // Run 1
      purgeCache(testProfileDir, false);
      await acquireRunnerLock(testProfileDir);
      const logger1 = initializeFileLogger(testProfileDir, { enabled: true });
      logger1.info("Run 1");
      await closeFileLogger();
      releaseRunnerLock();

      // Create some cache between runs
      const cacheDir = path.join(testProfileDir, "runner", ".cache");
      fs.writeFileSync(path.join(cacheDir, "temp.dat"), "temp");

      // Run 2 - should purge cache from run 1
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      purgeCache(testProfileDir, false);

      console.log = originalLog;

      expect(fs.readdirSync(cacheDir)).toHaveLength(0);

      await acquireRunnerLock(testProfileDir);
      const logger2 = initializeFileLogger(testProfileDir, { enabled: true });
      logger2.info("Run 2");
      await closeFileLogger();
      releaseRunnerLock();

      // Verify both runs logged
      const logFile = path.join(testProfileDir, "runner", "logs", "runner.log.ndjson");
      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe("Run 1");
      expect(JSON.parse(lines[1]).message).toBe("Run 2");
    });
  });
});
