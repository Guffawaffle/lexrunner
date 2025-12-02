/**
 * Tests for AXError adapters
 *
 * Verifies that LexRunner errors are correctly converted to AX-compliant format.
 */

import { describe, it, expect } from "vitest";
import {
  gateFailedError,
  mergeConflictError,
  cycleDetectedError,
  unknownDependencyError,
  githubApiError,
  gitOperationError,
  planValidationError,
  toAXError,
  isAXError,
  ErrorCodes,
} from "../src/errors/index.js";

describe("AXError adapters", () => {
  describe("gateFailedError", () => {
    it("should create valid AXError for lint gate failure", () => {
      const error = gateFailedError({
        gate: "lint",
        item: "PR-123",
        exitCode: 1,
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.GATE_FAILED);
      expect(error.message).toContain("lint");
      expect(error.message).toContain("PR-123");
      expect(error.nextActions.length).toBeGreaterThanOrEqual(1);
      expect(error.nextActions.some((a) => a.includes("npm run lint"))).toBe(
        true
      );
    });

    it("should include artifact path in nextActions when provided", () => {
      const error = gateFailedError({
        gate: "test",
        artifactPath: "artifacts/PR-123/test/",
      });

      expect(error.nextActions.some((a) => a.includes("artifacts/PR-123"))).toBe(
        true
      );
    });
  });

  describe("mergeConflictError", () => {
    it("should create valid AXError for merge conflict", () => {
      const error = mergeConflictError({
        item: "PR-456",
        pr: 456,
        files: ["src/cli.ts", "src/schema.ts"],
        targetBranch: "main",
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.MERGE_CONFLICT);
      expect(error.message).toContain("PR-456");
      expect(error.nextActions.length).toBeGreaterThanOrEqual(1);
      expect(error.nextActions.some((a) => a.includes("Rebase"))).toBe(true);
    });
  });

  describe("cycleDetectedError", () => {
    it("should create valid AXError for dependency cycle", () => {
      const error = cycleDetectedError({
        cycle: ["PR-1", "PR-2", "PR-3", "PR-1"],
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.PLAN_CYCLE_DETECTED);
      expect(error.message).toContain("cycle");
      expect(error.nextActions.some((a) => a.includes("dependencies"))).toBe(
        true
      );
    });
  });

  describe("unknownDependencyError", () => {
    it("should create valid AXError for unknown dependency", () => {
      const error = unknownDependencyError({
        item: "PR-100",
        dependency: "PR-999",
        availableItems: ["PR-1", "PR-2", "PR-3"],
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.UNKNOWN_DEPENDENCY);
      expect(error.message).toContain("PR-100");
      expect(error.message).toContain("PR-999");
      expect(error.nextActions.some((a) => a.includes("Available items"))).toBe(
        true
      );
    });
  });

  describe("githubApiError", () => {
    it("should handle authentication errors", () => {
      const error = githubApiError({
        status: 401,
        message: "Bad credentials",
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.GITHUB_AUTH_ERROR);
      expect(error.nextActions.some((a) => a.includes("GITHUB_TOKEN"))).toBe(
        true
      );
    });

    it("should handle rate limiting", () => {
      const error = githubApiError({
        status: 429,
        retryAfter: 60,
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.GITHUB_RATE_LIMIT);
      expect(error.nextActions.some((a) => a.includes("60 seconds"))).toBe(true);
    });

    it("should handle generic API errors", () => {
      const error = githubApiError({
        status: 500,
        endpoint: "/repos/owner/repo/pulls",
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.GITHUB_API_ERROR);
      expect(error.nextActions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("gitOperationError", () => {
    it("should create valid AXError for git operation failure", () => {
      const error = gitOperationError({
        operation: "merge",
        command: "git merge feature-branch",
        message: "Automatic merge failed",
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.GIT_OPERATION_FAILED);
      expect(error.message).toContain("merge");
      expect(error.nextActions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("planValidationError", () => {
    it("should create valid AXError for plan validation failure", () => {
      const error = planValidationError({
        errors: ["Missing required field: id", "Invalid gate configuration"],
        planPath: "plan.json",
      });

      expect(isAXError(error)).toBe(true);
      expect(error.code).toBe(ErrorCodes.PLAN_VALIDATION_FAILED);
      expect(error.message).toContain("2 error(s)");
      expect(error.nextActions.some((a) => a.includes("plan.json"))).toBe(true);
    });
  });

  describe("toAXError", () => {
    it("should wrap standard Error as AXError", () => {
      const standardError = new Error("Something went wrong");
      const axError = toAXError(standardError);

      expect(isAXError(axError)).toBe(true);
      expect(axError.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(axError.message).toBe("Something went wrong");
      expect(axError.nextActions.length).toBeGreaterThanOrEqual(1);
    });

    it("should allow custom error code", () => {
      const error = new Error("Config error");
      const axError = toAXError(error, ErrorCodes.CONFIG_INVALID);

      expect(axError.code).toBe(ErrorCodes.CONFIG_INVALID);
    });

    it("should allow custom nextActions", () => {
      const error = new Error("Custom error");
      const axError = toAXError(error, ErrorCodes.INTERNAL_ERROR, [
        "Check the config file",
        "Try running with --verbose",
      ]);

      expect(axError.nextActions).toHaveLength(2);
      expect(axError.nextActions[0]).toBe("Check the config file");
    });
  });

  describe("AXError schema compliance", () => {
    it("should always have at least one nextAction", () => {
      // All adapters must satisfy the AX requirement
      const errors = [
        gateFailedError({ gate: "unknown" }),
        mergeConflictError({}),
        cycleDetectedError({ cycle: [] }),
        unknownDependencyError({ item: "a", dependency: "b" }),
        githubApiError({}),
        gitOperationError({ operation: "unknown" }),
        planValidationError({ errors: [] }),
      ];

      for (const error of errors) {
        expect(
          error.nextActions.length,
          `Error ${error.code} should have at least one nextAction`
        ).toBeGreaterThanOrEqual(1);
      }
    });

    it("should have UPPER_SNAKE_CASE error codes", () => {
      const codePattern = /^[A-Z][A-Z0-9_]*$/;
      const codes = Object.values(ErrorCodes);

      for (const code of codes) {
        expect(code).toMatch(codePattern);
      }
    });
  });
});
