/**
 * Run Lifecycle Manager
 *
 * Core infrastructure for creating, tracking, and persisting run state
 * across the tool-grounded lifecycle.
 *
 * Supports dual-write mode: persists to both NDJSON files (backward compatible)
 * and optional RunStore for structured queries.
 */

import { ulid } from "ulid";
import type {
	RunState,
	CreateRunParams,
	RunFilter,
	RunIndexEntry,
	StartRunInput,
	GetStatusInput,
} from "./types.js";
import { parseRunState, RunNotFoundError } from "./types.js";
import {
	writeRunState,
	readRunState,
	deleteRunState,
	readIndex,
	upsertIndexEntry,
	removeIndexEntry,
	ensureRunDir,
	appendToRunLog,
	readRunLog,
	getRunsDir as getRunsDirPath,
} from "./storage.js";
import { buildStatusResponse } from "./statusBuilder.js";
import {
	listArtifacts as listArtifactsImpl,
	type ListArtifactsInput,
	type ListArtifactsOutput,
} from "./artifacts.js";
import type { RunStore, StepOutcome, Receipt } from "../store/run-store.js";
import { safeParseStepOutcome, safeParseReceipt } from "../store/run-store.js";
import { emitProcedureFrame, storeFrameResult } from "../frames/index.js";
import type { FrameEmitResult, FrameOutcome } from "../frames/types.js";

/**
 * Default initial state for new runs
 */
const DEFAULT_INITIAL_STATE = "initialized";

/**
 * MCP-compatible initial state (matches LR-060 expectations)
 */
const MCP_INITIAL_STATE = "planning";

/**
 * Options for creating a RunManager
 */
export interface RunManagerOptions {
	/**
	 * Base directory for run storage (defaults to cwd)
	 */
	baseDir?: string;

	/**
	 * Optional RunStore for structured persistence.
	 * If provided, step outcomes and receipts will be persisted to this store.
	 * NDJSON coexistence is maintained regardless.
	 */
	runStore?: RunStore;
}

/**
 * RunManager - Core run lifecycle management
 *
 * Handles creation, retrieval, updates, and cleanup of run state.
 * Supports dual-write mode: NDJSON files for backward compatibility,
 * plus optional RunStore for structured queries.
 */
export class RunManager {
	private baseDir: string;
	private runStore: RunStore | undefined;

	/**
	 * Create a new RunManager
	 *
	 * @param baseDirOrOptions - Base directory string (deprecated) or options object
	 */
	constructor(baseDirOrOptions: string | RunManagerOptions = process.cwd()) {
		if (typeof baseDirOrOptions === "string") {
			// Legacy: string baseDir for backward compatibility
			this.baseDir = baseDirOrOptions;
			this.runStore = undefined;
		} else {
			// New: options object with optional runStore
			this.baseDir = baseDirOrOptions.baseDir ?? process.cwd();
			this.runStore = baseDirOrOptions.runStore;
		}
	}

