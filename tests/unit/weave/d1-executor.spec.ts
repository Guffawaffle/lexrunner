/**
 * D1 Executor Tests
 *
 * Tests for deterministic (D1) intervention handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeD1Intervention,
  hasD1Handler,
  getD1InterventionTypes,
} from "../../../src/weave/executor/d1-executor.js";
import type { ExecutionContext, AuditEvent } from "../../../src/weave/executor/types.js";
import type { PlannedIntervention } from "../../../src/weave/planner/types.js";

describe("D1 Executor", () => {
  // Mock GitHub API
  const mockGitHub = {
    getPullRequest: vi.fn(),
    updatePullRequest: vi.fn(),
    updatePullRequestBranch: vi.fn(),
    listPullRequests: vi.fn(),
    mergePullRequest: vi.fn(),
    getCommitStatus: vi.fn(),
  };

  // Mock shell executor
  const mockShell = {
    run: vi.fn(),
  };

  // Mock git operations
  const mockGit = {
    pull: vi.fn(),
    getCurrentBranch: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
  };

  // Captured audit events
  let auditEvents: AuditEvent[] = [];

  const createContext = (dryRun = false): ExecutionContext => ({
    dryRun,
    github: mockGitHub,
    shell: mockShell,
    git: mockGit,
    workspaceRoot: "/tmp/test-work",
    repoPaths: new Map([["test-repo", "/tmp/test-work/test-repo"]]),
    emitAudit: (event: AuditEvent) => {
      auditEvents.push(event);
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    auditEvents = [];
  });

  describe("hasD1Handler", () => {
    it("returns true for registered D1 intervention types", () => {
      expect(hasD1Handler("discover_prs")).toBe(true);
      expect(hasD1Handler("filter_drafts")).toBe(true);
      expect(hasD1Handler("parse_dependencies")).toBe(true);
      expect(hasD1Handler("run_base_gate")).toBe(true);
      expect(hasD1Handler("check_ci_status")).toBe(true);
      expect(hasD1Handler("compute_merge_order")).toBe(true);
      expect(hasD1Handler("check_admin_authority")).toBe(true);
      expect(hasD1Handler("update_pr_branch")).toBe(true);
      expect(hasD1Handler("execute_merge")).toBe(true);
      expect(hasD1Handler("pull_changes")).toBe(true);
      expect(hasD1Handler("verify_gates")).toBe(true);
      expect(hasD1Handler("run_post_merge_checks")).toBe(true);
      expect(hasD1Handler("commit_fix")).toBe(true);
      expect(hasD1Handler("revert_merge")).toBe(true);
    });

    it("returns false for D2 intervention types", () => {
      expect(hasD1Handler("undraft_copilot")).toBe(false);
      expect(hasD1Handler("review_checklist")).toBe(false);
      expect(hasD1Handler("detect_failure_pattern")).toBe(false);
    });

    it("returns false for D3 intervention types", () => {
      expect(hasD1Handler("quality_assessment")).toBe(false);
      expect(hasD1Handler("resolve_conflict")).toBe(false);
    });
  });

  describe("getD1InterventionTypes", () => {
    it("returns all registered D1 types", () => {
      const types = getD1InterventionTypes();

      expect(types).toContain("discover_prs");
      expect(types).toContain("filter_drafts");
      expect(types).toContain("parse_dependencies");
      expect(types).toContain("run_base_gate");
      expect(types).toContain("check_ci_status");
      expect(types).toContain("compute_merge_order");
      expect(types).toContain("check_admin_authority");
      expect(types).toContain("update_pr_branch");
      expect(types).toContain("execute_merge");
      expect(types).toContain("pull_changes");
      expect(types).toContain("verify_gates");
      expect(types).toContain("run_post_merge_checks");
      expect(types).toContain("commit_fix");
      expect(types).toContain("revert_merge");
      expect(types.length).toBe(14);
    });
  });

  describe("executeD1Intervention", () => {
    describe("update_pr_branch", () => {
      const updateBranchIntervention: PlannedIntervention = {
        id: "int-update-001",
        type: "update_pr_branch",
        determinism: "D1",
        phase: "merge",
        target: "test-owner/test-repo#42",
        dependsOn: [],
        params: {
          owner: "test-owner",
          repo: "test-repo",
          prNumber: 42,
        },
        status: "ready",
      };

      it("calls updatePullRequestBranch to update the branch", async () => {
        mockGitHub.updatePullRequestBranch.mockResolvedValue(undefined);

        const ctx = createContext(false);
        const result = await executeD1Intervention(updateBranchIntervention, ctx);

        expect(result.success).toBe(true);
        expect(mockGitHub.updatePullRequestBranch).toHaveBeenCalledWith(
          "test-owner",
          "test-repo",
          42
        );
        expect(result.type).toBe("update_pr_branch");
        expect(result.output?.updated).toBe(true);
        expect(result.output?.prNumber).toBe(42);
      });

      it("returns dry-run result without calling API", async () => {
        const ctx = createContext(true);
        const result = await executeD1Intervention(updateBranchIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.dryRun).toBe(true);
        expect(mockGitHub.updatePullRequestBranch).not.toHaveBeenCalled();
      });

      it("emits audit events on execution", async () => {
        mockGitHub.updatePullRequestBranch.mockResolvedValue(undefined);

        const ctx = createContext(false);
        await executeD1Intervention(updateBranchIntervention, ctx);

        expect(auditEvents.length).toBe(2);
        const startEvent = auditEvents.find((e) => e.action === "start");
        expect(startEvent).toBeDefined();
        expect(startEvent?.type).toBe("update_pr_branch");

        const completeEvent = auditEvents.find((e) => e.action === "complete");
        expect(completeEvent).toBeDefined();
      });

      it("handles API errors gracefully", async () => {
        mockGitHub.updatePullRequestBranch.mockRejectedValue(new Error("Branch is up to date"));

        const ctx = createContext(false);
        const result = await executeD1Intervention(updateBranchIntervention, ctx);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Branch is up to date");
      });

      it("uses correct owner/repo from params", async () => {
        const interventionWithDifferentParams: PlannedIntervention = {
          ...updateBranchIntervention,
          id: "int-update-002",
          params: {
            prNumber: 123,
            owner: "acme-corp",
            repo: "my-project",
          },
        };

        mockGitHub.updatePullRequestBranch.mockResolvedValue(undefined);

        const ctx = createContext(false);
        await executeD1Intervention(interventionWithDifferentParams, ctx);

        expect(mockGitHub.updatePullRequestBranch).toHaveBeenCalledWith(
          "acme-corp",
          "my-project",
          123
        );
      });
    });

    describe("execute_merge", () => {
      const mergeIntervention: PlannedIntervention = {
        id: "int-merge-001",
        type: "execute_merge",
        determinism: "D1",
        phase: "merge",
        target: "test-owner/test-repo#42",
        dependsOn: [],
        params: {
          method: "squash",
          commitTitle: { use_pr_title: true },
          owner: "test-owner",
          repo: "test-repo",
          prNumber: 42,
        },
        status: "ready",
      };

      it("merges a PR successfully", async () => {
        mockGitHub.getPullRequest.mockResolvedValue({ title: "Fix bug in parser" });
        mockGitHub.mergePullRequest.mockResolvedValue(true);

        const ctx = createContext(false);
        const result = await executeD1Intervention(mergeIntervention, ctx);

        expect(result.success).toBe(true);
        expect(mockGitHub.mergePullRequest).toHaveBeenCalledWith("test-owner", "test-repo", 42, {
          method: "squash",
          commitTitle: "Fix bug in parser",
        });
        expect(result.output?.merged).toBe(true);
      });

      it("returns dry-run result without merging", async () => {
        const ctx = createContext(true);
        const result = await executeD1Intervention(mergeIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.dryRun).toBe(true);
        expect(mockGitHub.mergePullRequest).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("throws for unregistered intervention types", async () => {
        const unknownIntervention: PlannedIntervention = {
          id: "int-unknown-001",
          type: "unknown_type" as any,
          determinism: "D1",
          phase: "merge",
          target: "unknown",
          dependsOn: [],
          params: {},
          status: "ready",
        };

        const ctx = createContext(false);

        await expect(executeD1Intervention(unknownIntervention, ctx)).rejects.toThrow(
          "No D1 handler for intervention type: unknown_type"
        );
      });
    });
  });
});
