/**
 * Governance Comparison Logger
 *
 * Logs LexSona shadow governance results alongside LexRunner's decisions.
 * Implements Version Contract v0.1: Shadow mode only.
 *
 * Logs are written to .smartergpt/runner/governance-logs/ for later analysis.
 */

import * as fs from "fs";
import * as path from "path";
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
function getGovernanceLogsDir(): string {
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
 * Create a governance comparison log entry
 */
export function createGovernanceComparisonLog(
	context: LexSonaWorkflowContext,
	lexsona: LexSonaShadowResult,
	runner: RunnerGovernanceSignals,
	mode: LexSonaMode
): GovernanceComparisonLog {
	const log: GovernanceComparisonLog = {
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
 */
export function writeGovernanceLog(log: GovernanceComparisonLog): string {
	ensureGovernanceLogsDir();

	const dir = getGovernanceLogsDir();
	const filename = `${log.id}.json`;
	const filepath = path.join(dir, filename);

	fs.writeFileSync(filepath, JSON.stringify(log, null, 2));

	return filepath;
}

/**
 * Read all governance logs (for analysis)
 */
export function readGovernanceLogs(): GovernanceComparisonLog[] {
	const dir = getGovernanceLogsDir();

	if (!fs.existsSync(dir)) {
		return [];
	}

	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
	const logs: GovernanceComparisonLog[] = [];

	for (const file of files) {
		try {
			const content = fs.readFileSync(path.join(dir, file), "utf-8");
			const parsed = GovernanceComparisonLogSchema.parse(
				JSON.parse(content)
			);
			logs.push(parsed);
		} catch {
			// Skip invalid logs
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
