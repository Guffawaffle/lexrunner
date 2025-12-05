/**
 * Unified Budget Schema for Governance
 *
 * Implements a unified budget model that ties together:
 * - Token limits
 * - Turn/prompt limits
 * - Time limits
 * - Escalation limits
 *
 * Supports hierarchical budgets (session > task > gate)
 *
 * @module budget/schema
 */

import { z } from "zod";
import type { CapabilityTier } from "../tiers/schema.js";

// =============================================================================
// Budget Field Schema
// =============================================================================

/**
 * Individual budget field with limit, used, and remaining
 */
export const BudgetFieldSchema = z.object({
	/** Maximum allowed value */
	limit: z.number().nonnegative(),
	/** Current usage */
	used: z.number().nonnegative(),
	/** Remaining budget (computed as limit - used) */
	remaining: z.number(),
});

export type BudgetField = z.infer<typeof BudgetFieldSchema>;

// =============================================================================
// Budget Scope
// =============================================================================

/**
 * Budget scope levels for hierarchical budget management
 */
export const BudgetScope = z.enum(["session", "task", "gate"]);
export type BudgetScope = z.infer<typeof BudgetScope>;

// =============================================================================
// Unified Budget Schema
// =============================================================================

/**
 * Unified Budget - ties together all resource limits
 *
 * Each field tracks limit, used, and remaining values for:
 * - tokens: Token/character budget for AI interactions
 * - turns: Number of prompt/response cycles allowed
 * - time: Time budget in milliseconds
 * - escalations: Number of tier escalations allowed
 *
 * @example
 * ```json
 * {
 *   "id": "session-abc123",
 *   "scope": "session",
 *   "tier": "mid",
 *   "tokens": { "limit": 10000, "used": 2500, "remaining": 7500 },
 *   "turns": { "limit": 10, "used": 2, "remaining": 8 },
 *   "time": { "limit": 300000, "used": 45000, "remaining": 255000 },
 *   "escalations": { "limit": 2, "used": 0, "remaining": 2 }
 * }
 * ```
 */
export const UnifiedBudgetSchema = z.object({
	/** Unique identifier for this budget */
	id: z.string(),

	/** Scope level of this budget */
	scope: BudgetScope,

	/** Tier this budget is allocated for */
	tier: z.enum(["senior", "mid", "junior"]).optional(),

	/** Parent budget ID (for hierarchical tracking) */
	parentId: z.string().optional(),

	/** Token budget */
	tokens: BudgetFieldSchema,

	/** Turn/prompt budget */
	turns: BudgetFieldSchema,

	/** Time budget in milliseconds */
	time: BudgetFieldSchema,

	/** Escalation budget */
	escalations: BudgetFieldSchema,

	/** Whether this budget has been exhausted */
	exhausted: z.boolean().default(false),

	/** Timestamp when budget was created */
	createdAt: z.string().datetime().optional(),

	/** Timestamp when budget was last updated */
	updatedAt: z.string().datetime().optional(),
});

export type UnifiedBudget = z.infer<typeof UnifiedBudgetSchema>;

// =============================================================================
// Budget Allocation by Tier
// =============================================================================

/**
 * Default budget allocation configuration
 */
export interface TierBudgetAllocation {
	/** Token limit */
	tokens: number;
	/** Turn/prompt limit */
	turns: number;
	/** Time limit in milliseconds */
	time: number;
	/** Escalation limit */
	escalations: number;
}

/**
 * Default budget allocations per tier
 *
 * | Tier   | Tokens | Turns | Time (ms) | Escalations |
 * |--------|--------|-------|-----------|-------------|
 * | junior | 2000   | 3     | 60000     | 1           |
 * | mid    | 5000   | 5     | 180000    | 2           |
 * | senior | 15000  | 10    | 600000    | 3           |
 */
