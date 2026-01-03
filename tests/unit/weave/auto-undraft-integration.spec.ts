/**
 * Integration test for auto-undraft Copilot PR feature
 *
 * Tests the complete flow from PR discovery to undraft intervention planning.
 */

import { describe, it, expect } from "vitest";
import { createInterventionPlan } from "../../../src/weave/planner/planner.js";
import type { MergeWeavePolicy } from "../../../src/weave/policy/index.js";
import type { DiscoveredPR } from "../../../src/weave/planner/types.js";

describe("Auto-undraft Copilot PR Integration", () => {
  const basePolicy: MergeWeavePolicy = {
    version: 1,
    schemaVersion: "1.0.0",
    discovery: {
      repos: [{ owner: "test-owner", name: "test-repo", priority: 1 }],
      draft_policy: {
        undraft_copilot_prs: true,
        undraft_with_prefix: [],
        require_manual_for: [],
      },
    },
  };

  describe("when Copilot PR meets all completion criteria", () => {
    it("creates undraft intervention for completed Copilot draft PR", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 680,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      // Find undraft intervention
      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(1);
      expect(undraftInterventions[0].target).toBe("test-owner/test-repo#680");
      expect(undraftInterventions[0].params).toMatchObject({
        prNumber: 680,
        owner: "test-owner",
        repo: "test-repo",
      });
    });
  });

  describe("when Copilot PR has incomplete checklist", () => {
    it("does NOT create undraft intervention", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 681,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [ ] Add tests\n- [ ] Update docs",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("when Copilot PR review not requested", () => {
    it("does NOT create undraft intervention", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 682,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: false,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("when Copilot PR has recent commits (agent still working)", () => {
    it("does NOT create undraft intervention", () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 683,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: true,
          lastCommitDate: twoMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("when policy disables auto-undraft", () => {
    it("does NOT create undraft intervention even for completed PR", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const policyWithoutUndraft: MergeWeavePolicy = {
        ...basePolicy,
        discovery: {
          ...basePolicy.discovery,
          draft_policy: {
            undraft_copilot_prs: false,
            undraft_with_prefix: [],
            require_manual_for: [],
          },
        },
      };

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 684,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: policyWithoutUndraft, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("when PR is not from Copilot", () => {
    it("does NOT create undraft intervention", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 685,
          title: "feat: Add new feature",
          author: "human-dev",
          isDraft: true,
          isCopilot: false,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: [],
          headRef: "feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("when PR is not a draft", () => {
    it("does NOT create undraft intervention", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 686,
          title: "feat: Add new feature",
          author: "copilot",
          isDraft: false,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/feature-branch",
          baseRef: "main",
          body: "- [x] Implement feature\n- [x] Add tests\n- [x] Update docs",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(0);
    });
  });

  describe("with multiple PRs in different states", () => {
    it("creates undraft interventions only for completed Copilot drafts", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      const prs: DiscoveredPR[] = [
        // Complete - should be undrafted
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 700,
          title: "feat: Complete PR",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/complete",
          baseRef: "main",
          body: "- [x] Task 1\n- [x] Task 2",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
        // Incomplete checklist - should NOT be undrafted
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 701,
          title: "feat: Incomplete checklist",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/incomplete",
          baseRef: "main",
          body: "- [ ] Task 1\n- [x] Task 2",
          reviewRequested: true,
          lastCommitDate: tenMinutesAgo,
        },
        // Recent commits - should NOT be undrafted
        {
          owner: "test-owner",
          repo: "test-repo",
          number: 702,
          title: "feat: Recent activity",
          author: "copilot",
          isDraft: true,
          isCopilot: true,
          isDependabot: false,
          ciStatus: "success",
          dependsOn: [],
          labels: ["copilot"],
          headRef: "copilot/recent",
          baseRef: "main",
          body: "- [x] Task 1\n- [x] Task 2",
          reviewRequested: true,
          lastCommitDate: twoMinutesAgo,
        },
      ];

      const plan = createInterventionPlan({ policy: basePolicy, prs });

      const undraftInterventions = plan.interventions.filter((i) => i.type === "undraft_copilot");

      expect(undraftInterventions).toHaveLength(1);
      expect(undraftInterventions[0].target).toBe("test-owner/test-repo#700");
    });
  });
});
