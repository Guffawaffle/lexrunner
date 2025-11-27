/**
 * Tool-Grounded Mode Enforcement
 *
 * Implements enforcement rules for tool-grounded modes (senior-dev, tool-grounded).
 * When a run is active, orchestration must flow through lexrunner.* tools.
 *
 * Enforcement Rules:
 * - Use lexrunner.getStatus to understand run state
 * - Use lexrunner.submitDecision for orchestration decisions
 * - Use lexrunner.listArtifacts to inspect artifacts
 *
 * Forbidden:
 * - Direct git, gh, or merge commands during an active run
 * - Modifying CI configuration from within a run
 * - Bypassing gates or policy checks
 */

import { z } from "zod";
import { appendToRunLog, readRunLog } from "./storage.js";

/**
 * Violation types for tool-grounded mode enforcement
 */
export const ViolationType = {
	/** Direct git command executed during active run */
	DIRECT_GIT_COMMAND: "DIRECT_GIT_COMMAND",
	/** Direct gh CLI command executed during active run */
	DIRECT_GH_COMMAND: "DIRECT_GH_COMMAND",
	/** Attempted to bypass gates without proper decision */
	BYPASS_GATES: "BYPASS_GATES",
	/** Modified CI configuration during run */
	MODIFY_CI_CONFIG: "MODIFY_CI_CONFIG",
	/** Executed merge outside of lexrunner tools */
	DIRECT_MERGE: "DIRECT_MERGE",
	/** Skipped policy check without rationale */
	SKIP_POLICY: "SKIP_POLICY",
	/** Used forbidden action under current persona */
	FORBIDDEN_ACTION: "FORBIDDEN_ACTION",
} as const;

export type ViolationType = (typeof ViolationType)[keyof typeof ViolationType];

/**
 * Severity levels for violations
 */
export const ViolationSeverity = {
	/** Warning - logged but does not block */
	WARNING: "warning",
	/** Error - should block under hard enforcement */
	ERROR: "error",
	/** Critical - always blocks, may abort run */
	CRITICAL: "critical",
} as const;

export type ViolationSeverity =
	(typeof ViolationSeverity)[keyof typeof ViolationSeverity];

/**
 * Violation entry logged to failures.ndjson
 */
export const ViolationEntrySchema = z.object({
	/** ISO 8601 timestamp of the violation */
	timestamp: z.string(),
	/** Run identifier where violation occurred */
	runId: z.string(),
	/** Type of violation */
	violation: z.string(),
	/** Command or action that caused the violation */
	command: z.string().optional(),
	/** Additional context about the violation */
	context: z.string().optional(),
	/** Severity level */
	severity: z.enum(["warning", "error", "critical"]),
	/** Whether the violation was blocked (hard enforcement) */
	blocked: z.boolean().optional(),
});

export type ViolationEntry = z.infer<typeof ViolationEntrySchema>;

/**
 * Enforcement mode for the run
 */
export const EnforcementMode = {
	/** Log violations but don't block (Option B) */
	SOFT: "soft",
	/** Block violations and require explicit handling (Option C - future) */
	HARD: "hard",
} as const;

export type EnforcementMode =
	(typeof EnforcementMode)[keyof typeof EnforcementMode];

/**
 * Enforcement configuration
 */
export interface EnforcementConfig {
	/** Enforcement mode */
	mode: EnforcementMode;
	/** Modes that require enforcement (e.g., "senior-dev", "tool-grounded") */
	enforcedModes: string[];
	/** Commands that trigger DIRECT_GIT_COMMAND violation */
	forbiddenGitCommands: string[];
	/** Commands that trigger DIRECT_GH_COMMAND violation */
	forbiddenGhCommands: string[];
	/** Paths that trigger MODIFY_CI_CONFIG violation */
	protectedCiPaths: string[];
}

/**
 * Default enforcement configuration
 */
export const DEFAULT_ENFORCEMENT_CONFIG: EnforcementConfig = {
	mode: "soft",
	enforcedModes: ["senior-dev", "tool-grounded"],
	forbiddenGitCommands: [
		"git merge",
		"git push",
		"git rebase",
		"git cherry-pick",
		"git reset --hard",
		"git checkout -B",
	],
	forbiddenGhCommands: [
		"gh pr merge",
		"gh pr close",
		"gh pr create",
	],
	protectedCiPaths: [
		".github/workflows/",
		".gitlab-ci.yml",
		"Jenkinsfile",
		".circleci/",
		"azure-pipelines.yml",
	],
};

/**
 * Check if a mode requires enforcement
 */
export function requiresEnforcement(
	mode: string,
	config: EnforcementConfig = DEFAULT_ENFORCEMENT_CONFIG
): boolean {
	return config.enforcedModes.includes(mode);
}

/**
 * Check if a command violates direct git command rules
 */
export function detectGitViolation(
	command: string,
	config: EnforcementConfig = DEFAULT_ENFORCEMENT_CONFIG
): ViolationType | null {
	const normalizedCommand = command.toLowerCase().trim();

	// Check for merge operations first (higher severity)
	if (
		normalizedCommand.startsWith("git merge") ||
		normalizedCommand.includes("git pull --rebase")
	) {
		return ViolationType.DIRECT_MERGE;
	}

	// Check other forbidden commands
	for (const forbidden of config.forbiddenGitCommands) {
		// Skip git merge since we already handled it above
		if (forbidden.toLowerCase() === "git merge") {
			continue;
		}
		if (normalizedCommand.startsWith(forbidden.toLowerCase())) {
			return ViolationType.DIRECT_GIT_COMMAND;
		}
	}

	return null;
}

/**
 * Check if a command violates direct gh command rules
 */
