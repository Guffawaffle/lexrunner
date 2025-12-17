/**
 * Tool Budget Enforcement Module
 *
 * Implements runtime enforcement of tool budgets as defined in executor manifests.
 * Checks:
 * - Tool allowed/denied lists
 * - Maximum tool call limits
 * - Maximum token output limits
 *
 * @module executors/toolBudget
 * @see schemas/executorManifest.ts for ToolBudget schema
 */

import {
	toolBudgetExceededError,
	type AXError,
} from "../errors/index.js";
import type { ToolBudget } from "../schemas/executorManifest.js";

// =============================================================================
// ToolBudgetEnforcer Class
// =============================================================================

/**
 * Runtime tracker for tool budget enforcement
 */
export interface ToolBudgetState {
	/** Total number of tool calls made */
	totalCalls: number;
	/** Total tokens output so far */
	totalTokensOut: number;
}

/**
 * Enforces tool budget constraints at runtime
 *
 * @example
 * ```typescript
 * const budget: ToolBudget = {
 *   allowed: ["grep_search", "read_file"],
 *   denied: ["run_in_terminal"],
 *   limits: { maxToolCalls: 20, maxTokensOut: 2000 }
 * };
 *
 * const enforcer = new ToolBudgetEnforcer(budget);
 *
 * // Before each tool call:
 * const result = enforcer.checkToolCall("grep_search", 100);
 * if (!result.allowed) {
 *   throw new Error(result.error.message);
 * }
 *
 * // After successful call:
 * enforcer.recordToolCall("grep_search", 100);
 * ```
 */
export class ToolBudgetEnforcer {
	private budget: ToolBudget;
	private state: ToolBudgetState;

	constructor(budget: ToolBudget) {
		this.budget = budget;
		this.state = {
			totalCalls: 0,
			totalTokensOut: 0,
		};
	}

	/**
	 * Check if a tool call is allowed before execution
	 *
	 * @param toolName - Name of the tool to check
	 * @param estimatedTokensOut - Estimated token output (optional)
	 * @returns Result indicating if call is allowed and error if not
	 */
	checkToolCall(
		toolName: string,
		estimatedTokensOut = 0
	): { allowed: true } | { allowed: false; error: AXError } {
		// Check denied list first
		if (this.budget.denied.includes(toolName)) {
			return {
				allowed: false,
				error: toolBudgetExceededError(
					`Tool '${toolName}' is denied by executor budget`,
					{
						tool: toolName,
						violation: "tool_denied",
						denied: this.budget.denied,
					}
				),
			};
		}

		// Check allowed list (if not empty, tool must be in it)
		if (
			this.budget.allowed.length > 0 &&
			!this.budget.allowed.includes(toolName)
		) {
			return {
				allowed: false,
				error: toolBudgetExceededError(
					`Tool '${toolName}' is not in the allowed tool list`,
					{
						tool: toolName,
						violation: "tool_not_allowed",
						allowed: this.budget.allowed,
					}
				),
			};
		}

		// Check maxToolCalls limit
		if (this.budget.limits?.maxToolCalls !== undefined) {
			const nextCallCount = this.state.totalCalls + 1;
			if (nextCallCount > this.budget.limits.maxToolCalls) {
				return {
					allowed: false,
					error: toolBudgetExceededError(
						`Maximum tool calls limit (${this.budget.limits.maxToolCalls}) exceeded`,
						{
							tool: toolName,
							violation: "max_calls_exceeded",
							limit: this.budget.limits.maxToolCalls,
							current: nextCallCount,
						}
					),
				};
			}
		}

		// Check maxTokensOut limit
		if (
			this.budget.limits?.maxTokensOut !== undefined &&
			estimatedTokensOut > 0
		) {
			const nextTokenCount =
				this.state.totalTokensOut + estimatedTokensOut;
			if (nextTokenCount > this.budget.limits.maxTokensOut) {
				return {
					allowed: false,
					error: toolBudgetExceededError(
						`Maximum token output limit (${this.budget.limits.maxTokensOut}) would be exceeded`,
						{
							tool: toolName,
							violation: "max_tokens_exceeded",
							limit: this.budget.limits.maxTokensOut,
							current: nextTokenCount,
						}
					),
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Record a successful tool call
	 *
	 * @param toolName - Name of the tool that was called
	 * @param tokensOut - Actual tokens output (optional)
	 */
	recordToolCall(toolName: string, tokensOut = 0): void {
		this.state.totalCalls += 1;
		this.state.totalTokensOut += tokensOut;
	}

	/**
	 * Get current budget state
	 */
	getState(): Readonly<ToolBudgetState> {
		return { ...this.state };
	}

	/**
	 * Get the tool budget configuration
	 */
	getBudget(): Readonly<ToolBudget> {
		return {
			allowed: [...this.budget.allowed],
			denied: [...this.budget.denied],
			limits: this.budget.limits
				? { ...this.budget.limits }
				: undefined,
		};
	}

	/**
	 * Reset the budget state (useful for testing or new sessions)
	 */
	reset(): void {
		this.state = {
			totalCalls: 0,
			totalTokensOut: 0,
		};
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a ToolBudgetEnforcer from a ToolBudget configuration
 *
 * @param budget - Tool budget configuration
 * @returns New ToolBudgetEnforcer instance
 */
export function createToolBudgetEnforcer(
	budget: ToolBudget
): ToolBudgetEnforcer {
	return new ToolBudgetEnforcer(budget);
}
