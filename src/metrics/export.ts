/**
 * Metrics Export Module
 *
 * Provides Prometheus-compatible metrics export and JSON metrics dump
 * for governance observability (Wave 3).
 *
 * Key metrics:
 * - lex_turn_cost_total (counter): Total Turn Cost accumulated across operations
 * - lex_tier_distribution (gauge): Distribution of tasks by capability tier
 * - lex_failure_rate (gauge): Rate of failed operations
 * - lex_budget_remaining (gauge): Remaining budget (tokens and prompts)
 */

import type { TurnCostSummary, TurnCostComponents } from "./turncost.js";
import type { TierMetrics } from "../tiers/metrics.js";
import type { BudgetSummary } from "../budget/tracker.js";
import { ulid } from "ulid";

/**
 * Metric types supported by the export module
 */
export type MetricType = "counter" | "gauge" | "histogram";

/**
 * A single metric definition
 */
export interface MetricDefinition {
	name: string;
	type: MetricType;
	help: string;
	labels?: string[];
}

/**
 * A metric value with optional labels
 */
export interface MetricValue {
	name: string;
	value: number;
	labels?: Record<string, string>;
	timestamp?: string;
}

/**
 * Complete metrics snapshot for JSON export
 */
export interface MetricsSnapshot {
	timestamp: string;
	sessionId: string;
	metrics: {
		turnCost: TurnCostMetrics | null;
		tierDistribution: TierDistributionMetrics | null;
		failureRate: FailureRateMetrics | null;
		budgetRemaining: BudgetRemainingMetrics | null;
	};
}

/**
 * Turn Cost metrics
 */
export interface TurnCostMetrics {
	total: number;
	components: TurnCostComponents;
	eventCount: number;
}

/**
 * Tier distribution metrics
 */
export interface TierDistributionMetrics {
	byTier: {
		senior: number;
		mid: number;
		junior: number;
	};
	tierMatchRate: number;
	escalationRate: number;
}

/**
 * Failure rate metrics
 */
export interface FailureRateMetrics {
	gateFailures: number;
	totalGates: number;
	failureRate: number;
}

/**
 * Budget remaining metrics
 */
export interface BudgetRemainingMetrics {
	tokensRemaining: number;
	tokenBudget: number;
	promptsRemaining: number;
	maxPrompts: number;
	tokenUtilization: number;
	promptUtilization: number;
}

/**
 * Metric definitions for lexrunner governance
 */
export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
	lex_turn_cost_total: {
		name: "lex_turn_cost_total",
		type: "counter",
		help: "Total Turn Cost accumulated across merge-weave operations",
	},
	lex_tier_distribution: {
		name: "lex_tier_distribution",
		type: "gauge",
		help: "Distribution of tasks by capability tier",
		labels: ["tier"],
	},
	lex_failure_rate: {
		name: "lex_failure_rate",
		type: "gauge",
		help: "Rate of failed gate operations (0-1)",
	},
	lex_budget_remaining: {
		name: "lex_budget_remaining",
		type: "gauge",
		help: "Remaining budget (tokens or prompts)",
		labels: ["type"],
	},
	lex_tier_match_rate: {
		name: "lex_tier_match_rate",
		type: "gauge",
		help: "Rate of tier matches vs mismatches (0-1)",
	},
	lex_escalation_rate: {
		name: "lex_escalation_rate",
		type: "gauge",
		help: "Rate of tier escalations (0-1)",
	},
};

/**
 * GovernanceMetricsCollector aggregates metrics from various sources
 * and provides Prometheus-compatible and JSON export formats.
 */
export class GovernanceMetricsCollector {
	private sessionId: string;
	private turnCostMetrics: TurnCostMetrics | null = null;
	private tierDistributionMetrics: TierDistributionMetrics | null = null;
	private failureRateMetrics: FailureRateMetrics | null = null;
	private budgetRemainingMetrics: BudgetRemainingMetrics | null = null;

	constructor(sessionId?: string) {
		this.sessionId = sessionId || ulid();
	}

	/**
	 * Get the session ID for this collector
	 */
	getSessionId(): string {
		return this.sessionId;
	}

	/**
	 * Record Turn Cost metrics from a TurnCostSummary
	 */
	recordTurnCost(summary: TurnCostSummary): void {
		this.turnCostMetrics = {
			total: summary.weightedScore,
			components: summary.components,
			eventCount: summary.eventCount,
		};
	}

