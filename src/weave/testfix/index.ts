/**
 * Test Fix Pattern Library
 *
 * Provides deterministic test repair based on pattern matching.
 * Supports post-merge test fixes as documented in merge-weave-interventions.md.
 *
 * @module
 */

export * from "./schema.js";
export * from "./loader.js";
export * from "./matcher.js";
export * from "./applier.js";

// Re-export key functions for convenience
export {
	loadTestFixPatterns,
	safeLoadTestFixPatterns,
} from "./loader.js";
export {
	matchTriggers,
	findFixLocations,
	matchAndLocate,
} from "./matcher.js";
export {
	buildFixInstruction,
	applyFix,
	applyFixes,
} from "./applier.js";