export function detectGhViolation(
	command: string,
	config: EnforcementConfig = DEFAULT_ENFORCEMENT_CONFIG
): ViolationType | null {
	const normalizedCommand = command.toLowerCase().trim();

	for (const forbidden of config.forbiddenGhCommands) {
		if (normalizedCommand.startsWith(forbidden.toLowerCase())) {
			// gh pr merge is a direct merge violation
			if (normalizedCommand.startsWith("gh pr merge")) {
				return ViolationType.DIRECT_MERGE;
			}
			return ViolationType.DIRECT_GH_COMMAND;
		}
	}

	return null;
}

/**
 * Check if a file path modification violates CI config rules
 */
export function detectCiConfigViolation(
	filePath: string,
	config: EnforcementConfig = DEFAULT_ENFORCEMENT_CONFIG
): ViolationType | null {
	const normalizedPath = filePath.toLowerCase();

	for (const protectedPath of config.protectedCiPaths) {
		if (normalizedPath.includes(protectedPath.toLowerCase())) {
			return ViolationType.MODIFY_CI_CONFIG;
		}
	}

	return null;
}

/**
 * Determine severity for a violation type
 */
export function getViolationSeverity(violation: ViolationType): ViolationSeverity {
	switch (violation) {
		case ViolationType.DIRECT_MERGE:
		case ViolationType.BYPASS_GATES:
			return ViolationSeverity.ERROR;
		case ViolationType.MODIFY_CI_CONFIG:
		case ViolationType.FORBIDDEN_ACTION:
			return ViolationSeverity.CRITICAL;
		case ViolationType.DIRECT_GIT_COMMAND:
		case ViolationType.DIRECT_GH_COMMAND:
		case ViolationType.SKIP_POLICY:
		default:
			return ViolationSeverity.WARNING;
	}
}

/**
 * Log a violation to the run's failures.ndjson
 */
export function logViolation(
	runId: string,
	violation: ViolationType,
	options: {
		command?: string;
		context?: string;
		blocked?: boolean;
	} = {},
	baseDir: string = process.cwd()
): ViolationEntry {
	const entry: ViolationEntry = {
		timestamp: new Date().toISOString(),
		runId,
		violation,
		command: options.command,
		context: options.context,
		severity: getViolationSeverity(violation),
		blocked: options.blocked,
	};

	// Validate entry
	ViolationEntrySchema.parse(entry);

	// Log to failures.ndjson
	appendToRunLog(runId, "failures", entry, baseDir);

	return entry;
}

/**
 * Get all violations for a run
 */
export function getViolations(
	runId: string,
	baseDir: string = process.cwd()
): ViolationEntry[] {
	const failures = readRunLog(runId, "failures", baseDir);

	// Filter for violation entries
	return failures.filter(
		(entry): entry is ViolationEntry & Record<string, unknown> =>
			typeof entry.violation === "string" &&
			Object.values(ViolationType).includes(entry.violation as ViolationType)
	) as unknown as ViolationEntry[];
}

/**
 * Count violations by severity
 */
export function countViolationsBySeverity(
	violations: ViolationEntry[]
): Record<ViolationSeverity, number> {
	const counts: Record<ViolationSeverity, number> = {
		warning: 0,
		error: 0,
		critical: 0,
	};

	for (const v of violations) {
		counts[v.severity]++;
	}

	return counts;
}

/**
 * Generate risk flags from violations for StatusResponse
 */
export function generateViolationRiskFlags(violations: ViolationEntry[]): string[] {
	const flags: string[] = [];
	const counts = countViolationsBySeverity(violations);

	if (violations.length > 0) {
		flags.push(`violations:${violations.length}`);
	}

	if (counts.critical > 0) {
		flags.push(`critical-violations:${counts.critical}`);
	}

	if (counts.error > 0) {
		flags.push(`error-violations:${counts.error}`);
	}

	// Add specific violation type flags
	const violationTypes = new Set(violations.map((v) => v.violation));
	if (violationTypes.has(ViolationType.DIRECT_MERGE)) {
		flags.push("direct-merge-attempted");
	}
	if (violationTypes.has(ViolationType.BYPASS_GATES)) {
		flags.push("gates-bypassed");
	}
	if (violationTypes.has(ViolationType.MODIFY_CI_CONFIG)) {
		flags.push("ci-config-modified");
	}

	return flags;
}

/**
 * Check a command for violations and optionally log them
 *
 * @param runId - The active run identifier
 * @param command - The command being executed
 * @param options - Configuration options
 * @returns Violation entry if detected, null otherwise
 */
export function checkAndLogViolation(
	runId: string,
	command: string,
	options: {
		mode: string;
		log?: boolean;
		context?: string;
		config?: EnforcementConfig;
		baseDir?: string;
	}
): ViolationEntry | null {
	const config = options.config ?? DEFAULT_ENFORCEMENT_CONFIG;
	const baseDir = options.baseDir ?? process.cwd();

	// Skip if mode doesn't require enforcement
	if (!requiresEnforcement(options.mode, config)) {
		return null;
	}

	// Check for git violations
	let violation = detectGitViolation(command, config);
	if (!violation) {
		violation = detectGhViolation(command, config);
	}

	if (!violation) {
		return null;
	}

	// Log if requested
	if (options.log !== false) {
		return logViolation(
			runId,
			violation,
			{
				command,
				context: options.context ?? "Attempted during active run",
				blocked: config.mode === "hard",
			},
			baseDir
		);
	}

	// Return a violation entry without logging
	return {
		timestamp: new Date().toISOString(),
		runId,
		violation,
		command,
		context: options.context ?? "Attempted during active run",
		severity: getViolationSeverity(violation),
		blocked: config.mode === "hard",
	};
}
