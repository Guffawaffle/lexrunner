/**
 * Executor Manifest Schema v1.0.0
 *
 * Defines the canonical executor-manifest.yaml schema with Zod types.
 * Based on v0.3.0 thesis: Section 3.3 (Executors as Operational Units)
 *
 * An executor is a small, named, versioned unit that:
 * - implements a narrow role
 * - fixes its tool budget (which tools it may call, under what limits)
 * - binds to a particular guardrail profile
 * - follows a simple Jordan-mode protocol
 */

import { z, type ZodSafeParseResult } from "zod";

/**
 * Schema version for executor manifests
 * Format: "executor-{semver}" e.g., "executor-1.0.0"
 */
export const ExecutorSchemaVersion = z
	.string()
	.regex(
		/^executor-\d+\.\d+\.\d+$/,
		"Schema version must be in format 'executor-X.Y.Z'"
	);

/**
 * Tool limits configuration
 */
export const ToolLimits = z.object({
	maxToolCalls: z.number().int().min(1).optional(),
	maxTokensOut: z.number().int().min(1).optional(),
});
export type ToolLimits = z.infer<typeof ToolLimits>;

/**
 * Tool budget configuration
 * Specifies which tools the executor can use and under what constraints
 */
export const ToolBudget = z.object({
	allowed: z.array(z.string()).default([]),
	denied: z.array(z.string()).default([]),
	limits: ToolLimits.optional(),
});
export type ToolBudget = z.infer<typeof ToolBudget>;

/**
 * Scope guardrail configuration
 * Controls which paths the executor can access
 */
export const ScopeGuardrail = z.object({
	allowedPaths: z.array(z.string()).default([]),
	deniedPaths: z.array(z.string()).default([]),
});
export type ScopeGuardrail = z.infer<typeof ScopeGuardrail>;

/**
 * Tool guardrail configuration
 * Specifies required and optional tool dependencies
 */
export const ToolGuardrail = z.object({
	required: z.array(z.string()).default([]),
	optional: z.array(z.string()).default([]),
});
export type ToolGuardrail = z.infer<typeof ToolGuardrail>;

/**
 * Escalation threshold levels
 */
export const EscalationThreshold = z.enum([
	"low-risk",
	"medium-risk",
	"high-risk",
	"critical",
]);
export type EscalationThreshold = z.infer<typeof EscalationThreshold>;

/**
 * Epistemic guardrail configuration
 * Controls uncertainty handling and escalation
 */
export const EpistemicGuardrail = z.object({
	allowIDK: z.boolean().default(true),
	escalationThreshold: EscalationThreshold.optional(),
});
export type EpistemicGuardrail = z.infer<typeof EpistemicGuardrail>;

/**
 * Style guardrail configuration
 * Controls output formatting requirements
 */
export const StyleGuardrail = z.object({
	requirePlan: z.boolean().default(false),
	requireSummary: z.boolean().default(false),
});
export type StyleGuardrail = z.infer<typeof StyleGuardrail>;

/**
 * Audit level options
 */
export const AuditLevel = z.enum(["minimal", "normal", "verbose", "debug"]);
export type AuditLevel = z.infer<typeof AuditLevel>;

/**
 * Audit guardrail configuration
 * Controls logging and frame emission
 */
export const AuditGuardrail = z.object({
	level: AuditLevel.default("normal"),
	frameSchema: z.string().optional(),
});
export type AuditGuardrail = z.infer<typeof AuditGuardrail>;

/**
 * Executor-specific guardrail configuration
 *
 * A simplified guardrail binding for executor manifests.
 * For full GuardrailProfile specification, see src/types/guardrails.ts
 */
export const ExecutorGuardrails = z.object({
	scope: ScopeGuardrail.optional(),
	tool: ToolGuardrail.optional(),
	epistemic: EpistemicGuardrail.optional(),
	style: StyleGuardrail.optional(),
	audit: AuditGuardrail.optional(),
});
export type ExecutorGuardrails = z.infer<typeof ExecutorGuardrails>;

/**
 * Stochastic phase configuration for Jordan-mode protocol
 */
export const StochasticPhase = z.object({
	promptTemplate: z.string(),
	maxCalls: z.number().int().min(1).default(1),
});
export type StochasticPhase = z.infer<typeof StochasticPhase>;

/**
 * Receipt phase configuration
 * Defines what the executor must emit as output
 */
export const ReceiptPhase = z.object({
	frameType: z.string(),
	fields: z.array(z.string()).min(1, "At least one field is required"),
});
export type ReceiptPhase = z.infer<typeof ReceiptPhase>;

/**
 * Jordan-mode protocol configuration
 *
 * The protocol consists of three phases:
 * 1. Prep phase: deterministically prepare and validate inputs
 * 2. Stochastic phase: perform at most one irreducibly stochastic model call
 * 3. Receipt phase: emit at least one Frame as a receipt
 */
export const JordanModeProtocol = z.object({
	prepPhase: z.array(z.string()).default([]),
	stochasticPhase: StochasticPhase,
	receiptPhase: ReceiptPhase,
});
export type JordanModeProtocol = z.infer<typeof JordanModeProtocol>;

/**
 * Complete Executor Manifest Schema
 *
 * This is the canonical schema for executor-manifest.yaml files.
 * Each executor must define its role, tool budget, guardrail bindings,
 * and Jordan-mode protocol.
 */
export const ExecutorManifestSchema = z.object({
	schemaVersion: ExecutorSchemaVersion,
	role: z.string().min(1, "Role is required"),
	description: z.string().optional(),
	toolBudget: ToolBudget,
	guardrails: ExecutorGuardrails.optional(),
	jordanModeProtocol: JordanModeProtocol,
});
export type ExecutorManifest = z.infer<typeof ExecutorManifestSchema>;

/**
 * Validate an executor manifest object against the schema
 */
export function validateExecutorManifest(data: unknown): ExecutorManifest {
	return ExecutorManifestSchema.parse(data);
}

/**
 * Safely parse an executor manifest without throwing.
 * Returns a SafeParseReturnType containing either:
 * - { success: true, data: ExecutorManifest } on valid input
 * - { success: false, error: ZodError } on invalid input
 */
export function safeParseExecutorManifest(
	data: unknown
): ZodSafeParseResult<ExecutorManifest> {
	return ExecutorManifestSchema.safeParse(data);
}
