/**
 * AI Module - Conflict Resolution Strategy
 * 
 * Provides AI-driven conflict resolution with:
 * - JSON I/O contracts
 * - SHA-256 caching
 * - Risk-based abstention (threshold: 0.35)
 * - Heuristic fallback
 * 
 * @packageDocumentation
 */

// Main API
export {
	resolveConflict,
	resolveConflictsBatch,
	getCacheStats,
	clearCache,
	type ResolveConflictOptions
} from "./conflictStrategy.js";

// Schemas
export {
	ConflictResolutionInputSchema,
	ConflictResolutionOutputSchema,
	ResolutionOperationSchema,
	CachedResolutionSchema,
	type ConflictResolutionInput,
	type ConflictResolutionOutput,
	type ResolutionOperation,
	type CachedResolution
} from "./conflictStrategySchema.js";

// Caching
export {
	ConflictResolutionCache,
	generateCacheKey,
	globalConflictCache
} from "./conflictStrategyCache.js";

// Risk Scoring
export {
	calculateRiskScore,
	shouldAbstain,
	getRiskLevel,
	assessRisk,
	RISK_THRESHOLD
} from "./riskScoring.js";

// Prompt Generation
export {
	buildPrompt,
	parseAIResponse,
	generateConflictPrompt,
	estimateTokenCount,
	SYSTEM_PROMPT
} from "./conflictStrategyPrompt.js";

// Heuristic Fallback
export {
	applyHeuristicFallback,
	isTrivialConflict,
	getHeuristicConfidence
} from "./heuristicFallback.js";
