/**
 * Zod schema for procedure definition YAML files
 *
 * Validates procedure definitions at load time to ensure
 * they are well-formed and complete.
 *
 * @internal This module is internal to lex-pr-runner and should not be
 * imported directly by external consumers. The procedure format may
 * change between minor versions.
 */

import { z } from "zod";

/**
 * Risk level for decision options
 */
export const RiskLevelSchema = z.enum(["low", "medium", "high"]);

/**
 * Decision option schema
 */
export const DecisionOptionSchema = z.object({
	/** Action identifier */
	action: z.string().min(1),
	/** Human-readable description */
	description: z.string().min(1),
	/** Risk level for this option */
	riskLevel: RiskLevelSchema.optional(),
});

/**
 * Decision point schema
 */
export const DecisionPointSchema = z.object({
	/** State where this decision point applies */
	state: z.string().min(1),
	/** Whether this requires an LLM decision */
	requiresLLMDecision: z.boolean(),
	/** Prompt to present to the LLM */
	prompt: z.string().min(1),
	/** Available options for this decision */
	options: z.array(DecisionOptionSchema).min(1),
});

/**
 * Transition map schema - event to next state
 */
export const TransitionMapSchema = z.record(z.string(), z.string());

/**
 * Schema version - follows SemVer 1.x.y format
 */
export const ProcedureSchemaVersion = z
	.string()
	.regex(/^1\.\d+\.\d+$/, "Schema version must be 1.x.y format");

/**
 * Complete procedure definition schema
 */
export const ProcedureDefinitionSchema = z.object({
	/** Schema version for the procedure format */
	schemaVersion: ProcedureSchemaVersion,
	/** Unique identifier for this procedure */
	id: z.string().min(1),
	/** Human-readable name */
	name: z.string().min(1),
	/** Description of what this procedure does */
	description: z.string().min(1),
	/** List of all valid states */
	states: z.array(z.string().min(1)).min(1),
	/** Initial state when the procedure starts */
	initialState: z.string().min(1),
	/** State transition definitions */
	transitions: z.record(z.string(), TransitionMapSchema),
	/** Decision points that may require input */
	decisionPoints: z.array(DecisionPointSchema).optional(),
	/** Gates that must pass for completion */
	completionGates: z.array(z.string().min(1)).optional(),
});

export type ProcedureDefinitionParsed = z.infer<
	typeof ProcedureDefinitionSchema
>;

/**
 * Validate procedure definition against schema
 * @param data - Raw procedure definition data
 * @returns Validation result with errors if any
 */
export function validateProcedureSchema(data: unknown): {
	valid: boolean;
	data?: ProcedureDefinitionParsed;
	errors?: { path: string; message: string; code: string }[];
} {
	const result = ProcedureDefinitionSchema.safeParse(data);

	if (result.success) {
		return { valid: true, data: result.data };
	}

	return {
		valid: false,
		errors: result.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
			code: issue.code,
		})),
	};
}

/**
 * Perform semantic validation beyond schema validation
 * - Initial state must be in states list
 * - All transition targets must be valid states
 * - Decision point states must exist
 * @param definition - Validated procedure definition
 * @returns List of semantic validation errors
 */
export function validateProcedureSemantics(
	definition: ProcedureDefinitionParsed
): { path: string; message: string; code: string }[] {
	const errors: { path: string; message: string; code: string }[] = [];
	const statesSet = new Set(definition.states);

	// Check initial state exists
	if (!statesSet.has(definition.initialState)) {
		errors.push({
			path: "initialState",
			message: `Initial state "${definition.initialState}" is not in states list`,
			code: "invalid_initial_state",
		});
	}

	// Check all transition targets are valid states
	for (const [fromState, transitions] of Object.entries(
		definition.transitions
	)) {
		if (!statesSet.has(fromState)) {
			errors.push({
				path: `transitions.${fromState}`,
				message: `State "${fromState}" in transitions is not in states list`,
				code: "invalid_transition_source",
			});
		}

		for (const [event, toState] of Object.entries(transitions)) {
			if (!statesSet.has(toState)) {
				errors.push({
					path: `transitions.${fromState}.${event}`,
					message: `Target state "${toState}" is not in states list`,
					code: "invalid_transition_target",
				});
			}
		}
	}

	// Check decision point states exist
	if (definition.decisionPoints) {
		for (let i = 0; i < definition.decisionPoints.length; i++) {
			const dp = definition.decisionPoints[i];
			if (!statesSet.has(dp.state)) {
				errors.push({
					path: `decisionPoints[${i}].state`,
					message: `Decision point state "${dp.state}" is not in states list`,
					code: "invalid_decision_point_state",
				});
			}
		}
	}

	return errors;
}
