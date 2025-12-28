/**
 * CLI Plan Generation Tests
 * Comprehensive test suite for plan generation CLI options and features
 */

import { describe, it, expect, vi } from "vitest";
import { generatePlanFromGitHub } from "../src/core/githubPlan.js";
import { computeMergeOrder, CycleError } from "../src/mergeOrder.js";
import { Plan } from "../src/schema.js";

describe("CLI Plan Generation", () => {
  describe("Policy Configuration", () => {
    it("should accept custom required gates", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 123,
            title: "Feature A",
            body: "Base feature",
            head: { ref: "feature-a", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev1" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockResolvedValue({
          number: 123,
          title: "Feature A",
          body: "Base feature",
          head: { ref: "feature-a", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev1" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        }),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        policy: {
          requiredGates: ["custom-gate", "security-scan"],
          maxWorkers: 1,
        },
      });

      expect(plan.policy?.requiredGates).toEqual(["custom-gate", "security-scan"]);
      expect(plan.items[0].gates.map((g) => g.name)).toEqual(["custom-gate", "security-scan"]);
    });

    it("should accept custom max workers", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([]),
        getPRDetails: vi.fn(),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        policy: {
          requiredGates: ["lint"],
          maxWorkers: 5,
        },
      });

      expect(plan.policy?.maxWorkers).toBe(5);
    });

    it("should accept custom target branch", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([]),
        getPRDetails: vi.fn(),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        target: "develop",
      });

      expect(plan.target).toBe("develop");
    });
  });

  describe("Dependency Validation", () => {
    it("should detect circular dependencies", () => {
      const planWithCycle: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: ["PR-2"], gates: [] },
          { name: "PR-2", deps: ["PR-3"], gates: [] },
          { name: "PR-3", deps: ["PR-1"], gates: [] },
        ],
      };

      expect(() => computeMergeOrder(planWithCycle)).toThrow(CycleError);
      expect(() => computeMergeOrder(planWithCycle)).toThrow(/cycle detected/i);
    });

    it("should validate complex dependency graph without cycles", () => {
      const validPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: ["PR-1"], gates: [] },
          { name: "PR-3", deps: ["PR-1"], gates: [] },
          { name: "PR-4", deps: ["PR-2", "PR-3"], gates: [] },
        ],
      };

      const levels = computeMergeOrder(validPlan);

      expect(levels).toHaveLength(3);
      expect(levels[0]).toEqual(["PR-1"]);
      expect(levels[1]).toEqual(["PR-2", "PR-3"]);
      expect(levels[2]).toEqual(["PR-4"]);
    });

    it("should handle diamond dependencies correctly", () => {
      const diamondPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-100", deps: [], gates: [] },
          { name: "PR-101", deps: ["PR-100"], gates: [] },
          { name: "PR-102", deps: ["PR-100"], gates: [] },
          { name: "PR-103", deps: ["PR-101", "PR-102"], gates: [] },
        ],
      };

      const levels = computeMergeOrder(diamondPlan);

      expect(levels).toHaveLength(3);
      expect(levels[0]).toEqual(["PR-100"]);
      expect(levels[1]).toContain("PR-101");
      expect(levels[1]).toContain("PR-102");
      expect(levels[2]).toEqual(["PR-103"]);
    });
  });

  describe("Plan Optimization", () => {
    it("should optimize plan for parallel execution", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: [], gates: [] },
          { name: "PR-3", deps: ["PR-1"], gates: [] },
          { name: "PR-4", deps: ["PR-2"], gates: [] },
          { name: "PR-5", deps: ["PR-3", "PR-4"], gates: [] },
        ],
      };

      const levels = computeMergeOrder(plan);

      // Should have 3 levels for optimal parallelization
      expect(levels).toHaveLength(3);

      // Level 0: Independent items
      expect(levels[0]).toEqual(["PR-1", "PR-2"]);

      // Level 1: Items depending on level 0
      expect(levels[1]).toEqual(["PR-3", "PR-4"]);

      // Level 2: Items depending on level 1
      expect(levels[2]).toEqual(["PR-5"]);
    });

    it("should maintain deterministic ordering in levels", () => {
      const plan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-3", deps: [], gates: [] },
          { name: "PR-1", deps: [], gates: [] },
          { name: "PR-2", deps: [], gates: [] },
        ],
      };

      const levels1 = computeMergeOrder(plan);
      const levels2 = computeMergeOrder(plan);

      // Should be deterministically sorted
      expect(levels1[0]).toEqual(["PR-1", "PR-2", "PR-3"]);
      expect(levels2[0]).toEqual(["PR-1", "PR-2", "PR-3"]);
      expect(levels1).toEqual(levels2);
    });
  });

  describe("GitHub Plan Generation with Custom Options", () => {
    it("should generate plan with custom gates from CLI options", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 200,
            title: "Security Feature",
            body: "Adds security features",
            head: { ref: "security", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "security-team" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockResolvedValue({
          number: 200,
          title: "Security Feature",
          body: "Adds security features",
          head: { ref: "security", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "security-team" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        }),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        policy: {
          requiredGates: ["security-scan", "vulnerability-check"],
          maxWorkers: 1,
        },
      });

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].gates.map((g) => g.name)).toEqual([
        "security-scan",
        "vulnerability-check",
      ]);
      expect(plan.policy?.requiredGates).toEqual(["security-scan", "vulnerability-check"]);
    });

    it("should handle empty required gates", async () => {
      const mockClient = {
        validateRepository: vi.fn().mockResolvedValue({
          owner: "testowner",
          repo: "testrepo",
          defaultBranch: "main",
          url: "https://github.com/testowner/testrepo",
        }),
        listOpenPRs: vi.fn().mockResolvedValue([
          {
            number: 100,
            title: "Simple PR",
            body: "Simple change",
            head: { ref: "simple", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
            state: "open",
            labels: [],
            draft: false,
            mergeable: true,
            user: { login: "dev" },
            createdAt: "2023-01-01T00:00:00Z",
            updatedAt: "2023-01-02T00:00:00Z",
          },
        ]),
        getPRDetails: vi.fn().mockResolvedValue({
          number: 100,
          title: "Simple PR",
          body: "Simple change",
          head: { ref: "simple", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          state: "open",
          labels: [],
          draft: false,
          mergeable: true,
          user: { login: "dev" },
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-02T00:00:00Z",
          dependencies: [],
          tags: [],
          requiredGates: [],
        }),
      };

      const plan = await generatePlanFromGitHub(mockClient as any, {
        policy: {
          requiredGates: [],
          maxWorkers: 1,
        },
      });

      expect(plan.items).toHaveLength(1);
      expect(plan.items[0].gates).toEqual([]);
    });
  });

  describe("Plan Validation Error Messages", () => {
    it("should provide clear error for unknown dependencies", () => {
      const invalidPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "PR-1", deps: ["PR-999"], gates: [] }],
      };

      // AXError format: "Item 'PR-1' depends on unknown item 'PR-999'"
      expect(() => computeMergeOrder(invalidPlan)).toThrow(/depends on unknown item/i);
      expect(() => computeMergeOrder(invalidPlan)).toThrow(/PR-999/);
    });

    it("should identify all nodes in a cycle", () => {
      const cyclicPlan: Plan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [
          { name: "PR-A", deps: ["PR-B"], gates: [] },
          { name: "PR-B", deps: ["PR-C"], gates: [] },
          { name: "PR-C", deps: ["PR-A"], gates: [] },
        ],
      };

      try {
        computeMergeOrder(cyclicPlan);
        expect.fail("Should have thrown CycleError");
      } catch (error) {
        expect(error).toBeInstanceOf(CycleError);
        const message = (error as Error).message;
        expect(message).toMatch(/PR-A/);
        expect(message).toMatch(/PR-B/);
        expect(message).toMatch(/PR-C/);
      }
    });
  });
});
