/**
 * Budget tracking module for token and prompt limits.
 * Enforces hard limits and provides spend summaries.
 */

export interface BudgetConfig {
  tokenBudget: number;
  maxPrompts: number;
}

export interface BudgetSpend {
  prompts: number;
  tokens_estimated: number;
}

export interface BudgetSummary extends BudgetSpend {
  tokenBudget: number;
  maxPrompts: number;
  tokenBudgetExceeded: boolean;
  promptBudgetExceeded: boolean;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly type: "token" | "prompt",
    public readonly current: number,
    public readonly limit: number
  ) {
    super(`Budget exceeded: ${type} limit (${current}/${limit})`);
    this.name = "BudgetExceededError";
  }
}

/**
 * BudgetTracker enforces token and prompt limits with hard stops.
 */
export class BudgetTracker {
  private prompts = 0;
  private tokensEstimated = 0;
  private readonly config: BudgetConfig;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Estimate tokens for a given text.
   * Uses a simple heuristic: ~4 chars per token (GPT approximation).
   */
  private estimateTokens(text: string): number {
    // Simple estimation: 4 characters per token
    // This is a rough approximation used by many tools
    return Math.ceil(text.length / 4);
  }

  /**
   * Record a prompt with estimated tokens.
   * @throws BudgetExceededError if limit is exceeded
   */
  recordPrompt(promptText: string): void {
    // Increment prompt count
    this.prompts++;

    // Check prompt limit first
    if (this.prompts > this.config.maxPrompts) {
      throw new BudgetExceededError("prompt", this.prompts, this.config.maxPrompts);
    }

    // Estimate and add tokens
    const estimatedTokens = this.estimateTokens(promptText);
    this.tokensEstimated += estimatedTokens;

    // Check token limit
    if (this.tokensEstimated > this.config.tokenBudget) {
      throw new BudgetExceededError("token", this.tokensEstimated, this.config.tokenBudget);
    }
  }

  /**
   * Get current spend without exceeding limits.
   */
  getSpend(): BudgetSpend {
    return {
      prompts: this.prompts,
      tokens_estimated: this.tokensEstimated,
    };
  }

  /**
   * Get full budget summary including limits and exceeded status.
   */
  getSummary(): BudgetSummary {
    return {
      prompts: this.prompts,
      tokens_estimated: this.tokensEstimated,
      tokenBudget: this.config.tokenBudget,
      maxPrompts: this.config.maxPrompts,
      tokenBudgetExceeded: this.tokensEstimated > this.config.tokenBudget,
      promptBudgetExceeded: this.prompts > this.config.maxPrompts,
    };
  }

  /**
   * Check if we can proceed with another operation.
   * @throws BudgetExceededError if limit would be exceeded
   */
  checkBudget(estimatedPromptText: string = ""): void {
    // Check if we've already exceeded
    if (this.prompts >= this.config.maxPrompts) {
      throw new BudgetExceededError("prompt", this.prompts + 1, this.config.maxPrompts);
    }

    // Estimate next operation's tokens if text provided
    if (estimatedPromptText) {
      const nextTokens = this.estimateTokens(estimatedPromptText);
      if (this.tokensEstimated + nextTokens > this.config.tokenBudget) {
        throw new BudgetExceededError(
          "token",
          this.tokensEstimated + nextTokens,
          this.config.tokenBudget
        );
      }
    }
  }

  /**
   * Format spend summary for human-readable output.
   */
  formatHuman(): string {
    const summary = this.getSummary();
    const lines = [
      "",
      "=== Budget Summary ===",
      `Prompts: ${summary.prompts}/${summary.maxPrompts}${summary.promptBudgetExceeded ? " (EXCEEDED)" : ""}`,
      `Tokens (estimated): ${summary.tokens_estimated}/${summary.tokenBudget}${summary.tokenBudgetExceeded ? " (EXCEEDED)" : ""}`,
      "",
    ];
    return lines.join("\n");
  }

  /**
   * Get spend for JSON output.
   */
  formatJSON(): BudgetSpend {
    return this.getSpend();
  }
}

/**
 * Default budget configuration.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  tokenBudget: 5000,
  maxPrompts: 3,
};
