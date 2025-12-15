/**
 * Vacuum-Ready Prompt Schema v1.0.0
 *
 * Defines the canonical vrp-1.0.0 schema for stochastic phase calls.
 * Based on v0.3.0 thesis: Section 5 (Vacuum-Ready Prompts)
 *
 * A vacuum-ready prompt is a prompt that:
 * - is scope-closed: no unbounded research
 * - is tool-anchored: tools named explicitly
 * - is policy-attached: guardrails stated upfront
 * - is task-atomic: one deliverable
 * - is outcome-checkable: success criteria defined
 */

import { z, type ZodSafeParseResult } from "zod";

/**
 * Schema version for vacuum-ready prompts
 * Format: "vrp-{semver}" e.g., "vrp-1.0.0"
 */
export const VRPSchemaVersion = z
	.string()
	.regex(/^vrp-\d+\.\d+\.\d+$/, "Schema version must be in format 'vrp-X.Y.Z'");

/**
 * Scope closure configuration
 * Defines bounds on the search/research space
 */
export const ScopeClosure = z
	.object({
		targetPaths: z
			.array(z.string())
			.min(1, "At least one target path is required"),
		excludePaths: z.array(z.string()).default([]),
		maxDepth: z.number().int().min(1).optional(),
		description: z.string().min(1, "Scope description is required"),
	})
	.strict();
export type ScopeClosure = z.infer<typeof ScopeClosure>;

/**
 * Tool anchoring configuration
 * Explicitly names which tools may be used
 */
export const ToolAnchoring = z
	.object({
		allowedTools: z
			.array(z.string())
			.min(1, "At least one tool must be specified"),
		maxToolCalls: z.number().int().min(1).optional(),
		rationale: z
			.string()
			.min(1, "Tool selection rationale is required")
			.optional(),
	})
	.strict();
export type ToolAnchoring = z.infer<typeof ToolAnchoring>;

/**
 * Policy attachment configuration
 * Guardrails and constraints stated upfront
 */
export const PolicyAttachment = z
	.object({
		guardrails: z.array(z.string()).min(1, "At least one guardrail is required"),
		constraints: z.array(z.string()).default([]),
		escalationRules: z.array(z.string()).default([]),
	})
	.strict();
export type PolicyAttachment = z.infer<typeof PolicyAttachment>;

/**
 * Task atomicity configuration
 * Ensures exactly one deliverable
 */
export const TaskAtomicity = z
	.object({
		deliverable: z.string().min(1, "Deliverable description is required"),
		deliverableType: z.enum([
			"frame",
			"report",
			"decision",
			"artifact",
			"analysis",
		]),
		multipleOutputsProhibited: z.boolean().default(true),
	})
	.strict();
export type TaskAtomicity = z.infer<typeof TaskAtomicity>;

/**
 * Outcome checkability configuration
 * Defines how success is measured
 */
export const OutcomeCheckability = z
	.object({
		successCriteria: z
			.array(z.string())
			.min(1, "At least one success criterion is required"),
		failureCriteria: z.array(z.string()).default([]),
		acceptanceTest: z.string().optional(),
	})
	.strict();
export type OutcomeCheckability = z.infer<typeof OutcomeCheckability>;

/**
 * Complete Vacuum-Ready Prompt Schema
 *
 * This is the canonical schema for vrp-1.0.0 prompts used in stochastic phases.
 * Each prompt must satisfy all five properties to be considered vacuum-ready.
 */
export const VacuumReadyPromptSchema = z
	.object({
		schemaVersion: VRPSchemaVersion,
		promptId: z.string().min(1, "Prompt ID is required"),
		description: z.string().min(1, "Description is required"),
		scopeClosed: ScopeClosure,
		toolAnchored: ToolAnchoring,
		policyAttached: PolicyAttachment,
		taskAtomic: TaskAtomicity,
		outcomeCheckable: OutcomeCheckability,
		metadata: z.record(z.string(), z.any()).optional(),
	})
	.strict();
export type VacuumReadyPrompt = z.infer<typeof VacuumReadyPromptSchema>;

/**
 * Validate a vacuum-ready prompt object against the schema
 * Throws a ZodError if validation fails
 */
export function validateVacuumReadyPrompt(
	data: unknown
): VacuumReadyPrompt {
	return VacuumReadyPromptSchema.parse(data);
}

/**
 * Safely parse a vacuum-ready prompt without throwing.
 * Returns a SafeParseReturnType containing either:
 * - { success: true, data: VacuumReadyPrompt } on valid input
 * - { success: false, error: ZodError } on invalid input
 */
export function safeParseVacuumReadyPrompt(
	data: unknown
): ZodSafeParseResult<VacuumReadyPrompt> {
	return VacuumReadyPromptSchema.safeParse(data);
}
