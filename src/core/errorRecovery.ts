/**
 * Error Recovery and Resilience Framework
 *
 * Implements:
 * - Error classification (transient vs permanent)
 * - Exponential backoff retry mechanism
 * - Circuit breaker pattern for external services
 * - Graceful degradation strategies
 * - Detailed error diagnostics and recovery guidance
 */

/**
 * Error classification types
 */
export enum ErrorType {
  /** Transient errors that may succeed on retry (network, rate limits, temporary service outages) */
  Transient = "transient",
  /** Permanent errors that won't succeed on retry (validation, auth, not found) */
  Permanent = "permanent",
  /** Unknown error classification */
  Unknown = "unknown",
}

/**
 * Error severity levels for prioritization and alerting
 */
export enum ErrorSeverity {
  /** Critical errors that prevent operation continuation */
  Critical = "critical",
  /** High severity errors that impact functionality */
  High = "high",
  /** Medium severity errors with workarounds available */
  Medium = "medium",
  /** Low severity errors or warnings */
  Low = "low",
}

/**
 * Classified error with context and recovery information
 */
export interface ClassifiedError {
  /** Original error */
  error: Error;
  /** Error classification type */
  type: ErrorType;
  /** Severity level */
  severity: ErrorSeverity;
  /** Human-readable context */
  context: string;
  /** Suggested recovery actions */
  recoveryActions: string[];
  /** Whether this error is retryable */
  retryable: boolean;
  /** Error code for automation */
  code: string;
  /** Metadata for diagnostics */
  metadata?: Record<string, any>;
}

/**
 * Retry configuration with exponential backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier: number;
  /** Whether to add random jitter to prevent thundering herd */
  jitter: boolean;
  /** Timeout for each attempt in milliseconds */
  timeoutMs?: number;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Circuit is closed, requests flow normally */
  Closed = "closed",
  /** Circuit is open, requests fail fast */
  Open = "open",
  /** Circuit is half-open, testing if service recovered */
  HalfOpen = "half-open",
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /** Failure threshold before opening circuit */
  failureThreshold: number;
  /** Success threshold in half-open state to close circuit */
  successThreshold: number;
  /** Time to wait before attempting half-open in milliseconds */
  resetTimeoutMs: number;
  /** Rolling window for failure tracking in milliseconds */
  rollingWindowMs: number;
}

/**
 * Circuit breaker for external service calls
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime?: number;
  private failureTimestamps: number[] = [];
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 2,
      resetTimeoutMs: options.resetTimeoutMs ?? 60000,
      rollingWindowMs: options.rollingWindowMs ?? 120000,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition to half-open
    if (this.state === CircuitState.Open && this.shouldAttemptReset()) {
      this.state = CircuitState.HalfOpen;
      this.successes = 0;
    }

    // Fail fast if circuit is open
    if (this.state === CircuitState.Open) {
      throw new Error(
        `Circuit breaker is OPEN. Service unavailable. Will retry after ${this.getTimeUntilReset()}ms`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record successful execution
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HalfOpen) {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = CircuitState.Closed;
        this.successes = 0;
        this.failureTimestamps = [];
      }
    }
  }

  /**
   * Record failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failureTimestamps.push(now);

    // Clean old failures outside rolling window
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp < this.options.rollingWindowMs
    );

    this.failures = this.failureTimestamps.length;

    if (this.state === CircuitState.HalfOpen) {
      this.state = CircuitState.Open;
      this.successes = 0;
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.Open;
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs;
  }

  /**
   * Get time until circuit can attempt reset
   */
  private getTimeUntilReset(): number {
    if (!this.lastFailureTime) return 0;
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.options.resetTimeoutMs - elapsed);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker (for testing or manual intervention)
   */
  reset(): void {
    this.state = CircuitState.Closed;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.failureTimestamps = [];
  }
}

/**
 * Classify error based on type and context
 */
