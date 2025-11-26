/**
 * Run Lifecycle Manager
 *
 * Core infrastructure for creating, tracking, and persisting run state
 * across the tool-grounded lifecycle.
 */

import { ulid } from "ulid";
import type {
	RunState,
	CreateRunParams,
	RunFilter,
	RunIndexEntry
} from "./types.js";
import { parseRunState } from "./types.js";
import {
	writeRunState,
	readRunState,
	deleteRunState,
	readIndex,
	upsertIndexEntry,
	removeIndexEntry,
	ensureRunDir,
	appendToRunLog,
	readRunLog
} from "./storage.js";

/**
 * Default initial state for new runs
 */
const DEFAULT_INITIAL_STATE = "initialized";

/**
 * RunManager - Core run lifecycle management
 *
 * Handles creation, retrieval, updates, and cleanup of run state.
 */
export class RunManager {
	private baseDir: string;

	/**
	 * Create a new RunManager
	 *
	 * @param baseDir - Base directory for run storage (defaults to cwd)
	 */
	constructor(baseDir: string = process.cwd()) {
		this.baseDir = baseDir;
	}

	/**
	 * Create a new run
	 *
	 * Generates a unique runId (ULID), initializes state, and persists to disk.
	 *
	 * @param params - Run creation parameters
	 * @returns The created RunState
	 */
	async createRun(params: CreateRunParams): Promise<RunState> {
		const now = new Date().toISOString();
		const runId = ulid();

		const runState: RunState = {
			runId,
			mode: params.mode,
			procedure: params.procedure,
			repo: params.repo,
			task: params.task,
			state: params.initialState ?? DEFAULT_INITIAL_STATE,
			createdAt: now,
			updatedAt: now,
			completedSteps: [],
			currentStep: null,
			params: params.params ?? {},
			metadata: params.metadata ?? {},
			persona: params.persona
		};

		// Validate the run state
		parseRunState(runState);

		// Persist run state
		writeRunState(runState, this.baseDir);

		// Ensure run directory exists
		ensureRunDir(runId, this.baseDir);

		// Update index
		const indexEntry = this.createIndexEntry(runState);
		upsertIndexEntry(indexEntry, this.baseDir);

		return runState;
	}

	/**
	 * Get a run by ID
	 *
	 * @param runId - The run identifier
	 * @returns RunState if found, null if not found
	 */
	async getRun(runId: string): Promise<RunState | null> {
		const runState = readRunState(runId, this.baseDir);
		return runState;
	}

	/**
	 * List runs with optional filtering
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of RunState objects matching the filter
	 */
	async listRuns(filter?: RunFilter): Promise<RunState[]> {
		const index = readIndex(this.baseDir);
		let entries = index.runs;

		// Apply filters
		if (filter) {
			if (filter.state) {
				entries = entries.filter(e => e.state === filter.state);
			}
			if (filter.procedure) {
				entries = entries.filter(e => e.procedure === filter.procedure);
			}
			if (filter.mode) {
				entries = entries.filter(e => e.mode === filter.mode);
			}
			if (filter.since) {
				entries = entries.filter(e => e.createdAt >= filter.since!);
			}
			if (filter.until) {
				entries = entries.filter(e => e.createdAt <= filter.until!);
			}
			if (filter.limit && filter.limit > 0) {
				entries = entries.slice(0, filter.limit);
			}
		}

		// Load full run states
		const runs: RunState[] = [];
		for (const entry of entries) {
			const runState = readRunState(entry.runId, this.baseDir);
			if (runState) {
				runs.push(runState);
			}
		}

		return runs;
	}

	/**
	 * Update a run
	 *
	 * Applies updates atomically and persists changes.
	 *
	 * @param runId - The run identifier
	 * @param updates - Partial updates to apply
	 * @returns Updated RunState
	 * @throws Error if run not found
	 */
	async updateRun(runId: string, updates: Partial<RunState>): Promise<RunState> {
		const current = await this.getRun(runId);

		if (!current) {
			throw new Error(`Run not found: ${runId}`);
		}

		// Apply updates
		const updated: RunState = {
			...current,
			...updates,
			runId: current.runId, // Prevent runId from being changed
			createdAt: current.createdAt, // Prevent createdAt from being changed
			updatedAt: new Date().toISOString()
		};

		// Validate the updated state
		parseRunState(updated);

		// Persist updated state
		writeRunState(updated, this.baseDir);

		// Update index
		const indexEntry = this.createIndexEntry(updated);
		upsertIndexEntry(indexEntry, this.baseDir);

		return updated;
	}

