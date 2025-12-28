import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ErrorType,
  ErrorSeverity,
  CircuitState,
  CircuitBreaker,
  classifyError,
  retryWithBackoff,
  formatErrorForUser,
  createGitHubCircuitBreaker,
  createNetworkCircuitBreaker,
} from "../src/core/errorRecovery";

describe("Error Classification", () => {
  it("should classify GitHub rate limit errors as transient", () => {
    const error = new Error("API rate limit exceeded");
    error.name = "GitHubRateLimitError";

    const classified = classifyError(error, "GitHub API call");

    expect(classified.type).toBe(ErrorType.Transient);
    expect(classified.severity).toBe(ErrorSeverity.Medium);
    expect(classified.retryable).toBe(true);
    expect(classified.code).toBe("GITHUB_RATE_LIMIT");
    expect(classified.recoveryActions).toContain("Wait for rate limit reset");
  });

  it("should classify network errors as transient", () => {
    const error = new Error("fetch failed: ECONNREFUSED");

    const classified = classifyError(error, "Network request");

    expect(classified.type).toBe(ErrorType.Transient);
    expect(classified.severity).toBe(ErrorSeverity.High);
    expect(classified.retryable).toBe(true);
    expect(classified.code).toBe("NETWORK_ERROR");
  });

  it("should classify authentication errors as permanent", () => {
    const error = new Error("Unauthorized: Invalid token");
    error.name = "GitHubAuthError";

    const classified = classifyError(error, "API authentication");

    expect(classified.type).toBe(ErrorType.Permanent);
    expect(classified.severity).toBe(ErrorSeverity.Critical);
    expect(classified.retryable).toBe(false);
    expect(classified.code).toBe("AUTH_ERROR");
    expect(classified.recoveryActions).toContain("Verify GITHUB_TOKEN environment variable is set");
  });

  it("should classify validation errors as permanent", () => {
    const error = new Error("Schema validation failed");
    error.name = "SchemaValidationError";

    const classified = classifyError(error, "Plan validation");

    expect(classified.type).toBe(ErrorType.Permanent);
    expect(classified.retryable).toBe(false);
    expect(classified.code).toBe("VALIDATION_ERROR");
  });

  it("should classify timeout errors as transient", () => {
    const error = new Error("Operation timed out after 30000ms");

    const classified = classifyError(error, "Gate execution");

    expect(classified.type).toBe(ErrorType.Transient);
    expect(classified.retryable).toBe(true);
    expect(classified.code).toBe("TIMEOUT_ERROR");
  });

  it("should classify service unavailable errors as transient", () => {
    const error = new Error("Service unavailable: 503");

    const classified = classifyError(error, "External service");

    expect(classified.type).toBe(ErrorType.Transient);
    expect(classified.retryable).toBe(true);
    expect(classified.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("should classify unknown errors appropriately", () => {
    const error = new Error("Some weird error");

    const classified = classifyError(error);

    expect(classified.type).toBe(ErrorType.Unknown);
    expect(classified.severity).toBe(ErrorSeverity.High);
    expect(classified.retryable).toBe(false);
    expect(classified.code).toBe("UNKNOWN_ERROR");
  });
});

describe("Circuit Breaker", () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeoutMs: 100,
      rollingWindowMs: 200,
    });
  });

  it("should start in closed state", () => {
    expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
  });

  it("should open circuit after failure threshold", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Fail 3 times to reach threshold
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    expect(circuitBreaker.getState()).toBe(CircuitState.Open);
  });

  it("should fail fast when circuit is open", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    // Next call should fail immediately
    const startTime = Date.now();
    try {
      await circuitBreaker.execute(failingFn);
      expect.fail("Should have thrown");
    } catch (error) {
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(50); // Should fail fast
      expect((error as Error).message).toContain("Circuit breaker is OPEN");
    }
  });

  it("should transition to half-open after reset timeout", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    expect(circuitBreaker.getState()).toBe(CircuitState.Open);

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next call should transition to half-open
    const successFn = async () => "success";
    const result = await circuitBreaker.execute(successFn);

    expect(result).toBe("success");
    expect(circuitBreaker.getState()).toBe(CircuitState.HalfOpen);
  });

  it("should close circuit after success threshold in half-open", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Succeed enough times to close circuit
    const successFn = async () => "success";
    await circuitBreaker.execute(successFn);
    await circuitBreaker.execute(successFn);

    expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
  });

  it("should reopen circuit on failure in half-open state", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Fail in half-open state
    try {
      await circuitBreaker.execute(failingFn);
    } catch (e) {
      // Expected
    }

    expect(circuitBreaker.getState()).toBe(CircuitState.Open);
  });

  it("should reset circuit breaker", async () => {
    const failingFn = async () => {
      throw new Error("Service error");
    };

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }
    }

    expect(circuitBreaker.getState()).toBe(CircuitState.Open);

    circuitBreaker.reset();

    expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
  });
});