export function classifyError(error: unknown, context: string = ""): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const errorMessage = err.message.toLowerCase();

  // GitHub rate limit errors
  if (err.name === "GitHubRateLimitError" || errorMessage.includes("rate limit")) {
    return {
      error: err,
      type: ErrorType.Transient,
      severity: ErrorSeverity.Medium,
      context: context || "GitHub API rate limit exceeded",
      recoveryActions: [
        "Wait for rate limit reset",
        "Use authenticated requests for higher limits",
        "Implement request caching",
      ],
      retryable: true,
      code: "GITHUB_RATE_LIMIT",
      metadata: { errorName: err.name },
    };
  }

  // Network errors
  if (
    errorMessage.includes("network") ||
    errorMessage.includes("econnrefused") ||
    errorMessage.includes("enotfound") ||
    errorMessage.includes("etimedout") ||
    errorMessage.includes("fetch failed")
  ) {
    return {
      error: err,
      type: ErrorType.Transient,
      severity: ErrorSeverity.High,
      context: context || "Network connectivity issue",
      recoveryActions: [
        "Check network connection",
        "Verify service endpoint is accessible",
        "Wait and retry with exponential backoff",
      ],
      retryable: true,
      code: "NETWORK_ERROR",
      metadata: { errorName: err.name },
    };
  }

  // Authentication errors
  if (
    err.name === "GitHubAuthError" ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("authentication")
  ) {
    return {
      error: err,
      type: ErrorType.Permanent,
      severity: ErrorSeverity.Critical,
      context: context || "Authentication failed",
      recoveryActions: [
        "Verify GITHUB_TOKEN environment variable is set",
        "Check token has required permissions",
        "Generate a new token if expired",
      ],
      retryable: false,
      code: "AUTH_ERROR",
      metadata: { errorName: err.name },
    };
  }

  // Validation errors
  if (
    err.name === "SchemaValidationError" ||
    err.name === "CycleError" ||
    err.name === "UnknownDependencyError"
  ) {
    return {
      error: err,
      type: ErrorType.Permanent,
      severity: ErrorSeverity.Medium,
      context: context || "Configuration validation failed",
      recoveryActions: [
        "Fix configuration errors in plan.json or stack.yml",
        "Validate schema using: lex-pr schema validate",
        "Check documentation for correct format",
      ],
      retryable: false,
      code: "VALIDATION_ERROR",
      metadata: { errorName: err.name },
    };
  }

  // Timeout errors
  if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
    return {
      error: err,
      type: ErrorType.Transient,
      severity: ErrorSeverity.Medium,
      context: context || "Operation timed out",
      recoveryActions: [
        "Increase timeout value",
        "Check if operation is too resource intensive",
        "Retry with exponential backoff",
      ],
      retryable: true,
      code: "TIMEOUT_ERROR",
      metadata: { errorName: err.name },
    };
  }

  // Service unavailable
  if (
    errorMessage.includes("503") ||
    errorMessage.includes("service unavailable") ||
    errorMessage.includes("502") ||
    errorMessage.includes("bad gateway")
  ) {
    return {
      error: err,
      type: ErrorType.Transient,
      severity: ErrorSeverity.High,
      context: context || "Service temporarily unavailable",
      recoveryActions: [
        "Wait for service to recover",
        "Check service status page",
        "Retry with exponential backoff",
      ],
      retryable: true,
      code: "SERVICE_UNAVAILABLE",
      metadata: { errorName: err.name },
    };
  }

  // Default classification for unknown errors
  return {
    error: err,
    type: ErrorType.Unknown,
    severity: ErrorSeverity.High,
    context: context || "Unknown error occurred",
    recoveryActions: [
      "Check error message for details",
      "Review logs for additional context",
      "Contact support if issue persists",
    ],
    retryable: false,
    code: "UNKNOWN_ERROR",
    metadata: { errorName: err.name, message: err.message },
  };
}

/**
 * Execute function with exponential backoff retry
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  onRetry?: (attempt: number, error: ClassifiedError, delayMs: number) => void
): Promise<T> {
  const config: RetryOptions = {
    maxAttempts: options.maxAttempts ?? 3,
    initialDelayMs: options.initialDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 30000,
    backoffMultiplier: options.backoffMultiplier ?? 2,
    jitter: options.jitter ?? true,
    timeoutMs: options.timeoutMs,
  };

  let lastError: ClassifiedError | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // Apply timeout if specified
      if (config.timeoutMs) {
        return await withTimeout(fn(), config.timeoutMs);
      }
      return await fn();
    } catch (error) {
      const classified = classifyError(error, `Attempt ${attempt}/${config.maxAttempts}`);
      lastError = classified;

      // Don't retry permanent errors
      if (classified.type === ErrorType.Permanent || !classified.retryable) {
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt >= config.maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
      const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
      const jitter = config.jitter ? Math.random() * cappedDelay * 0.1 : 0;
      const delayMs = Math.floor(cappedDelay + jitter);

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, classified, delayMs);
      }

      // Wait before next attempt
      await delay(delayMs);
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw lastError?.error ?? new Error("Retry failed");
}

/**
 * Execute function with timeout
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format error for user-friendly display
 */
export function formatErrorForUser(classified: ClassifiedError): string {
  const lines: string[] = [];

  lines.push(`❌ ${classified.context}`);
  lines.push("");
  lines.push(`Error: ${classified.error.message}`);
  lines.push(`Type: ${classified.type} (${classified.retryable ? "retryable" : "not retryable"})`);
  lines.push(`Severity: ${classified.severity}`);

  if (classified.recoveryActions.length > 0) {
    lines.push("");
    lines.push("💡 Recovery Actions:");
    classified.recoveryActions.forEach((action) => {
      lines.push(`  • ${action}`);
    });
  }

  if (classified.metadata) {
    lines.push("");
    lines.push("📊 Additional Details:");
    Object.entries(classified.metadata).forEach(([key, value]) => {
      lines.push(`  ${key}: ${value}`);
    });
  }

  return lines.join("\n");
}

/**
 * Create a circuit breaker for GitHub API calls
 */
export function createGitHubCircuitBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeoutMs: 60000, // 1 minute
    rollingWindowMs: 120000, // 2 minutes
  });
}

/**
 * Create a circuit breaker for network operations
 */
export function createNetworkCircuitBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 30000, // 30 seconds
    rollingWindowMs: 60000, // 1 minute
  });
}