	/**
	 * Record tier distribution metrics from TierMetrics
	 */
	recordTierDistribution(metrics: TierMetrics): void {
		this.tierDistributionMetrics = {
			byTier: { ...metrics.byActualTier },
			tierMatchRate: metrics.tierMatchRate,
			escalationRate: metrics.escalationRate,
		};
	}

	/**
	 * Record failure rate from gate execution results
	 */
	recordFailureRate(failures: number, total: number): void {
		this.failureRateMetrics = {
			gateFailures: failures,
			totalGates: total,
			failureRate: total > 0 ? failures / total : 0,
		};
	}

	/**
	 * Record budget remaining from BudgetSummary
	 */
	recordBudgetRemaining(summary: BudgetSummary): void {
		const tokensRemaining = Math.max(
			0,
			summary.tokenBudget - summary.tokens_estimated
		);
		const promptsRemaining = Math.max(
			0,
			summary.maxPrompts - summary.prompts
		);

		this.budgetRemainingMetrics = {
			tokensRemaining,
			tokenBudget: summary.tokenBudget,
			promptsRemaining,
			maxPrompts: summary.maxPrompts,
			tokenUtilization:
				summary.tokenBudget > 0
					? summary.tokens_estimated / summary.tokenBudget
					: 0,
			promptUtilization:
				summary.maxPrompts > 0
					? summary.prompts / summary.maxPrompts
					: 0,
		};
	}

	/**
	 * Get a complete metrics snapshot for JSON export
	 */
	getSnapshot(): MetricsSnapshot {
		return {
			timestamp: new Date().toISOString(),
			sessionId: this.sessionId,
			metrics: {
				turnCost: this.turnCostMetrics,
				tierDistribution: this.tierDistributionMetrics,
				failureRate: this.failureRateMetrics,
				budgetRemaining: this.budgetRemainingMetrics,
			},
		};
	}

	/**
	 * Get metrics filtered by name pattern.
	 * The pattern is matched against metric category keywords (turn_cost, tier, failure, budget).
	 * This allows flexible filtering like "turn" to match turnCost metrics.
	 */
	getMetricsByName(pattern: string): MetricsSnapshot {
		const snapshot = this.getSnapshot();
		const regex = new RegExp(pattern, "i");

		// Filter metrics based on pattern matching against category keywords
		const filteredMetrics: MetricsSnapshot["metrics"] = {
			turnCost: null,
			tierDistribution: null,
			failureRate: null,
			budgetRemaining: null,
		};

		// Match turn_cost or turnCost patterns
		if (regex.test("turn_cost") || regex.test("turnCost")) {
			filteredMetrics.turnCost = snapshot.metrics.turnCost;
		}
		// Match tier or distribution patterns
		if (regex.test("tier") || regex.test("distribution")) {
			filteredMetrics.tierDistribution = snapshot.metrics.tierDistribution;
		}
		// Match failure or rate patterns
		if (regex.test("failure") || regex.test("rate")) {
			filteredMetrics.failureRate = snapshot.metrics.failureRate;
		}
		// Match budget or remaining patterns
		if (regex.test("budget") || regex.test("remaining")) {
			filteredMetrics.budgetRemaining = snapshot.metrics.budgetRemaining;
		}

		return {
			...snapshot,
			metrics: filteredMetrics,
		};
	}

	/**
	 * Export metrics in Prometheus text format
	 */
	exportPrometheus(): string {
		const lines: string[] = [];

		// Turn Cost metric
		if (this.turnCostMetrics !== null) {
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_turn_cost_total.name} ${METRIC_DEFINITIONS.lex_turn_cost_total.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_turn_cost_total.name} ${METRIC_DEFINITIONS.lex_turn_cost_total.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_turn_cost_total.name} ${this.turnCostMetrics.total}`
			);
		}

		// Tier Distribution metrics
		if (this.tierDistributionMetrics !== null) {
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_tier_distribution.name} ${METRIC_DEFINITIONS.lex_tier_distribution.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_tier_distribution.name} ${METRIC_DEFINITIONS.lex_tier_distribution.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_tier_distribution.name}{tier="senior"} ${this.tierDistributionMetrics.byTier.senior}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_tier_distribution.name}{tier="mid"} ${this.tierDistributionMetrics.byTier.mid}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_tier_distribution.name}{tier="junior"} ${this.tierDistributionMetrics.byTier.junior}`
			);

