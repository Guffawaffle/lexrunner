/**
 * Post-Merge Checks Tests
 *
 * Tests for post-merge validation check execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runPostMergeCheck,
  runPostMergeChecks,
  formatPostMergeCheckResult,
  formatPostMergeChecksResult,
  DEFAULT_POST_MERGE_CHECKS,
  type PostMergeCheck,
} from "../../../src/weave/post-merge-checks.js";
import type { ShellExecutor } from "../../../src/weave/executor/types.js";

describe("Post-Merge Checks", () => {
  // Mock shell executor
  const mockShell: ShellExecutor = {
    run: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DEFAULT_POST_MERGE_CHECKS", () => {
    it("includes typecheck as required check", () => {
      expect(DEFAULT_POST_MERGE_CHECKS).toHaveLength(1);
      expect(DEFAULT_POST_MERGE_CHECKS[0]).toEqual({
        type: "typecheck",
        command: "npm run build",
        required: true,
        timeout: 60_000,
      });
    });
  });

  describe("runPostMergeCheck", () => {
    it("runs check successfully and returns success result", async () => {
      const check: PostMergeCheck = {
        type: "typecheck",
        command: "npm run build",
        required: true,
        timeout: 60_000,
      };

      vi.mocked(mockShell.run).mockResolvedValue({
        exitCode: 0,
        stdout: "Build successful",
        stderr: "",
      });

      const result = await runPostMergeCheck(check, mockShell, "/test/path");

      expect(result.success).toBe(true);
      expect(result.type).toBe("typecheck");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Build successful");
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("runs check and returns failure result on non-zero exit code", async () => {
      const check: PostMergeCheck = {
        type: "lint",
        command: "npm run lint",
        required: true,
        timeout: 30_000,
      };

      vi.mocked(mockShell.run).mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Lint errors found",
      });

      const result = await runPostMergeCheck(check, mockShell, "/test/path");

      expect(result.success).toBe(false);
      expect(result.type).toBe("lint");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("Lint errors found");
      expect(result.error).toBe("Check failed with exit code 1");
    });

    it("handles command timeout/error gracefully", async () => {
      const check: PostMergeCheck = {
        type: "test",
        command: "npm test",
        required: true,
        timeout: 10_000,
      };

      vi.mocked(mockShell.run).mockRejectedValue(new Error("Command timeout"));

      const result = await runPostMergeCheck(check, mockShell, "/test/path");

      expect(result.success).toBe(false);
      expect(result.type).toBe("test");
      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe("Command timeout");
    });

    it("passes correct parameters to shell executor", async () => {
      const check: PostMergeCheck = {
        type: "typecheck",
        command: "tsc --noEmit",
        required: true,
        timeout: 45_000,
      };

      vi.mocked(mockShell.run).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      await runPostMergeCheck(check, mockShell, "/my/workspace");

      expect(mockShell.run).toHaveBeenCalledWith("tsc --noEmit", {
        cwd: "/my/workspace",
        timeout: 45_000,
      });
    });
  });

  describe("runPostMergeChecks", () => {
    it("runs all checks and returns success when all pass", async () => {
      const checks: PostMergeCheck[] = [
        { type: "typecheck", command: "npm run build", required: true, timeout: 60_000 },
        { type: "lint", command: "npm run lint", required: true, timeout: 30_000 },
      ];

      vi.mocked(mockShell.run).mockResolvedValue({
        exitCode: 0,
        stdout: "Success",
        stderr: "",
      });

      const result = await runPostMergeChecks(checks, mockShell, "/test/path");

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(2);
      expect(result.firstFailure).toBeUndefined();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("stops at first required check failure", async () => {
      const checks: PostMergeCheck[] = [
        { type: "typecheck", command: "npm run build", required: true, timeout: 60_000 },
        { type: "lint", command: "npm run lint", required: true, timeout: 30_000 },
        { type: "test", command: "npm test", required: true, timeout: 120_000 },
      ];

      vi.mocked(mockShell.run)
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "Build successful",
          stderr: "",
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: "",
          stderr: "Lint errors",
        });

      const result = await runPostMergeChecks(checks, mockShell, "/test/path");

      expect(result.success).toBe(false);
      expect(result.checks).toHaveLength(2); // Only first two checks run
      expect(result.firstFailure).toBeDefined();
      expect(result.firstFailure?.type).toBe("lint");
    });

    it("continues past non-required check failures", async () => {
      const checks: PostMergeCheck[] = [
        { type: "typecheck", command: "npm run build", required: true, timeout: 60_000 },
        { type: "lint", command: "npm run lint", required: false, timeout: 30_000 },
        { type: "test", command: "npm test", required: true, timeout: 120_000 },
      ];

      vi.mocked(mockShell.run)
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "Build successful",
          stderr: "",
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: "",
          stderr: "Lint warnings",
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "Tests passed",
          stderr: "",
        });

      const result = await runPostMergeChecks(checks, mockShell, "/test/path");

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(3); // All checks run
      expect(result.firstFailure).toBeUndefined(); // No required check failed
    });

    it("skips all checks when skip option is true", async () => {
      const checks: PostMergeCheck[] = [
        { type: "typecheck", command: "npm run build", required: true, timeout: 60_000 },
      ];

      const result = await runPostMergeChecks(checks, mockShell, "/test/path", { skip: true });

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(0);
      expect(mockShell.run).not.toHaveBeenCalled();
    });

    it("runs only required checks when requiredOnly option is true", async () => {
      const checks: PostMergeCheck[] = [
        { type: "typecheck", command: "npm run build", required: true, timeout: 60_000 },
        { type: "lint", command: "npm run lint", required: false, timeout: 30_000 },
        { type: "test", command: "npm test", required: true, timeout: 120_000 },
      ];

      vi.mocked(mockShell.run).mockResolvedValue({
        exitCode: 0,
        stdout: "Success",
        stderr: "",
      });

      const result = await runPostMergeChecks(checks, mockShell, "/test/path", {
        requiredOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(2); // Only required checks
      expect(result.checks[0].type).toBe("typecheck");
      expect(result.checks[1].type).toBe("test");
    });

    it("handles empty checks array", async () => {
      const result = await runPostMergeChecks([], mockShell, "/test/path");

      expect(result.success).toBe(true);
      expect(result.checks).toHaveLength(0);
      expect(result.firstFailure).toBeUndefined();
    });
  });

  describe("formatPostMergeCheckResult", () => {
    it("formats successful check result", () => {
      const result = {
        type: "typecheck" as const,
        success: true,
        exitCode: 0,
        stdout: "Build successful",
        stderr: "",
        durationMs: 5432,
      };

      const formatted = formatPostMergeCheckResult(result);

      expect(formatted).toContain("✅");
      expect(formatted).toContain("typecheck");
      expect(formatted).toContain("5432ms");
    });

    it("formats failed check result with error", () => {
      const result = {
        type: "lint" as const,
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error: Missing semicolon at line 42\nError: Unused variable at line 100",
        durationMs: 2500,
        error: "Check failed with exit code 1",
      };

      const formatted = formatPostMergeCheckResult(result);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("lint");
      expect(formatted).toContain("2500ms");
      expect(formatted).toContain("Error:");
      expect(formatted).toContain("Missing semicolon");
    });
  });

  describe("formatPostMergeChecksResult", () => {
    it("formats result with all checks passing", () => {
      const result = {
        success: true,
        checks: [
          {
            type: "typecheck" as const,
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 5000,
          },
        ],
        totalDurationMs: 5000,
      };

      const formatted = formatPostMergeChecksResult(result);

      expect(formatted).toContain("✅");
      expect(formatted).toContain("typecheck");
      expect(formatted).not.toContain("Weave paused");
    });

    it("formats result with failure and includes recovery options", () => {
      const failedCheck = {
        type: "typecheck" as const,
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Type error",
        durationMs: 3000,
        error: "Check failed",
      };

      const result = {
        success: false,
        checks: [failedCheck],
        firstFailure: failedCheck,
        totalDurationMs: 3000,
      };

      const formatted = formatPostMergeChecksResult(result);

      expect(formatted).toContain("❌");
      expect(formatted).toContain("Weave paused");
      expect(formatted).toContain("--resume");
      expect(formatted).toContain("--revert-last");
      expect(formatted).toContain("--abort");
    });
  });
});
