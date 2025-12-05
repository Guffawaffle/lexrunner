/**
 * Turn Cost Tracking for Merge-Weave Operations
 *
 * Implements Turn Cost tracking per the coordination cost compression thesis:
 * Turn Cost = λL + γC + ρR + τT + αA
 *
 * Where:
 * - L: Latency (API response time, gate execution, merge time)
 * - C: Context Reset tokens (N/A for deterministic runner)
 * - R: Renegotiation (conflict resolution retries, clarification turns)
 * - T: Token Bloat (excess tokens beyond expected)
 * - A: Attention Switch (human interventions, manual conflict resolutions)
 */

/**
 * Default weights for Turn Cost calculation
 */
export const DEFAULT_TURN_COST_WEIGHTS = {
	/** Weight for latency (λ) - normalized to seconds */
	lambda: 0.1,
	/** Weight for context reset tokens (γ) */
	gamma: 0.2,
	/** Weight for renegotiation count (ρ) */
	rho: 0.3,
	/** Weight for token bloat (τ) */
	tau: 0.1,
	/** Weight for attention switch count (α) */
	alpha: 0.3,
} as const;

export type TurnCostWeights = typeof DEFAULT_TURN_COST_WEIGHTS;

/**
 * Turn Cost components tracked during merge-weave operations
 */
export interface TurnCostComponents {
	/** Total latency in milliseconds */
	latencyMs: number;
	/** Context reset tokens (N/A for deterministic runner, always 0) */
	contextResetTokens: number;
	/** Number of renegotiation events (conflict retries, clarifications) */
	renegotiationCount: number;
	/** Token bloat (actual - expected tokens used) */
	tokenBloat: number;
	/** Number of attention switches (human interventions) */
	attentionSwitchCount: number;
}

/**
 * Event recorded during Turn Cost tracking
 */
export interface TurnCostEvent {
	/** Type of event */
	type: 'latency' | 'renegotiation' | 'token_bloat' | 'attention_switch';
	/** Timestamp of the event */
	timestamp: string;
	/** Event-specific details */
	details: {
		/** Reason for the event */
		reason?: string;
		/** Duration in milliseconds (for latency events) */
		durationMs?: number;
		/** Expected token count (for token bloat events) */
		expectedTokens?: number;
		/** Actual token count (for token bloat events) */
		actualTokens?: number;
		/** Item name associated with the event */
		itemName?: string;
	};
}

/**
 * Turn Cost summary for output
 */
export interface TurnCostSummary {
	/** Component values */
	components: TurnCostComponents;
	/** Weighted score using default weights */
	weightedScore: number;
	/** Number of events recorded */
	eventCount: number;
	/** Optional prior run score for comparison */
	priorRunScore?: number;
	/** Optional improvement percentage (negative = improvement) */
	improvement?: string;
}

/**
 * MergeWeaveTurnCost tracks coordination costs during merge-weave operations.
 *
 * Usage:
 * ```typescript
 * const turnCost = new MergeWeaveTurnCost();
 *
 * // Track latency for operations
 * const start = performance.now();
 * await someOperation();
 * turnCost.recordLatency(performance.now() - start);
 *
 * // Track renegotiation events
 * turnCost.recordRenegotiation('conflict in feature-branch');
 *
 * // Track token bloat
 * turnCost.recordTokenBloat(1000, 1500); // expected, actual
 *
 * // Track attention switches
 * turnCost.recordAttentionSwitch('manual conflict resolution required');
 *
 * // Get summary
 * const summary = turnCost.toJSON();
 * ```
 */
export class MergeWeaveTurnCost {
	private components: TurnCostComponents = {
		latencyMs: 0,
		contextResetTokens: 0,
		renegotiationCount: 0,
		tokenBloat: 0,
		attentionSwitchCount: 0,
	};

	private events: TurnCostEvent[] = [];
	private weights: TurnCostWeights;

	constructor(weights: TurnCostWeights = DEFAULT_TURN_COST_WEIGHTS) {
		this.weights = weights;
	}

	/**
	 * Record latency from an operation.
	 * @param durationMs Duration in milliseconds
	 * @param itemName Optional item name for context
	 */
	recordLatency(durationMs: number, itemName?: string): void {
		this.components.latencyMs += durationMs;
		this.events.push({
			type: 'latency',
			timestamp: new Date().toISOString(),
			details: {
				durationMs,
				itemName,
			},
		});
	}

