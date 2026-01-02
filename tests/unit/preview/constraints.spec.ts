/**
 * Constraint Preview Tests
 *
 * Tests for constraint preview functionality in dry-run mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  previewConstraints,
  formatConstraintPreview,
  formatConstraintPreviewJSON,
  type ConstraintPreview,
  type PreviewedConstraint,
} from "../../../src/preview/constraints.js";
import type { Plan } from "../../../src/schema.js";

describe("Constraint Preview", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    vi.resetModules();
    process.env = { ...originalEnv };
    // Disable LexSona by default
    delete process.env.LEXSONA_MODE;
    delete process.env.LEXSONA_PERSONA;
    delete process.env.LEX_DB_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("previewConstraints", () => {
    it("should return baseline constraints for a simple plan", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "item-1",
            deps: [],
            gates: [
              { name: "lint", run: "npm run lint" },
              { name: "test", run: "npm test" },
            ],
          },
        ],
        policy: {
          requiredGates: ["lint", "test"],
          optionalGates: [],
          maxWorkers: 1,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };

      const preview = await previewConstraints(plan);

      expect(preview.totalCount).toBeGreaterThan(0);
      expect(preview.bySource.baseline).toBeGreaterThan(0);
      expect(preview.constraints).toContainEqual(
        expect.objectContaining({
          id: "merge-gates-required",
          source: "baseline",
        })
      );
      expect(preview.constraints).toContainEqual(
        expect.objectContaining({
          id: "require-ci-green",
          source: "baseline",
        })
      );
    });

    it("should include no-force-push constraint when policy exists", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-1", deps: [], gates: [] }],
        policy: {
          requiredGates: [],
          optionalGates: [],
          maxWorkers: 1,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };

      const preview = await previewConstraints(plan);

      expect(preview.constraints).toContainEqual(
        expect.objectContaining({
          id: "no-force-push",
          source: "baseline",
        })
      );
    });

    it("should include flaky-gate-retry constraint when retry config exists", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-1", deps: [], gates: [] }],
        policy: {
          requiredGates: [],
          optionalGates: [],
          maxWorkers: 1,
          retries: {
            lint: { maxAttempts: 3, backoffSeconds: 5 },
          },
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };

      const preview = await previewConstraints(plan);

      expect(preview.constraints).toContainEqual(
        expect.objectContaining({
          id: "flaky-gate-retry",
          source: "baseline",
        })
      );
    });

    it("should warn about items with no gates", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-1", deps: [], gates: [] },
          { name: "item-2", deps: [], gates: [] },
        ],
      };

      const preview = await previewConstraints(plan);

      expect(preview.warnings).toContainEqual(
        expect.stringContaining("2 item(s) have no explicit gate configuration")
      );
    });

    it("should warn about missing dependencies", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-1", deps: ["missing-item"], gates: [] },
          { name: "item-2", deps: [], gates: [] },
        ],
      };

      const preview = await previewConstraints(plan);

      expect(preview.warnings).toContainEqual(
        expect.stringContaining('Item "item-1" depends on missing item "missing-item"')
      );
    });

    it("should have no conflicts for simple plans", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-1", deps: [], gates: [] }],
      };

      const preview = await previewConstraints(plan);

      expect(preview.conflicts).toHaveLength(0);
    });

    it("should count constraints by source correctly", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "item-1", deps: [], gates: [] }],
        policy: {
          requiredGates: ["lint"],
          optionalGates: [],
          maxWorkers: 1,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };

      const preview = await previewConstraints(plan);

      expect(preview.bySource.baseline).toBeGreaterThan(0);
      expect(preview.bySource.persona).toBe(0); // LexSona disabled
      expect(preview.bySource.learned).toBe(0); // Not implemented yet
      expect(preview.totalCount).toBe(
        preview.bySource.baseline + preview.bySource.persona + preview.bySource.learned
      );
    });

    it("should apply constraints to all items", async () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "item-1", deps: [], gates: [] },
          { name: "item-2", deps: [], gates: [] },
          { name: "item-3", deps: [], gates: [] },
        ],
      };

      const preview = await previewConstraints(plan);

      // All baseline constraints should apply to all items
      const baselineConstraints = preview.constraints.filter((c) => c.source === "baseline");
      for (const constraint of baselineConstraints) {
        expect(constraint.appliesTo).toContain("item-1");
        expect(constraint.appliesTo).toContain("item-2");
        expect(constraint.appliesTo).toContain("item-3");
      }
    });
  });

  describe("formatConstraintPreview", () => {
    it("should format constraint preview with baseline constraints", () => {
      const preview: ConstraintPreview = {
        constraints: [
          {
            id: "merge-gates-required",
            statement: "All gates must pass before merge",
            source: "baseline",
            appliesTo: ["item-1"],
          },
          {
            id: "require-ci-green",
            statement: "CI must be green",
            source: "baseline",
            appliesTo: ["item-1"],
          },
        ],
        conflicts: [],
        warnings: [],
        totalCount: 2,
        bySource: {
          baseline: 2,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreview(preview);

      expect(output).toContain("📋 Active Constraints (2 total)");
      expect(output).toContain("From baseline:");
      expect(output).toContain("merge-gates-required");
      expect(output).toContain("All gates must pass before merge");
      expect(output).toContain("require-ci-green");
      expect(output).toContain("CI must be green");
      expect(output).toContain("✅ No constraint conflicts detected");
    });

    it("should format constraint preview with persona constraints", () => {
      const preview: ConstraintPreview = {
        constraints: [
          {
            id: "test-coverage-80",
            statement: "Test coverage must be above 80%",
            source: "persona",
            appliesTo: ["item-1"],
            confidence: 0.95,
          },
        ],
        conflicts: [],
        warnings: [],
        totalCount: 1,
        bySource: {
          baseline: 0,
          persona: 1,
          learned: 0,
        },
      };

      const output = formatConstraintPreview(preview);

      expect(output).toContain("From persona:");
      expect(output).toContain("test-coverage-80");
      expect(output).toContain("Test coverage must be above 80%");
      expect(output).toContain("(95%)"); // confidence
    });

    it("should format constraint preview with warnings", () => {
      const preview: ConstraintPreview = {
        constraints: [],
        conflicts: [],
        warnings: ["2 items have no explicit gate configuration (will use defaults)"],
        totalCount: 0,
        bySource: {
          baseline: 0,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreview(preview);

      expect(output).toContain("⚠️  Warnings:");
      expect(output).toContain("2 items have no explicit gate configuration");
    });

    it("should format constraint preview with conflicts", () => {
      const preview: ConstraintPreview = {
        constraints: [],
        conflicts: [
          {
            constraint1: "require-ci-green",
            constraint2: "skip-ci-for-hotfix",
            reason: "Cannot both require and skip CI",
          },
        ],
        warnings: [],
        totalCount: 0,
        bySource: {
          baseline: 0,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreview(preview);

      expect(output).toContain("❌ Constraint Conflicts Detected:");
      expect(output).toContain("require-ci-green");
      expect(output).toContain("skip-ci-for-hotfix");
      expect(output).toContain("Cannot both require and skip CI");
    });

    it("should show learned rules section even if empty", () => {
      const preview: ConstraintPreview = {
        constraints: [],
        conflicts: [],
        warnings: [],
        totalCount: 0,
        bySource: {
          baseline: 0,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreview(preview);

      expect(output).toContain("From learned rules:");
      expect(output).toContain("(none active for this scope)");
    });
  });

  describe("formatConstraintPreviewJSON", () => {
    it("should format constraint preview as valid JSON", () => {
      const preview: ConstraintPreview = {
        constraints: [
          {
            id: "merge-gates-required",
            statement: "All gates must pass before merge",
            source: "baseline",
            appliesTo: ["item-1"],
          },
        ],
        conflicts: [],
        warnings: ["Test warning"],
        totalCount: 1,
        bySource: {
          baseline: 1,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreviewJSON(preview);

      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed.totalCount).toBe(1);
      expect(parsed.constraints).toHaveLength(1);
      expect(parsed.warnings).toHaveLength(1);
    });

    it("should include all preview fields in JSON", () => {
      const preview: ConstraintPreview = {
        constraints: [
          {
            id: "test-id",
            statement: "Test statement",
            source: "baseline",
            appliesTo: ["item-1", "item-2"],
          },
        ],
        conflicts: [
          {
            constraint1: "c1",
            constraint2: "c2",
            reason: "conflict reason",
          },
        ],
        warnings: ["warning1", "warning2"],
        totalCount: 1,
        bySource: {
          baseline: 1,
          persona: 0,
          learned: 0,
        },
      };

      const output = formatConstraintPreviewJSON(preview);
      const parsed = JSON.parse(output);

      expect(parsed.constraints).toBeDefined();
      expect(parsed.conflicts).toBeDefined();
      expect(parsed.warnings).toBeDefined();
      expect(parsed.totalCount).toBeDefined();
      expect(parsed.bySource).toBeDefined();
      expect(parsed.bySource.baseline).toBe(1);
      expect(parsed.bySource.persona).toBe(0);
      expect(parsed.bySource.learned).toBe(0);
    });
  });
});
