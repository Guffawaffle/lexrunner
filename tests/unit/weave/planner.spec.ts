/**
 * Intervention Planner Tests
 *
 * Tests for the intervention planning system.
 */

import { describe, it, expect } from "vitest";
import { createInterventionPlan } from "../../../src/weave/planner/planner.js";
import type { PlanningContext, DiscoveredPR } from "../../../src/weave/planner/types.js";
import type { MergeWeavePolicy } from "../../../src/weave/policy/schema.js";

describe("Intervention Planner", () => {
  const createMockPolicy = (overrides?: Partial<MergeWeavePolicy>): MergeWeavePolicy => ({
    version: 1,
    schemaVersion: "1.0.0",
    discovery: {
      repos: [{ owner: "test-owner", name: "test-repo", priority: 1 }],
      filters: {
        include_drafts: false,
        include_dependabot: true,
        include_copilot: true,
      },
      draft_policy: {
        undraft_copilot_prs: true,
        undraft_with_prefix: [],
        require_manual_for: [],
      },
    },
    dependencies: {
      resolution: {
        depends_on_footer: true,
        cross_repo_chain: false,
        heuristic_detection: false,
      },
      on_cycle: "fail",
      on_missing_dep: "warn",
    },
    merge: {
      method: "squash",
      auto_update_branch: true,
      admin_authority: {
        enabled: true,
        conditions: [],
      },
    },
    ...overrides,
  });

  const createMockPR = (overrides?: Partial<DiscoveredPR>): DiscoveredPR => ({
    owner: "test-owner",
    repo: "test-repo",
    number: 1,
    title: "Test PR",
    author: "test-user",
    isDraft: false,
    isCopilot: false,
    isDependabot: false,
    ciStatus: "success",
    dependsOn: [],
    labels: [],
    headRef: "feature/test",
    baseRef: "main",
    ...overrides,
  });

  describe("createInterventionPlan", () => {
    it("creates update_pr_branch intervention before execute_merge", () => {
      const policy = createMockPolicy();
      const prs = [createMockPR({ number: 1 }), createMockPR({ number: 2 })];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      // Find merge phase interventions
      const mergeInterventions = plan.interventions.filter((i) => i.phase === "merge");

      // Should have update_pr_branch interventions
      const updateBranchInterventions = mergeInterventions.filter(
        (i) => i.type === "update_pr_branch"
      );
      expect(updateBranchInterventions.length).toBe(2); // One per PR

      // Should have execute_merge interventions
      const executeMergeInterventions = mergeInterventions.filter(
        (i) => i.type === "execute_merge"
      );
      expect(executeMergeInterventions.length).toBe(2); // One per PR

      // Each execute_merge should depend on corresponding update_pr_branch
      for (const executeMerge of executeMergeInterventions) {
        const prNumber = (executeMerge.params as any).prNumber;
        const updateBranch = updateBranchInterventions.find(
          (u) => (u.params as any).prNumber === prNumber
        );
        expect(updateBranch).toBeDefined();
        expect(executeMerge.dependsOn).toContain(updateBranch!.id);
      }
    });

    it("skips update_pr_branch when auto_update_branch is false", () => {
      const policy = createMockPolicy({
        merge: {
          method: "squash",
          auto_update_branch: false,
        },
      });
      const prs = [createMockPR({ number: 1 })];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      // Should not have update_pr_branch interventions
      const updateBranchInterventions = plan.interventions.filter(
        (i) => i.type === "update_pr_branch"
      );
      expect(updateBranchInterventions.length).toBe(0);
    });

    it("creates undraft_copilot interventions for draft Copilot PRs", () => {
      const policy = createMockPolicy();
      const prs = [
        createMockPR({ number: 1, isDraft: true, isCopilot: true }),
        createMockPR({ number: 2, isDraft: false, isCopilot: true }),
        createMockPR({ number: 3, isDraft: true, isCopilot: false }),
      ];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      // Find discovery phase interventions
      const discoveryInterventions = plan.interventions.filter((i) => i.phase === "discovery");

      // Should have undraft_copilot for PR #1 only (draft + copilot)
      const undraftInterventions = discoveryInterventions.filter(
        (i) => i.type === "undraft_copilot"
      );
      expect(undraftInterventions.length).toBe(1);
      expect((undraftInterventions[0].params as any).prNumber).toBe(1);
    });

    it("skips undraft_copilot when policy disabled", () => {
      const policy = createMockPolicy({
        discovery: {
          repos: [{ owner: "test-owner", name: "test-repo", priority: 1 }],
          draft_policy: {
            undraft_copilot_prs: false,
            undraft_with_prefix: [],
            require_manual_for: [],
          },
        },
      });
      const prs = [createMockPR({ number: 1, isDraft: true, isCopilot: true })];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      // Should not have undraft_copilot interventions
      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");
      expect(undraftInterventions.length).toBe(0);
    });

    it("creates all intervention phases in correct order", () => {
      const policy = createMockPolicy();
      const prs = [createMockPR({ number: 1 })];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      // Check that phases are present
      const phases = [...new Set(plan.interventions.map((i) => i.phase))];
      expect(phases).toContain("discovery");
      expect(phases).toContain("merge");

      // Check stats
      expect(plan.stats.total).toBeGreaterThan(0);
      expect(plan.stats.byDeterminism.D1).toBeGreaterThan(0);
      expect(plan.stats.byPhase.discovery).toBeGreaterThan(0);
      expect(plan.stats.byPhase.merge).toBeGreaterThan(0);
    });

    it("includes policy version in plan", () => {
      const policy = createMockPolicy();
      const prs = [createMockPR({ number: 1 })];

      const context: PlanningContext = {
        policy,
        prs,
        baseBranch: "main",
      };

      const plan = createInterventionPlan(context);

      expect(plan.policyVersion).toBe("1.0.0");
      expect(plan.generatedAt).toBeDefined();
      expect(plan.id).toBeDefined();
    });
  });
});
