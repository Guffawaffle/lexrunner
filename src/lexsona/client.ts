/**
 * LexSona Client Module
 *
 * Wraps LexSona for use in LexRunner shadow governance mode.
 * Implements Version Contract v0.1: Shadow mode only, no enforcement.
 *
 * This module is "dumb plumbing" - it calls LexSona and returns results.
 * No policy decisions are made here.
 */

import { ulid } from "ulid";
import chalk from "chalk";
import type {
	LexSonaMode,
	LexSonaEnvConfig,
	LexSonaWorkflowContext,
	LexSonaShadowResult,
	LexSonaConstraintSnapshot,
} from "./types.js";
import type { RunnerGovernanceSignals } from "./logger.js";

// Debug logging helper (QOL-006)
const DEBUG_ENABLED = process.env.LEXSONA_DEBUG === "1";

function debugLog(...args: unknown[]): void {
	if (DEBUG_ENABLED) {
		console.error("[lexsona:debug]", ...args);
	}
}

// Dynamic import to handle cases where LexSona isn't installed
// NOTE: LexSona is an optional dependency. CI/typecheck must succeed even when
// '@smartergpt/lexsona' is not installed.
//
// To avoid TS2307 in environments without LexSona, do NOT reference it in type
// positions (e.g. `typeof import(...)`) and avoid literal-module-specifier
// dynamic imports (e.g. `import("@smartergpt/lexsona")`).
//
// Instead, define the minimal shape we need and load the module via a runtime
// string variable.
type LexSonaDeriveContext = {
	/** Workflow / domain identifier */
	domain: string;
	/** Module / step identifier (LexSona convention) */
	module_id: string;
	/** Optional task type hint */
	taskType?: string;
};

type LexSonaConstraintSet = {
	personaId: string;
	principles: Array<{ id: string; description: string }>;
	constraints: Array<{
		rule_id: string;
		text: string;
		severity: string;
		confidence: number;
		category: string;
	}>;
	metadata: {
		rulesConsidered: number;
		rulesFiltered: number;
		confidenceThreshold: number;
		offlineMode: boolean;
		confidenceCeiling?: number;
	};
};

type LexSonaInstance = {
	deriveConstraints: (
		ctx: LexSonaDeriveContext
	) => Promise<LexSonaConstraintSet>;
};

type LexSonaModuleLike = {
	LexSona: {
		connect: (opts: {
			lexDb?: string;
			persona: string;
			domain: string;
		}) => Promise<LexSonaInstance>;
	};
};

let LexSonaModule: LexSonaModuleLike | null = null;

/**
 * Lazily load LexSona module
 */
async function getLexSonaModule(): Promise<LexSonaModuleLike | null> {
	if (LexSonaModule !== null) {
		return LexSonaModule;
	}
	try {
		const moduleName = "@smartergpt/lexsona";
		LexSonaModule = (await import(
			moduleName
		)) as unknown as LexSonaModuleLike;
		return LexSonaModule;
	} catch {
		return null;
	}
}

/**
 * Read LexSona configuration from environment
 */
export function getLexSonaConfig(): LexSonaEnvConfig {
	const modeRaw = process.env.LEXSONA_MODE ?? "off";
	const mode: LexSonaMode = modeRaw === "shadow" ? "shadow" : "off";
	const personaId = process.env.LEXSONA_PERSONA ?? null;
	const hasLexConnection = process.env.LEX_DB_PATH !== undefined;

	return { mode, personaId, hasLexConnection };
}

/**
 * Check if LexSona shadow mode is enabled for a workflow
 */
export function isLexSonaEnabled(config: LexSonaEnvConfig): boolean {
	return config.mode === "shadow" && config.personaId !== null;
}

/**
 * Convert LexSona ConstraintSet to a snapshot for logging
 */