	/**
	 * Transition run state
	 *
	 * Applies a state transition event and persists the change.
	 * Currently does not validate against a state machine - this is
	 * intentionally flexible for different procedures.
	 *
	 * @param runId - The run identifier
	 * @param newState - The new state to transition to
	 * @returns Updated RunState
	 * @throws Error if run not found
	 */
	async transitionState(runId: string, newState: string): Promise<RunState> {
		const current = await this.getRun(runId);

		if (!current) {
			throw new Error(`Run not found: ${runId}`);
		}

		const now = new Date().toISOString();
		const previousState = current.state;

		// Determine if this is a terminal state
		const isTerminal = this.isTerminalState(newState);

		const updated: RunState = {
			...current,
			state: newState,
			updatedAt: now,
			completedAt: isTerminal ? now : current.completedAt
		};

		// Validate the updated state
		parseRunState(updated);

		// Log state transition
		appendToRunLog(runId, "decisions", {
			type: "state_transition",
			from: previousState,
			to: newState,
			ts: now
		}, this.baseDir);

		// Persist updated state
		writeRunState(updated, this.baseDir);

		// Update index
		const indexEntry = this.createIndexEntry(updated);
		upsertIndexEntry(indexEntry, this.baseDir);

		return updated;
	}

	/**
	 * Mark a step as complete
	 *
	 * @param runId - The run identifier
	 * @param stepId - The step to mark as complete
	 * @param nextStep - The next step to set as current (optional)
	 * @returns Updated RunState
	 */
	async completeStep(runId: string, stepId: string, nextStep?: string | null): Promise<RunState> {
		const current = await this.getRun(runId);

		if (!current) {
			throw new Error(`Run not found: ${runId}`);
		}

		// Add to completed steps if not already present
		const completedSteps = current.completedSteps.includes(stepId)
			? current.completedSteps
			: [...current.completedSteps, stepId];

		return this.updateRun(runId, {
			completedSteps,
			currentStep: nextStep !== undefined ? nextStep : current.currentStep
		});
	}

	/**
	 * Log a decision to the run's decision log
	 *
	 * @param runId - The run identifier
	 * @param decision - The decision to log
	 */
	async logDecision(runId: string, decision: Record<string, unknown>): Promise<void> {
		appendToRunLog(runId, "decisions", decision, this.baseDir);
	}

	/**
	 * Log a failure to the run's failure log
	 *
	 * @param runId - The run identifier
	 * @param failure - The failure to log
	 */
	async logFailure(runId: string, failure: Record<string, unknown>): Promise<void> {
		appendToRunLog(runId, "failures", failure, this.baseDir);
	}

	/**
	 * Get decisions for a run
	 *
	 * @param runId - The run identifier
	 * @returns Array of decision log entries
	 */
	async getDecisions(runId: string): Promise<Array<Record<string, unknown>>> {
		return readRunLog(runId, "decisions", this.baseDir);
	}

	/**
	 * Get failures for a run
	 *
	 * @param runId - The run identifier
	 * @returns Array of failure log entries
	 */
	async getFailures(runId: string): Promise<Array<Record<string, unknown>>> {
		return readRunLog(runId, "failures", this.baseDir);
	}

	/**
	 * Archive a run (mark as archived in metadata)
	 *
	 * @param runId - The run identifier
	 */
	async archiveRun(runId: string): Promise<void> {
		await this.updateRun(runId, {
			metadata: {
				...(await this.getRun(runId))?.metadata,
				archived: true,
				archivedAt: new Date().toISOString()
			}
		});
	}

	/**
	 * Delete a run and all associated data
	 *
	 * @param runId - The run identifier
	 */
	async deleteRun(runId: string): Promise<void> {
		// Delete state file and run directory
		deleteRunState(runId, this.baseDir);

		// Remove from index
		removeIndexEntry(runId, this.baseDir);
	}

	/**
	 * Create an index entry from a run state
	 */
	private createIndexEntry(runState: RunState): RunIndexEntry {
		return {
			runId: runState.runId,
			mode: runState.mode,
			procedure: runState.procedure,
			state: runState.state,
			createdAt: runState.createdAt,
			updatedAt: runState.updatedAt,
			completedAt: runState.completedAt
		};
	}

	/**
	 * Check if a state is terminal
	 */
	private isTerminalState(state: string): boolean {
		return ["completed", "failed", "cancelled", "aborted"].includes(state);
	}
}

/**
 * Create a new RunManager instance
 *
 * @param baseDir - Base directory for run storage
 * @returns A new RunManager instance
 */
export function createRunManager(baseDir?: string): RunManager {
	return new RunManager(baseDir);
}
