/**
 * Decision Validation and Logging (LR-062)
 *
 * Handles submission and validation of LLM decisions at decision points within runs.
 * Enforces strict validation against nextOptions and response schemas, and maintains
 * append-only decision logs in NDJSON format.
 */

import { z } from "zod";
import type { NextOption, StatusResponse } from "../schemas/runCentric.js";
import { StatusResponseSchema } from "../schemas/runCentric.js";
import { readRunState, appendToRunLog, writeRunState, readRunLog } from "./storage.js";
import { buildStatusResponse } from "./statusBuilder.js";
import { RunNotFoundError } from "./types.js";

/**
 * Error codes for decision submission failures
 */
export const DecisionErrorCodes = {
	/** Action not found in current nextOptions */
	INVALID_ACTION: "INVALID_ACTION",
	/** Action exists but doesn't require LLM decision */
	NOT_DECISION_POINT: "NOT_DECISION_POINT",
	/** Response doesn't match required schema */
	VALIDATION_FAILED: "VALIDATION_FAILED",
	/** Run is in a terminal state (completed/failed) */
	INVALID_STATE: "INVALID_STATE",
} as const;

/**
 * Input schema for submitDecision
 */
export const SubmitDecisionInputSchema = z.object({
	/** Unique run identifier */
	runId: z.string(),
	/** Action to submit (must match a nextOptions[x].action) */
	action: z.string(),
	/** Response data (validated against nextOptions[x].responseSchema) */
	response: z.unknown(),
	/** Optional rationale for audit trail */
	rationale: z.string().optional(),
});

export type SubmitDecisionInput = z.infer<typeof SubmitDecisionInputSchema>;

/**
 * Output schema for submitDecision
 */
export const SubmitDecisionOutputSchema = z.object({
	/** Whether the decision was accepted */
	accepted: z.boolean(),
	/** Updated status after accepting the decision */
	updatedStatus: StatusResponseSchema,
	/** Error information if rejected */
	error: z.object({
		/** Error code from DecisionErrorCodes */
		code: z.string(),
		/** Human-readable error message */
		message: z.string(),
	}).optional(),
});

export type SubmitDecisionOutput = z.infer<typeof SubmitDecisionOutputSchema>;

/**
 * Decision log entry structure
 */
export interface DecisionLogEntry {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Run identifier */
	runId: string;
	/** Action that was submitted */
	action: string;
	/** Response data */
	response: unknown;
	/** Optional rationale */
	rationale?: string;
	/** State before the decision */
	state_before: string;
	/** State after the decision */
	state_after: string;
}

/**
 * Terminal states where decision submission is invalid
 */
const TERMINAL_STATES = ["completed", "failed", "aborted"];

/**
 * Validate that an action exists in the current nextOptions
 *
 * @param action - Action identifier to validate
 * @param nextOptions - Available next options
 * @returns The matching NextOption, or null if not found
 */
function findActionOption(
	action: string,
	nextOptions: NextOption[]
): NextOption | null {
	return nextOptions.find((opt) => opt.action === action) || null;
}

/**
 * Validate that a response matches the required schema
 *
 * @param response - Response data to validate
 * @param responseSchema - JSON Schema to validate against
 * @returns Validation result with error details if invalid
 */