function toConstraintSnapshot(constraintSet: {
	personaId: string;
	principles: Array<{ id: string; description: string }>;
	constraints: Array<{
		rule_id: string;
		text: string;
		severity: string;
		confidence: number;
		category: string;
	}>;
	metadata: {
		rulesConsidered: number;
		rulesFiltered: number;
		confidenceThreshold: number;
		offlineMode: boolean;
		confidenceCeiling?: number;
	};
}): LexSonaConstraintSnapshot {
	// Sort by confidence descending, take top 10
	const sorted = [...constraintSet.constraints].sort(
		(a, b) => b.confidence - a.confidence
	);
	const topConstraints = sorted.slice(0, 10).map((c) => ({
		id: c.rule_id,
		description: c.text,
		severity: c.severity,
		confidence: c.confidence,
	}));

	return {
		constraintCount: constraintSet.constraints.length,
		topConstraints,
		principleCount: constraintSet.principles.length,
		metadata: constraintSet.metadata,
	};
}

/**
 * Call LexSona to derive constraints for a workflow context (QOL-006: Debug mode)
 *
 * This is the main entry point for shadow governance.
 * Returns a result even on failure (for logging purposes).
 */
export async function deriveShadowConstraints(
	context: LexSonaWorkflowContext,
	config?: LexSonaEnvConfig
): Promise<LexSonaShadowResult> {
	const cfg = config ?? getLexSonaConfig();
	const derivedAt = new Date().toISOString();

	debugLog("deriveShadowConstraints() called");
	debugLog("  Context:", JSON.stringify(context, null, 2));
	debugLog("  Config:", JSON.stringify(cfg, null, 2));

	// If disabled, return early
	if (!isLexSonaEnabled(cfg)) {
		debugLog("LexSona disabled (mode=off or no persona)");
		return {
			success: false,
			personaId: cfg.personaId,
			constraintSet: null,
			error: "LexSona disabled (mode=off or no persona)",
			offlineMode: !cfg.hasLexConnection,
			derivedAt,
		};
	}

	debugLog("Loading LexSona module...");

	// Try to load LexSona
	const lexsona = await getLexSonaModule();
	if (!lexsona) {
		debugLog("LexSona module not available");
		return {
			success: false,
			personaId: cfg.personaId,
			constraintSet: null,
			error: "LexSona module not available",
			offlineMode: !cfg.hasLexConnection,
			derivedAt,
		};
	}

	debugLog("LexSona module loaded successfully");

	try {
		debugLog(`Connecting to LexSona with persona: ${cfg.personaId}`);
		debugLog(
			`  Lex DB: ${process.env.LEX_DB_PATH ?? "(none - offline mode)"}`
		);
		debugLog(`  Domain: ${context.workflowId}`);

		// Create LexSona instance via static factory
		const instance = await lexsona.LexSona.connect({
			lexDb: process.env.LEX_DB_PATH,
			persona: cfg.personaId!,
			domain: context.workflowId,
		});

		debugLog("LexSona instance created");

		// Build derive context from workflow context
		const deriveContext: LexSonaDeriveContext = {
			domain: context.workflowId,
			module_id: context.stepKind,
			taskType: context.hints?.task as string | undefined,
		};

		debugLog("Deriving constraints with context:", deriveContext);

		// Derive constraints
		const constraintSet = await instance.deriveConstraints(deriveContext);

		debugLog("Constraints derived successfully");
		debugLog(`  Total constraints: ${constraintSet.constraints.length}`);
		debugLog(
			`  Rules considered: ${constraintSet.metadata.rulesConsidered}`
		);
		debugLog(`  Rules filtered: ${constraintSet.metadata.rulesFiltered}`);
		debugLog(
			`  Confidence threshold: ${constraintSet.metadata.confidenceThreshold}`
		);
		debugLog(`  Offline mode: ${constraintSet.metadata.offlineMode}`);

		// Log each constraint
		if (constraintSet.constraints.length > 0) {
			debugLog("Constraints:");
			for (const c of constraintSet.constraints) {
				debugLog(
					`  - [${c.severity}] ${c.text} (confidence: ${(
						c.confidence * 100
					).toFixed(0)}%)`
				);
			}
		} else {
			debugLog("No constraints derived");
		}

		// Convert to snapshot
		const snapshot = toConstraintSnapshot(constraintSet);

		debugLog("Final snapshot:", JSON.stringify(snapshot, null, 2));

		return {
			success: true,
			personaId: cfg.personaId,
			constraintSet: snapshot,
			offlineMode: constraintSet.metadata.offlineMode,
			confidenceCeiling: constraintSet.metadata.confidenceCeiling,
			derivedAt,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);

		debugLog("Error during derivation:", errorMessage);
		debugLog("Stack:", error instanceof Error ? error.stack : "(no stack)");

		// Check for PersonaRequiresMemoryError
		const isMemoryError = errorMessage.includes("requires_memory");
		if (isMemoryError) {
			debugLog("Detected PersonaRequiresMemoryError");
		}

		return {
			success: false,
			personaId: cfg.personaId,
			constraintSet: null,
			error: errorMessage,
			offlineMode: !cfg.hasLexConnection,
			derivedAt,
		};
	}
}

