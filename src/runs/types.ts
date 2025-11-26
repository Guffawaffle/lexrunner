/**
 * Run Lifecycle Types
 *
 * Core types for the run lifecycle manager, including RunState, RunFilter,
 * and related interfaces for tracking tool-grounded execution runs.
 */

import { z } from "zod";
import { PersonaSnapshotSchema } from "../schemas/runCentric.js";

/**
 * Run State Schema
 *
 * Represents the complete state of a run at any point in time.
 * Persisted to .lexrunner/runs/{runId}.json
 */
export const RunStateSchema = z.object({
	/** Unique run identifier (ULID) */
	runId: z.string(),
	/** Persona mode, e.g. "senior-dev", "eager-pm" */
	mode: z.string(),
	/** Procedure being executed, e.g. "merge-weave-main", "pr-review" */
	procedure: z.string(),
	/** Repository identifier (owner/repo or path) */
	repo: z.string(),
	/** Optional task description */
	task: z.string().optional(),

	// Lifecycle
	/** Current state in procedure state machine */
	state: z.string(),
	/** ISO 8601 timestamp when run was created */
	createdAt: z.string(),
	/** ISO 8601 timestamp when run was last updated */
	updatedAt: z.string(),
	/** ISO 8601 timestamp when run completed (if applicable) */
	completedAt: z.string().optional(),

	// Progress
	/** List of completed step identifiers */
	completedSteps: z.array(z.string()),
	/** Current step identifier, or null if between steps */
	currentStep: z.string().nullable(),

	// Context
	/** Runtime parameters for the run */
	params: z.record(z.unknown()),
	/** Additional metadata for the run */
	metadata: z.record(z.unknown()),

	// Persona snapshot (frozen at run start)
	/** Snapshot of the active persona configuration */
	persona: PersonaSnapshotSchema.optional()
});

export type RunState = z.infer<typeof RunStateSchema>;

/**
 * Parameters for creating a new run
 */
export interface CreateRunParams {
	/** Persona mode, e.g. "senior-dev", "eager-pm" */
	mode: string;
	/** Procedure being executed, e.g. "merge-weave-main", "pr-review" */
	procedure: string;
	/** Repository identifier (owner/repo or path) */
	repo: string;
	/** Optional task description */
	task?: string;
	/** Initial state in procedure state machine */
	initialState?: string;
	/** Runtime parameters for the run */
	params?: Record<string, unknown>;
	/** Additional metadata for the run */
	metadata?: Record<string, unknown>;
	/** Persona snapshot to freeze for the run */
	persona?: z.infer<typeof PersonaSnapshotSchema>;
}

/**
 * Filter options for listing runs
 */
export interface RunFilter {
	/** Filter by state */
	state?: string;
	/** Filter by procedure */
	procedure?: string;
	/** Filter by mode */
	mode?: string;
	/** Filter by creation date (ISO 8601 timestamp) - runs created after this date */
	since?: string;
	/** Filter by creation date (ISO 8601 timestamp) - runs created before this date */
	until?: string;
	/** Maximum number of runs to return */
	limit?: number;
}

/**
 * Run index entry for quick queries
 */
export interface RunIndexEntry {
	runId: string;
	mode: string;
	procedure: string;
	state: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

/**
 * Run index file structure
 */
export interface RunIndex {
	/** Schema version for the index format */
	schemaVersion: string;
	/** Last update timestamp */
	updatedAt: string;
	/** Run entries */
	runs: RunIndexEntry[];
}

/**
 * Validate and parse RunState
 */
export function parseRunState(data: unknown): RunState {
	return RunStateSchema.parse(data);
}

/**
 * Safely parse RunState with error handling
 */
export function safeParseRunState(data: unknown): {
	success: true;
	data: RunState;
} | {
	success: false;
	error: z.ZodError;
} {
	const result = RunStateSchema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}
