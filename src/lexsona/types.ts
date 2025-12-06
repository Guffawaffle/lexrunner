/**
 * LexSona Integration Types
 *
 * Types for LexRunner ↔ LexSona shadow governance integration.
 * Implements Version Contract v0.1: Shadow mode only, no enforcement.
 */

import { z } from "zod";

/**
 * LexSona operation mode
 * - "off": LexSona not called at all
 * - "shadow": LexSona called but only for logging/comparison
 */
export type LexSonaMode = "off" | "shadow";

/**
 * Environment configuration for LexSona integration
 */
export interface LexSonaEnvConfig {
	/** Operating mode */
	mode: LexSonaMode;
	/** Persona ID to use (e.g., "quality-first_engineering") */
	personaId: string | null;
	/** Whether Lex memory connection is available */
	hasLexConnection: boolean;
}

/**
 * Context passed to LexSona for constraint derivation
 */
export interface LexSonaWorkflowContext {
	/** Workflow identifier (e.g., "merge-weave", "gate-execution") */
	workflowId: string;
	/** Current step in workflow */
	stepKind: string;
	/** Repository being operated on */
	repo?: string;
	/** Branch target */
	branch?: string;
	/** Environment hostility score (0-1) if available */
	hostilityScore?: number;
	/** Current capability tier suggestion */
	suggestedTier?: string;
	/** Additional context hints */
	hints?: Record<string, unknown>;
}

/**
 * Result from LexSona constraint derivation (shadow mode)
 */
export interface LexSonaShadowResult {
	/** Whether the call succeeded */
	success: boolean;
	/** Persona used */
	personaId: string | null;
	/** Raw constraint set from LexSona */
	constraintSet: LexSonaConstraintSnapshot | null;
	/** Error message if failed */
	error?: string;
	/** Whether offline mode was used */
	offlineMode: boolean;
	/** Confidence ceiling applied (if any) */
	confidenceCeiling?: number;
	/** Derivation timestamp */
	derivedAt: string;
}

/**
 * Snapshot of constraints for logging/comparison
 * Simplified from full ConstraintSet for governance logging
 */
export interface LexSonaConstraintSnapshot {
	/** Number of constraints derived */
	constraintCount: number;
	/** Top constraints by confidence */
	topConstraints: Array<{
		id: string;
		description: string;
		severity: string;
		confidence: number;
	}>;
	/** Principles active */
	principleCount: number;
	/** Metadata from derivation */
	metadata: {
		rulesConsidered: number;
		rulesFiltered: number;
		confidenceThreshold: number;
		offlineMode: boolean;
		confidenceCeiling?: number;
	};
}

/**
 * Governance comparison log entry
 */
export interface GovernanceComparisonLog {
	/** Unique log ID */
	id: string;
	/** Timestamp */
	timestamp: string;
	/** Workflow context */
	context: LexSonaWorkflowContext;
	/** LexSona shadow result */
	lexsona: LexSonaShadowResult;
	/** Runner's governance signals (for comparison) */
	runner: {
		hostilityScore?: number;
		suggestedTier?: string;
		gatesRequired?: string[];
		mergeEligible?: boolean;
	};
	/** LexSona mode used */
	mode: LexSonaMode;
}

/**
 * Zod schema for validation
 */
export const GovernanceComparisonLogSchema = z.object({
	id: z.string(),
	timestamp: z.string(),
	context: z.object({
		workflowId: z.string(),
		stepKind: z.string(),
		repo: z.string().optional(),
		branch: z.string().optional(),
		hostilityScore: z.number().optional(),
		suggestedTier: z.string().optional(),
		hints: z.record(z.string(), z.unknown()).optional(),
	}),
	lexsona: z.object({
		success: z.boolean(),
		personaId: z.string().nullable(),
		constraintSet: z
			.object({
				constraintCount: z.number(),
				topConstraints: z.array(
					z.object({
						id: z.string(),
						description: z.string(),
						severity: z.string(),
						confidence: z.number(),
					})
				),
				principleCount: z.number(),
				metadata: z.object({
					rulesConsidered: z.number(),
					rulesFiltered: z.number(),
					confidenceThreshold: z.number(),
					offlineMode: z.boolean(),
					confidenceCeiling: z.number().optional(),
				}),
			})
			.nullable(),
		error: z.string().optional(),
		offlineMode: z.boolean(),
		confidenceCeiling: z.number().optional(),
		derivedAt: z.string(),
	}),
	runner: z.object({
		hostilityScore: z.number().optional(),
		suggestedTier: z.string().optional(),
		gatesRequired: z.array(z.string()).optional(),
		mergeEligible: z.boolean().optional(),
	}),
	mode: z.enum(["off", "shadow"]),
});
