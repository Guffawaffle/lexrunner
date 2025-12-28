/**
 * Failure Handling Payload Tests - LR-064
 *
 * Tests for FailureHandlingPayload wrapping and logging functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { GateResult } from "../../src/schema.js";
import {
  FailureErrorCode,
  isRetryableErrorCode,
  classifyGateError,
  buildRecommendedActions,
  wrapGateFailure,
  logGateFailure,
  getGateFailures,
  toNextOptions,
} from "../../src/runs/failures.js";
import { ensureRunDir } from "../../src/runs/storage.js";

describe("FailureErrorCode", () => {
  describe("isRetryableErrorCode", () => {
    it("should return true for GATE_TIMEOUT", () => {
      expect(isRetryableErrorCode(FailureErrorCode.GATE_TIMEOUT)).toBe(true);
    });

    it("should return true for GATE_FLAKY", () => {
      expect(isRetryableErrorCode(FailureErrorCode.GATE_FLAKY)).toBe(true);
    });

    it("should return true for NETWORK_ERROR", () => {
      expect(isRetryableErrorCode(FailureErrorCode.NETWORK_ERROR)).toBe(true);
    });

    it("should return true for RATE_LIMITED", () => {
      expect(isRetryableErrorCode(FailureErrorCode.RATE_LIMITED)).toBe(true);
    });

    it("should return false for GATE_FAILED", () => {
      expect(isRetryableErrorCode(FailureErrorCode.GATE_FAILED)).toBe(false);
    });

    it("should return false for AUTH_FAILED", () => {
      expect(isRetryableErrorCode(FailureErrorCode.AUTH_FAILED)).toBe(false);
    });

    it("should return false for CONFIG_ERROR", () => {
      expect(isRetryableErrorCode(FailureErrorCode.CONFIG_ERROR)).toBe(false);
    });

    it("should return false for CONFLICT_DETECTED", () => {
      expect(isRetryableErrorCode(FailureErrorCode.CONFLICT_DETECTED)).toBe(false);
    });

    it("should return false for VALIDATION_ERROR", () => {
      expect(isRetryableErrorCode(FailureErrorCode.VALIDATION_ERROR)).toBe(false);
    });
  });
});

describe("classifyGateError", () => {
  it("should classify timeout errors as GATE_TIMEOUT", () => {
    const result = classifyGateError("test", "Command timed out after 30s");
    expect(result.code).toBe(FailureErrorCode.GATE_TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it("should classify ETIMEDOUT as GATE_TIMEOUT", () => {
    const result = classifyGateError("test", "Error: ETIMEDOUT");
    expect(result.code).toBe(FailureErrorCode.GATE_TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  it("should classify network errors as NETWORK_ERROR", () => {
    const result = classifyGateError("test", "Error: ECONNREFUSED");
    expect(result.code).toBe(FailureErrorCode.NETWORK_ERROR);
    expect(result.retryable).toBe(true);
  });

  it("should classify ENOTFOUND as NETWORK_ERROR", () => {
    const result = classifyGateError("test", "Error: ENOTFOUND example.com");
    expect(result.code).toBe(FailureErrorCode.NETWORK_ERROR);
    expect(result.retryable).toBe(true);
  });

  it("should classify fetch failed as NETWORK_ERROR", () => {
    const result = classifyGateError("test", "TypeError: fetch failed");
    expect(result.code).toBe(FailureErrorCode.NETWORK_ERROR);
    expect(result.retryable).toBe(true);
  });

  it("should classify rate limit errors as RATE_LIMITED", () => {
    const result = classifyGateError("test", "Error: API rate limit exceeded");
    expect(result.code).toBe(FailureErrorCode.RATE_LIMITED);
    expect(result.retryable).toBe(true);
  });

  it("should classify 429 status as RATE_LIMITED", () => {
    const result = classifyGateError("test", "HTTP Error: 429 Too Many Requests");
    expect(result.code).toBe(FailureErrorCode.RATE_LIMITED);
    expect(result.retryable).toBe(true);
  });

  it("should classify flaky gates as GATE_FLAKY when marked", () => {
    const result = classifyGateError("test", "Test failed", undefined, true);
    expect(result.code).toBe(FailureErrorCode.GATE_FLAKY);
    expect(result.retryable).toBe(true);
  });

  it("should classify authentication errors as AUTH_FAILED", () => {
    const result = classifyGateError("test", "Error: Unauthorized access");
    expect(result.code).toBe(FailureErrorCode.AUTH_FAILED);
    expect(result.retryable).toBe(false);
  });

  it("should classify 401 errors as AUTH_FAILED", () => {
    const result = classifyGateError("test", "HTTP 401: Unauthorized");
    expect(result.code).toBe(FailureErrorCode.AUTH_FAILED);
    expect(result.retryable).toBe(false);
  });

  it("should classify 403 errors as AUTH_FAILED", () => {
    const result = classifyGateError("test", "HTTP 403: Forbidden");
    expect(result.code).toBe(FailureErrorCode.AUTH_FAILED);
    expect(result.retryable).toBe(false);
  });

  it("should classify configuration errors as CONFIG_ERROR", () => {
    const result = classifyGateError("test", "Error: Invalid configuration file");
    expect(result.code).toBe(FailureErrorCode.CONFIG_ERROR);
    expect(result.retryable).toBe(false);
  });

  it("should classify merge conflicts as CONFLICT_DETECTED", () => {
    const result = classifyGateError("test", "CONFLICT: Merge conflict in src/file.ts");
    expect(result.code).toBe(FailureErrorCode.CONFLICT_DETECTED);
    expect(result.retryable).toBe(false);
  });

  it("should classify validation errors as VALIDATION_ERROR", () => {
    const result = classifyGateError("test", "Schema validation failed");
    expect(result.code).toBe(FailureErrorCode.VALIDATION_ERROR);
    expect(result.retryable).toBe(false);
  });

  it("should default to GATE_FAILED for unknown errors", () => {
    const result = classifyGateError("test", "npm test exited with code 1");
    expect(result.code).toBe(FailureErrorCode.GATE_FAILED);
    expect(result.retryable).toBe(false);
  });
});

describe("buildRecommendedActions", () => {
  it("should include retry actions for retryable errors", () => {
    const actions = buildRecommendedActions(FailureErrorCode.GATE_TIMEOUT, "test", true);

    const retryAction = actions.find((a) => a.action === "retry_gate");
    expect(retryAction).toBeDefined();
    expect(retryAction!.requiresLLMDecision).toBe(false);
    expect(retryAction!.riskLevel).toBe("low");

    const retryWithOptionsAction = actions.find((a) => a.action === "retry_with_options");
    expect(retryWithOptionsAction).toBeDefined();
    expect(retryWithOptionsAction!.requiresLLMDecision).toBe(true);
  });

  it("should not include retry actions for non-retryable errors", () => {
    const actions = buildRecommendedActions(FailureErrorCode.AUTH_FAILED, "test", false);

    const retryAction = actions.find((a) => a.action === "retry_gate");
    expect(retryAction).toBeUndefined();
  });

  it("should always include skip_gate action", () => {
    const actions = buildRecommendedActions(FailureErrorCode.GATE_FAILED, "test", false);

    const skipAction = actions.find((a) => a.action === "skip_gate");
    expect(skipAction).toBeDefined();
    expect(skipAction!.requiresLLMDecision).toBe(true);
    expect(skipAction!.riskLevel).toBe("medium");
  });

  it("should always include abort_run action", () => {
    const actions = buildRecommendedActions(FailureErrorCode.GATE_FAILED, "test", false);

    const abortAction = actions.find((a) => a.action === "abort_run");
    expect(abortAction).toBeDefined();
    expect(abortAction!.requiresLLMDecision).toBe(false);
  });

  it("should include check_credentials for AUTH_FAILED", () => {
    const actions = buildRecommendedActions(FailureErrorCode.AUTH_FAILED, "test", false);

    const checkCredsAction = actions.find((a) => a.action === "check_credentials");
    expect(checkCredsAction).toBeDefined();
  });

  it("should include fix_config for CONFIG_ERROR", () => {
    const actions = buildRecommendedActions(FailureErrorCode.CONFIG_ERROR, "test", false);

    const fixConfigAction = actions.find((a) => a.action === "fix_config");
    expect(fixConfigAction).toBeDefined();
    expect(fixConfigAction!.requiresLLMDecision).toBe(true);
  });

  it("should include resolve_conflict for CONFLICT_DETECTED", () => {
    const actions = buildRecommendedActions(FailureErrorCode.CONFLICT_DETECTED, "test", false);

    const resolveAction = actions.find((a) => a.action === "resolve_conflict");
    expect(resolveAction).toBeDefined();
    expect(resolveAction!.requiresLLMDecision).toBe(true);
    expect(resolveAction!.riskLevel).toBe("medium");
  });
});

describe("wrapGateFailure", () => {
  it("should wrap a gate failure in FailureHandlingPayload", () => {
    const gateResult: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 5000,
      stdout: "",
      stderr: "npm test exited with code 1",
      artifacts: [],
      attempts: 1,
    };

    const payload = wrapGateFailure(gateResult);

    expect(payload.error.code).toBe(FailureErrorCode.GATE_FAILED);
    expect(payload.error.message).toContain('Gate "test" failed');
    expect(payload.error.retryable).toBe(false);
    expect(payload.error.hint).toBeDefined();
    expect(payload.recommendedActions.length).toBeGreaterThan(0);
    expect(payload.failureRecordSchema).toBeDefined();
  });

  it("should classify timeout failures correctly", () => {
    const gateResult: GateResult = {
      gate: "build",
      status: "fail",
      exitCode: 1,
      duration: 60000,
      stdout: "",
      stderr: "Command timed out after 60s",
      artifacts: [],
      attempts: 1,
    };

    const payload = wrapGateFailure(gateResult);

    expect(payload.error.code).toBe(FailureErrorCode.GATE_TIMEOUT);
    expect(payload.error.retryable).toBe(true);

    // Should have retry actions
    const retryAction = payload.recommendedActions.find((a) => a.action === "retry_gate");
    expect(retryAction).toBeDefined();
  });

  it("should mark flaky gates as retryable when specified", () => {
    const gateResult: GateResult = {
      gate: "e2e",
      status: "fail",
      exitCode: 1,
      stdout: "",
      stderr: "Test assertion failed",
      artifacts: [],
      attempts: 1,
    };

    const payload = wrapGateFailure(gateResult, { isFlaky: true });

    expect(payload.error.code).toBe(FailureErrorCode.GATE_FLAKY);
    expect(payload.error.retryable).toBe(true);
  });

  it("should include runId in hint when provided", () => {
    const gateResult: GateResult = {
      gate: "lint",
      status: "fail",
      exitCode: 1,
      stderr: "ESLint errors found",
      artifacts: [],
      attempts: 1,
    };

    const payload = wrapGateFailure(gateResult, {
      runId: "01HXYZ123456789012345",
    });

    expect(payload.error.hint).toContain(".lexrunner/runs/01HXYZ123456789012345");
  });
});

describe("toNextOptions", () => {
  it("should convert recommendedActions to NextOptions format", () => {
    const gateResult: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      stderr: "Test failed",
      artifacts: [],
      attempts: 1,
    };

    const payload = wrapGateFailure(gateResult);
    const nextOptions = toNextOptions(payload);

    expect(nextOptions.length).toBe(payload.recommendedActions.length);

    for (const option of nextOptions) {
      expect(option.action).toBeDefined();
      expect(option.description).toBeDefined();
    }
  });
});

describe("logGateFailure and getGateFailures", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "failures-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should log a failure to failures.ndjson", async () => {
    const runId = "01HXYZ123456789012345";

    // Ensure run directory exists
    ensureRunDir(runId, testDir);

    const gateResult: GateResult = {
      gate: "test",
      status: "fail",
      exitCode: 1,
      duration: 5000,
      stderr: "Test failed",
      artifacts: [],
      attempts: 1,
    };

    const record = logGateFailure(runId, gateResult, {}, testDir);

    expect(record.runId).toBe(runId);
    expect(record.gate).toBe("test");
    expect(record.error.code).toBe(FailureErrorCode.GATE_FAILED);
    expect(record.retryable).toBe(false);
    expect(record.timestamp).toBeDefined();
  });

  it("should include actionTaken and rationale when provided", async () => {
    const runId = "01HXYZ123456789012346";
    ensureRunDir(runId, testDir);

    const gateResult: GateResult = {
      gate: "lint",
      status: "fail",
      exitCode: 1,
      stderr: "ESLint errors",
      artifacts: [],
      attempts: 1,
    };

    const record = logGateFailure(
      runId,
      gateResult,
      {
        actionTaken: "skip_gate",
        rationale: "Known flaky test - tracked in issue #123",
      },
      testDir
    );

    expect(record.actionTaken).toBe("skip_gate");
    expect(record.rationale).toBe("Known flaky test - tracked in issue #123");
  });

  it("should retrieve logged failures with getGateFailures", async () => {
    const runId = "01HXYZ123456789012347";
    ensureRunDir(runId, testDir);

    // Log multiple failures
    logGateFailure(
      runId,
      {
        gate: "lint",
        status: "fail",
        exitCode: 1,
        stderr: "ESLint errors",
        artifacts: [],
        attempts: 1,
      },
      {},
      testDir
    );

    logGateFailure(
      runId,
      {
        gate: "test",
        status: "fail",
        exitCode: 1,
        stderr: "Test failed",
        artifacts: [],
        attempts: 1,
      },
      {},
      testDir
    );

    const failures = getGateFailures(runId, testDir);

    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.gate).sort()).toEqual(["lint", "test"]);
  });

  it("should return empty array when no failures exist", async () => {
    const runId = "01HXYZ123456789012348";
    ensureRunDir(runId, testDir);

    const failures = getGateFailures(runId, testDir);

    expect(failures).toEqual([]);
  });

  it("should handle mixed failures and violations", async () => {
    const runId = "01HXYZ123456789012349";
    ensureRunDir(runId, testDir);

    // Log a gate failure
    logGateFailure(
      runId,
      {
        gate: "test",
        status: "fail",
        exitCode: 1,
        stderr: "Test failed",
        artifacts: [],
        attempts: 1,
      },
      {},
      testDir
    );

    // Log a violation (using enforcement module's format)
    // This simulates the case where violations and failures share the same log file
    const { appendToRunLog } = await import("../../src/runs/storage.js");
    appendToRunLog(
      runId,
      "failures",
      {
        timestamp: new Date().toISOString(),
        runId,
        violation: "DIRECT_MERGE",
        command: "git merge",
        severity: "warning",
      },
      testDir
    );

    // getGateFailures should only return gate failures, not violations
    const failures = getGateFailures(runId, testDir);

    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("test");
  });
});

describe("Error Type Coverage", () => {
  const testCases = [
    {
      name: "GATE_TIMEOUT - explicit timeout message",
      stderr: "Error: Gate exceeded time limit",
      expectedCode: FailureErrorCode.GATE_TIMEOUT,
      retryable: true,
    },
    {
      name: "GATE_FLAKY - marked as flaky",
      stderr: "Test randomly failed",
      isFlaky: true,
      expectedCode: FailureErrorCode.GATE_FLAKY,
      retryable: true,
    },
    {
      name: "NETWORK_ERROR - network connectivity issue",
      stderr: "Error: network unreachable",
      expectedCode: FailureErrorCode.NETWORK_ERROR,
      retryable: true,
    },
    {
      name: "RATE_LIMITED - too many requests",
      stderr: "Error: Too many requests to API",
      expectedCode: FailureErrorCode.RATE_LIMITED,
      retryable: true,
    },
    {
      name: "GATE_FAILED - general test failure",
      stderr: "npm test exited with code 1",
      expectedCode: FailureErrorCode.GATE_FAILED,
      retryable: false,
    },
    {
      name: "AUTH_FAILED - authentication error",
      stderr: "Error: Authentication failed",
      expectedCode: FailureErrorCode.AUTH_FAILED,
      retryable: false,
    },
    {
      name: "CONFIG_ERROR - configuration issue",
      stderr: "Error: Invalid option in tsconfig",
      expectedCode: FailureErrorCode.CONFIG_ERROR,
      retryable: false,
    },
    {
      name: "CONFLICT_DETECTED - merge conflict",
      stderr: "CONFLICT: merge conflict in file.ts",
      expectedCode: FailureErrorCode.CONFLICT_DETECTED,
      retryable: false,
    },
    {
      name: "VALIDATION_ERROR - schema validation",
      stderr: "Schema validation failed: missing required field",
      expectedCode: FailureErrorCode.VALIDATION_ERROR,
      retryable: false,
    },
  ];

  for (const testCase of testCases) {
    it(`should correctly classify ${testCase.name}`, () => {
      const gateResult: GateResult = {
        gate: "test-gate",
        status: "fail",
        exitCode: 1,
        stderr: testCase.stderr,
        artifacts: [],
        attempts: 1,
      };

      const payload = wrapGateFailure(gateResult, {
        isFlaky: testCase.isFlaky,
      });

      expect(payload.error.code).toBe(testCase.expectedCode);
      expect(payload.error.retryable).toBe(testCase.retryable);
    });
  }
});
