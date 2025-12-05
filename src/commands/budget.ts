/**
 * Budget CLI Command
 *
 * Provides CLI interface for budget management:
 * - lex-pr budget show: Display current budget status
 * - lex-pr budget reset: Reset session budget
 * - lex-pr budget set --tokens 10000: Configure limits
 *
 * @module commands/budget
 */

import { Command } from "commander";
import {
	UnifiedBudgetManager,
	createBudgetManager,
	TIER_BUDGET_ALLOCATIONS,
	type UnifiedBudget,
} from "../budget/index.js";
import { CapabilityTier } from "../tiers/schema.js";
import { writeJsonOutput } from "../cli/output.js";
import { throwExit } from "../cli/exitHandler.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

// Session budget ID (in a real implementation, this would be stored persistently)
const DEFAULT_SESSION_ID = "current-session";

// Global budget manager (in a real implementation, this would be persisted)
let globalBudgetManager: UnifiedBudgetManager | null = null;

/**
 * Get or create the global budget manager
 */
function getOrCreateBudgetManager(): UnifiedBudgetManager {
	if (!globalBudgetManager) {
		globalBudgetManager = createBudgetManager();
	}
	return globalBudgetManager;
}

/**
 * Reset the global budget manager (primarily for testing)
 */
function resetGlobalBudgetManager(): void {
	globalBudgetManager = null;
}

/**
 * Get or create a session budget
 */
function getOrCreateSessionBudget(
	manager: UnifiedBudgetManager,
	tier: CapabilityTier = "mid"
): UnifiedBudget {
	let budget = manager.getBudget(DEFAULT_SESSION_ID);
	if (!budget) {
		budget = manager.createSessionBudget(DEFAULT_SESSION_ID, tier);
	}
	return budget;
}

/**
 * Format budget for human-readable display
 */
function formatBudgetDisplay(budget: UnifiedBudget): string {
	const formatField = (
		name: string,
		field: { limit: number; used: number; remaining: number },
		unit: string = ""
	): string => {
		const percent = ((field.used / field.limit) * 100).toFixed(1);
		const bar = createProgressBar(field.used, field.limit);
		const status =
			field.remaining <= 0
				? " ⚠️  EXHAUSTED"
				: field.remaining < field.limit * 0.2
				? " ⚠️  LOW"
				: "";
		return `  ${name.padEnd(12)}: ${bar} ${field.used}/${field.limit}${unit} (${percent}% used)${status}`;
	};

	const lines = [
		"",
		"╔═══════════════════════════════════════╗",
		"║         Budget Status                 ║",
		"╚═══════════════════════════════════════╝",
		"",
		`📋 Budget ID: ${budget.id}`,
		`📊 Scope: ${budget.scope}`,
		budget.tier ? `🎯 Tier: ${budget.tier}` : null,
		budget.parentId ? `↑ Parent: ${budget.parentId}` : null,
		"",
		"───────────────────────────────────────",
		formatField("Tokens", budget.tokens),
		formatField("Turns", budget.turns),
		formatField("Time", budget.time, " ms"),
		formatField("Escalations", budget.escalations),
		"───────────────────────────────────────",
		"",
		budget.exhausted
			? "⚠️  Status: BUDGET EXHAUSTED - Some operations may be blocked"
			: "✅ Status: Budget available",
		"",
	].filter((line): line is string => line !== null);

	return lines.join("\n");
}

/**
 * Create a simple progress bar
 */
function createProgressBar(used: number, limit: number): string {
	const width = 20;
	const filled = Math.round((used / limit) * width);
	const empty = width - filled;
	const bar = "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(empty, 0));
	return `[${bar}]`;
}

/**
 * Register the budget command with the CLI program
 */
