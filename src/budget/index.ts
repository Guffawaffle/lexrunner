/**
 * Budget tracking and enforcement module.
 * Exports budget tracking functionality for CLI integration.
 *
 * This module provides:
 * 1. Legacy BudgetTracker for simple token/prompt tracking
 * 2. Unified Budget model for governance with hierarchical budgets
 */

// Legacy tracker (simple token/prompt tracking)
export {
	BudgetTracker,
	BudgetExceededError,
	DEFAULT_BUDGET_CONFIG,
	type BudgetConfig,
	type BudgetSpend,
	type BudgetSummary,
} from "./tracker.js";

// Unified Budget Schema
export {
	// Schemas
	BudgetFieldSchema,
	BudgetScope,
	UnifiedBudgetSchema,
	BudgetExhaustedReceiptSchema,
	// Types
	type BudgetField,
	type UnifiedBudget,
	type BudgetExhaustedReceipt,
	type TierBudgetAllocation,
	// Tier allocations
	TIER_BUDGET_ALLOCATIONS,
	// Helper functions
	createBudgetField,
	createUnifiedBudget,
	createCustomBudget,
	isFieldExhausted,
	isBudgetExhausted,
	getExhaustedField,
} from "./schema.js";

// Unified Budget Manager
export {
	UnifiedBudgetManager,
	UnifiedBudgetExceededError,
	createBudgetManager,
	getTierAllocation,
	type SpendRequest,
} from "./manager.js";