/**
 * Generate a unique ID for governance comparison logs
 */
export function generateGovernanceLogId(): string {
	return `gov-${ulid()}`;
}

/**
 * Format a shadow governance result as a console summary
 *
 * Returns a colored string showing:
 * - Persona ID
 * - Constraint count
 * - Agreement/disagreement with runner
 * - Top constraints (if any)
 */
export function formatShadowGovernanceSummary(
	shadowResult: LexSonaShadowResult,
	runnerSignals: RunnerGovernanceSignals,
	opts: { noColor?: boolean } = {}
): string {
	const lines: string[] = [];

	if (!shadowResult.success) {
		const prefix = opts.noColor
			? "[LexSona shadow]"
			: chalk.yellow("[LexSona shadow]");
		lines.push(
			`${prefix} ${shadowResult.personaId ?? "unknown"}: ERROR - ${
				shadowResult.error
			}`
		);
		return lines.join("\n");
	}

	const constraintCount = shadowResult.constraintSet?.constraintCount ?? 0;
	const runnerEligible = runnerSignals.mergeEligible ?? false;
	const lexsonaBlocking = constraintCount > 0;

	// Determine agreement status
	let statusText: string;
	let statusColor: (text: string) => string;
	if (runnerEligible && !lexsonaBlocking) {
		statusText = "AGREES";
		statusColor = opts.noColor ? (t) => t : chalk.green;
	} else if (runnerEligible && lexsonaBlocking) {
		statusText = "WOULD BLOCK";
		statusColor = opts.noColor ? (t) => t : chalk.yellow;
	} else if (!runnerEligible && lexsonaBlocking) {
		statusText = "AGREES (both block)";
		statusColor = opts.noColor ? (t) => t : chalk.green;
	} else {
		statusText = "DISAGREES (runner blocks, LexSona allows)";
		statusColor = opts.noColor ? (t) => t : chalk.cyan;
	}

	// Main status line
	const prefix = opts.noColor
		? "[LexSona shadow]"
		: chalk.blue("[LexSona shadow]");
	const persona = shadowResult.personaId ?? "unknown";
	const runnerStatus = runnerEligible ? "allow" : "block";

	lines.push(
		`${prefix} ${persona}: ${constraintCount} constraints, ${statusColor(
			statusText
		)} (runner: ${runnerStatus})`
	);

	// Show top constraints if any
	if (constraintCount > 0 && shadowResult.constraintSet) {
		const topConstraints = shadowResult.constraintSet.topConstraints.slice(
			0,
			3
		);
		for (const constraint of topConstraints) {
			const confStr = (constraint.confidence * 100).toFixed(0);
			lines.push(
				`  - "${constraint.description.slice(
					0,
					60
				)}" (confidence: ${confStr}%)`
			);
		}
		if (constraintCount > 3) {
			lines.push(`  ... and ${constraintCount - 3} more`);
		}
	}

	// Show offline mode warning if applicable
	if (
		shadowResult.offlineMode &&
		shadowResult.constraintSet?.metadata.offlineMode
	) {
		const warning = opts.noColor
			? "(offline mode - no Lex DB)"
			: chalk.dim("(offline mode - no Lex DB)");
		lines.push(`  ${warning}`);
	}

	return lines.join("\n");
}
