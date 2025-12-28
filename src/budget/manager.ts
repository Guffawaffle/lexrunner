/**
 * Unified Budget Manager
 *
 * Manages hierarchical budgets with enforcement points at:
 * - Pre-operation check
 * - Post-operation decrement
 * - Exhaustion receipt emission
 *
 * @module budget/manager
 */

import {
  type UnifiedBudget,
  type BudgetScope,
  type BudgetField,
  type BudgetExhaustedReceipt,
  type TierBudgetAllocation,
  BudgetExhaustedReceiptSchema,
  createUnifiedBudget,
  createCustomBudget,
  isBudgetExhausted,
  getExhaustedField,
  TIER_BUDGET_ALLOCATIONS,
} from "./schema.js";
import type { CapabilityTier } from "../tiers/schema.js";

// =============================================================================
// Budget Exceeded Error
// =============================================================================

/**
 * Extended error for budget exhaustion with governance context
 */
export class UnifiedBudgetExceededError extends Error {
  constructor(
    public readonly field: "tokens" | "turns" | "time" | "escalations",
    public readonly current: number,
    public readonly limit: number,
    public readonly budgetId: string,
    public readonly scope: BudgetScope
  ) {
    super(`Budget exhausted: ${field} (${current}/${limit}) in ${scope} budget ${budgetId}`);
    this.name = "UnifiedBudgetExceededError";
  }
}

// =============================================================================
// Spend Request
// =============================================================================

/**
 * Request to spend from a budget
 */
export interface SpendRequest {
  /** Tokens to spend */
  tokens?: number;
  /** Turns to spend (usually 1) */
  turns?: number;
  /** Time spent in milliseconds */
  time?: number;
  /** Escalations to record */
  escalations?: number;
}

// =============================================================================
// Budget Manager
// =============================================================================

/**
 * No-op logger for silent operation (useful in testing)
 */
export const silentReceiptLogger = (_receipt: BudgetExhaustedReceipt): void => {
  // Intentionally silent
};

/**
 * Default JSON logger for console output
 */
export const defaultReceiptLogger = (receipt: BudgetExhaustedReceipt): void => {
  console.log(JSON.stringify({ event: "budget_exhausted", ...receipt }));
};

/**
 * Unified Budget Manager
 *
 * Manages hierarchical budgets and enforces limits at key points:
 * 1. Before operation: Check if budget allows the operation
 * 2. After operation: Decrement used values
 * 3. On exhaustion: Emit receipt
 */
export class UnifiedBudgetManager {
  private budgets: Map<string, UnifiedBudget> = new Map();
  private receiptLogger: (receipt: BudgetExhaustedReceipt) => void;

  constructor(
    options: {
      receiptLogger?: (receipt: BudgetExhaustedReceipt) => void;
    } = {}
  ) {
    this.receiptLogger = options.receiptLogger ?? defaultReceiptLogger;
  }

  // =========================================================================
  // Budget Creation
  // =========================================================================

  /**
   * Create a session-level budget
   */
  createSessionBudget(sessionId: string, tier: CapabilityTier): UnifiedBudget {
    const budget = createUnifiedBudget(sessionId, "session", tier);
    this.budgets.set(sessionId, budget);
    return budget;
  }

  /**
   * Create a task-level budget under a session
   */
  createTaskBudget(taskId: string, sessionId: string, tier: CapabilityTier): UnifiedBudget {
    const budget = createUnifiedBudget(taskId, "task", tier, sessionId);
    this.budgets.set(taskId, budget);
    return budget;
  }

  /**
   * Create a gate-level budget under a task
   */
  createGateBudget(gateId: string, taskId: string, tier: CapabilityTier): UnifiedBudget {
    const budget = createUnifiedBudget(gateId, "gate", tier, taskId);
    this.budgets.set(gateId, budget);
    return budget;
  }

  /**
   * Create a budget with custom limits
   */
  createBudgetWithLimits(
    id: string,
    scope: BudgetScope,
    limits: Partial<TierBudgetAllocation>,
    tier?: CapabilityTier,
    parentId?: string
  ): UnifiedBudget {
    const budget = createCustomBudget(id, scope, limits, tier, parentId);
    this.budgets.set(id, budget);
    return budget;
  }

  // =========================================================================
  // Budget Retrieval
  // =========================================================================

  /**
   * Get a budget by ID
   */
  getBudget(id: string): UnifiedBudget | undefined {
    return this.budgets.get(id);
  }

  /**
   * Get all budgets
   */
  getAllBudgets(): UnifiedBudget[] {
    return Array.from(this.budgets.values());
  }

  /**
   * Get child budgets for a parent
   */
  getChildBudgets(parentId: string): UnifiedBudget[] {
    return Array.from(this.budgets.values()).filter((b) => b.parentId === parentId);
  }

  // =========================================================================
  // Budget Enforcement
  // =========================================================================

