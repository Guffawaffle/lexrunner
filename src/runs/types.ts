/**
 * Run-centric types for lexrunner.startRun and lexrunner.getStatus
 * 
 * These types define the run lifecycle state machine for tool-grounded orchestration.
 */

import { z } from "zod";
import type { StatusResponse, NextOption } from "../schemas/runCentric.js";
import { StatusResponseSchema } from "../schemas/runCentric.js";

// Re-export for convenience
export type { StatusResponse, NextOption };

/**
 * Valid run states for the state machine
 */
export const RunStateSchema = z.enum([
	"planning",
	"gated",
	"executing",
	"completed",
	"failed",
	"paused",
	"aborted"
]);

export type RunState = z.infer<typeof RunStateSchema>;

/**
 * Input parameters for starting a run
 */
export const StartRunInputSchema = z.object({
	/** Persona mode, e.g. "senior-dev", "eager-pm" */
	mode: z.string(),
	/** Procedure identifier, e.g. "merge-weave-main", "pr-review" */
	procedure: z.string(),
	/** Repository in "owner/repo" format */
	repo: z.string(),
	/** Human-readable task description */
	task: z.string().optional(),
	/** Procedure-specific parameters */
	params: z.record(z.unknown()).optional()
});

export type StartRunInput = z.infer<typeof StartRunInputSchema>;

/**
 * Output from starting a run
 */
export interface StartRunOutput {
	runId: string;
	initialStatus: StatusResponse;
}

/**
 * Input for getStatus
 */
export const GetStatusInputSchema = z.object({
	runId: z.string()
});

export type GetStatusInput = z.infer<typeof GetStatusInputSchema>;

/**
 * Progress tracking for a run
 */
export interface RunProgress {
	/** List of completed step identifiers */
	completed: string[];
	/** Current step identifier, or null if between steps */
	current: string | null;
	/** List of remaining step identifiers */
	remaining: string[];
}

/**
 * Persistent run state stored in `.lexrunner/runs/{runId}.json`
 */
export const RunStateFileSchema = z.object({
	/** Unique run identifier (ULID) */
	runId: z.string(),
	/** Current state */
	state: RunStateSchema,
	/** Persona mode */
	mode: z.string(),
	/** Procedure identifier */
	procedure: z.string(),
	/** Repository in "owner/repo" format */
	repo: z.string(),
	/** Human-readable task description */
	task: z.string().optional(),
	/** Procedure-specific parameters */
	params: z.record(z.unknown()).optional(),
	/** Creation timestamp (ISO 8601) */
	createdAt: z.string(),
	/** Last update timestamp (ISO 8601) */
	updatedAt: z.string(),
	/** Progress tracking */
	progress: z.object({
		completed: z.array(z.string()),
		current: z.string().nullable(),
		remaining: z.array(z.string())
	}).optional(),
	/** Additional context for the run */
	context: z.record(z.unknown()).optional(),
	/** Risk flags for the current state */
	riskFlags: z.array(z.string()).optional(),
	/** Blocking issues that prevent progress */
	blockers: z.array(z.string()).optional()
});

export type RunStateFile = z.infer<typeof RunStateFileSchema>;

/**
 * Error thrown when a run is not found
 */
export class RunNotFoundError extends Error {
	constructor(runId: string) {
		super(`Run not found: ${runId}`);
		this.name = "RunNotFoundError";
	}
}

/**
 * Error thrown when run state is invalid
 */
export class InvalidRunStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidRunStateError";
	}
}
