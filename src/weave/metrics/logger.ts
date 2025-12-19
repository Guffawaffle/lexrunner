/**
 * Audit Logger for Intervention Tracking
 *
 * Logs intervention executions to NDJSON audit file for handoff metrics.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	type InterventionAuditEntry,
	type DeterminismLevel,
	type ModelTier,
	getInterventionById,
	safeParseAuditEntry,
} from "./schema.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_AUDIT_PATH = ".smartergpt/deliverables/merge-weave-audit.ndjson";

// =============================================================================
// AUDIT LOGGER
// =============================================================================

export interface AuditLoggerOptions {
	/** Path to audit log file (relative to cwd or absolute) */
	auditPath?: string;
	/** Working directory */
	cwd?: string;
	/** Current run ID for correlation */
	runId?: string;
}

export interface LogInterventionOptions {
	/** Intervention ID (e.g., INT-007) */
	interventionId: string;
	/** Whether intervention succeeded */
	success: boolean;
	/** Time to complete in milliseconds */
	durationMs: number;
	/** Model tier that executed this */
	modelTier?: ModelTier;
	/** Whether human override was needed */
	humanOverride?: boolean;
	/** Repository context */
	repo?: string;
	/** Error message if failed */
	error?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Audit logger for intervention tracking
 */
export class AuditLogger {
	private readonly auditPath: string;
	private readonly runId: string;

	constructor(options: AuditLoggerOptions = {}) {
		const cwd = options.cwd ?? process.cwd();
		const relativePath = options.auditPath ?? DEFAULT_AUDIT_PATH;

		this.auditPath = path.isAbsolute(relativePath)
			? relativePath
			: path.join(cwd, relativePath);

		this.runId = options.runId ?? this.generateRunId();
	}

	/**
	 * Log an intervention execution
	 */
	async logIntervention(options: LogInterventionOptions): Promise<void> {
		const intervention = getInterventionById(options.interventionId);

		const entry: InterventionAuditEntry = {
			intervention_id: options.interventionId,
			intervention_name: intervention?.name ?? options.interventionId,
			determinism_level: intervention?.determinism_level ?? "D2",
			model_tier_used: options.modelTier ?? "frontier",
			success: options.success,
			required_human_override: options.humanOverride ?? false,
			time_to_complete_ms: options.durationMs,
			timestamp: new Date().toISOString(),
			run_id: this.runId,
			repo: options.repo,
			error_message: options.error,
			context: options.context,
		};

		await this.appendEntry(entry);
	}

	/**
	 * Log intervention start and return a finisher function
	 */
	startIntervention(
		interventionId: string,
		options?: Partial<LogInterventionOptions>
	): InterventionTracker {
		const startTime = Date.now();
		return new InterventionTracker(
			this,
			interventionId,
			startTime,
			options
		);
	}

	/**
	 * Read all audit entries
	 */
	async readEntries(): Promise<InterventionAuditEntry[]> {
		if (!fs.existsSync(this.auditPath)) {
			return [];
		}

		const content = await fs.promises.readFile(this.auditPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		const entries: InterventionAuditEntry[] = [];
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line);
				const result = safeParseAuditEntry(parsed);
				if (result.success) {
					entries.push(result.data);
				}
			} catch {
				// Skip invalid lines
			}
		}

		return entries;
	}

	/**
	 * Get entries for a specific run
	 */
	async getEntriesForRun(runId: string): Promise<InterventionAuditEntry[]> {
		const entries = await this.readEntries();
		return entries.filter((e) => e.run_id === runId);
	}

	/**
	 * Get entries for a specific intervention
	 */
	async getEntriesForIntervention(
		interventionId: string
	): Promise<InterventionAuditEntry[]> {
		const entries = await this.readEntries();
		return entries.filter((e) => e.intervention_id === interventionId);
	}

	/**
	 * Get entries by determinism level
	 */
	async getEntriesByLevel(
		level: DeterminismLevel
	): Promise<InterventionAuditEntry[]> {
		const entries = await this.readEntries();
		return entries.filter((e) => e.determinism_level === level);
	}

	/**
	 * Get current run ID
	 */
	getRunId(): string {
		return this.runId;
	}

	/**
	 * Get audit file path
	 */
	getAuditPath(): string {
		return this.auditPath;
	}

	/**
	 * Append an entry to the audit log
	 */
	private async appendEntry(entry: InterventionAuditEntry): Promise<void> {
		// Ensure directory exists
		const dir = path.dirname(this.auditPath);
		if (!fs.existsSync(dir)) {
			await fs.promises.mkdir(dir, { recursive: true });
		}

		// Append as NDJSON
		const line = JSON.stringify(entry) + "\n";
		await fs.promises.appendFile(this.auditPath, line, "utf-8");
	}

	/**
	 * Generate a unique run ID
	 */
	private generateRunId(): string {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const random = Math.random().toString(36).substring(2, 8);
		return `run-${timestamp}-${random}`;
	}
}

// =============================================================================
// INTERVENTION TRACKER
// =============================================================================

/**
 * Tracks a single intervention execution
 */
export class InterventionTracker {
	private completed = false;

	constructor(
		private readonly logger: AuditLogger,
		private readonly interventionId: string,
		private readonly startTime: number,
		private readonly options?: Partial<LogInterventionOptions>
	) {}

	/**
	 * Mark intervention as successful
	 */
	async success(context?: Record<string, unknown>): Promise<void> {
		if (this.completed) return;
		this.completed = true;

		await this.logger.logIntervention({
			interventionId: this.interventionId,
			success: true,
			durationMs: Date.now() - this.startTime,
			...this.options,
			context: { ...this.options?.context, ...context },
		});
	}

	/**
	 * Mark intervention as failed
	 */
	async fail(
		error?: string | Error,
		context?: Record<string, unknown>
	): Promise<void> {
		if (this.completed) return;
		this.completed = true;

		const errorMessage = typeof error === "string" ? error : error?.message;

		await this.logger.logIntervention({
			interventionId: this.interventionId,
			success: false,
			durationMs: Date.now() - this.startTime,
			error: errorMessage,
			...this.options,
			context: { ...this.options?.context, ...context },
		});
	}

	/**
	 * Mark intervention as requiring human override
	 */
	async humanOverride(
		reason?: string,
		context?: Record<string, unknown>
	): Promise<void> {
		if (this.completed) return;
		this.completed = true;

		await this.logger.logIntervention({
			interventionId: this.interventionId,
			success: true, // Override succeeded
			durationMs: Date.now() - this.startTime,
			humanOverride: true,
			...this.options,
			context: {
				...this.options?.context,
				...context,
				override_reason: reason,
			},
		});
	}
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create an audit logger with default options
 */
export function createAuditLogger(options?: AuditLoggerOptions): AuditLogger {
	return new AuditLogger(options);
}