	/**
	 * Get the runs directory path
	 *
	 * @returns Path to the runs directory
	 */
	getRunsDir(): string {
		return getRunsDirPath(this.baseDir);
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
			persona: params.persona,
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
	 * Note: Filters are applied to the index first, so only matching entries
	 * are loaded. Use the `limit` filter to control the number of runs loaded.
	 *
	 * @param filter - Optional filter criteria
	 * @returns Array of RunState objects matching the filter
	 */
	async listRunStates(filter?: RunFilter): Promise<RunState[]> {
		const index = readIndex(this.baseDir);
		let entries = index.runs;

		// Apply filters
		if (filter) {
			if (filter.state) {
				entries = entries.filter((e) => e.state === filter.state);
			}
			if (filter.procedure) {
				entries = entries.filter(
					(e) => e.procedure === filter.procedure
				);
			}
			if (filter.mode) {
				entries = entries.filter((e) => e.mode === filter.mode);
			}
			if (filter.since) {
				entries = entries.filter((e) => e.createdAt >= filter.since!);
			}
			if (filter.until) {
				entries = entries.filter((e) => e.createdAt <= filter.until!);
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
	 * List run IDs (synchronous)
	 *
	 * Returns sorted list of run IDs from the index.
	 *
	 * @returns Sorted array of run IDs
	 */
	listRuns(): string[] {
		const index = readIndex(this.baseDir);
		return index.runs.map((e) => e.runId).sort();
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
	async updateRun(
		runId: string,
		updates: Partial<RunState>
	): Promise<RunState> {
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
			updatedAt: new Date().toISOString(),
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
			completedAt: isTerminal ? now : current.completedAt,
		};

		// Validate the updated state
		parseRunState(updated);

		// Log state transition
		appendToRunLog(
			runId,
			"decisions",
			{
				type: "state_transition",
				from: previousState,
				to: newState,
				ts: now,
			},
			this.baseDir
		);

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
	async completeStep(
		runId: string,
		stepId: string,
		nextStep?: string | null
	): Promise<RunState> {
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
			currentStep:
				nextStep !== undefined ? nextStep : current.currentStep,
		});
	}

	/**
	 * Log a decision to the run's decision log
	 *
	 * @param runId - The run identifier
	 * @param decision - The decision to log
	 */
	async logDecision(
		runId: string,
		decision: Record<string, unknown>
	): Promise<void> {
		appendToRunLog(runId, "decisions", decision, this.baseDir);
	}

	/**
	 * Log a failure to the run's failure log
	 *
	 * @param runId - The run identifier
	 * @param failure - The failure to log
	 */
	async logFailure(
		runId: string,
		failure: Record<string, unknown>
	): Promise<void> {
		appendToRunLog(runId, "failures", failure, this.baseDir);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// RunStore Integration (Step Outcomes & Receipts)
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Get the RunStore instance (if configured)
	 *
	 * @returns The RunStore instance, or undefined if not configured
	 */
	getRunStore(): RunStore | undefined {
		return this.runStore;
	}

	/**
	 * Record a step outcome to the RunStore.
	 *
	 * Step outcomes are persisted to both:
	 * 1. NDJSON log (backward compatible)
	 * 2. RunStore (if configured)
	 *
	 * @param outcome - The step outcome to record
	 *
	 * @example
	 * ```typescript
	 * await manager.recordStepOutcome({
	 *   stepId: "step-001",
	 *   runId: "run-001",
	 *   nodeId: "pr-42",
	 *   gateName: "lint",
	 *   status: "pass",
	 *   durationMs: 1234,
	 *   timestamp: new Date().toISOString()
	 * });
	 * ```
	 */
	async recordStepOutcome(outcome: StepOutcome): Promise<void> {
		// Always log to NDJSON for backward compatibility
		appendToRunLog(
			outcome.runId,
			"steps",
			{
				type: "step_outcome",
				...outcome,
			},
			this.baseDir
		);

		// Also persist to RunStore if configured
		if (this.runStore) {
			await this.runStore.appendStep(outcome);
		}
	}

	/**
	 * Record a receipt (scope/risk escalation) to the RunStore.
	 *
	 * Receipts are persisted to both:
	 * 1. NDJSON log (backward compatible)
	 * 2. RunStore (if configured)
	 *
	 * @param receipt - The receipt to record
	 *
	 * @example
	 * ```typescript
	 * await manager.recordReceipt({
	 *   receiptId: "receipt-001",
	 *   runId: "run-001",
	 *   reason: "Scope expanded beyond initial plan",
	 *   approver: "alice@example.com",
	 *   timestamp: new Date().toISOString()
	 * });
	 * ```
	 */
	async recordReceipt(receipt: Receipt): Promise<void> {
		// Always log to NDJSON for backward compatibility
		appendToRunLog(
			receipt.runId,
			"receipts",
			{
				type: "receipt",
				...receipt,
			},
			this.baseDir
		);

		// Also persist to RunStore if configured
		if (this.runStore) {
			await this.runStore.saveReceipt(receipt);
		}
	}

	/**
	 * Get step outcomes for a run.
	 *
	 * Queries the RunStore if configured, otherwise returns from NDJSON logs.
	 *
	 * @param runId - The run identifier
	 * @returns Array of step outcomes for the run
	 */
	async getStepOutcomes(runId: string): Promise<StepOutcome[]> {
		// Prefer RunStore if configured
		if (this.runStore) {
			return this.runStore.getStepsForRun(runId);
		}

		// Fallback to NDJSON logs with Zod validation
		const logs = readRunLog(runId, "steps", this.baseDir);
		const results: StepOutcome[] = [];

		for (const log of logs) {
			if (log.type !== "step_outcome") continue;

			// Extract step data (excluding 'type' field added by logging)
			const { type, ...stepData } = log;
			const parsed = safeParseStepOutcome(stepData);
			if (parsed.success) {
				results.push(parsed.data);
			}
			// Silently skip invalid entries (best-effort recovery from legacy data)
		}

		return results;
	}

	/**
	 * Get receipts for a run.
	 *
	 * Queries the RunStore if configured, otherwise returns from NDJSON logs.
	 *
	 * @param runId - The run identifier
	 * @returns Array of receipts for the run
	 */
	async getReceipts(runId: string): Promise<Receipt[]> {
		// Prefer RunStore if configured
		if (this.runStore) {
			return this.runStore.getReceiptsForRun(runId);
		}

		// Fallback to NDJSON logs with Zod validation
		const logs = readRunLog(runId, "receipts", this.baseDir);
		const results: Receipt[] = [];

		for (const log of logs) {
			if (log.type !== "receipt") continue;

			// Extract receipt data (excluding 'type' field added by logging)
			const { type, ...receiptData } = log;
			const parsed = safeParseReceipt(receiptData);
			if (parsed.success) {
				results.push(parsed.data);
			}
			// Silently skip invalid entries (best-effort recovery from legacy data)
		}

		return results;
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
				archivedAt: new Date().toISOString(),
			},
		});
	}

	/**
	 * Delete a run and all associated data (sync version)
	 *
	 * @param runId - The run identifier
	 * @returns true if run was deleted, false if not found
	 */
	deleteRun(runId: string): boolean {
		// Check if run exists first
		if (!this.runExists(runId)) {
			return false;
		}

		// Delete state file and run directory
		deleteRunState(runId, this.baseDir);

		// Remove from index
		removeIndexEntry(runId, this.baseDir);

		return true;
	}

	/**
	 * Delete a run and all associated data (async version)
	 *
	 * @param runId - The run identifier
	 */
	async deleteRunAsync(runId: string): Promise<void> {
		// Delete state file and run directory
		deleteRunState(runId, this.baseDir);

		// Remove from index
		removeIndexEntry(runId, this.baseDir);
	}

	/**
	 * Start a new run (MCP tool interface)
	 *
	 * Convenience wrapper around createRun for MCP tool usage.
	 * Maps StartRunInput to CreateRunParams and returns a structured result.
	 *
	 * @param input - MCP tool input for starting a run
	 * @returns Result object with runId, status, message, and initialStatus
	 */
	startRun(input: StartRunInput): {
		runId: string;
		status: string;
		message: string;
		initialStatus: ReturnType<typeof buildStatusResponse>;
	} {
		// Use MCP_INITIAL_STATE ("planning") for MCP-triggered runs
		const runState = this.createRunSync({
			mode: input.mode,
			procedure: input.procedure,
			repo: input.repo,
			task: input.task,
			params: input.params,
			initialState: MCP_INITIAL_STATE,
		});

		const statusResponse = buildStatusResponse(runState);

		return {
			runId: runState.runId,
			status: runState.state,
			message: `Run started successfully with ID: ${runState.runId}`,
			initialStatus: statusResponse,
		};
	}

	/**
	 * Check if a run exists
	 *
	 * @param runId - The run identifier
	 * @returns true if run exists, false otherwise
	 */
	runExists(runId: string): boolean {
		return readRunState(runId, this.baseDir) !== null;
	}

	/**
	 * Load run state (synchronous)
	 *
	 * @param runId - The run identifier
	 * @returns RunState
	 * @throws Error if run not found
	 */
	loadRunState(runId: string): RunState {
		const runState = readRunState(runId, this.baseDir);
		if (!runState) {
			throw new RunNotFoundError(runId);
		}
		return runState;
	}

	/**
	 * Update run state (synchronous)
	 *
	 * @param runId - The run identifier
	 * @param updates - Partial updates to apply
	 * @returns Updated RunState
	 * @throws Error if run not found
	 */
	updateRunState(runId: string, updates: Partial<RunState>): RunState {
		const current = readRunState(runId, this.baseDir);
		if (!current) {
			throw new RunNotFoundError(runId);
		}

		// Apply updates
		const updated: RunState = {
			...current,
			...updates,
			runId: current.runId, // Prevent runId from being changed
			createdAt: current.createdAt, // Prevent createdAt from being changed
			updatedAt: new Date().toISOString(),
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
	 * Get status of a run (MCP tool interface)
	 *
	 * Convenience wrapper around getRun for MCP tool usage.
	 * Returns a structured status response.
	 *
	 * @param input - MCP tool input for getting status
	 * @returns Status response object
	 * @throws RunNotFoundError if run not found
	 */
	getStatus(input: GetStatusInput): ReturnType<typeof buildStatusResponse> {
		const runState = readRunState(input.runId, this.baseDir);

		if (!runState) {
			throw new RunNotFoundError(input.runId);
		}

		return buildStatusResponse(runState);
	}

	/**
	 * List artifacts for a run (MCP tool interface)
	 *
	 * Returns metadata for all artifacts in a run directory,
	 * with optional filtering by type, path pattern, and recency.
	 *
	 * @param input - MCP tool input for listing artifacts
	 * @returns ListArtifactsOutput with artifacts array and total count
	 * @throws RunNotFoundError if run not found
	 */
	listArtifacts(input: ListArtifactsInput): ListArtifactsOutput {
		// Check if run exists first
		const runState = readRunState(input.runId, this.baseDir);

		if (!runState) {
			throw new RunNotFoundError(input.runId);
		}

		return listArtifactsImpl(input, this.baseDir);
	}

	/**
	 * Complete a run and emit a Frame (AX-005)
	 *
	 * Transitions the run to a terminal state and emits an execution Frame
	 * capturing what was attempted, scope touched, outcome, and next steps.
	 * The Frame is persisted to .lexrunner/frames/ for audit trail.
	 *
	 * @param runId - The run identifier
	 * @param outcome - The outcome of the run (success/failure/partial)
	 * @param nextActions - Recommended next actions
	 * @param options - Additional options
	 * @returns Updated RunState and FrameEmitResult
	 */
	async completeRunWithFrame(
		runId: string,
		outcome: FrameOutcome,
		nextActions: string[],
		options?: {
			artifacts?: string[];
			error?: string;
			planHash?: string;
		}
	): Promise<{ runState: RunState; frameResult: FrameEmitResult }> {
		const current = await this.getRun(runId);

		if (!current) {
			throw new RunNotFoundError(runId);
		}

		const now = new Date().toISOString();
		// Map outcome to terminal state - partial is considered completed (with partial results)
		const terminalState = outcome === "failure" ? "failed" : "completed";

		// Calculate duration
		const startTime = new Date(current.createdAt).getTime();
		const endTime = Date.now();
		const durationMs = endTime - startTime;

		// Build module scope from params (if available) or metadata
		const moduleScope: string[] = [];
		if (current.params?.prNumbers && Array.isArray(current.params.prNumbers)) {
			moduleScope.push(...current.params.prNumbers.map(String));
		} else if (current.params?.scope && Array.isArray(current.params.scope)) {
			moduleScope.push(...current.params.scope.map(String));
		} else if (current.task) {
			moduleScope.push(current.task);
		} else {
			moduleScope.push(current.procedure);
		}

		// Emit procedure Frame (AX-005)
		const frameResult = emitProcedureFrame({
			runId,
			procedure: current.procedure,
			moduleScope,
			durationMs,
			outcome,
			nextActions,
			artifacts: options?.artifacts,
			error: options?.error,
			planHash: options?.planHash,
		});

		// Persist Frame to disk (AX-005)
		if (frameResult.success && frameResult.frame && frameResult.frameId) {
			try {
				storeFrameResult(frameResult, this.baseDir);
			} catch {
				// Best-effort persistence - don't fail the run if storage fails
			}
		}

		// Log Frame emission to run log
		appendToRunLog(
			runId,
			"decisions",
			{
				type: "frame_emitted",
				frameId: frameResult.frameId,
				outcome,
				ts: now,
			},
			this.baseDir
		);

		// Update run state to terminal
		const updated = await this.transitionState(runId, terminalState);

		return { runState: updated, frameResult };
	}

	/**
	 * Synchronous version of createRun for MCP compatibility
	 *
	 * @param params - Run creation parameters
	 * @returns The created RunState
	 */
	private createRunSync(params: CreateRunParams): RunState {
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
			persona: params.persona,
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
			completedAt: runState.completedAt,
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
 * @param baseDirOrOptions - Base directory string or options object
 * @returns A new RunManager instance
 *
 * @example
 * ```typescript
 * // Legacy: string baseDir
 * const manager = createRunManager("/path/to/project");
 *
 * // New: options object with RunStore
 * const store = new InMemoryRunStore();
 * const manager = createRunManager({ baseDir: "/path/to/project", runStore: store });
 * ```
 */
export function createRunManager(baseDirOrOptions?: string | RunManagerOptions): RunManager {
	if (typeof baseDirOrOptions === "string" || baseDirOrOptions === undefined) {
		return new RunManager(baseDirOrOptions);
	}
	return new RunManager(baseDirOrOptions);
}
