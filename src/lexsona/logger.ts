/**
 * Governance Comparison Logger (QOL-002: Retention policy)
 *
 * Logs LexSona shadow governance results alongside LexRunner's decisions.
 * Implements Version Contract v0.1: Shadow mode only.
 *
 * Logs are written to .smartergpt/runner/governance-logs/ for later analysis.
 *
 * Retention policy:
 * - Default: 30 days max age
 * - Default: 100 MB max total size
 * - Cleanup runs automatically before writing new logs
 */

import * as fs from "fs";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import * as path from "path";
import { join } from "path";
import { ulid } from "ulid";
import type {
	GovernanceComparisonLog,
	LexSonaWorkflowContext,
	LexSonaShadowResult,
	LexSonaMode,
} from "./types.js";
import { GovernanceComparisonLogSchema } from "./types.js";

/**
 * Get the governance logs directory
 */
export function getGovernanceLogsDir(): string {
	const profileDir = process.env.LEX_PR_PROFILE_DIR ?? ".smartergpt";
	return path.join(process.cwd(), profileDir, "runner", "governance-logs");
}

/**
 * Ensure governance logs directory exists
 */
function ensureGovernanceLogsDir(): void {
	const dir = getGovernanceLogsDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Runner governance signals for comparison
 */
export interface RunnerGovernanceSignals {
	hostilityScore?: number;
	suggestedTier?: string;
	gatesRequired?: string[];
	mergeEligible?: boolean;
}

/**
 * Create a governance comparison log entry (QOL-005: Schema v1.0.0)
 */
export function createGovernanceComparisonLog(
	context: LexSonaWorkflowContext,
	lexsona: LexSonaShadowResult,
	runner: RunnerGovernanceSignals,
	mode: LexSonaMode
): GovernanceComparisonLog {
	const log: GovernanceComparisonLog = {
		schemaVersion: "1.0.0",
		id: `gov-${ulid()}`,
		timestamp: new Date().toISOString(),
		context,
		lexsona,
		runner,
		mode,
	};

	// Validate before returning
	GovernanceComparisonLogSchema.parse(log);

	return log;
}

/**
 * Write a governance comparison log to disk
 * Automatically applies retention policy before writing
 */
export async function writeGovernanceLog(
	log: GovernanceComparisonLog,
	retentionConfig?: RetentionConfig
): Promise<string> {
	ensureGovernanceLogsDir();

	// Apply retention policy before writing new log
	await applyRetentionPolicy(retentionConfig);

	const dir = getGovernanceLogsDir();
	const filename = `${log.id}.json`;
	const filepath = path.join(dir, filename);

	fs.writeFileSync(filepath, JSON.stringify(log, null, 2));

	return filepath;
}

/**
 * Read all governance logs (for analysis) (QOL-005: Schema version validation)
 */
export function readGovernanceLogs(): GovernanceComparisonLog[] {
	const dir = getGovernanceLogsDir();

	if (!fs.existsSync(dir)) {
		return [];
	}

	const CURRENT_MAJOR_VERSION = 1;

	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
	const logs: GovernanceComparisonLog[] = [];

	for (const file of files) {
		try {
			const content = fs.readFileSync(path.join(dir, file), "utf-8");
			const rawLog = JSON.parse(content);

			// Validate schema version (reject unknown major versions)
			if (rawLog.schemaVersion) {
				const [major] = rawLog.schemaVersion.split(".").map(Number);
				if (major > CURRENT_MAJOR_VERSION) {
					console.warn(
						`[lex-pr] Skipping log ${file}: schema v${rawLog.schemaVersion} not supported (current: v${CURRENT_MAJOR_VERSION}.x.x)`
					);
					continue;
				}
			} else {
				// Legacy logs without schemaVersion (treat as v0.x.x)
				console.warn(
					`[lex-pr] Skipping log ${file}: missing schemaVersion (legacy format)`
				);
				continue;
			}

			const parsed = GovernanceComparisonLogSchema.parse(rawLog);
			logs.push(parsed);
		} catch (error) {
			// Skip invalid logs
			console.warn(`[lex-pr] Skipping invalid log ${file}:`, error);
		}
	}

	// Sort by timestamp descending (most recent first)
	logs.sort(
		(a, b) =>
			new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
	);

	return logs;
}

/**
 * Legacy log normalization result
 */
export interface LegacyLogResult {
	log: GovernanceComparisonLog;
	wasLegacy: boolean;
	normalizationWarnings: string[];
}

/**
 * Read all governance logs with best-effort legacy normalization (fail-forward)
 *
 * Unlike readGovernanceLogs(), this function attempts to normalize legacy logs
 * (those without schemaVersion) by filling in reasonable defaults. This is useful
 * for analyzing older logs while acknowledging the uncertainty they represent.
 */
export function readGovernanceLogsWithLegacy(): LegacyLogResult[] {
	const dir = getGovernanceLogsDir();

	if (!fs.existsSync(dir)) {
		return [];
	}

	const CURRENT_MAJOR_VERSION = 1;

	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
	const results: LegacyLogResult[] = [];

	for (const file of files) {
		try {
			const content = fs.readFileSync(path.join(dir, file), "utf-8");
			const rawLog = JSON.parse(content);
			const warnings: string[] = [];
			let wasLegacy = false;

			// Handle schema version check
			if (rawLog.schemaVersion) {
				const [major] = rawLog.schemaVersion.split(".").map(Number);
				if (major > CURRENT_MAJOR_VERSION) {
					console.warn(
						`[lex-pr] Skipping log ${file}: schema v${rawLog.schemaVersion} not supported (current: v${CURRENT_MAJOR_VERSION}.x.x)`
					);
					continue;
				}
			} else {
				// Legacy log - attempt normalization
				wasLegacy = true;
				warnings.push(
					"missing schemaVersion - normalized to 0.0.0 (legacy)"
				);
				rawLog.schemaVersion = "0.0.0";
			}

			// Best-effort normalization for missing fields
			if (!rawLog.id && file.startsWith("gov-")) {
				rawLog.id = file.replace(".json", "");
				warnings.push("id inferred from filename");
			}

			if (!rawLog.mode) {
				rawLog.mode = "offline";
				warnings.push("mode defaulted to offline");
			}

			if (!rawLog.lexsona) {
				rawLog.lexsona = {
					success: false,
					offlineMode: true,
					constraints: [],
				};
				warnings.push("lexsona block reconstructed (empty)");
			}

			if (!rawLog.runner) {
				rawLog.runner = {};
				warnings.push("runner block reconstructed (empty)");
			}

			if (!rawLog.context) {
				rawLog.context = {
					workflowId: "unknown",
					stepKind: "unknown",
				};
				warnings.push("context block reconstructed (unknown)");
			}

			const parsed = GovernanceComparisonLogSchema.parse(rawLog);
			results.push({
				log: parsed,
				wasLegacy,
				normalizationWarnings: warnings,
			});
		} catch (error) {
			// Skip invalid logs (even with normalization)
			console.warn(
				`[lex-pr] Skipping invalid log ${file} (even with normalization):`,
				error
			);
		}
	}

	// Sort by timestamp descending (most recent first)
	results.sort(
		(a, b) =>
			new Date(b.log.timestamp).getTime() -
			new Date(a.log.timestamp).getTime()
	);

	return results;
}

/**
 * Format governance log for human-readable output
 */
export function formatGovernanceLog(log: GovernanceComparisonLog): string {
	const lines: string[] = [];

	lines.push(`=== Governance Comparison: ${log.id} ===`);
	lines.push(`Timestamp: ${log.timestamp}`);
	lines.push(`Mode: ${log.mode}`);
	lines.push("");

	lines.push("Context:");
	lines.push(`  Workflow: ${log.context.workflowId}`);
	lines.push(`  Step: ${log.context.stepKind}`);
	if (log.context.repo) lines.push(`  Repo: ${log.context.repo}`);
	if (log.context.branch) lines.push(`  Branch: ${log.context.branch}`);
	lines.push("");

	lines.push("LexSona:");
	lines.push(`  Success: ${log.lexsona.success}`);
	lines.push(`  Persona: ${log.lexsona.personaId ?? "none"}`);
	lines.push(`  Offline: ${log.lexsona.offlineMode}`);
	if (log.lexsona.confidenceCeiling) {
		lines.push(`  Confidence Ceiling: ${log.lexsona.confidenceCeiling}`);
	}
	if (log.lexsona.error) {
		lines.push(`  Error: ${log.lexsona.error}`);
	}
	if (log.lexsona.constraintSet) {
		lines.push(
			`  Constraints: ${log.lexsona.constraintSet.constraintCount}`
		);
		lines.push(`  Principles: ${log.lexsona.constraintSet.principleCount}`);
		if (log.lexsona.constraintSet.topConstraints.length > 0) {
			lines.push("  Top Constraints:");
			for (const c of log.lexsona.constraintSet.topConstraints.slice(
				0,
				5
			)) {
				lines.push(
					`    - [${c.severity}] ${c.description} (${(
						c.confidence * 100
					).toFixed(0)}%)`
				);
			}
		}
	}
	lines.push("");

	lines.push("Runner:");
	if (log.runner.hostilityScore !== undefined) {
		lines.push(
			`  Hostility Score: ${log.runner.hostilityScore.toFixed(2)}`
		);
	}
	if (log.runner.suggestedTier) {
		lines.push(`  Suggested Tier: ${log.runner.suggestedTier}`);
	}
	if (log.runner.gatesRequired) {
		lines.push(`  Required Gates: ${log.runner.gatesRequired.join(", ")}`);
	}
	if (log.runner.mergeEligible !== undefined) {
		lines.push(`  Merge Eligible: ${log.runner.mergeEligible}`);
	}

	return lines.join("\n");
}

/**
 * Retention policy configuration
 */
export interface RetentionConfig {
	/** Maximum age in days before deletion (default: 30) */
	maxAgeDays?: number;
	/** Maximum total size in MB before cleanup (default: 100) */
	maxSizeMB?: number;
	/** Enable gzip compression for old logs (default: false) */
	compressionEnabled?: boolean;
}

/**
 * Delete governance logs older than the specified age
 * @param maxAgeDays - Maximum age in days (default: 30)
 * @returns Number of logs deleted
 */
export async function cleanupOldLogs(maxAgeDays: number = 30): Promise<number> {
	const logsDir = getGovernanceLogsDir();
	if (!existsSync(logsDir)) {
		return 0;
	}

	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
	const cutoffTime = cutoffDate.getTime();

	const files = readdirSync(logsDir).filter((f) => f.endsWith(".json"));
	let deleted = 0;

	for (const file of files) {
		const filePath = join(logsDir, file);
		const stats = statSync(filePath);

		if (stats.mtimeMs < cutoffTime) {
			unlinkSync(filePath);
			deleted++;
		}
	}

	return deleted;
}

/**
 * Enforce size-based retention by deleting oldest logs first
 * @param maxSizeMB - Maximum total size in MB (default: 100)
 * @returns Number of logs deleted
 */
export async function enforceRetentionPolicy(
	maxSizeMB: number = 100
): Promise<number> {
	const logsDir = getGovernanceLogsDir();
	if (!existsSync(logsDir)) {
		return 0;
	}

	const files = readdirSync(logsDir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			const filePath = join(logsDir, f);
			const stats = statSync(filePath);
			return {
				name: f,
				path: filePath,
				size: stats.size,
				mtime: stats.mtimeMs,
			};
		})
		.sort((a, b) => a.mtime - b.mtime); // oldest first

	const maxSizeBytes = maxSizeMB * 1024 * 1024;
	let totalSize = files.reduce((sum, f) => sum + f.size, 0);
	let deleted = 0;

	// Delete oldest files until under size limit
	for (const file of files) {
		if (totalSize <= maxSizeBytes) {
			break;
		}
		unlinkSync(file.path);
		totalSize -= file.size;
		deleted++;
	}

	return deleted;
}

/**
 * Apply retention policy before writing new log
 * Called automatically by writeGovernanceLog
 */
export async function applyRetentionPolicy(
	config: RetentionConfig = {}
): Promise<void> {
	const { maxAgeDays = 30, maxSizeMB = 100 } = config;

	// Age-based cleanup
	await cleanupOldLogs(maxAgeDays);

	// Size-based cleanup
	await enforceRetentionPolicy(maxSizeMB);
}
