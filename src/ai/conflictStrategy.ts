/**
 * AI Conflict Resolution Strategy
 * 
 * Main orchestrator that combines:
 * - JSON I/O schemas
 * - Caching layer
 * - Risk scoring
 * - AI prompt generation
 * - Heuristic fallback
 */

import type { 
	ConflictResolutionInput, 
	ConflictResolutionOutput 
} from "./conflictStrategySchema.js";
import { ConflictResolutionInputSchema, ConflictResolutionOutputSchema } from "./conflictStrategySchema.js";
import { generateCacheKey, globalConflictCache, ConflictResolutionCache } from "./conflictStrategyCache.js";
import { assessRisk, shouldAbstain, RISK_THRESHOLD } from "./riskScoring.js";
import { buildPrompt, parseAIResponse } from "./conflictStrategyPrompt.js";
import { applyHeuristicFallback } from "./heuristicFallback.js";

/**
 * Options for conflict resolution strategy
 */
export interface ResolveConflictOptions {
	/**
	 * Custom cache instance (optional)
	 * If not provided, uses global cache
	 */
	cache?: ConflictResolutionCache;
	
	/**
	 * Force skip cache lookup
	 */
	skipCache?: boolean;
	
	/**
	 * AI model caller function (optional)
	 * If not provided, falls back to heuristics
	 */
	aiCaller?: (systemPrompt: string, userPrompt: string) => Promise<string>;
	
	/**
	 * Cache TTL in seconds (optional)
	 */
	cacheTTL?: number;
	
	/**
	 * Force heuristic fallback (skip AI)
	 */
	forceHeuristic?: boolean;
}

/**
 * Resolve conflict using AI strategy with caching and risk assessment
 * 
 * Workflow:
 * 1. Validate input schema
 * 2. Generate cache key from input
 * 3. Check cache for existing resolution
 * 4. If cache miss, assess risk
 * 5. If risk > threshold, use heuristic fallback
 * 6. Otherwise, query AI model
 * 7. Validate output schema
 * 8. Store in cache
 * 9. Return resolution
 * 
 * @param input - Conflict resolution input
 * @param options - Resolution options
 * @returns Conflict resolution output
 */
export async function resolveConflict(
	input: ConflictResolutionInput,
	options: ResolveConflictOptions = {}
): Promise<ConflictResolutionOutput> {
	// Step 1: Validate input
	const validatedInput = ConflictResolutionInputSchema.parse(input);
	
	// Step 2: Generate cache key
	const cacheKey = generateCacheKey(validatedInput);
	
	// Step 3: Check cache (if not skipped)
	const cache = options.cache || globalConflictCache;
	if (!options.skipCache) {
		const cached = cache.get(cacheKey);
		if (cached) {
			return cached;
		}
	}
	
	// Step 4: Assess risk
	const riskAssessment = assessRisk(validatedInput);
	
	// Step 5: Check if we should abstain (risk > threshold)
	if (shouldAbstain(riskAssessment.score) || options.forceHeuristic) {
		// Use heuristic fallback
		const heuristicResult = applyHeuristicFallback(validatedInput);
		
		// Mark as abstained if due to risk
		if (shouldAbstain(riskAssessment.score)) {
			heuristicResult.abstained = true;
			heuristicResult.explanation = `Risk too high (${riskAssessment.score.toFixed(2)} > ${RISK_THRESHOLD}): ${riskAssessment.factors.join(", ")}. ${heuristicResult.explanation}`;
		}
		
		// Cache the result
		cache.set(cacheKey, heuristicResult, options.cacheTTL);
		
		return heuristicResult;
	}
	
	// Step 6: Query AI (if caller provided)
	if (options.aiCaller) {
		try {
			const { system, user } = buildPrompt(validatedInput);
			const aiResponse = await options.aiCaller(system, user);
			const parsedResponse = parseAIResponse(aiResponse);
			
			// Step 7: Validate AI output
			const aiResult = ConflictResolutionOutputSchema.parse(parsedResponse);
			
			// Enhance with risk assessment
			if (aiResult.risk < riskAssessment.score) {
				aiResult.risk = riskAssessment.score;
			}
			
			// Step 8: Cache the result
			cache.set(cacheKey, aiResult, options.cacheTTL);
			
			return aiResult;
		} catch (error) {
			// AI failed, fall back to heuristics
			const heuristicResult = applyHeuristicFallback(validatedInput);
			heuristicResult.abstained = true;
			heuristicResult.explanation = `AI resolution failed: ${error instanceof Error ? error.message : String(error)}. ${heuristicResult.explanation}`;
			
			// Cache the fallback result
			cache.set(cacheKey, heuristicResult, options.cacheTTL);
			
			return heuristicResult;
		}
	}
	
	// No AI caller provided, use heuristics
	const heuristicResult = applyHeuristicFallback(validatedInput);
	heuristicResult.explanation = `No AI model available. ${heuristicResult.explanation}`;
	
	// Cache the result
	cache.set(cacheKey, heuristicResult, options.cacheTTL);
	
	return heuristicResult;
}

/**
 * Batch resolve multiple conflicts
 * 
 * Processes conflicts in parallel while sharing cache
 * 
 * @param inputs - Array of conflict inputs
 * @param options - Resolution options
 * @returns Array of resolutions
 */
export async function resolveConflictsBatch(
	inputs: ConflictResolutionInput[],
	options: ResolveConflictOptions = {}
): Promise<ConflictResolutionOutput[]> {
	return Promise.all(
		inputs.map(input => resolveConflict(input, options))
	);
}

/**
 * Get cache statistics
 * 
 * @param cache - Cache instance (optional)
 * @returns Cache stats
 */
export function getCacheStats(cache?: ConflictResolutionCache): {
	hits: number;
	misses: number;
	size: number;
	hitRate: number;
} {
	const cacheInstance = cache || globalConflictCache;
	return cacheInstance.getStats();
}

/**
 * Clear cache
 * 
 * @param cache - Cache instance (optional)
 */
export function clearCache(cache?: ConflictResolutionCache): void {
	const cacheInstance = cache || globalConflictCache;
	cacheInstance.clear();
}

// Export all components for direct use
export { 
	ConflictResolutionCache,
	generateCacheKey
} from "./conflictStrategyCache.js";
export { 
	assessRisk,
	shouldAbstain,
	RISK_THRESHOLD,
	calculateRiskScore, 
	getRiskLevel 
} from "./riskScoring.js";
export { 
	buildPrompt,
	parseAIResponse,
	SYSTEM_PROMPT, 
	generateConflictPrompt, 
	estimateTokenCount 
} from "./conflictStrategyPrompt.js";
export { 
	applyHeuristicFallback,
	isTrivialConflict, 
	getHeuristicConfidence 
} from "./heuristicFallback.js";
export * from "./conflictStrategySchema.js";