			// Tier match rate
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_tier_match_rate.name} ${METRIC_DEFINITIONS.lex_tier_match_rate.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_tier_match_rate.name} ${METRIC_DEFINITIONS.lex_tier_match_rate.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_tier_match_rate.name} ${this.tierDistributionMetrics.tierMatchRate}`
			);

			// Escalation rate
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_escalation_rate.name} ${METRIC_DEFINITIONS.lex_escalation_rate.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_escalation_rate.name} ${METRIC_DEFINITIONS.lex_escalation_rate.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_escalation_rate.name} ${this.tierDistributionMetrics.escalationRate}`
			);
		}

		// Failure Rate metric
		if (this.failureRateMetrics !== null) {
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_failure_rate.name} ${METRIC_DEFINITIONS.lex_failure_rate.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_failure_rate.name} ${METRIC_DEFINITIONS.lex_failure_rate.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_failure_rate.name} ${this.failureRateMetrics.failureRate}`
			);
		}

		// Budget Remaining metrics
		if (this.budgetRemainingMetrics !== null) {
			lines.push(
				`# HELP ${METRIC_DEFINITIONS.lex_budget_remaining.name} ${METRIC_DEFINITIONS.lex_budget_remaining.help}`
			);
			lines.push(
				`# TYPE ${METRIC_DEFINITIONS.lex_budget_remaining.name} ${METRIC_DEFINITIONS.lex_budget_remaining.type}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_budget_remaining.name}{type="tokens"} ${this.budgetRemainingMetrics.tokensRemaining}`
			);
			lines.push(
				`${METRIC_DEFINITIONS.lex_budget_remaining.name}{type="prompts"} ${this.budgetRemainingMetrics.promptsRemaining}`
			);
		}

		return lines.join("\n") + "\n";
	}

	/**
	 * Get all metric values as an array for programmatic access
	 */
	getMetricValues(): MetricValue[] {
		const values: MetricValue[] = [];
		const timestamp = new Date().toISOString();

		if (this.turnCostMetrics !== null) {
			values.push({
				name: METRIC_DEFINITIONS.lex_turn_cost_total.name,
				value: this.turnCostMetrics.total,
				timestamp,
			});
		}

		if (this.tierDistributionMetrics !== null) {
			values.push(
				{
					name: METRIC_DEFINITIONS.lex_tier_distribution.name,
					value: this.tierDistributionMetrics.byTier.senior,
					labels: { tier: "senior" },
					timestamp,
				},
				{
					name: METRIC_DEFINITIONS.lex_tier_distribution.name,
					value: this.tierDistributionMetrics.byTier.mid,
					labels: { tier: "mid" },
					timestamp,
				},
				{
					name: METRIC_DEFINITIONS.lex_tier_distribution.name,
					value: this.tierDistributionMetrics.byTier.junior,
					labels: { tier: "junior" },
					timestamp,
				},
				{
					name: METRIC_DEFINITIONS.lex_tier_match_rate.name,
					value: this.tierDistributionMetrics.tierMatchRate,
					timestamp,
				},
				{
					name: METRIC_DEFINITIONS.lex_escalation_rate.name,
					value: this.tierDistributionMetrics.escalationRate,
					timestamp,
				}
			);
		}

		if (this.failureRateMetrics !== null) {
			values.push({
				name: METRIC_DEFINITIONS.lex_failure_rate.name,
				value: this.failureRateMetrics.failureRate,
				timestamp,
			});
		}

		if (this.budgetRemainingMetrics !== null) {
			values.push(
				{
					name: METRIC_DEFINITIONS.lex_budget_remaining.name,
					value: this.budgetRemainingMetrics.tokensRemaining,
					labels: { type: "tokens" },
					timestamp,
				},
				{
					name: METRIC_DEFINITIONS.lex_budget_remaining.name,
					value: this.budgetRemainingMetrics.promptsRemaining,
					labels: { type: "prompts" },
					timestamp,
				}
			);
		}

		return values;
	}

	/**
	 * Reset all collected metrics
	 */
	reset(): void {
		this.turnCostMetrics = null;
		this.tierDistributionMetrics = null;
		this.failureRateMetrics = null;
		this.budgetRemainingMetrics = null;
	}
}

/**
 * Factory function to create a new GovernanceMetricsCollector
 */
export function createMetricsCollector(
	sessionId?: string
): GovernanceMetricsCollector {
	return new GovernanceMetricsCollector(sessionId);
}

/**
 * Global singleton for convenience (optional use)
 */
let globalCollector: GovernanceMetricsCollector | null = null;

/**
 * Get or create the global metrics collector
 */
export function getGlobalMetricsCollector(): GovernanceMetricsCollector {
	if (!globalCollector) {
		globalCollector = new GovernanceMetricsCollector();
	}
	return globalCollector;
}

/**
 * Reset the global metrics collector
 */
export function resetGlobalMetricsCollector(): void {
	globalCollector = null;
}
