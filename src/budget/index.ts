/**
 * Budget tracking and enforcement module.
 * Exports budget tracking functionality for CLI integration.
 */

export {
	BudgetTracker,
	BudgetExceededError,
	DEFAULT_BUDGET_CONFIG,
	type BudgetConfig,
	type BudgetSpend,
	type BudgetSummary,
} from './tracker.js';
