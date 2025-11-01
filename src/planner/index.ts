/**
 * Planner module - Dependency parsing, file analysis, and plan generation
 */

// Dependency parsing (PR #110)
export {
        parsePRDescription,
        validateDependencies,
        isValidDependencyRef,
        normalizeDependencyRef,
        type ParsedDependency,
        type ParserOptions
} from "./dependencyParser.js";

// File analysis and intersection detection (PR #111)
export * from "./types.js";
export * from "./fileAnalysis.js";

// Dependency scoring and weighting (Issue #196)
export {
	scoreDependencies,
	mergeDuplicateScores,
	sortScores,
	type DependencyScore,
	type ScoringOptions
} from "./dependencyScoring.js";

// Scope validation for agent edits
export * from "./scopeValidator.js";