export function registerBudgetCommand(
	program: Command,
	jsonModeActive: () => boolean
): void {
	const budgetCmd = program
		.command("budget")
		.description("Manage and display budget status for governance control");

	// budget show
	budgetCmd
		.command("show")
		.description("Display current budget status")
		.option("--tier <tier>", "Tier for default budget allocation", "mid")
		.option("--json", "Output in JSON format")
		.addHelpText(
			"after",
			`
Examples:
  $ lex-pr budget show                    # Show current session budget
  $ lex-pr budget show --tier senior      # Show with senior tier allocation
  $ lex-pr budget show --json             # JSON output for automation

Budget Fields:
  • Tokens: Token/character budget for AI interactions
  • Turns: Number of prompt/response cycles allowed
  • Time: Time budget in milliseconds
  • Escalations: Number of tier escalations allowed`
		)
		.action((opts) => {
			try {
				const tier = parseTier(opts.tier);
				const manager = getOrCreateBudgetManager();
				const budget = getOrCreateSessionBudget(manager, tier);

				if (opts.json || jsonModeActive()) {
					writeJsonOutput(budget);
				} else {
					console.log(formatBudgetDisplay(budget));
				}
			} catch (error) {
				console.error(
					`Error displaying budget: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
				throwExit(1);
			}
		});

	// budget reset
	budgetCmd
		.command("reset")
		.description("Reset session budget to initial state")
		.option("--tier <tier>", "Tier for budget allocation after reset", "mid")
		.option("--json", "Output in JSON format")
		.addHelpText(
			"after",
			`
Examples:
  $ lex-pr budget reset                   # Reset with current tier
  $ lex-pr budget reset --tier senior     # Reset with senior allocation
  $ lex-pr budget reset --json            # JSON output after reset`
		)
		.action((opts) => {
			try {
				const tier = parseTier(opts.tier);
				const manager = getOrCreateBudgetManager();

				// Remove existing budget and create new one
				manager.removeBudget(DEFAULT_SESSION_ID);
				const budget = manager.createSessionBudget(DEFAULT_SESSION_ID, tier);

				if (opts.json || jsonModeActive()) {
					writeJsonOutput({
						status: "reset",
						budget,
					});
				} else {
					console.log("\n✅ Budget reset successfully!\n");
					console.log(formatBudgetDisplay(budget));
				}
			} catch (error) {
				console.error(
					`Error resetting budget: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
				throwExit(1);
			}
		});

	// budget set
	budgetCmd
		.command("set")
		.description("Configure budget limits")
		.option("--tokens <number>", "Set token limit", parseInt)
		.option("--turns <number>", "Set turn limit", parseInt)
		.option("--time <number>", "Set time limit in milliseconds", parseInt)
		.option("--escalations <number>", "Set escalation limit", parseInt)
		.option("--tier <tier>", "Set limits based on tier allocation")
		.option("--json", "Output in JSON format")
		.addHelpText(
			"after",
			`
Examples:
  $ lex-pr budget set --tokens 10000            # Set token limit
  $ lex-pr budget set --turns 10 --tokens 5000  # Set multiple limits
  $ lex-pr budget set --tier senior             # Use senior tier defaults
  $ lex-pr budget set --json                    # JSON output after setting

Default Tier Allocations:
  Junior: tokens=2000, turns=3, time=60000ms, escalations=1
  Mid:    tokens=5000, turns=5, time=180000ms, escalations=2
  Senior: tokens=15000, turns=10, time=600000ms, escalations=3`
		)
		.action((opts) => {
			try {
				const manager = getOrCreateBudgetManager();

				// Get or create budget first
				let budget = manager.getBudget(DEFAULT_SESSION_ID);
				if (!budget) {
					budget = manager.createSessionBudget(DEFAULT_SESSION_ID, "mid");
				}

				// If tier is specified, use tier defaults
				if (opts.tier) {
					const tier = parseTier(opts.tier);
					const allocation = TIER_BUDGET_ALLOCATIONS[tier];
					manager.updateLimits(DEFAULT_SESSION_ID, allocation);
					budget = manager.getBudget(DEFAULT_SESSION_ID)!;
				}

				// Apply individual overrides
				const limits: Record<string, number> = {};
				if (opts.tokens !== undefined) limits.tokens = opts.tokens;
				if (opts.turns !== undefined) limits.turns = opts.turns;
				if (opts.time !== undefined) limits.time = opts.time;
				if (opts.escalations !== undefined) limits.escalations = opts.escalations;

				if (Object.keys(limits).length > 0) {
					budget = manager.updateLimits(DEFAULT_SESSION_ID, limits);
				}

				if (opts.json || jsonModeActive()) {
					writeJsonOutput({
						status: "updated",
						budget,
					});
				} else {
					console.log("\n✅ Budget limits updated!\n");
					console.log(formatBudgetDisplay(budget));
				}
			} catch (error) {
				console.error(
					`Error setting budget: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
				throwExit(1);
			}
		});

	// budget allocations - show tier allocations
	budgetCmd
		.command("allocations")
		.description("Display default budget allocations by tier")
		.option("--json", "Output in JSON format")
		.action((opts) => {
			if (opts.json || jsonModeActive()) {
				writeJsonOutput({
					allocations: TIER_BUDGET_ALLOCATIONS,
				});
			} else {
				console.log("\n╔═══════════════════════════════════════════════════════════════╗");
				console.log("║         Default Budget Allocations by Tier                     ║");
				console.log("╚═══════════════════════════════════════════════════════════════╝\n");

				console.log("┌──────────┬─────────┬───────┬────────────┬─────────────┐");
				console.log("│   Tier   │ Tokens  │ Turns │  Time (ms) │ Escalations │");
				console.log("├──────────┼─────────┼───────┼────────────┼─────────────┤");

				for (const tier of ["junior", "mid", "senior"] as const) {
					const alloc = TIER_BUDGET_ALLOCATIONS[tier];
					console.log(
						`│ ${tier.padEnd(8)} │ ${String(alloc.tokens).padStart(7)} │ ${String(
							alloc.turns
						).padStart(5)} │ ${String(alloc.time).padStart(10)} │ ${String(
							alloc.escalations
						).padStart(11)} │`
					);
				}

				console.log("└──────────┴─────────┴───────┴────────────┴─────────────┘\n");

				console.log("Time values: junior=1min, mid=3min, senior=10min\n");
			}
		});
}

/**
 * Parse tier string to CapabilityTier
 */
function parseTier(tierStr: string): CapabilityTier {
	const tier = tierStr.toLowerCase();
	if (tier !== "junior" && tier !== "mid" && tier !== "senior") {
		throw new Error(`Invalid tier: ${tierStr}. Must be junior, mid, or senior.`);
	}
	return tier;
}

/**
 * Export for testing
 */
export { getOrCreateBudgetManager, resetGlobalBudgetManager, DEFAULT_SESSION_ID };
