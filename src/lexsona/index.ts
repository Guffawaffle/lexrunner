/**
 * LexSona Integration Module
 *
 * Public API for LexRunner ↔ LexSona shadow governance integration.
 * Implements Version Contract v0.1: Shadow mode only, no enforcement.
 *
 * Usage:
 *   import { getLexSonaConfig, isLexSonaEnabled, deriveShadowConstraints } from './lexsona';
 *
 * Environment Variables:
 *   LEXSONA_MODE     - "off" (default) | "shadow"
 *   LEXSONA_PERSONA  - Persona ID (e.g., "quality-first_engineering")
 *   LEX_DB_PATH      - Path to Lex database (optional, enables connected mode)
 */

// Types
export type {
	LexSonaMode,
	LexSonaEnvConfig,
	LexSonaWorkflowContext,
	LexSonaShadowResult,
	LexSonaConstraintSnapshot,
	GovernanceComparisonLog,
} from "./types.js";

export { GovernanceComparisonLogSchema } from "./types.js";

// Client
export {
	getLexSonaConfig,
	isLexSonaEnabled,
	deriveShadowConstraints,
	generateGovernanceLogId,
} from "./client.js";

// Logger
export type { RunnerGovernanceSignals } from "./logger.js";
export {
	createGovernanceComparisonLog,
	writeGovernanceLog,
	readGovernanceLogs,
	formatGovernanceLog,
} from "./logger.js";
