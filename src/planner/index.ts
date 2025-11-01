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

// Scope validation for agent edits
export * from "./scopeValidator.js";

// Plan validation with cycle detection and diagnostics
export {
        validatePlan,
        formatValidationResult,
        type ValidationResult,
        type ValidationError,
        type ValidationWarning,
        type ValidationDiagnostics,
        type ValidationErrorType,
        type ValidationWarningType
} from "./validation.js";