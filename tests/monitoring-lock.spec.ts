import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRunnerLock, RunnerLock, LockError } from "../src/monitoring/lock";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("RunnerLock", () => {
  let testProfileDir: string;
  let lock: RunnerLock;

  beforeEach(() => {
    // Create temporary profile directory for tests
    testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-lock-test-"));
    lock = createRunnerLock(testProfileDir);
  });

  afterEach(() => {
    // Release lock and cleanup
    lock.release();
    fs.rmSync(testProfileDir, { recursive: true, force: true });
  });

  describe("Lock Acquisition", () => {
    it("should create locks directory automatically", async () => {
      await lock.acquire();

      const locksDir = path.join(testProfileDir, "runner", "locks");
      expect(fs.existsSync(locksDir)).toBe(true);
    });

    it("should create lock file with valid JSON", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      expect(fs.existsSync(lockFile)).toBe(true);

      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      expect(lockInfo).toHaveProperty("pid");
      expect(lockInfo).toHaveProperty("commit");
      expect(lockInfo).toHaveProperty("started");
      expect(lockInfo).toHaveProperty("command");
      expect(lockInfo).toHaveProperty("profile");
    });

    it("should include current PID in lock", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      expect(lockInfo.pid).toBe(process.pid);
    });

    it("should include ISO 8601 timestamp", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      // Verify ISO 8601 format
      expect(lockInfo.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Should be a valid date
      expect(new Date(lockInfo.started).toString()).not.toBe("Invalid Date");
    });

    it("should include command line arguments", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      // Command should include node and test runner
      expect(lockInfo.command).toContain("node");
      expect(typeof lockInfo.command).toBe("string");
    });

    it("should include profile directory path", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      expect(lockInfo.profile).toBe(testProfileDir);
    });

    it("should set acquired state", async () => {
      expect(lock.isAcquired()).toBe(false);

      await lock.acquire();

      expect(lock.isAcquired()).toBe(true);
    });
  });

  describe("Lock Release", () => {
    it("should remove lock file on release", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      expect(fs.existsSync(lockFile)).toBe(true);

      lock.release();

      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it("should clear acquired state on release", async () => {
      await lock.acquire();
      expect(lock.isAcquired()).toBe(true);

      lock.release();

      expect(lock.isAcquired()).toBe(false);
    });

    it("should be safe to call release multiple times", async () => {
      await lock.acquire();

      lock.release();
      lock.release();
      lock.release();

      // Should not throw
      expect(lock.isAcquired()).toBe(false);
    });

    it("should be safe to call release without acquire", () => {
      lock.release();

      // Should not throw
      expect(lock.isAcquired()).toBe(false);
    });
  });

  describe("Concurrent Lock Attempts", () => {
    it("should block concurrent lock attempts", async () => {
      await lock.acquire();

      // Try to acquire with different lock instance
      const lock2 = createRunnerLock(testProfileDir);

      await expect(lock2.acquire()).rejects.toThrow(LockError);
      await expect(lock2.acquire()).rejects.toThrow("Another runner is active");
    });

    it("should include helpful error message on conflict", async () => {
      await lock.acquire();

      const lock2 = createRunnerLock(testProfileDir);

      try {
        await lock2.acquire();
        expect.fail("Should have thrown LockError");
      } catch (error) {
        expect(error).toBeInstanceOf(LockError);
        expect((error as Error).message).toContain(`PID ${process.pid}`);
        expect((error as Error).message).toContain("Started:");
        expect((error as Error).message).toContain("Command:");
        expect((error as Error).message).toContain("If stale, remove:");
      }
    });

    it("should allow re-acquisition after release", async () => {
      await lock.acquire();
      lock.release();

      // Should succeed
      await lock.acquire();
      expect(lock.isAcquired()).toBe(true);
    });
  });

  describe("Stale Lock Detection", () => {
    it("should remove stale lock with invalid PID", async () => {
      // Create a fake stale lock with a PID that doesn't exist
      const lockFile = lock.getLockFile();
      const locksDir = path.dirname(lockFile);
      fs.mkdirSync(locksDir, { recursive: true });

      const staleLock = {
        pid: 999999, // Very unlikely to exist
        commit: "abc123",
        started: new Date().toISOString(),
        command: "stale command",
        profile: testProfileDir,
      };

      fs.writeFileSync(lockFile, JSON.stringify(staleLock));

      // Should successfully acquire by removing stale lock
      await lock.acquire();

      expect(lock.isAcquired()).toBe(true);

      // Verify new lock has current PID
      const content = fs.readFileSync(lockFile, "utf-8");
      const newLock = JSON.parse(content);
      expect(newLock.pid).toBe(process.pid);
    });

    it("should handle corrupted lock file", async () => {
      // Create corrupted lock file
      const lockFile = lock.getLockFile();
      const locksDir = path.dirname(lockFile);
      fs.mkdirSync(locksDir, { recursive: true });
      fs.writeFileSync(lockFile, "invalid json {{{");

      // Should successfully acquire by removing corrupted lock
      await lock.acquire();

      expect(lock.isAcquired()).toBe(true);
    });
  });

  describe("Lock File Path", () => {
    it("should use correct lock file path", () => {
      const expectedPath = path.join(testProfileDir, "runner", "locks", "runner.lock");
      expect(lock.getLockFile()).toBe(expectedPath);
    });
  });

  describe("Git Commit Integration", () => {
    it("should include commit SHA in lock info", async () => {
      await lock.acquire();

      const lockFile = lock.getLockFile();
      const content = fs.readFileSync(lockFile, "utf-8");
      const lockInfo = JSON.parse(content);

      // Should have commit field (may be 'unknown' if not in git repo)
      expect(lockInfo).toHaveProperty("commit");
      expect(typeof lockInfo.commit).toBe("string");
      expect(lockInfo.commit.length).toBeGreaterThan(0);
    });
  });

  describe("Real-world Scenarios", () => {
    it("should support typical acquire-use-release lifecycle", async () => {
      // Acquire
      await lock.acquire();
      expect(lock.isAcquired()).toBe(true);

      // Do work
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Release
      lock.release();
      expect(lock.isAcquired()).toBe(false);
    });

    it("should handle error during work with proper cleanup", async () => {
      await lock.acquire();

      let errorThrown = false;
      try {
        // Simulate error during work
        throw new Error("Simulated error");
      } catch (error) {
        errorThrown = true;
      } finally {
        // Cleanup should always happen
        lock.release();
      }

      expect(errorThrown).toBe(true);
      expect(lock.isAcquired()).toBe(false);
      expect(fs.existsSync(lock.getLockFile())).toBe(false);
    });

    it("should support multiple sequential lock cycles", async () => {
      // First cycle
      await lock.acquire();
      lock.release();

      // Second cycle
      await lock.acquire();
      lock.release();

      // Third cycle
      await lock.acquire();
      lock.release();

      expect(lock.isAcquired()).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing locks directory gracefully", async () => {
      // Remove locks directory if it exists
      const locksDir = path.join(testProfileDir, "runner", "locks");
      if (fs.existsSync(locksDir)) {
        fs.rmSync(locksDir, { recursive: true });
      }

      // Should create directory and acquire lock
      await lock.acquire();
      expect(lock.isAcquired()).toBe(true);
      expect(fs.existsSync(locksDir)).toBe(true);
    });
  });
});
