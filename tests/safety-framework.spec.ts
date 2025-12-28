import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SafetyFramework,
  type OperationSummary,
  type MergeOperation,
} from "../src/autopilot/safety/SafetyFramework.js";
import { GitHubAPI } from "../src/github/api.js";

describe("SafetyFramework", () => {
  let safety: SafetyFramework;

  beforeEach(() => {
    safety = new SafetyFramework();
  });

  describe("Kill Switch", () => {
    it("should detect abort request", () => {
      expect(safety.isAbortRequested()).toBe(false);

      safety.requestAbort();

      expect(safety.isAbortRequested()).toBe(true);
    });

    it("should install signal handlers only once", () => {
      safety.installKillSwitch();
      safety.installKillSwitch(); // Should not throw or cause issues

      expect(safety.isAbortRequested()).toBe(false);
    });

    it("should handle SIGINT gracefully", () => {
      safety.installKillSwitch();

      // Simulate SIGINT
      process.emit("SIGINT", "SIGINT");

      expect(safety.isAbortRequested()).toBe(true);
    });
  });

  describe("Containment Validation", () => {
    it("should validate clean containment check", () => {
      const check = {
        allPRsReachable: true,
        unreachablePRs: [],
        hasExternalDeps: false,
        externalDeps: [],
        hasMergeConflicts: false,
        conflictingPRs: [],
      };

      const result = safety.validateContainment(check);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect unreachable PRs", () => {
      const check = {
        allPRsReachable: false,
        unreachablePRs: [123, 456],
        hasExternalDeps: false,
        externalDeps: [],
        hasMergeConflicts: false,
        conflictingPRs: [],
      };

      const result = safety.validateContainment(check);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("123");
      expect(result.errors[0]).toContain("456");
    });

    it("should detect external dependencies", () => {
      const check = {
        allPRsReachable: true,
        unreachablePRs: [],
        hasExternalDeps: true,
        externalDeps: ["PR #123 targets develop, not main"],
        hasMergeConflicts: false,
        conflictingPRs: [],
      };

      const result = safety.validateContainment(check);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("External dependencies"))).toBe(true);
    });

    it("should detect merge conflicts", () => {
      const check = {
        allPRsReachable: true,
        unreachablePRs: [],
        hasExternalDeps: false,
        externalDeps: [],
        hasMergeConflicts: true,
        conflictingPRs: [789],
      };

      const result = safety.validateContainment(check);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Merge conflicts"))).toBe(true);
      expect(result.errors.some((e) => e.includes("789"))).toBe(true);
    });

    it("should report multiple containment issues", () => {
      const check = {
        allPRsReachable: false,
        unreachablePRs: [100],
        hasExternalDeps: true,
        externalDeps: ["External dep"],
        hasMergeConflicts: true,
        conflictingPRs: [200],
      };

      const result = safety.validateContainment(check);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });
  });

  describe("Operation Summary", () => {
    it("should handle empty operation summary in non-TTY", async () => {
      // Mock non-TTY environment
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;

      try {
        const summary: OperationSummary = {
          autopilotLevel: 2,
          mergeOperations: [],
          prOperations: [],
          affectedPRs: [],
        };

        const result = await safety.confirmOperation(summary);

        expect(result.confirmed).toBe(true);
        expect(result.aborted).toBe(false);
      } finally {
        process.stdin.isTTY = originalStdinIsTTY;
        process.stdout.isTTY = originalStdoutIsTTY;
      }
    });

    it("should skip confirmation in CI environment", async () => {
      // Ensure non-TTY (simulating CI)
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;

      try {
        const summary: OperationSummary = {
          autopilotLevel: 3,
          mergeOperations: [
            { type: "merge", description: "Merge PR-123 → integration branch", prNumber: 123 },
          ],
          prOperations: [
            { type: "add-comment", description: "Add status comment to PR-123", prNumber: 123 },
          ],
          affectedPRs: [123],
        };

        const result = await safety.confirmOperation(summary);

        expect(result.confirmed).toBe(true);
        expect(result.aborted).toBe(false);
      } finally {
        process.stdin.isTTY = originalStdinIsTTY;
        process.stdout.isTTY = originalStdoutIsTTY;
      }
    });

    it("should detect abort before prompting", async () => {
      safety.requestAbort();

      const summary: OperationSummary = {
        autopilotLevel: 2,
        mergeOperations: [],
        prOperations: [],
        affectedPRs: [],
      };

      const result = await safety.confirmOperation(summary);

      expect(result.confirmed).toBe(false);
      expect(result.aborted).toBe(true);
      expect(result.reason).toContain("Abort");
    });
  });

  describe("Rollback Procedures", () => {
    it("should create rollback result", async () => {
      const result = await safety.rollback("abc123def456", [123, 456], "Gate failure");

      expect(result.success).toBe(true);
      expect(result.affectedPRs).toEqual([123, 456]);
      expect(result.revertCommit).toContain("revert-");
      expect(result.revertCommit).toContain("abc123d");
    });

    it("should handle rollback with GitHub API", async () => {
      // Mock GitHub API
      const mockGitHubAPI = {
        addLabel: vi.fn().mockResolvedValue(undefined),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.rollback(
        "commit123",
        [789],
        "Determinism check failed"
      );

      expect(result.success).toBe(true);
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(789, "needs-manual-weave");
    });

    it("should handle rollback failure gracefully", async () => {
      // Mock GitHub API that throws
      const mockGitHubAPI = {
        addLabel: vi.fn().mockRejectedValue(new Error("API Error")),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.rollback("commit456", [111], "Test failure");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Safety Logging", () => {
    it("should log safety decisions", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      safety.logSafetyDecision("merge", "approved", {
        prNumbers: [123, 456],
        level: 3,
      });

      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0][0];
      expect(call).toContain("[SAFETY-LOG]");
      expect(call).toContain("merge");
      expect(call).toContain("approved");

      consoleSpy.mockRestore();
    });

    it("should include timestamp in log entries", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      safety.logSafetyDecision("abort", "user-requested");

      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(call.replace("[SAFETY-LOG] ", ""));

      expect(logEntry.timestamp).toBeDefined();
      expect(logEntry.operation).toBe("abort");
      expect(logEntry.decision).toBe("user-requested");

      consoleSpy.mockRestore();
    });
  });

  describe("Advisory Locks", () => {
    it("should check for existing locks", async () => {
      const mockGitHubAPI = {
        getLabels: vi
          .fn()
          .mockResolvedValueOnce(["bug", "lex-pr:weaving-20251002-153045"])
          .mockResolvedValueOnce(["enhancement"]),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const locks = await safetyWithGitHub.checkExistingLocks([123, 456]);

      expect(locks).toHaveLength(1);
      expect(locks[0]).toContain("lex-pr:weaving-");
    });

    it("should apply advisory locks", async () => {
      const mockGitHubAPI = {
        addLabel: vi.fn().mockResolvedValue(undefined),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      await safetyWithGitHub.applyAdvisoryLock([123, 456], "20251002-153045");

      expect(mockGitHubAPI.addLabel).toHaveBeenCalledTimes(2);
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(123, "lex-pr:weaving-20251002-153045");
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(456, "lex-pr:weaving-20251002-153045");
    });

    it("should remove advisory locks", async () => {
      const mockGitHubAPI = {
        removeLabel: vi.fn().mockResolvedValue(undefined),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      await safetyWithGitHub.removeAdvisoryLocks([789], "20251002-153045");

      expect(mockGitHubAPI.removeLabel).toHaveBeenCalledWith(789, "lex-pr:weaving-20251002-153045");
    });

    it("should handle lock removal errors gracefully", async () => {
      const mockGitHubAPI = {
        removeLabel: vi.fn().mockRejectedValue(new Error("Label not found")),
      } as any;

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);

      // Should not throw
      await expect(
        safetyWithGitHub.removeAdvisoryLocks([999], "20251002-153045")
      ).resolves.not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it("should return empty locks when GitHub API not available", async () => {
      const safetyWithoutGitHub = new SafetyFramework();
      const locks = await safetyWithoutGitHub.checkExistingLocks([123]);

      expect(locks).toEqual([]);
    });
  });

  describe("Containment Checks with GitHub API", () => {
    it("should perform containment checks successfully", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi
          .fn()
          .mockResolvedValueOnce({
            number: 123,
            baseBranch: "main",
            mergeable: true,
          })
          .mockResolvedValueOnce({
            number: 456,
            baseBranch: "main",
            mergeable: true,
          }),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.performContainmentChecks([123, 456], "main");

      expect(result.allPRsReachable).toBe(true);
      expect(result.hasExternalDeps).toBe(false);
      expect(result.hasMergeConflicts).toBe(false);
    });

    it("should detect unreachable PRs", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi
          .fn()
          .mockResolvedValueOnce({ number: 123, baseBranch: "main" })
          .mockResolvedValueOnce(null),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.performContainmentChecks([123, 999], "main");

      expect(result.allPRsReachable).toBe(false);
      expect(result.unreachablePRs).toContain(999);
    });

    it("should detect external dependencies", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockResolvedValueOnce({
          number: 123,
          baseBranch: "develop",
          mergeable: true,
        }),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.performContainmentChecks([123], "main");

      expect(result.hasExternalDeps).toBe(true);
      expect(result.externalDeps).toHaveLength(1);
      expect(result.externalDeps[0]).toContain("develop");
    });

    it("should detect merge conflicts", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockResolvedValueOnce({
          number: 123,
          baseBranch: "main",
          mergeable: false,
        }),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.performContainmentChecks([123], "main");

      expect(result.hasMergeConflicts).toBe(true);
      expect(result.conflictingPRs).toContain(123);
    });

    it("should handle API errors as unreachable PRs", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockRejectedValue(new Error("API Error")),
      } as any;

      const safetyWithGitHub = new SafetyFramework(mockGitHubAPI);
      const result = await safetyWithGitHub.performContainmentChecks([123], "main");

      expect(result.allPRsReachable).toBe(false);
      expect(result.unreachablePRs).toContain(123);
    });
  });
});
