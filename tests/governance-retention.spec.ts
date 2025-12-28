/**
 * Governance log retention tests (QOL-002)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  cleanupOldLogs,
  enforceRetentionPolicy,
  getGovernanceLogsDir,
} from "../src/lexsona/logger.js";

describe("Governance Log Retention (QOL-002)", () => {
  const testDir = join(process.cwd(), ".test-governance-logs");

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Override env to use test directory
    process.env.LEX_PR_PROFILE_DIR = ".test-governance-logs";
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.LEX_PR_PROFILE_DIR;
  });

  describe("cleanupOldLogs", () => {
    it("deletes logs older than maxAgeDays", async () => {
      const logsDir = join(testDir, "runner", "governance-logs");
      mkdirSync(logsDir, { recursive: true });

      // Create old log (91 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 91);
      const oldFile = join(logsDir, "old-log.json");
      writeFileSync(oldFile, JSON.stringify({ id: "old" }));
      // Manually set mtime to old date
      const fs = await import("fs");
      fs.utimesSync(oldFile, oldDate, oldDate);

      // Create recent log
      const recentFile = join(logsDir, "recent-log.json");
      writeFileSync(recentFile, JSON.stringify({ id: "recent" }));

      // Cleanup logs older than 30 days
      const deleted = await cleanupOldLogs(30);

      expect(deleted).toBe(1);
      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(recentFile)).toBe(true);
    });

    it("returns 0 if no logs to delete", async () => {
      const logsDir = join(testDir, "runner", "governance-logs");
      mkdirSync(logsDir, { recursive: true });

      // Create only recent log
      const recentFile = join(logsDir, "recent-log.json");
      writeFileSync(recentFile, JSON.stringify({ id: "recent" }));

      const deleted = await cleanupOldLogs(30);

      expect(deleted).toBe(0);
      expect(existsSync(recentFile)).toBe(true);
    });

    it("returns 0 if logs directory does not exist", async () => {
      const deleted = await cleanupOldLogs(30);
      expect(deleted).toBe(0);
    });
  });

  describe("enforceRetentionPolicy", () => {
    it("deletes oldest logs when size limit exceeded", async () => {
      const logsDir = join(testDir, "runner", "governance-logs");
      mkdirSync(logsDir, { recursive: true });

      // Create logs with known sizes (each ~1KB)
      const createLog = (name: string, ageOffset: number) => {
        const date = new Date();
        date.setDate(date.getDate() - ageOffset);
        const file = join(logsDir, `${name}.json`);
        // Create 1KB content
        const data = JSON.stringify({
          id: name,
          padding: "x".repeat(900),
        });
        writeFileSync(file, data);
        const fs = require("fs");
        fs.utimesSync(file, date, date);
      };

      createLog("log1", 30); // oldest
      createLog("log2", 20);
      createLog("log3", 10);
      createLog("log4", 5); // newest

      // Set limit to ~2KB (should keep newest 2, delete oldest 2)
      const deleted = await enforceRetentionPolicy(0.002);

      // Should have deleted oldest logs
      expect(deleted).toBeGreaterThanOrEqual(2);

      const remaining = readdirSync(logsDir).filter((f) => f.endsWith(".json"));
      expect(remaining.length).toBeLessThanOrEqual(2);
    });

    it("does not delete logs if under size limit", async () => {
      const logsDir = join(testDir, "runner", "governance-logs");
      mkdirSync(logsDir, { recursive: true });

      // Create small log
      const file = join(logsDir, "small-log.json");
      writeFileSync(file, JSON.stringify({ id: "small" }));

      // Set high limit (100MB)
      const deleted = await enforceRetentionPolicy(100);

      expect(deleted).toBe(0);
      expect(existsSync(file)).toBe(true);
    });

    it("returns 0 if logs directory does not exist", async () => {
      const deleted = await enforceRetentionPolicy(100);
      expect(deleted).toBe(0);
    });
  });

  describe("getGovernanceLogsDir", () => {
    it("returns correct path with LEX_PR_PROFILE_DIR", () => {
      process.env.LEX_PR_PROFILE_DIR = ".test-custom";
      const dir = getGovernanceLogsDir();
      expect(dir).toContain(".test-custom/runner/governance-logs");
    });

    it("defaults to .smartergpt when no env var", () => {
      delete process.env.LEX_PR_PROFILE_DIR;
      const dir = getGovernanceLogsDir();
      expect(dir).toContain(".smartergpt/runner/governance-logs");
    });
  });
});