describe("Retry with Exponential Backoff", () => {
  it("should succeed on first attempt if no error", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const result = await retryWithBackoff(fn, { maxAttempts: 3 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry transient errors with exponential backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    const result = await retryWithBackoff(
      fn,
      {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitter: false,
      },
      onRetry
    );

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);

    // Check exponential backoff delays
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Object), 10);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Object), 20);
  });

  it("should not retry permanent errors", async () => {
    const error = new Error("Validation failed");
    error.name = "SchemaValidationError";
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retryWithBackoff(fn, { maxAttempts: 3 })).rejects.toThrow("Validation failed");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should respect max delay cap", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("success");

    const onRetry = vi.fn();

    await retryWithBackoff(
      fn,
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 1500,
        backoffMultiplier: 3,
        jitter: false,
      },
      onRetry
    );

    // Second retry would be 3000ms but capped at 1500ms
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Object), 1500);
  });

  it("should throw after max attempts exceeded", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 10,
      })
    ).rejects.toThrow("Network error");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should apply timeout if specified", async () => {
    const fn = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("success"), 200))
      );

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 1,
        timeoutMs: 50,
      })
    ).rejects.toThrow("Operation timed out");
  });
});

describe("Error Formatting", () => {
  it("should format error for user display", () => {
    const error = new Error("API rate limit exceeded");
    const classified = classifyError(error, "GitHub API call");

    const formatted = formatErrorForUser(classified);

    expect(formatted).toContain("❌");
    expect(formatted).toContain("GitHub API call");
    expect(formatted).toContain("API rate limit exceeded");
    expect(formatted).toContain("transient");
    expect(formatted).toContain("retryable");
    expect(formatted).toContain("💡 Recovery Actions:");
    expect(formatted).toContain("Wait for rate limit reset");
  });

  it("should include metadata in formatted output", () => {
    const error = new Error("Test error");
    error.name = "TestError";
    const classified = classifyError(error);

    const formatted = formatErrorForUser(classified);

    expect(formatted).toContain("📊 Additional Details:");
    expect(formatted).toContain("errorName: TestError");
  });
});

describe("Circuit Breaker Factory Functions", () => {
  it("should create GitHub circuit breaker with appropriate settings", () => {
    const breaker = createGitHubCircuitBreaker();
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });

  it("should create network circuit breaker with appropriate settings", () => {
    const breaker = createNetworkCircuitBreaker();
    expect(breaker.getState()).toBe(CircuitState.Closed);
  });
});

describe("Error Recovery Integration", () => {
  it("should use retry mechanism for transient errors", async () => {
    let callCount = 0;
    const unstableService = async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Network timeout");
      }
      return "success";
    };

    // Retry should handle transient errors
    const result = await retryWithBackoff(unstableService, {
      maxAttempts: 5,
      initialDelayMs: 10,
      jitter: false,
    });

    expect(result).toBe("success");
    expect(callCount).toBe(3);
  });

  it("should use circuit breaker to prevent cascading failures", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      resetTimeoutMs: 50,
      rollingWindowMs: 100,
    });

    const alwaysFailingService = async () => {
      throw new Error("Service down");
    };

    // Fail enough times to open circuit
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(alwaysFailingService);
      } catch (e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe(CircuitState.Open);

    // Circuit should now fail fast
    try {
      await breaker.execute(alwaysFailingService);
      expect.fail("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Circuit breaker is OPEN");
    }
  });
});
