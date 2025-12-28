/**
 * Tests for plan history and versioning
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  savePlanVersion,
  loadPlanHistory,
  getPlanVersion,
  getCurrentPlan,
  listPlanVersions,
  restorePlanVersion,
  savePlanToFile,
  loadPlanFromFile,
  getPlanHistoryPath,
} from "../src/interactive/planHistory.js";
import { Plan } from "../src/schema.js";

describe("Plan History and Versioning", () => {
  const testDir = "/tmp/lex-pr-plan-history-test";
  const historyPath = path.join(testDir, "test.history.json");

  const samplePlan: Plan = {
    schemaVersion: "1.0.0",
    target: "main",
    items: [{ name: "item-a", deps: [], gates: [] }],
  };

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("savePlanVersion", () => {
    it("should save first plan version", () => {
      const version = savePlanVersion(historyPath, samplePlan);

      expect(version.version).toBe(1);
      expect(version.plan).toEqual(samplePlan);
      expect(version.timestamp).toBeDefined();
      expect(fs.existsSync(historyPath)).toBe(true);
    });

    it("should save multiple versions", () => {
      const v1 = savePlanVersion(historyPath, samplePlan);
      const modifiedPlan: Plan = {
        ...samplePlan,
        items: [...samplePlan.items, { name: "item-b", deps: ["item-a"], gates: [] }],
      };
      const v2 = savePlanVersion(historyPath, modifiedPlan);

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
    });

    it("should save metadata with version", () => {
      const version = savePlanVersion(historyPath, samplePlan, {
        author: "test-user",
        message: "Initial plan",
        approved: true,
        changes: ["Added item-a"],
      });

      expect(version.author).toBe("test-user");
      expect(version.message).toBe("Initial plan");
      expect(version.approved).toBe(true);
      expect(version.changes).toEqual(["Added item-a"]);
    });
  });

  describe("loadPlanHistory", () => {
    it("should return empty history when file does not exist", () => {
      const history = loadPlanHistory(historyPath);

      expect(history.versions).toHaveLength(0);
      expect(history.current).toBe(0);
    });

    it("should load existing history", () => {
      savePlanVersion(historyPath, samplePlan);
      const history = loadPlanHistory(historyPath);

      expect(history.versions).toHaveLength(1);
      expect(history.current).toBe(1);
    });
  });

  describe("getPlanVersion", () => {
    it("should get specific version", () => {
      savePlanVersion(historyPath, samplePlan);
      const version = getPlanVersion(historyPath, 1);

      expect(version).toBeDefined();
      expect(version?.version).toBe(1);
      expect(version?.plan).toEqual(samplePlan);
    });

    it("should return null for non-existent version", () => {
      const version = getPlanVersion(historyPath, 99);
      expect(version).toBeNull();
    });
  });

  describe("getCurrentPlan", () => {
    it("should get current plan", () => {
      savePlanVersion(historyPath, samplePlan);
      const current = getCurrentPlan(historyPath);

      expect(current).toEqual(samplePlan);
    });

    it("should return null when no history", () => {
      const current = getCurrentPlan(historyPath);
      expect(current).toBeNull();
    });
  });

  describe("listPlanVersions", () => {
    it("should list all versions", () => {
      savePlanVersion(historyPath, samplePlan);
      const modifiedPlan: Plan = {
        ...samplePlan,
        target: "develop",
      };
      savePlanVersion(historyPath, modifiedPlan);

      const versions = listPlanVersions(historyPath);
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
    });

    it("should return empty array when no history", () => {
      const versions = listPlanVersions(historyPath);
      expect(versions).toHaveLength(0);
    });
  });

  describe("restorePlanVersion", () => {
    it("should restore specific version", () => {
      const v1 = savePlanVersion(historyPath, samplePlan);
      const modifiedPlan: Plan = {
        ...samplePlan,
        target: "develop",
      };
      savePlanVersion(historyPath, modifiedPlan);

      const restored = restorePlanVersion(historyPath, 1);
      expect(restored).toEqual(samplePlan);

      const current = getCurrentPlan(historyPath);
      expect(current).toEqual(samplePlan);
    });

    it("should return null for non-existent version", () => {
      const restored = restorePlanVersion(historyPath, 99);
      expect(restored).toBeNull();
    });
  });

  describe("savePlanToFile", () => {
    const planPath = path.join(testDir, "plan.json");

    it("should save plan to file", () => {
      savePlanToFile(planPath, samplePlan);

      expect(fs.existsSync(planPath)).toBe(true);
      const content = fs.readFileSync(planPath, "utf-8");
      const loaded = JSON.parse(content);
      expect(loaded).toEqual(samplePlan);
    });

    it("should save metadata", () => {
      savePlanToFile(planPath, samplePlan, {
        metadata: {
          author: "test-user",
          approved: true,
        },
      });

      const metaPath = `${planPath}.meta`;
      expect(fs.existsSync(metaPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(metadata.author).toBe("test-user");
      expect(metadata.approved).toBe(true);
    });

    it("should create backup when requested", () => {
      // Create initial file
      savePlanToFile(planPath, samplePlan);

      // Wait a moment to ensure different timestamp
      const modifiedPlan: Plan = { ...samplePlan, target: "develop" };
      savePlanToFile(planPath, modifiedPlan, { createBackup: true });

      // Check backup exists
      const backupFiles = fs.readdirSync(testDir).filter((f) => f.startsWith("plan.json.backup-"));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe("loadPlanFromFile", () => {
    const planPath = path.join(testDir, "plan.json");

    it("should load plan from file", () => {
      savePlanToFile(planPath, samplePlan);
      const { plan } = loadPlanFromFile(planPath);

      expect(plan).toEqual(samplePlan);
    });

    it("should load metadata if exists", () => {
      savePlanToFile(planPath, samplePlan, {
        metadata: { author: "test-user" },
      });
      const { plan, metadata } = loadPlanFromFile(planPath);

      expect(plan).toEqual(samplePlan);
      expect(metadata?.author).toBe("test-user");
    });

    it("should throw when file does not exist", () => {
      expect(() => loadPlanFromFile(planPath)).toThrow("Plan file not found");
    });
  });

  describe("getPlanHistoryPath", () => {
    it("should generate correct history path", () => {
      const profileDir = "/tmp/test-profile";
      const histPath = getPlanHistoryPath(profileDir, "my-plan");

      expect(histPath).toContain("plan-history");
      expect(histPath).toContain("my-plan.history.json");
    });

    it("should use default plan name", () => {
      const profileDir = "/tmp/test-profile";
      const histPath = getPlanHistoryPath(profileDir);

      expect(histPath).toContain("default.history.json");
    });
  });
});
