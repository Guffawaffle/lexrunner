/**
 * Heuristic fallback strategies for conflict resolution
 * 
 * Used when AI abstains due to high risk or unavailability.
 * Provides rule-based resolution for common conflict patterns.
 */

import type { 
	ConflictResolutionInput, 
	ConflictResolutionOutput,
	ResolutionOperation 
} from "./conflictStrategySchema.js";

/**
 * Apply heuristic-based conflict resolution
 * 
 * Uses pattern matching to handle common conflict types:
 * - Import order conflicts → merge both
 * - Whitespace conflicts → accept-theirs
 * - Formatting conflicts → accept-theirs
 * - Everything else → manual-review
 * 
 * @param input - Conflict resolution input
 * @returns Heuristic resolution strategy
 */
export function applyHeuristicFallback(input: ConflictResolutionInput): ConflictResolutionOutput {
	const ops: ResolutionOperation[] = [];
	let maxRisk = 0.0;
	
	// Analyze hints to determine conflict types
	const importHints = input.hints.filter(h => h.type === "import-order");
	const whitespaceHints = input.hints.filter(h => h.type === "whitespace");
	const formattingHints = input.hints.filter(h => h.type === "formatting");
	const semanticHints = input.hints.filter(h => h.type === "semantic");
	const structuralHints = input.hints.filter(h => h.type === "structural");
	
	// Strategy 1: Import order conflicts - merge both
	if (importHints.length > 0 && semanticHints.length === 0 && structuralHints.length === 0) {
		for (let i = 0; i < Math.min(input.hunkHashes.length, input.paths.length); i++) {
			ops.push({
				type: "merge-both",
				path: input.paths[i] || input.paths[0],
				hunkHash: input.hunkHashes[i],
				rationale: "Import order conflict - safe to merge both imports"
			});
		}
		maxRisk = 0.15;
	}
	// Strategy 2: Whitespace/formatting only - accept theirs
	else if ((whitespaceHints.length > 0 || formattingHints.length > 0) && 
	         semanticHints.length === 0 && structuralHints.length === 0) {
		for (let i = 0; i < Math.min(input.hunkHashes.length, input.paths.length); i++) {
			ops.push({
				type: "accept-theirs",
				path: input.paths[i] || input.paths[0],
				hunkHash: input.hunkHashes[i],
				rationale: "Whitespace/formatting conflict - accepting incoming changes"
			});
		}
		maxRisk = 0.10;
	}
	// Strategy 3: Semantic or structural - manual review
	else {
		for (let i = 0; i < Math.min(input.hunkHashes.length, input.paths.length); i++) {
			ops.push({
				type: "manual-review",
				path: input.paths[i] || input.paths[0],
				hunkHash: input.hunkHashes[i],
				rationale: "Complex conflict requires manual review"
			});
		}
		maxRisk = 0.50;
	}
	
	// Determine overall strategy
	const hasManualReview = ops.some(op => op.type === "manual-review");
	const strategy = hasManualReview ? "manual-review" : "auto-resolve";
	
	return {
		strategy,
		ops,
		risk: maxRisk,
		explanation: `Heuristic fallback: ${getHeuristicExplanation(importHints, whitespaceHints, formattingHints, semanticHints, structuralHints)}`,
		abstained: false,
		fallbackMethod: "heuristic"
	};
}

/**
 * Generate explanation for heuristic strategy
 */
function getHeuristicExplanation(
	importHints: any[],
	whitespaceHints: any[],
	formattingHints: any[],
	semanticHints: any[],
	structuralHints: any[]
): string {
	if (importHints.length > 0 && semanticHints.length === 0 && structuralHints.length === 0) {
		return "Import order conflicts detected - merging both import sets";
	}
	
	if ((whitespaceHints.length > 0 || formattingHints.length > 0) && 
	    semanticHints.length === 0 && structuralHints.length === 0) {
		return "Whitespace/formatting conflicts detected - accepting incoming changes";
	}
	
	return "Complex conflict patterns detected - requiring manual review";
}

/**
 * Check if conflict is trivial and safe for auto-resolution
 * 
 * Trivial conflicts:
 * - Import order only
 * - Whitespace only
 * - Formatting only
 * - No semantic or structural changes
 * 
 * @param input - Conflict resolution input
 * @returns true if trivial
 */
export function isTrivialConflict(input: ConflictResolutionInput): boolean {
	const semanticHints = input.hints.filter(h => h.type === "semantic");
	const structuralHints = input.hints.filter(h => h.type === "structural");
	const structuralSymbols = input.symbols.filter(s => 
		s.type === "function" || s.type === "class"
	);
	
	// No semantic/structural hints and no structural symbols
	return semanticHints.length === 0 && 
	       structuralHints.length === 0 && 
	       structuralSymbols.length === 0;
}

/**
 * Get confidence score for heuristic resolution
 * 
 * @param input - Conflict resolution input
 * @returns Confidence score (0-1)
 */
export function getHeuristicConfidence(input: ConflictResolutionInput): number {
	if (isTrivialConflict(input)) {
		// High confidence for trivial conflicts
		return 0.85;
	}
	
	// Lower confidence for complex conflicts
	const semanticHints = input.hints.filter(h => h.type === "semantic");
	const structuralSymbols = input.symbols.filter(s => 
		s.type === "function" || s.type === "class"
	);
	
	const complexity = semanticHints.length + structuralSymbols.length;
	return Math.max(0.2, 1.0 - (complexity * 0.1));
}
