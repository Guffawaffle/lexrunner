/**
 * Type definitions for the Procedure Library
 *
 * Procedures define state machines for different workflow types
 * (merge-weave, PR review, sprint planning). These are config-driven
 * and loaded from YAML files.
 */

import type { NextOption } from "../schemas/runCentric.js";

/**
 * Risk level for decision options
 */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Decision option within a decision point
 */
export interface DecisionOption {
	/** Action identifier */
	action: string;
	/** Human-readable description */
	description: string;
	/** Risk level for this option */
	riskLevel?: RiskLevel;
}

/**
 * Decision point that may require LLM decision
 */
export interface DecisionPoint {
	/** State where this decision point applies */
	state: string;
	/** Whether this requires an LLM decision */
	requiresLLMDecision: boolean;
	/** Prompt to present to the LLM */
	prompt: string;
	/** Available options for this decision */
	options: DecisionOption[];
}

/**
 * Transition map from one state to another based on events
 */
export type TransitionMap = Record<string, string>;

/**
 * Complete transitions definition for all states
 */
export type TransitionsDefinition = Record<string, TransitionMap>;

/**
 * Run context for procedure execution
 */
export interface RunContext {
	/** Current run identifier */
	runId: string;
	/** Current state */
	state: string;
	/** Any additional context data */
	[key: string]: unknown;
}

/**
 * Procedure definition as loaded from YAML
 */
export interface ProcedureDefinition {
	/** Schema version for the procedure format */
	schemaVersion: string;
	/** Unique identifier for this procedure */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what this procedure does */
	description: string;
	/** List of all valid states */
	states: string[];
	/** Initial state when the procedure starts */
	initialState: string;
	/** State transition definitions */
	transitions: TransitionsDefinition;
	/** Decision points that may require input */
	decisionPoints?: DecisionPoint[];
	/** Gates that must pass for completion */
	completionGates?: string[];
}

/**
 * Summary information about a procedure
 */
export interface ProcedureSummary {
	/** Unique identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description */
	description: string;
	/** File path where the procedure is defined */
	filePath: string;
}

/**
 * Result of procedure validation
 */
export interface ProcedureValidationResult {
	/** Whether the procedure is valid */
	valid: boolean;
	/** List of validation errors if any */
	errors: ProcedureValidationError[];
}

/**
 * A single validation error
 */
export interface ProcedureValidationError {
	/** Path to the error in the definition */
	path: string;
	/** Error message */
	message: string;
	/** Error code */
	code: string;
}

/**
 * Procedure interface for runtime use
 */
export interface Procedure {
	/** Unique identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description */
	description: string;

	/** Get the initial state for this procedure */
	getInitialState(): string;

	/** Get available options for the current state and context */
	getNextOptions(state: string, context: RunContext): NextOption[];

	/** Check if a transition is valid */
	canTransition(from: string, event: string): boolean;

	/** Apply a transition and return the new state */
	applyTransition(from: string, event: string): string;

	/** Check if a state is terminal (no outgoing transitions) */
	isTerminal(state: string): boolean;

	/** Get the decision point for a state if any */
	getDecisionPoint(state: string): DecisionPoint | null;

	/** Get the list of completion gates */
	getCompletionGates(): string[];
}
