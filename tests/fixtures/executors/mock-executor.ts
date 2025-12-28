/**
 * Mock Executor for Testing
 *
 * This mock executor implements the full lifecycle for testing purposes.
 * It simulates the executor interface defined in the placeholder types.
 */

import type {
  Executor,
  ExecutorContext,
  ExecutorResult,
  Receipt,
  Artifact,
  ModelCallFunction,
  Frame,
} from "./types.js";

export class MockExecutor implements Executor {
  id = "mock-executor";
  name = "Mock Executor";

  private budgetLimit: number = 1000;
  private shouldFailOnBudget: boolean = false;
  private shouldFailOnGuardrail: boolean = false;
  private shouldFailOnMissingFrame: boolean = false;

  /**
   * Configure mock behavior for testing error scenarios
   */
  configure(options: {
    budgetLimit?: number;
    failOnBudget?: boolean;
    failOnGuardrail?: boolean;
    failOnMissingFrame?: boolean;
  }) {
    if (options.budgetLimit !== undefined) this.budgetLimit = options.budgetLimit;
    if (options.failOnBudget !== undefined) this.shouldFailOnBudget = options.failOnBudget;
    if (options.failOnGuardrail !== undefined) this.shouldFailOnGuardrail = options.failOnGuardrail;
    if (options.failOnMissingFrame !== undefined)
      this.shouldFailOnMissingFrame = options.failOnMissingFrame;
  }

  /**
   * Reset mock to default configuration
   */
  reset() {
    this.budgetLimit = 1000;
    this.shouldFailOnBudget = false;
    this.shouldFailOnGuardrail = false;
    this.shouldFailOnMissingFrame = false;
  }

  /**
   * Phase 1: Prep - Load context and prepare execution environment
   */
  async prep(input: any): Promise<ExecutorContext> {
    // Check for missing required input
    if (!input.taskId) {
      throw new Error("Missing required field: taskId");
    }

    // Create a basic frame
    const frames: Frame[] = [
      {
        id: "frame-1",
        type: "context",
        content: { task: input.taskId },
        timestamp: new Date().toISOString(),
      },
    ];

    return {
      taskId: input.taskId,
      budget: {
        maxTokens: this.budgetLimit,
        usedTokens: 0,
      },
      frames,
      guardrails: [
        {
          id: "budget-check",
          type: "budget",
          limit: this.budgetLimit,
          current: 0,
        },
      ],
    };
  }

  /**
   * Phase 2: Stochastic - Execute with model call
   */
  async stochastic(
    context: ExecutorContext,
    modelCall: ModelCallFunction
  ): Promise<ExecutorResult> {
    // Test error scenarios
    if (this.shouldFailOnMissingFrame && context.frames.length === 0) {
      return {
        success: false,
        output: null,
        tokensUsed: 0,
        error: "Required frame missing",
      };
    }

    if (this.shouldFailOnGuardrail) {
      return {
        success: false,
        output: null,
        tokensUsed: 50,
        error: "Guardrail violation detected",
        guardrailViolations: ["content-policy-violation"],
      };
    }

    // Simulate model call
    const response = await modelCall({
      prompt: `Execute task: ${context.taskId}`,
      maxTokens: context.budget.maxTokens,
    });

    const tokensUsed = response.tokensUsed;

    // Check budget after model call
    if (this.shouldFailOnBudget || tokensUsed > context.budget.maxTokens) {
      return {
        success: false,
        output: response.content,
        tokensUsed,
        error: "Budget exceeded",
      };
    }

    return {
      success: true,
      output: response.content,
      tokensUsed,
    };
  }

  /**
   * Phase 3: Receipt - Generate execution receipt
   */
  async receipt(result: ExecutorResult): Promise<Receipt> {
    return {
      executorId: this.id,
      status: result.success ? "completed" : "failed",
      timestamp: new Date().toISOString(),
      result,
      artifacts: result.success ? ["output.txt"] : [],
    };
  }

  /**
   * Phase 4: Emit - Publish artifacts
   */
  async emit(receipt: Receipt): Promise<Artifact[]> {
    const artifacts: Artifact[] = [
      {
        type: "receipt",
        path: `receipts/${receipt.executorId}-${Date.now()}.json`,
        content: JSON.stringify(receipt, null, 2),
      },
    ];

    // Add output artifact if successful
    if (receipt.status === "completed" && receipt.result.output) {
      artifacts.push({
        type: "output",
        path: `outputs/${receipt.executorId}-output.txt`,
        content: String(receipt.result.output),
      });
    }

    return artifacts;
  }
}

/**
 * Mock model call function for testing
 */
export function mockModelCall(args: {
  prompt: string;
  maxTokens?: number;
}): Promise<{ content: string; tokensUsed: number }> {
  return Promise.resolve({
    content: `Mock response to: ${args.prompt}`,
    tokensUsed: 50,
  });
}

/**
 * Mock model call that simulates high token usage
 */
export function mockHighTokenModelCall(args: {
  prompt: string;
  maxTokens?: number;
}): Promise<{ content: string; tokensUsed: number }> {
  return Promise.resolve({
    content: `Mock response to: ${args.prompt}`,
    tokensUsed: 2000, // Exceeds typical budget
  });
}