  /**
   * Check if a budget can accommodate a spend request
   * Does NOT modify the budget
   *
   * @throws UnifiedBudgetExceededError if budget cannot accommodate the request
   */
  checkBudget(budgetId: string, request: SpendRequest): void {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget not found: ${budgetId}`);
    }

    // Check each field that's being spent
    if (request.tokens !== undefined && request.tokens > budget.tokens.remaining) {
      throw new UnifiedBudgetExceededError(
        "tokens",
        budget.tokens.used + request.tokens,
        budget.tokens.limit,
        budgetId,
        budget.scope
      );
    }

    if (request.turns !== undefined && request.turns > budget.turns.remaining) {
      throw new UnifiedBudgetExceededError(
        "turns",
        budget.turns.used + request.turns,
        budget.turns.limit,
        budgetId,
        budget.scope
      );
    }

    if (request.time !== undefined && request.time > budget.time.remaining) {
      throw new UnifiedBudgetExceededError(
        "time",
        budget.time.used + request.time,
        budget.time.limit,
        budgetId,
        budget.scope
      );
    }

    if (request.escalations !== undefined && request.escalations > budget.escalations.remaining) {
      throw new UnifiedBudgetExceededError(
        "escalations",
        budget.escalations.used + request.escalations,
        budget.escalations.limit,
        budgetId,
        budget.scope
      );
    }
  }

  /**
   * Spend from a budget
   * Updates used/remaining values and checks for exhaustion
   *
   * @returns true if budget is now exhausted
   * @throws UnifiedBudgetExceededError if spend would exceed limit
   */
  spend(budgetId: string, request: SpendRequest): boolean {
    // First check if we can spend
    this.checkBudget(budgetId, request);

    const budget = this.budgets.get(budgetId)!;
    const now = new Date().toISOString();

    // Update each field
    if (request.tokens !== undefined) {
      budget.tokens.used += request.tokens;
      budget.tokens.remaining = budget.tokens.limit - budget.tokens.used;
    }

    if (request.turns !== undefined) {
      budget.turns.used += request.turns;
      budget.turns.remaining = budget.turns.limit - budget.turns.used;
    }

    if (request.time !== undefined) {
      budget.time.used += request.time;
      budget.time.remaining = budget.time.limit - budget.time.used;
    }

    if (request.escalations !== undefined) {
      budget.escalations.used += request.escalations;
      budget.escalations.remaining = budget.escalations.limit - budget.escalations.used;
    }

    budget.updatedAt = now;

    // Check if budget is now exhausted
    const exhaustedField = getExhaustedField(budget);
    if (exhaustedField && !budget.exhausted) {
      budget.exhausted = true;
      this.emitExhaustionReceipt(budget, exhaustedField);
    }

    // Also update parent budgets
    if (budget.parentId) {
      this.propagateSpendToParent(budget.parentId, request);
    }

    return budget.exhausted;
  }

  /**
   * Propagate spend to parent budgets (hierarchical tracking)
   */
  private propagateSpendToParent(parentId: string, request: SpendRequest): void {
    const parent = this.budgets.get(parentId);
    if (!parent) return;

    // Update parent fields (don't throw - parent has different limits)
    if (request.tokens !== undefined) {
      parent.tokens.used += request.tokens;
      parent.tokens.remaining = Math.max(0, parent.tokens.limit - parent.tokens.used);
    }

    if (request.turns !== undefined) {
      parent.turns.used += request.turns;
      parent.turns.remaining = Math.max(0, parent.turns.limit - parent.turns.used);
    }

    if (request.time !== undefined) {
      parent.time.used += request.time;
      parent.time.remaining = Math.max(0, parent.time.limit - parent.time.used);
    }

    if (request.escalations !== undefined) {
      parent.escalations.used += request.escalations;
      parent.escalations.remaining = Math.max(
        0,
        parent.escalations.limit - parent.escalations.used
      );
    }

    parent.updatedAt = new Date().toISOString();

    // Check parent exhaustion
    const exhaustedField = getExhaustedField(parent);
    if (exhaustedField && !parent.exhausted) {
      parent.exhausted = true;
      this.emitExhaustionReceipt(parent, exhaustedField);
    }

    // Continue propagating up
    if (parent.parentId) {
      this.propagateSpendToParent(parent.parentId, request);
    }
  }

  // =========================================================================
  // Receipt Emission
  // =========================================================================

  /**
   * Emit a budget exhaustion receipt
   */
  private emitExhaustionReceipt(
    budget: UnifiedBudget,
    field: "tokens" | "turns" | "time" | "escalations"
  ): void {
    const fieldData = budget[field];

    const receipt: BudgetExhaustedReceipt = {
      schemaVersion: "1.0.0",
      kind: "BudgetExhaustedReceipt",
      budgetId: budget.id,
      exhaustedField: field,
      current: fieldData.used,
      limit: fieldData.limit,
      scope: budget.scope,
      tier: budget.tier,
      nextActions: this.suggestNextActions(budget, field),
      timestamp: new Date().toISOString(),
    };

    // Validate against schema
    const validated = BudgetExhaustedReceiptSchema.parse(receipt);
    this.receiptLogger(validated);
  }

  /**
   * Suggest next actions based on exhausted field and scope
   */
  private suggestNextActions(
    budget: UnifiedBudget,
    field: "tokens" | "turns" | "time" | "escalations"
  ): string[] {
    const actions: string[] = [];

    switch (field) {
      case "tokens":
        actions.push("Consider escalating to a higher tier for more token budget");
        actions.push("Optimize prompts to reduce token usage");
        break;
      case "turns":
        actions.push("Combine multiple operations into fewer turns");
        actions.push("Request additional turns from parent budget");
        break;
      case "time":
        actions.push("Review operation efficiency");
        actions.push("Consider parallel execution where possible");
        break;
      case "escalations":
        actions.push("Escalation limit reached - human review may be required");
        actions.push("Consider restructuring task to reduce complexity");
        break;
    }

    if (budget.scope === "gate" && budget.parentId) {
      actions.push(`Request budget extension from task: ${budget.parentId}`);
    } else if (budget.scope === "task" && budget.parentId) {
      actions.push(`Request budget extension from session: ${budget.parentId}`);
    }

    return actions;
  }

  // =========================================================================
  // Budget Reset
  // =========================================================================

  /**
   * Reset a budget to its initial state (keeps limits, resets usage)
   */
  resetBudget(budgetId: string): UnifiedBudget {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget not found: ${budgetId}`);
    }

    const now = new Date().toISOString();

    budget.tokens.used = 0;
    budget.tokens.remaining = budget.tokens.limit;

    budget.turns.used = 0;
    budget.turns.remaining = budget.turns.limit;

    budget.time.used = 0;
    budget.time.remaining = budget.time.limit;

    budget.escalations.used = 0;
    budget.escalations.remaining = budget.escalations.limit;

    budget.exhausted = false;
    budget.updatedAt = now;

    return budget;
  }

  /**
   * Update budget limits
   */
  updateLimits(budgetId: string, limits: Partial<TierBudgetAllocation>): UnifiedBudget {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget not found: ${budgetId}`);
    }

    const now = new Date().toISOString();

    if (limits.tokens !== undefined) {
      budget.tokens.limit = limits.tokens;
      budget.tokens.remaining = budget.tokens.limit - budget.tokens.used;
    }

    if (limits.turns !== undefined) {
      budget.turns.limit = limits.turns;
      budget.turns.remaining = budget.turns.limit - budget.turns.used;
    }

    if (limits.time !== undefined) {
      budget.time.limit = limits.time;
      budget.time.remaining = budget.time.limit - budget.time.used;
    }

    if (limits.escalations !== undefined) {
      budget.escalations.limit = limits.escalations;
      budget.escalations.remaining = budget.escalations.limit - budget.escalations.used;
    }

    // Re-check exhaustion status
    budget.exhausted = isBudgetExhausted(budget);
    budget.updatedAt = now;

    return budget;
  }

  // =========================================================================
  // Budget Formatting
  // =========================================================================

  /**
   * Format a budget for human-readable output
   */
  formatBudgetHuman(budgetId: string): string {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      return `Budget not found: ${budgetId}`;
    }

    const formatField = (name: string, field: BudgetField): string => {
      const percent = ((field.used / field.limit) * 100).toFixed(1);
      const status =
        field.remaining <= 0 ? " (EXHAUSTED)" : field.remaining < field.limit * 0.2 ? " (LOW)" : "";
      return `  ${name}: ${field.used}/${field.limit} (${percent}% used)${status}`;
    };

    const lines = [
      "",
      `=== Budget: ${budget.id} ===`,
      `Scope: ${budget.scope}${budget.tier ? ` | Tier: ${budget.tier}` : ""}`,
      budget.parentId ? `Parent: ${budget.parentId}` : null,
      "",
      formatField("Tokens", budget.tokens),
      formatField("Turns", budget.turns),
      formatField("Time (ms)", budget.time),
      formatField("Escalations", budget.escalations),
      "",
      budget.exhausted ? "⚠️  BUDGET EXHAUSTED" : "✓ Budget available",
      "",
    ].filter((line): line is string => line !== null);

    return lines.join("\n");
  }

  /**
   * Format a budget for JSON output
   */
  formatBudgetJSON(budgetId: string): UnifiedBudget | null {
    return this.budgets.get(budgetId) ?? null;
  }

  /**
   * Remove a budget
   */
  removeBudget(budgetId: string): boolean {
    return this.budgets.delete(budgetId);
  }

  /**
   * Clear all budgets
   */
  clear(): void {
    this.budgets.clear();
  }
}

// =============================================================================
// Default Manager Instance
// =============================================================================

/**
 * Create a new budget manager with default options
 */
export function createBudgetManager(options?: {
  receiptLogger?: (receipt: BudgetExhaustedReceipt) => void;
}): UnifiedBudgetManager {
  return new UnifiedBudgetManager(options);
}

/**
 * Get default tier allocation
 */
export function getTierAllocation(tier: CapabilityTier): TierBudgetAllocation {
  return TIER_BUDGET_ALLOCATIONS[tier];
}
