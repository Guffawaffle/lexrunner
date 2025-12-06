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
import type {
	LexSonaMode,
	LexSonaEnvConfig,
	LexSonaWorkflowContext,
	LexSonaShadowResult,
	LexSonaConstraintSnapshot,
} from "./types.js";

// Dynamic import to handle cases where LexSona isn't installed
let LexSonaModule: typeof import("@smartergpt/lexsona") | null = null;

/**
 * Lazily load LexSona module
 */
async function getLexSonaModule(): Promise<
	typeof import("@smartergpt/lexsona") | null
> {
	if (LexSonaModule !== null) {
		return LexSonaModule;
	}
	try {
		LexSonaModule = await import("@smartergpt/lexsona");
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
 * Call LexSona to derive constraints for a workflow context
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

	// If disabled, return early
	if (!isLexSonaEnabled(cfg)) {
		return {
			success: false,
			personaId: cfg.personaId,
			constraintSet: null,
			error: "LexSona disabled (mode=off or no persona)",
			offlineMode: !cfg.hasLexConnection,
			derivedAt,
		};
	}

	// Try to load LexSona
	const lexsona = await getLexSonaModule();
	if (!lexsona) {
		return {
			success: false,
			personaId: cfg.personaId,
			constraintSet: null,
			error: "LexSona module not available",
			offlineMode: !cfg.hasLexConnection,
			derivedAt,
		};
	}

	try {
		// Create LexSona instance via static factory
		const instance = await lexsona.LexSona.connect({
			lexDb: process.env.LEX_DB_PATH,
			persona: cfg.personaId!,
			domain: context.workflowId,
		});

		// Build derive context from workflow context
		const deriveContext: import("@smartergpt/lexsona").DeriveContext = {
			domain: context.workflowId,
			module_id: context.stepKind,
			taskType: context.hints?.task as string | undefined,
		};

		// Derive constraints
		const constraintSet = await instance.deriveConstraints(deriveContext);

		// Convert to snapshot
		const snapshot = toConstraintSnapshot(constraintSet);

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

		// Check for PersonaRequiresMemoryError
		const isMemoryError = errorMessage.includes("requires_memory");

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
