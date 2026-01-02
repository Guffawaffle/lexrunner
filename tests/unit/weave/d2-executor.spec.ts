/**
 * D2 Executor Tests
 *
 * Tests for bounded judgment (D2) intervention handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeD2Intervention,
  hasD2Handler,
  getD2InterventionTypes,
} from "../../../src/weave/executor/d2-executor.js";
import type { ExecutionContext, AuditEvent } from "../../../src/weave/executor/types.js";
import type { PlannedIntervention } from "../../../src/weave/planner/types.js";

describe("D2 Executor", () => {
  // Mock GitHub API
  const mockGitHub = {
    getPullRequest: vi.fn(),
    updatePullRequest: vi.fn(),
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

  describe("hasD2Handler", () => {
    it("returns true for registered D2 intervention types", () => {
      expect(hasD2Handler("undraft_copilot")).toBe(true);
      expect(hasD2Handler("review_checklist")).toBe(true);
      expect(hasD2Handler("detect_failure_pattern")).toBe(true);
      expect(hasD2Handler("auto_fix")).toBe(true);
      expect(hasD2Handler("detect_fanout_trigger")).toBe(true);
      expect(hasD2Handler("create_issue")).toBe(true);
    });

    it("returns false for D1 intervention types", () => {
      expect(hasD2Handler("merge_pr")).toBe(false);
      expect(hasD2Handler("sync_branch")).toBe(false);
      expect(hasD2Handler("create_pr")).toBe(false);
    });

    it("returns false for D3 intervention types", () => {
      expect(hasD2Handler("review_suggestion")).toBe(false);
      expect(hasD2Handler("resolve_conflict")).toBe(false);
    });
  });

  describe("getD2InterventionTypes", () => {
    it("returns all registered D2 types", () => {
      const types = getD2InterventionTypes();

      expect(types).toContain("undraft_copilot");
      expect(types).toContain("review_checklist");
      expect(types).toContain("detect_failure_pattern");
      expect(types).toContain("auto_fix");
      expect(types).toContain("detect_fanout_trigger");
      expect(types).toContain("create_issue");
      expect(types.length).toBe(6);
    });
  });

  describe("executeD2Intervention", () => {
    describe("undraft_copilot", () => {
      const undraftIntervention: PlannedIntervention = {
        id: "int-undraft-001",
        type: "undraft_copilot",
        determinism_level: "D2",
        description: "Promote PR from draft to ready for review",
        target: "PR#42",
        params: {
          prNumber: 42,
          owner: "test-owner",
          repo: "test-repo",
        },
        priority: 1,
      };

      it("calls updatePullRequest to remove draft status", async () => {
        mockGitHub.updatePullRequest.mockResolvedValue(undefined);

        const ctx = createContext(false);
        const result = await executeD2Intervention(undraftIntervention, ctx);

        expect(result.success).toBe(true);
        expect(mockGitHub.updatePullRequest).toHaveBeenCalledWith("test-owner", "test-repo", 42, {
          draft: false,
        });
        expect(result.type).toBe("undraft_copilot");
        expect(result.output?.promoted).toBe(true);
        expect(result.output?.message).toContain("Promoted PR #42");
      });

      it("returns dry-run result without calling API", async () => {
        const ctx = createContext(true);
        const result = await executeD2Intervention(undraftIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.dryRun).toBe(true);
        expect(mockGitHub.updatePullRequest).not.toHaveBeenCalled();
        expect(result.output?.message).toContain("Would promote PR #42");
      });

      it("emits audit events on execution", async () => {
        mockGitHub.updatePullRequest.mockResolvedValue(undefined);

        const ctx = createContext(false);
        await executeD2Intervention(undraftIntervention, ctx);

        expect(auditEvents.length).toBe(2);
        const startEvent = auditEvents.find((e) => e.action === "start");
        expect(startEvent).toBeDefined();
        expect(startEvent?.type).toBe("undraft_copilot");

        const completeEvent = auditEvents.find((e) => e.action === "complete");
        expect(completeEvent).toBeDefined();
      });

      it("handles API errors gracefully", async () => {
        mockGitHub.updatePullRequest.mockRejectedValue(new Error("API rate limit exceeded"));

        const ctx = createContext(false);
        const result = await executeD2Intervention(undraftIntervention, ctx);

        expect(result.success).toBe(false);
        expect(result.error).toContain("API rate limit exceeded");
      });

      it("uses correct owner/repo from params", async () => {
        const interventionWithDifferentParams: PlannedIntervention = {
          ...undraftIntervention,
          id: "int-undraft-002",
          params: {
            prNumber: 123,
            owner: "acme-corp",
            repo: "my-project",
          },
        };

        mockGitHub.updatePullRequest.mockResolvedValue(undefined);

        const ctx = createContext(false);
        await executeD2Intervention(interventionWithDifferentParams, ctx);

        expect(mockGitHub.updatePullRequest).toHaveBeenCalledWith("acme-corp", "my-project", 123, {
          draft: false,
        });
      });
    });

    describe("detect_failure_pattern", () => {
      const detectPatternIntervention: PlannedIntervention = {
        id: "int-pattern-001",
        type: "detect_failure_pattern",
        determinism_level: "D2",
        description: "Analyze failure logs for patterns",
        target: "gate:test",
        params: {
          gateName: "test",
          gateResult: {
            exitCode: 1,
            stderr: "Cannot find module 'missing-package'",
          },
        },
        priority: 3,
      };

      it("returns pattern analysis result", async () => {
        const ctx = createContext(false);
        const result = await executeD2Intervention(detectPatternIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.type).toBe("detect_failure_pattern");
        expect(result.output?.patterns).toContain("missing_module");
      });

      it("detects multiple patterns", async () => {
        const multiPatternIntervention: PlannedIntervention = {
          ...detectPatternIntervention,
          id: "int-pattern-002",
          params: {
            gateName: "build",
            gateResult: {
              exitCode: 1,
              stderr: "Type error at line 10\nENOENT: no such file",
            },
          },
        };

        const ctx = createContext(false);
        const result = await executeD2Intervention(multiPatternIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.patterns).toContain("type_error");
        expect(result.output?.patterns).toContain("file_not_found");
      });
    });

    describe("create_issue", () => {
      const createIssueIntervention: PlannedIntervention = {
        id: "int-issue-001",
        type: "create_issue",
        determinism_level: "D2",
        description: "Create tracking issue for failed gate",
        target: "test-owner/test-repo",
        params: {
          owner: "test-owner",
          repo: "test-repo",
          title: "Gate failure: lint check failed",
          body: "The lint check failed on PR #42",
          labels: ["bug", "ci-failure"],
        },
        priority: 2,
      };

      it("returns success in non-dry-run mode", async () => {
        const ctx = createContext(false);
        const result = await executeD2Intervention(createIssueIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.created).toBe(true);
        expect(result.output?.title).toBe("Gate failure: lint check failed");
      });

      it("returns dry-run result without creating issue", async () => {
        const ctx = createContext(true);
        const result = await executeD2Intervention(createIssueIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.dryRun).toBe(true);
        expect(result.output?.message).toContain("Would create issue");
      });
    });

    describe("detect_fanout_trigger", () => {
      it("recommends fanout for large PRs", async () => {
        const largePRIntervention: PlannedIntervention = {
          id: "int-fanout-001",
          type: "detect_fanout_trigger",
          determinism_level: "D2",
          description: "Check if PR should trigger fanout",
          target: "PR#100",
          params: {
            prNumber: 100,
            filesChanged: 15,
            linesChanged: 600,
          },
          priority: 2,
        };

        const ctx = createContext(false);
        const result = await executeD2Intervention(largePRIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.shouldFanout).toBe(true);
      });

      it("does not recommend fanout for small PRs", async () => {
        const smallPRIntervention: PlannedIntervention = {
          id: "int-fanout-002",
          type: "detect_fanout_trigger",
          determinism_level: "D2",
          description: "Check if PR should trigger fanout",
          target: "PR#101",
          params: {
            prNumber: 101,
            filesChanged: 3,
            linesChanged: 50,
          },
          priority: 2,
        };

        const ctx = createContext(false);
        const result = await executeD2Intervention(smallPRIntervention, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.shouldFanout).toBe(false);
      });
    });

    describe("error handling", () => {
      it("throws for unregistered intervention types", async () => {
        const unknownIntervention: PlannedIntervention = {
          id: "int-unknown-001",
          type: "unknown_type" as any,
          determinism_level: "D2",
          description: "Unknown intervention",
          target: "unknown",
          params: {},
          priority: 1,
        };

        const ctx = createContext(false);

        await expect(executeD2Intervention(unknownIntervention, ctx)).rejects.toThrow(
          "No D2 handler for intervention type: unknown_type"
        );
      });
    });
  });
});