	/**
	 * Record a renegotiation event (conflict resolution retry, clarification).
	 * @param reason Reason for the renegotiation
	 * @param itemName Optional item name for context
	 */
	recordRenegotiation(reason: string, itemName?: string): void {
		this.components.renegotiationCount++;
		this.events.push({
			type: 'renegotiation',
			timestamp: new Date().toISOString(),
			details: {
				reason,
				itemName,
			},
		});
	}

	/**
	 * Record token bloat (excess tokens used beyond expected).
	 * @param expected Expected token count
	 * @param actual Actual token count
	 * @param itemName Optional item name for context
	 */
	recordTokenBloat(expected: number, actual: number, itemName?: string): void {
		const bloat = Math.max(0, actual - expected);
		this.components.tokenBloat += bloat;
		this.events.push({
			type: 'token_bloat',
			timestamp: new Date().toISOString(),
			details: {
				expectedTokens: expected,
				actualTokens: actual,
				itemName,
			},
		});
	}

	/**
	 * Record an attention switch (human intervention required).
	 * @param reason Reason for the attention switch
	 * @param itemName Optional item name for context
	 */
	recordAttentionSwitch(reason: string, itemName?: string): void {
		this.components.attentionSwitchCount++;
		this.events.push({
			type: 'attention_switch',
			timestamp: new Date().toISOString(),
			details: {
				reason,
				itemName,
			},
		});
	}

	/**
	 * Get the current Turn Cost components.
	 */
	getComponents(): TurnCostComponents {
		return { ...this.components };
	}

	/**
	 * Get all recorded events.
	 */
	getEvents(): TurnCostEvent[] {
		return [...this.events];
	}

	/**
	 * Calculate the weighted Turn Cost score.
	 * @param weights Optional custom weights (uses default if not provided)
	 */
	getWeightedScore(weights: TurnCostWeights = this.weights): number {
		return (
			weights.lambda * (this.components.latencyMs / 1000) + // normalize ms to seconds
			weights.gamma * this.components.contextResetTokens +
			weights.rho * this.components.renegotiationCount +
			weights.tau * this.components.tokenBloat +
			weights.alpha * this.components.attentionSwitchCount
		);
	}

	/**
	 * Get Turn Cost summary for output.
	 * @param priorRunScore Optional prior run score for comparison
	 */
	toJSON(priorRunScore?: number): TurnCostSummary {
		const weightedScore = this.getWeightedScore();
		const summary: TurnCostSummary = {
			components: this.getComponents(),
			weightedScore: Math.round(weightedScore * 100) / 100, // Round to 2 decimal places
			eventCount: this.events.length,
		};

		if (priorRunScore !== undefined && priorRunScore > 0) {
			summary.priorRunScore = priorRunScore;
			const delta = ((weightedScore - priorRunScore) / priorRunScore) * 100;
			summary.improvement = `${delta > 0 ? '+' : ''}${Math.round(delta)}%`;
		}

		return summary;
	}

	/**
	 * Reset all tracked values.
	 */
	reset(): void {
		this.components = {
			latencyMs: 0,
			contextResetTokens: 0,
			renegotiationCount: 0,
			tokenBloat: 0,
			attentionSwitchCount: 0,
		};
		this.events = [];
	}

	/**
	 * Merge another TurnCost tracker into this one.
	 * Useful for aggregating per-item costs into a total.
	 */
	merge(other: MergeWeaveTurnCost): void {
		const otherComponents = other.getComponents();
		this.components.latencyMs += otherComponents.latencyMs;
		this.components.contextResetTokens += otherComponents.contextResetTokens;
		this.components.renegotiationCount += otherComponents.renegotiationCount;
		this.components.tokenBloat += otherComponents.tokenBloat;
		this.components.attentionSwitchCount += otherComponents.attentionSwitchCount;
		this.events.push(...other.getEvents());
	}
}

/**
 * Create a new Turn Cost tracker.
 * @param weights Optional custom weights
 */
export function createTurnCostTracker(weights?: TurnCostWeights): MergeWeaveTurnCost {
	return new MergeWeaveTurnCost(weights);
}
