/**
 * Tests for Counter-Example Storage - LR-TSF-003
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  storeCounterExample,
  listCounterExamples,
  loadCounterExample,
  exportCounterExamples,
  getCounterExamplesDir,
} from "../../../src/learning/storage.js";
import type { CounterExample } from "../../../src/learning/counter-example.js";

describe("Counter-Example Storage", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique test directory for each test using os.tmpdir() for cross-platform support
    testDir = path.join(os.tmpdir(), `counter-examples-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createMockCounterExample(): CounterExample {
    return {
      id: "test-id-123",
      timestamp: new Date().toISOString(),
      failure: {
        type: "gate",
        target: "test-gate",
        error: "Test failed",
        exitCode: 1,
      },
      context: {
        plan: "/path/to/plan.json",
        runId: "run-123",
        activeConstraints: ["test-coverage"],
        scope: ["src/**"],
      },
      classification: {
        type: "gap",
        description: "Missing test",
        suggestedAction: "Add tests",
      },
      relatedConstraints: ["test-coverage"],
      shouldLearn: true,
    };
  }

  describe("storeCounterExample", () => {
    it("should store counter-example to disk", () => {
      const counterExample = createMockCounterExample();
      const filePath = storeCounterExample(counterExample, testDir);

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      const stored = JSON.parse(content);
      expect(stored.id).toBe(counterExample.id);
    });

    it("should create index with stored counter-example", () => {
      const counterExample = createMockCounterExample();
      storeCounterExample(counterExample, testDir);

      const indexPath = path.join(getCounterExamplesDir(testDir), "index.json");
      expect(fs.existsSync(indexPath)).toBe(true);

      const indexContent = fs.readFileSync(indexPath, "utf-8");
      const index = JSON.parse(indexContent);
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].id).toBe(counterExample.id);
    });
  });

  describe("listCounterExamples", () => {
    it("should list all counter-examples", () => {
      const ce1 = createMockCounterExample();
      const ce2 = { ...createMockCounterExample(), id: "test-id-456" };

      storeCounterExample(ce1, testDir);
      storeCounterExample(ce2, testDir);

      const entries = listCounterExamples(testDir);
      expect(entries).toHaveLength(2);
    });

    it("should return empty array when no counter-examples exist", () => {
      const entries = listCounterExamples(testDir);
      expect(entries).toHaveLength(0);
    });
  });

  describe("loadCounterExample", () => {
    it("should load a specific counter-example by ID", () => {
      const counterExample = createMockCounterExample();
      storeCounterExample(counterExample, testDir);

      const loaded = loadCounterExample(counterExample.id, testDir);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(counterExample.id);
      expect(loaded?.failure.target).toBe("test-gate");
    });

    it("should return null for non-existent ID", () => {
      const loaded = loadCounterExample("non-existent-id", testDir);
      expect(loaded).toBeNull();
    });
  });

  describe("exportCounterExamples", () => {
    it("should export counter-examples as JSON", () => {
      const counterExample = createMockCounterExample();
      storeCounterExample(counterExample, testDir);

      const exported = exportCounterExamples("json", testDir);
      const parsed = JSON.parse(exported);
      expect(parsed.entries).toHaveLength(1);
    });

    it("should export counter-examples as CSV", () => {
      const counterExample = createMockCounterExample();
      storeCounterExample(counterExample, testDir);

      const exported = exportCounterExamples("csv", testDir);
      const lines = exported.split("\n");
      expect(lines[0]).toContain("ID,Timestamp,Failure Type");
      expect(lines[1]).toContain(counterExample.id);
    });

    it("should properly escape CSV fields with commas and quotes", () => {
      const counterExample = createMockCounterExample();
      counterExample.failure.target = 'test,with"quotes';
      counterExample.classification.description = "Test with, commas";
      storeCounterExample(counterExample, testDir);

      const exported = exportCounterExamples("csv", testDir);
      const lines = exported.split("\n");
      // Check that fields with special characters are properly escaped
      expect(lines[1]).toContain('"test,with""quotes"');
    });
  });
});
