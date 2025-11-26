/**
 * Run lifecycle manager for lexrunner.startRun and lexrunner.getStatus
 * 
 * Manages persistent run state in `.lexrunner/runs/{runId}.json`
 */

import { ulid } from "ulid";
import * as fs from "fs";
import * as path from "path";
import {
	RunStateFile,
	RunStateFileSchema,
	StartRunInput,
	StartRunOutput,
	GetStatusInput,
	RunNotFoundError,
	InvalidRunStateError,
	StatusResponse
} from "./types.js";
import { buildStatusResponse } from "./statusBuilder.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Default runs directory path (relative to cwd or provided base)
 */
const DEFAULT_RUNS_DIR = ".lexrunner/runs";

/**
 * Run manager for creating and querying run state
 */
export class RunManager {
	private runsDir: string;
	
	constructor(baseDir?: string) {
		const base = baseDir || process.cwd();
		this.runsDir = path.join(base, DEFAULT_RUNS_DIR);
	}
	
	/**
	 * Get the runs directory path
	 */
	getRunsDir(): string {
		return this.runsDir;
	}
	
	/**
	 * Ensure the runs directory exists
	 */
	private ensureRunsDir(): void {
		if (!fs.existsSync(this.runsDir)) {
			fs.mkdirSync(this.runsDir, { recursive: true });
		}
	}
	
	/**
	 * Get the file path for a run
	 */
	private getRunPath(runId: string): string {
		return path.join(this.runsDir, `${runId}.json`);
	}
	
	/**
	 * Generate a unique run ID using ULID
	 */
	private generateRunId(): string {
		return ulid();
	}
	
	/**
	 * Start a new run
	 */
	startRun(input: StartRunInput): StartRunOutput {
		this.ensureRunsDir();
		
		const runId = this.generateRunId();
		const now = new Date().toISOString();
		
		// Determine initial steps based on procedure
		const initialSteps = this.getInitialSteps(input.procedure);
		
		const runState: RunStateFile = {
			runId,
			state: "planning",
			mode: input.mode,
			procedure: input.procedure,
			repo: input.repo,
			task: input.task,
			params: input.params,
			createdAt: now,
			updatedAt: now,
			progress: {
				completed: [],
				current: initialSteps[0] || null,
				remaining: initialSteps.slice(1)
			}
		};
		
		// Validate and save run state
		const validated = RunStateFileSchema.parse(runState);
		this.saveRunState(validated);
		
		// Build and return initial status
		const initialStatus = buildStatusResponse(validated);
		
		return {
			runId,
			initialStatus
		};
	}
	
	/**
	 * Get status for an existing run
	 */
	getStatus(input: GetStatusInput): StatusResponse {
		const runState = this.loadRunState(input.runId);
		return buildStatusResponse(runState);
	}
	
	/**
	 * Load run state from file
	 */
	loadRunState(runId: string): RunStateFile {
		const runPath = this.getRunPath(runId);
		
		if (!fs.existsSync(runPath)) {
			throw new RunNotFoundError(runId);
		}
		
		try {
			const content = fs.readFileSync(runPath, "utf-8");
			const data = JSON.parse(content);
			return RunStateFileSchema.parse(data);
		} catch (error) {
			if (error instanceof RunNotFoundError) {
				throw error;
			}
			throw new InvalidRunStateError(
				`Failed to load run state for ${runId}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
	
	/**
	 * Save run state to file
	 */
	saveRunState(runState: RunStateFile): void {
		this.ensureRunsDir();
		const runPath = this.getRunPath(runState.runId);
		const content = canonicalJSONStringify(runState);
		fs.writeFileSync(runPath, content + "\n");
	}
	
	/**
	 * Update run state
	 */
	updateRunState(runId: string, updates: Partial<RunStateFile>): RunStateFile {
		const existing = this.loadRunState(runId);
		const updated: RunStateFile = {
			...existing,
			...updates,
			runId: existing.runId, // Preserve original runId
			createdAt: existing.createdAt, // Preserve original creation time
			updatedAt: new Date().toISOString()
		};
		
		const validated = RunStateFileSchema.parse(updated);
		this.saveRunState(validated);
		return validated;
	}
	
	/**
	 * Check if a run exists
	 */
	runExists(runId: string): boolean {
		return fs.existsSync(this.getRunPath(runId));
	}
	
	/**
	 * List all run IDs
	 */
	listRuns(): string[] {
		if (!fs.existsSync(this.runsDir)) {
			return [];
		}
		
		return fs.readdirSync(this.runsDir)
			.filter(file => file.endsWith(".json"))
			.map(file => file.replace(".json", ""))
			.sort(); // Sort for deterministic output
	}
	
	/**
	 * Delete a run
	 */
	deleteRun(runId: string): boolean {
		const runPath = this.getRunPath(runId);
		if (fs.existsSync(runPath)) {
			fs.unlinkSync(runPath);
			return true;
		}
		return false;
	}
	
	/**
	 * Get initial steps for a procedure
	 */
	private getInitialSteps(procedure: string): string[] {
		// Define procedure-specific steps
		const procedureSteps: Record<string, string[]> = {
			"merge-weave-main": [
				"fetch-prs",
				"analyze-deps",
				"run-gates",
				"merge-prs",
				"cleanup"
			],
			"pr-review": [
				"fetch-pr",
				"analyze-changes",
				"run-checks",
				"generate-review"
			]
		};
		
		return procedureSteps[procedure] || ["initialize", "execute", "finalize"];
	}
}

/**
 * Create a run manager instance
 */
export function createRunManager(baseDir?: string): RunManager {
	return new RunManager(baseDir);
}
