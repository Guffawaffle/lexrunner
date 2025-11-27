/**
 * Procedure Library Module
 *
 * Provides procedures for different workflow types (merge-weave, PR review,
 * sprint planning). Procedures are config-driven state machines loaded from YAML.
 *
 * @internal This module is internal to lex-pr-runner. The procedure format and
 * API may change between minor versions. External consumers should not depend
 * on the procedure system directly.
 */

// Types
export type {
	RiskLevel,
	DecisionOption,
	DecisionPoint,
	TransitionMap,
	TransitionsDefinition,
	RunContext,
	ProcedureDefinition,
	ProcedureSummary,
	ProcedureValidationResult,
	ProcedureValidationError,
	Procedure,
} from "./types.js";

// Schema
export {
	RiskLevelSchema,
	DecisionOptionSchema,
	DecisionPointSchema,
	TransitionMapSchema,
	ProcedureSchemaVersion,
	ProcedureDefinitionSchema,
	validateProcedureSchema,
	validateProcedureSemantics,
} from "./schema.js";
export type { ProcedureDefinitionParsed } from "./schema.js";

// State machine
export { ProcedureStateMachine } from "./stateMachine.js";

// Loader
export {
	ProcedureLoader,
	ProcedureLoadError,
	createProcedureLoader,
} from "./loader.js";
export type { ProcedureLoaderOptions } from "./loader.js";