export const TIER_BUDGET_ALLOCATIONS: Record<CapabilityTier, TierBudgetAllocation> = {
	junior: {
		tokens: 2000,
		turns: 3,
		time: 60000,      // 1 minute
		escalations: 1,
	},
	mid: {
		tokens: 5000,
		turns: 5,
		time: 180000,     // 3 minutes
		escalations: 2,
	},
	senior: {
		tokens: 15000,
		turns: 10,
		time: 600000,     // 10 minutes
		escalations: 3,
	},
};

// =============================================================================
// Budget Exhausted Receipt
// =============================================================================

/**
 * Receipt emitted when a budget is exhausted
 */
export const BudgetExhaustedReceiptSchema = z.object({
	/** Schema version */
	schemaVersion: z.literal("1.0.0"),

	/** Receipt kind */
	kind: z.literal("BudgetExhaustedReceipt"),

	/** Budget that was exhausted */
	budgetId: z.string(),

	/** Which field was exhausted */
	exhaustedField: z.enum(["tokens", "turns", "time", "escalations"]),

	/** Current value when exhausted */
	current: z.number(),

	/** Limit that was exceeded */
	limit: z.number(),

	/** Scope of the exhausted budget */
	scope: BudgetScope,

	/** Tier of the exhausted budget */
	tier: z.enum(["senior", "mid", "junior"]).optional(),

	/** Suggested next actions */
	nextActions: z.array(z.string()).optional(),

	/** Timestamp of exhaustion */
	timestamp: z.string().datetime(),
});

export type BudgetExhaustedReceipt = z.infer<typeof BudgetExhaustedReceiptSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new budget field with the given limit
 */
export function createBudgetField(limit: number): BudgetField {
	return {
		limit,
		used: 0,
		remaining: limit,
	};
}

/**
 * Create a new unified budget with default allocations for a tier
 */
export function createUnifiedBudget(
	id: string,
	scope: BudgetScope,
	tier: CapabilityTier,
	parentId?: string
): UnifiedBudget {
	const allocation = TIER_BUDGET_ALLOCATIONS[tier];
	const now = new Date().toISOString();

	return {
		id,
		scope,
		tier,
		parentId,
		tokens: createBudgetField(allocation.tokens),
		turns: createBudgetField(allocation.turns),
		time: createBudgetField(allocation.time),
		escalations: createBudgetField(allocation.escalations),
		exhausted: false,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Create a budget with custom limits
 */
export function createCustomBudget(
	id: string,
	scope: BudgetScope,
	limits: Partial<TierBudgetAllocation>,
	tier?: CapabilityTier,
	parentId?: string
): UnifiedBudget {
	const defaults = tier ? TIER_BUDGET_ALLOCATIONS[tier] : TIER_BUDGET_ALLOCATIONS.mid;
	const now = new Date().toISOString();

	return {
		id,
		scope,
		tier,
		parentId,
		tokens: createBudgetField(limits.tokens ?? defaults.tokens),
		turns: createBudgetField(limits.turns ?? defaults.turns),
		time: createBudgetField(limits.time ?? defaults.time),
		escalations: createBudgetField(limits.escalations ?? defaults.escalations),
		exhausted: false,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Check if a budget field is exhausted
 */
export function isFieldExhausted(field: BudgetField): boolean {
	return field.remaining <= 0;
}

/**
 * Check if any budget field is exhausted
 */
export function isBudgetExhausted(budget: UnifiedBudget): boolean {
	return (
		isFieldExhausted(budget.tokens) ||
		isFieldExhausted(budget.turns) ||
		isFieldExhausted(budget.time) ||
		isFieldExhausted(budget.escalations)
	);
}

/**
 * Get the first exhausted field, if any
 */
export function getExhaustedField(
	budget: UnifiedBudget
): "tokens" | "turns" | "time" | "escalations" | null {
	if (isFieldExhausted(budget.tokens)) return "tokens";
	if (isFieldExhausted(budget.turns)) return "turns";
	if (isFieldExhausted(budget.time)) return "time";
	if (isFieldExhausted(budget.escalations)) return "escalations";
	return null;
}
