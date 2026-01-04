/**
 * Tests for next actions generation
 */

import { describe, it, expect } from "vitest";
import {
  generateNextActions,
  registerFailurePattern,
  FAILURE_PATTERNS,
} from "../../../../src/gates/test/enrichment/nextActions.js";
import type { AXTestResult } from "../../../../src/gates/test/enrichment/types.js";

describe("generateNextActions", () => {
  describe("snapshot-mismatch pattern", () => {
    it("should detect snapshot mismatches", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "should match snapshot",
        status: "fail",
        error: "Snapshot does not match",
      };

      const actions = generateNextActions(failure);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].action).toContain("snapshot");
      expect(actions[0].confidence).toBeGreaterThan(0.8);
    });

    it("should suggest updating snapshots", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "snapshot test",
        status: "fail",
        error: "Error: expect(received).toMatchSnapshot()",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("updateSnapshot"))).toBe(true);
    });
  });

  describe("module-not-found pattern", () => {
    it("should detect missing module errors", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "import test",
        status: "fail",
        error: "Cannot find module 'express'",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.toLowerCase().includes("install"))).toBe(true);
    });

    it("should suggest checking import paths", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "import test",
        status: "fail",
        errorType: "MODULE_NOT_FOUND",
        error: "Cannot find module './missing-file'",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("import path"))).toBe(true);
    });

    it("should detect ENOENT errors", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "file test",
        status: "fail",
        error: "ENOENT: no such file or directory",
      };

      const actions = generateNextActions(failure);

      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe("timeout pattern", () => {
    it("should detect timeout errors", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "slow test",
        status: "fail",
        error: "Test timeout of 5000ms exceeded",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.toLowerCase().includes("timeout"))).toBe(true);
    });

    it("should suggest increasing timeout", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "slow test",
        status: "fail",
        error: "Operation timed out after 10000ms",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("Increase"))).toBe(true);
    });

    it("should include timeout value in suggestion", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "slow test",
        status: "fail",
        error: "Timeout of 5000ms exceeded",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("5000"))).toBe(true);
    });
  });

  describe("unhandled-promise pattern", () => {
    it("should detect unhandled promise rejections", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "async test",
        status: "fail",
        error: "UnhandledPromiseRejectionWarning: Error occurred",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.toLowerCase().includes("promise"))).toBe(true);
    });

    it("should suggest await or catch", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "async test",
        status: "fail",
        error: "Unhandled promise rejection",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("await") || a.action.includes(".catch()"))).toBe(
        true
      );
    });
  });

  describe("port-in-use pattern", () => {
    it("should detect port conflicts", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "server test",
        status: "fail",
        error: "Error: listen EADDRINUSE: address already in use :::3000",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.toLowerCase().includes("port"))).toBe(true);
    });

    it("should suggest checking specific port", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "server test",
        status: "fail",
        error: "Port 8080 is already in use",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("8080"))).toBe(true);
    });
  });

  describe("date-flake pattern", () => {
    it("should detect date/time related failures", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "time test",
        status: "fail",
        error: "Expected date 2024-01-01 but received 2024-01-02",
      };

      const actions = generateNextActions(failure);

      expect(
        actions.some(
          (a) => a.action.toLowerCase().includes("date") || a.action.toLowerCase().includes("time")
        )
      ).toBe(true);
    });

    it("should suggest mocking Date", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "time test",
        status: "fail",
        error: "Time mismatch: expected 10:00:00 received 10:00:01",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("Mock"))).toBe(true);
    });
  });

  describe("order-dependent pattern", () => {
    it("should detect state-related issues", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "state test",
        status: "fail",
        error: "Expected state to be 'initial' but was 'modified'",
      };

      const actions = generateNextActions(failure);

      expect(
        actions.some(
          (a) =>
            a.action.toLowerCase().includes("state") || a.action.toLowerCase().includes("isolation")
        )
      ).toBe(true);
    });

    it("should suggest checking hooks", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "setup test",
        status: "fail",
        error: "beforeEach hook failed to reset state",
      };

      const actions = generateNextActions(failure);

      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe("type-error-null pattern", () => {
    it("should detect null/undefined access errors", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "access test",
        status: "fail",
        errorType: "TypeError",
        error: "Cannot read property 'foo' of undefined",
      };

      const actions = generateNextActions(failure);

      expect(
        actions.some(
          (a) =>
            a.action.toLowerCase().includes("null") || a.action.toLowerCase().includes("undefined")
        )
      ).toBe(true);
    });

    it("should suggest optional chaining", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "access test",
        status: "fail",
        errorType: "TypeError",
        error: "Cannot access 'bar' of null",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action.includes("?.") || a.action.includes("??"))).toBe(true);
    });
  });

  describe("generic fallback", () => {
    it("should provide generic actions when no pattern matches", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "unknown test",
        status: "fail",
        error: "Some completely unknown error",
      };

      const actions = generateNextActions(failure);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((a) => a.action.includes("Review"))).toBe(true);
    });
  });

  describe("pattern registration", () => {
    it("should allow registering custom patterns", () => {
      const initialCount = FAILURE_PATTERNS.length;

      registerFailurePattern({
        name: "custom-pattern",
        detect: (f) => f.error?.includes("CUSTOM_ERROR") || false,
        actions: () => [
          {
            action: "Run custom fix",
            confidence: 0.95,
          },
        ],
      });

      expect(FAILURE_PATTERNS.length).toBe(initialCount + 1);

      const failure: AXTestResult = {
        file: "test.ts",
        name: "custom test",
        status: "fail",
        error: "CUSTOM_ERROR occurred",
      };

      const actions = generateNextActions(failure);

      expect(actions.some((a) => a.action === "Run custom fix")).toBe(true);
    });
  });

  describe("multiple pattern matches", () => {
    it("should return actions from all matching patterns", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "complex test",
        status: "fail",
        errorType: "TypeError",
        error: "Cannot read property 'foo' of undefined - timeout of 5000ms exceeded",
      };

      const actions = generateNextActions(failure);

      // Should match both type-error-null and timeout patterns
      expect(actions.length).toBeGreaterThan(2);
    });
  });

  describe("confidence levels", () => {
    it("should return confidence scores between 0 and 1", () => {
      const failure: AXTestResult = {
        file: "test.ts",
        name: "test",
        status: "fail",
        error: "Snapshot does not match",
      };

      const actions = generateNextActions(failure);

      for (const action of actions) {
        expect(action.confidence).toBeGreaterThanOrEqual(0);
        expect(action.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});
