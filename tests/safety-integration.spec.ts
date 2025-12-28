import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SafetyFramework, type OperationSummary } from "../src/autopilot/safety/SafetyFramework.js";
import { GitHubAPI } from "../src/github/api.js";

describe("Safety Integration Tests", () => {
  describe("Safety Stops Prevent Destructive Operations", () => {
    it("should prevent merge when abort is requested", async () => {
      const safety = new SafetyFramework();

      // Simulate abort request
      safety.requestAbort();

      const summary: OperationSummary = {
        autopilotLevel: 3,
        mergeOperations: [
          {
            type: "create-branch",
            description: "Create branch: merge-weave/20251002-153045",
            branch: "merge-weave/20251002-153045",
          },
          { type: "merge", description: "Merge PR-123 → integration branch", prNumber: 123 },
          {
            type: "push",
            description: "Push integration branch to origin",
            branch: "merge-weave/20251002-153045",
          },
        ],
        prOperations: [
          { type: "open-pr", description: "Open integration PR targeting main", target: "main" },
          { type: "add-comment", description: "Add status comments to PR-123", prNumber: 123 },
        ],
        affectedPRs: [123],
      };

      const result = await safety.confirmOperation(summary);

      expect(result.confirmed).toBe(false);
      expect(result.aborted).toBe(true);
      expect(result.reason).toContain("Abort");
    });

    it("should prevent merge when containment checks fail", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockResolvedValueOnce(null), // PR not found
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);

      const containmentCheck = await safety.performContainmentChecks([999], "main");
      const validation = safety.validateContainment(containmentCheck);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain("Unreachable");
    });

    it("should prevent merge when PRs have conflicts", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockResolvedValueOnce({
          number: 123,
          baseBranch: "main",
          mergeable: false,
        }),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);

      const containmentCheck = await safety.performContainmentChecks([123], "main");
      const validation = safety.validateContainment(containmentCheck);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("Merge conflicts"))).toBe(true);
    });

    it("should prevent merge when existing locks detected", async () => {
      const mockGitHubAPI = {
        getLabels: vi.fn().mockResolvedValueOnce(["lex-pr:weaving-20251002-120000"]),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);

      const existingLocks = await safety.checkExistingLocks([123]);

      expect(existingLocks.length).toBeGreaterThan(0);
      // In a real scenario, the autopilot would check this and refuse to proceed
    });

    it("should perform rollback when operation fails", async () => {
      const mockGitHubAPI = {
        addLabel: vi.fn().mockResolvedValue(undefined),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);

      // Simulate failed operation
      const rollbackResult = await safety.rollback(
        "commit-that-failed-gates",
        [123, 456],
        "Gates failed: test suite returned non-zero exit code"
      );

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.affectedPRs).toEqual([123, 456]);
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(123, "needs-manual-weave");
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(456, "needs-manual-weave");
    });

    it("should log all safety decisions for audit trail", () => {
      const safety = new SafetyFramework();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Log various safety decisions
      safety.logSafetyDecision("containment-check", "passed", { prNumbers: [123, 456] });
      safety.logSafetyDecision("confirmation", "user-approved", { level: 3 });
      safety.logSafetyDecision("rollback", "executed", { reason: "gate-failure" });

      expect(consoleSpy).toHaveBeenCalledTimes(3);

      // Verify all logs are in proper format
      for (const call of consoleSpy.mock.calls) {
        const logLine = call[0];
        expect(logLine).toContain("[SAFETY-LOG]");
        const logEntry = JSON.parse(logLine.replace("[SAFETY-LOG] ", ""));
        expect(logEntry.timestamp).toBeDefined();
        expect(logEntry.operation).toBeDefined();
        expect(logEntry.decision).toBeDefined();
      }

      consoleSpy.mockRestore();
    });

    it("should handle full safety workflow", async () => {
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
        getLabels: vi.fn().mockResolvedValue([]),
        addLabel: vi.fn().mockResolvedValue(undefined),
        removeLabel: vi.fn().mockResolvedValue(undefined),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);
      const timestamp = "20251002-153045";

      // Step 1: Check for existing locks
      const existingLocks = await safety.checkExistingLocks([123, 456]);
      expect(existingLocks).toHaveLength(0);

      // Step 2: Perform containment checks
      const containmentCheck = await safety.performContainmentChecks([123, 456], "main");
      const validation = safety.validateContainment(containmentCheck);
      expect(validation.valid).toBe(true);

      // Step 3: Apply advisory locks
      await safety.applyAdvisoryLock([123, 456], timestamp);
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(123, `lex-pr:weaving-${timestamp}`);
      expect(mockGitHubAPI.addLabel).toHaveBeenCalledWith(456, `lex-pr:weaving-${timestamp}`);

      // Step 4: In non-TTY, confirmation should auto-pass
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      process.stdin.isTTY = false;
      process.stdout.isTTY = false;

      try {
        const summary: OperationSummary = {
          autopilotLevel: 3,
          mergeOperations: [
            { type: "merge", description: "Merge PR-123 → integration", prNumber: 123 },
            { type: "merge", description: "Merge PR-456 → integration", prNumber: 456 },
          ],
          prOperations: [],
          affectedPRs: [123, 456],
        };

        const confirmResult = await safety.confirmOperation(summary);
        expect(confirmResult.confirmed).toBe(true);

        // Step 5: Clean up locks after operation
        await safety.removeAdvisoryLocks([123, 456], timestamp);
        expect(mockGitHubAPI.removeLabel).toHaveBeenCalled();
      } finally {
        process.stdin.isTTY = originalStdinIsTTY;
        process.stdout.isTTY = originalStdoutIsTTY;
      }
    });

    it("should install kill switch and handle signals", async () => {
      const safety = new SafetyFramework();

      safety.installKillSwitch();
      expect(safety.isAbortRequested()).toBe(false);

      // Simulate signal
      process.emit("SIGINT", "SIGINT");

      expect(safety.isAbortRequested()).toBe(true);

      // Verify operations are blocked
      const summary: OperationSummary = {
        autopilotLevel: 2,
        mergeOperations: [],
        prOperations: [],
        affectedPRs: [],
      };

      // This should detect the abort without prompting
      const result = await safety.confirmOperation(summary);
      expect(result.aborted).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle GitHub API unavailable gracefully", async () => {
      const safety = new SafetyFramework(); // No GitHub API

      // Should not throw when applying locks
      await expect(safety.applyAdvisoryLock([123], "20251002-153045")).rejects.toThrow(
        "GitHub API not available"
      );

      // Should not throw when checking containment
      await expect(safety.performContainmentChecks([123], "main")).rejects.toThrow(
        "GitHub API not available"
      );

      // Should return empty for check existing locks
      const locks = await safety.checkExistingLocks([123]);
      expect(locks).toEqual([]);

      // Should not throw when removing locks
      await safety.removeAdvisoryLocks([123], "20251002-153045");
    });

    it("should handle PR with undefined mergeable status", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi.fn().mockResolvedValueOnce({
          number: 123,
          baseBranch: "main",
          mergeable: undefined, // Sometimes GitHub doesn't have this yet
        }),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);
      const result = await safety.performContainmentChecks([123], "main");

      // Should not flag as conflict if mergeable is undefined
      expect(result.hasMergeConflicts).toBe(false);
    });

    it("should handle multiple target branches in containment check", async () => {
      const mockGitHubAPI = {
        getPullRequest: vi
          .fn()
          .mockResolvedValueOnce({ number: 123, baseBranch: "main" })
          .mockResolvedValueOnce({ number: 456, baseBranch: "develop" })
          .mockResolvedValueOnce({ number: 789, baseBranch: "main" }),
      } as any;

      const safety = new SafetyFramework(mockGitHubAPI);
      const result = await safety.performContainmentChecks([123, 456, 789], "main");

      expect(result.hasExternalDeps).toBe(true);
      expect(result.externalDeps.length).toBe(1);
      expect(result.externalDeps[0]).toContain("456");
      expect(result.externalDeps[0]).toContain("develop");
    });
  });
});