function validateResponseSchema(
	response: unknown,
	responseSchema: Record<string, unknown> | undefined
): { valid: boolean; error?: string } {
	// If no schema is defined, accept any response
	if (!responseSchema) {
		return { valid: true };
	}

	// Convert JSON Schema to Zod schema for validation
	// For now, we'll do basic type checking based on the schema structure
	try {
		// If the schema is a simple object, we can do basic validation
		const schemaType = responseSchema.type as string | undefined;
		
		if (schemaType === "object") {
			if (typeof response !== "object" || response === null || Array.isArray(response)) {
				return {
					valid: false,
					error: `Expected object, got ${typeof response}`,
				};
			}

			// Check required properties if defined
			const required = responseSchema.required as string[] | undefined;
			if (required && Array.isArray(required)) {
				const respObj = response as Record<string, unknown>;
				for (const prop of required) {
					if (!(prop in respObj)) {
						return {
							valid: false,
							error: `Missing required property: ${prop}`,
						};
					}
				}
			}

			// Check properties if defined
			const properties = responseSchema.properties as Record<string, unknown> | undefined;
			if (properties) {
				const respObj = response as Record<string, unknown>;
				for (const [key, propSchema] of Object.entries(properties)) {
					if (key in respObj) {
						const propType = (propSchema as Record<string, unknown>).type as string | undefined;
						const value = respObj[key];
						
						if (propType === "string" && typeof value !== "string") {
							return {
								valid: false,
								error: `Property '${key}' should be string, got ${typeof value}`,
							};
						}
						if (propType === "number" && typeof value !== "number") {
							return {
								valid: false,
								error: `Property '${key}' should be number, got ${typeof value}`,
							};
						}
						if (propType === "boolean" && typeof value !== "boolean") {
							return {
								valid: false,
								error: `Property '${key}' should be boolean, got ${typeof value}`,
							};
						}
					}
				}
			}
		} else if (schemaType === "string" && typeof response !== "string") {
			return {
				valid: false,
				error: `Expected string, got ${typeof response}`,
			};
		} else if (schemaType === "number" && typeof response !== "number") {
			return {
				valid: false,
				error: `Expected number, got ${typeof response}`,
			};
		} else if (schemaType === "boolean" && typeof response !== "boolean") {
			return {
				valid: false,
				error: `Expected boolean, got ${typeof response}`,
			};
		} else if (schemaType === "array" && !Array.isArray(response)) {
			return {
				valid: false,
				error: `Expected array, got ${typeof response}`,
			};
		}

		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			error: `Schema validation error: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Apply state transition based on the submitted action
 *
 * NOTE: This implements a simplified state machine for decision-driven transitions.
 * For more complex state machines, consider extracting to a shared state machine module.
 *
 * @param currentState - Current run state
 * @param action - Action being submitted
 * @returns New state after applying the action
 */
function applyStateTransition(currentState: string, action: string): string {
	// State machine transitions based on action
	// This is a simplified version - real implementation would be more complex
	switch (action) {
		case "continue":
			if (currentState === "planning") return "executing";
			if (currentState === "gated") return "executing";
			return currentState;
		
		case "pause":
			return "paused";
		
		case "resume":
			if (currentState === "paused") return "executing";
			return currentState;
		
		case "abort":
			return "aborted";
		
		case "retry":
			return "gated";
		
		case "skip":
			// When skipping a gate, move to executing
			return "executing";
		
		case "restart":
			return "planning";
		
		default:
			// Unknown actions don't change state
			return currentState;
	}
}

/**
 * Submit an LLM decision for a pending action in a run
 *
 * Validates the decision against current nextOptions and response schema,
 * then logs the decision and updates run state.
 *
 * @param input - Decision submission parameters
 * @param baseDir - Base directory for run storage
 * @returns Decision result with updated status or error
 */
export function submitDecision(
	input: SubmitDecisionInput,
	baseDir: string = process.cwd()
): SubmitDecisionOutput {
	const { runId, action, response, rationale } = input;

	// Read current run state
	const runState = readRunState(runId, baseDir);
	if (!runState) {
		// Build an empty status response for nonexistent run
		const dummyStatus: StatusResponse = {
			runId,
			state: "failed",
			mode: "unknown",
			procedure: "unknown",
			summary: "Run not found",
			nextOptions: [],
		};
		
		return {
			accepted: false,
			updatedStatus: dummyStatus,
			error: {
				code: DecisionErrorCodes.INVALID_STATE,
				message: `Run not found: ${runId}`,
			},
		};
	}

	// Check if run is in a terminal state
	if (TERMINAL_STATES.includes(runState.state)) {
		return {
			accepted: false,
			updatedStatus: buildStatusResponse(runState, { baseDir }),
			error: {
				code: DecisionErrorCodes.INVALID_STATE,
				message: `Cannot submit decisions for run in ${runState.state} state. Valid states: planning, gated, executing, paused.`,
			},
		};
	}

	// Build current status to get nextOptions
	const currentStatus = buildStatusResponse(runState, { baseDir });

	// Validate action exists in nextOptions
	const actionOption = findActionOption(action, currentStatus.nextOptions);
	if (!actionOption) {
		const availableActions = currentStatus.nextOptions
			.map((opt) => opt.action)
			.join(", ");
		return {
			accepted: false,
			updatedStatus: currentStatus,
			error: {
				code: DecisionErrorCodes.INVALID_ACTION,
				message: `Action '${action}' not found in available options. Available: ${availableActions}`,
			},
		};
	}

	// Validate action requires LLM decision
	if (!actionOption.requiresLLMDecision) {
		return {
			accepted: false,
			updatedStatus: currentStatus,
			error: {
				code: DecisionErrorCodes.NOT_DECISION_POINT,
				message: `Action '${action}' does not require LLM decision. Use standard action submission instead.`,
			},
		};
	}

	// Validate response against schema
	const schemaValidation = validateResponseSchema(
		response,
		actionOption.responseSchema
	);
	if (!schemaValidation.valid) {
		return {
			accepted: false,
			updatedStatus: currentStatus,
			error: {
				code: DecisionErrorCodes.VALIDATION_FAILED,
				message: `Response validation failed: ${schemaValidation.error}`,
			},
		};
	}

	// Decision is valid - log it
	const stateBefore = runState.state;
	const stateAfter = applyStateTransition(stateBefore, action);

	const logEntry: DecisionLogEntry = {
		timestamp: new Date().toISOString(),
		runId,
		action,
		response,
		rationale,
		state_before: stateBefore,
		state_after: stateAfter,
	};

	appendToRunLog(runId, "decisions", logEntry as unknown as Record<string, unknown>, baseDir);

	// Update run state
	runState.state = stateAfter;
	runState.updatedAt = new Date().toISOString();
	
	// Update metadata with decision context
	if (!runState.metadata) {
		runState.metadata = {};
	}
	runState.metadata.lastDecision = {
		action,
		timestamp: logEntry.timestamp,
		rationale,
	};

	writeRunState(runState, baseDir);

	// Build updated status
	const updatedStatus = buildStatusResponse(runState, { baseDir });

	return {
		accepted: true,
		updatedStatus,
	};
}

/**
 * Read all decision log entries for a run
 *
 * NOTE: Uses `as unknown as` to bridge from generic Record to specific type.
 * The NDJSON log format doesn't provide runtime type guarantees, so this is
 * acceptable as long as we control the write path (which we do via appendToRunLog).
 *
 * @param runId - Run identifier
 * @param baseDir - Base directory for run storage
 * @returns Array of decision log entries
 */
export function getDecisions(
	runId: string,
	baseDir: string = process.cwd()
): DecisionLogEntry[] {
	try {
		const entries = readRunLog(runId, "decisions", baseDir);
		// Safe cast since we control the write path through submitDecision
		return entries as unknown as DecisionLogEntry[];
	} catch {
		// Return empty array if log doesn't exist yet
		return [];
	}
}
