/**
 * Merge-Weave Audit Logger
 *
 * Integrates with the existing audit system to log merge-weave interventions.
 *
 * @module
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AuditEvent } from "../executor/index.js";
import type {
	InterventionPlan,
	PlannedIntervention,
} from "../planner/index.js";

// =============================================================================
// AUDIT TYPES
// =============================================================================

export interface MergeWeaveAuditEntry {
	timestamp: string;
	runId: string;
	policyVersion: string;
	event: AuditEvent | PlanEvent | SummaryEvent;
}

export interface PlanEvent {
	type: "plan_created" | "plan_completed" | "plan_failed";
	planId: string;
	stats?: InterventionPlan["stats"];
	error?: string;
}

export interface SummaryEvent {
	type: "run_summary";
	planId: string;
	duration: number;
	interventions: {
		total: number;
		completed: number;
		failed: number;
		skipped: number;
	};
	byDeterminism: Record<string, { completed: number; failed: number }>;
}

// =============================================================================
// AUDIT LOGGER
// =============================================================================

export interface AuditLoggerOptions {
	logPath: string;
	runId: string;
	policyVersion: string;
}

/**
 * Create an audit logger for a merge-weave run
 */
export function createAuditLogger(options: AuditLoggerOptions) {
	const { logPath, runId, policyVersion } = options;
	const entries: MergeWeaveAuditEntry[] = [];
	let initialized = false;

	async function ensureDirectory() {
		if (!initialized) {
			const dir = dirname(logPath);
			await mkdir(dir, { recursive: true });
			initialized = true;
		}
	}

	async function writeEntry(entry: MergeWeaveAuditEntry) {
		await ensureDirectory();
		const line = JSON.stringify(entry) + "\n";
		await appendFile(logPath, line, "utf-8");
		entries.push(entry);
	}

	return {
		/**
		 * Log an intervention event
		 */
		async logEvent(event: AuditEvent): Promise<void> {
			await writeEntry({
				timestamp: new Date().toISOString(),
				runId,
				policyVersion,
				event,
			});
		},

		/**
		 * Log plan creation
		 */
		async logPlanCreated(plan: InterventionPlan): Promise<void> {
			await writeEntry({
				timestamp: new Date().toISOString(),
				runId,
				policyVersion,
				event: {
					type: "plan_created",
					planId: plan.id,
					stats: plan.stats,
				},
			});
		},

		/**
		 * Log plan completion
		 */
		async logPlanCompleted(planId: string): Promise<void> {
			await writeEntry({
				timestamp: new Date().toISOString(),
				runId,
				policyVersion,
				event: {
					type: "plan_completed",
					planId,
				},
			});
		},

		/**
		 * Log plan failure
		 */
		async logPlanFailed(planId: string, error: string): Promise<void> {
			await writeEntry({
				timestamp: new Date().toISOString(),
				runId,
				policyVersion,
				event: {
					type: "plan_failed",
					planId,
					error,
				},
			});
		},

		/**
		 * Log run summary
		 */
		async logSummary(
			planId: string,
			durationMs: number,
			interventions: PlannedIntervention[]
		): Promise<void> {
			const completed = interventions.filter(
				(i) => i.status === "completed"
			).length;
			const failed = interventions.filter(
				(i) => i.status === "failed"
			).length;
			const skipped = interventions.filter(
				(i) => i.status === "skipped"
			).length;

			const byDeterminism: Record<
				string,
				{ completed: number; failed: number }
			> = {};
			for (const i of interventions) {
				if (!byDeterminism[i.determinism]) {
					byDeterminism[i.determinism] = { completed: 0, failed: 0 };
				}
				if (i.status === "completed")
					byDeterminism[i.determinism].completed++;
				if (i.status === "failed")
					byDeterminism[i.determinism].failed++;
			}

			await writeEntry({
				timestamp: new Date().toISOString(),
				runId,
				policyVersion,
				event: {
					type: "run_summary",
					planId,
					duration: durationMs,
					interventions: {
						total: interventions.length,
						completed,
						failed,
						skipped,
					},
					byDeterminism,
				},
			});
		},

		/**
		 * Get all entries logged so far
		 */
		getEntries(): readonly MergeWeaveAuditEntry[] {
			return entries;
		},

		/**
		 * Get the log file path
		 */
		getLogPath(): string {
			return logPath;
		},
	};
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;

/**
 * Create an audit emitter function for use in ExecutionContext
 */
export function createAuditEmitter(
	logger: AuditLogger
): (event: AuditEvent) => void {
	return (event: AuditEvent) => {
		// Fire and forget - don't block execution
		logger.logEvent(event).catch((err) => {
			console.error("Failed to log audit event:", err);
		});
	};
}
