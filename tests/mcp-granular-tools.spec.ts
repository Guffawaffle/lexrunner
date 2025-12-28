import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrListArgs, PlanValidateArgs, PlanAnalyzeArgs } from "../src/mcp/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("MCP Granular Plan Tools", () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-granular-test-"));
    process.env.LEX_PR_PROFILE_DIR = testDir;
    process.env.ALLOW_MUTATIONS = "false";
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    process.chdir("/");

    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("PrListArgs schema validation", () => {
    it("should validate valid pr_list arguments", () => {
      // Valid arguments
      expect(() => PrListArgs.parse({})).not.toThrow();
      expect(() => PrListArgs.parse({ owner: "testowner", repo: "testrepo" })).not.toThrow();
      expect(() => PrListArgs.parse({ query: "is:open label:bug" })).not.toThrow();
      expect(() => PrListArgs.parse({ labels: ["bug", "feature"] })).not.toThrow();
      expect(() => PrListArgs.parse({ includeDrafts: true })).not.toThrow();
      expect(() => PrListArgs.parse({ excludePRs: [123, 456] })).not.toThrow();
      expect(() => PrListArgs.parse({ githubToken: "ghp_token123" })).not.toThrow();
      expect(() => PrListArgs.parse({ state: "open" })).not.toThrow();
      expect(() => PrListArgs.parse({ state: "closed" })).not.toThrow();
      expect(() => PrListArgs.parse({ state: "all" })).not.toThrow();

      // Complex valid argument
      expect(() =>
        PrListArgs.parse({
          owner: "org",
          repo: "repo",
          query: "is:open label:stack:*",
          labels: ["priority:high"],
          includeDrafts: false,
          excludePRs: [100, 200],
          githubToken: "token",
          state: "open",
        })
      ).not.toThrow();
    });

    it("should reject invalid pr_list arguments", () => {
      // Invalid arguments
      expect(() => PrListArgs.parse({ owner: 123 })).toThrow();
      expect(() => PrListArgs.parse({ repo: true })).toThrow();
      expect(() => PrListArgs.parse({ labels: "bug,feature" })).toThrow(); // Should be array
      expect(() => PrListArgs.parse({ excludePRs: "123,456" })).toThrow(); // Should be array of numbers
      expect(() => PrListArgs.parse({ excludePRs: [123, "456"] })).toThrow(); // Should be numbers
      expect(() => PrListArgs.parse({ includeDrafts: "true" })).toThrow(); // Should be boolean
      expect(() => PrListArgs.parse({ state: "invalid" })).toThrow(); // Invalid enum value
    });
  });

  describe("PlanValidateArgs schema validation", () => {
    it("should validate valid plan_validate arguments", () => {
      // Valid arguments
      expect(() => PlanValidateArgs.parse({})).not.toThrow();
      expect(() => PlanValidateArgs.parse({ planFile: "/path/to/plan.json" })).not.toThrow();
      expect(() =>
        PlanValidateArgs.parse({ planContent: '{"schemaVersion":"1.0.0"}' })
      ).not.toThrow();
      expect(() =>
        PlanValidateArgs.parse({ planFile: "/path/to/plan.json", planContent: "{}" })
      ).not.toThrow();
    });

    it("should reject invalid plan_validate arguments", () => {
      // Invalid arguments
      expect(() => PlanValidateArgs.parse({ planFile: 123 })).toThrow();
      expect(() => PlanValidateArgs.parse({ planContent: true })).toThrow();
    });
  });

  describe("PlanAnalyzeArgs schema validation", () => {
    it("should validate valid plan_analyze arguments", () => {
      // Valid arguments
      expect(() => PlanAnalyzeArgs.parse({})).not.toThrow();
      expect(() => PlanAnalyzeArgs.parse({ planFile: "/path/to/plan.json" })).not.toThrow();
    });

    it("should reject invalid plan_analyze arguments", () => {
      // Invalid arguments
      expect(() => PlanAnalyzeArgs.parse({ planFile: 123 })).toThrow();
      expect(() => PlanAnalyzeArgs.parse({ planFile: true })).toThrow();
    });
  });

  describe("plan_validate tool behavior", () => {
    it("should validate a simple valid plan", () => {
      const validPlan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            sha: "abc123",
            branch: "feature/test",
          },
        ],
      };

      const planContent = JSON.stringify(validPlan);
      const args = PlanValidateArgs.parse({ planContent });

      expect(args.planContent).toBe(planContent);
    });

    it("should handle validation of plan with empty items", () => {
      const emptyPlan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [],
      };

      const planContent = JSON.stringify(emptyPlan);
      const args = PlanValidateArgs.parse({ planContent });

      expect(args.planContent).toBe(planContent);
    });
  });

  describe("plan_analyze tool behavior", () => {
    it("should accept planFile argument", () => {
      const args = PlanAnalyzeArgs.parse({ planFile: "/tmp/test-plan.json" });
      expect(args.planFile).toBe("/tmp/test-plan.json");
    });

    it("should work with no arguments", () => {
      const args = PlanAnalyzeArgs.parse({});
      expect(args.planFile).toBeUndefined();
    });
  });

  describe("Integration with existing plan schema", () => {
    it("should work with plan content that includes dependencies", () => {
      const planWithDeps = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            sha: "abc123",
            branch: "feature/base",
          },
          {
            name: "PR-2",
            sha: "def456",
            branch: "feature/dependent",
            dependsOn: ["PR-1"],
          },
        ],
      };

      const planContent = JSON.stringify(planWithDeps);
      const args = PlanValidateArgs.parse({ planContent });

      expect(args.planContent).toBe(planContent);
    });

    it("should work with plan content that includes policy", () => {
      const planWithPolicy = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          {
            name: "PR-1",
            sha: "abc123",
            branch: "feature/test",
          },
        ],
        policy: {
          requiredGates: ["lint", "test"],
          optionalGates: [],
          maxWorkers: 2,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };

      const planContent = JSON.stringify(planWithPolicy);
      const args = PlanValidateArgs.parse({ planContent });

      expect(args.planContent).toBe(planContent);
    });
  });
});
