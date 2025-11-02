/**
 * Audit event schemas and type definitions (Phase 3A)
 * Comprehensive Zod validation for all 14 event types
 */

import { z } from 'zod';

/**
 * Schema version - follows SemVer
 */
export const AUDIT_SCHEMA_VERSION = '1.0.0';

/**
 * Event types enum
 */
export const EventType = z.enum([
	'command_invocation',
	'plan_discovered',
	'plan_validated',
	'merge_order_computed',
	'gate_started',
	'gate_finished',
	'merge_dry_run_started',
	'merge_dry_run_finished',
	'merge_execute_started',
	'merge_conflict_detected',
	'merge_finished',
	'artifact_written',
	'error',
	'run_summary'
]);
export type EventType = z.infer<typeof EventType>;

/**
 * Event severity level
 */
export const EventLevel = z.enum(['info', 'warn', 'error']);
export type EventLevel = z.infer<typeof EventLevel>;

/**
 * Actor type
 */
export const ActorType = z.enum(['cli', 'mcp', 'ci']);
export type ActorType = z.infer<typeof ActorType>;

/**
 * Gate status
 */
export const GateStatus = z.enum(['pass', 'fail', 'skip', 'error']);
export type GateStatus = z.infer<typeof GateStatus>;

/**
 * Merge status
 */
export const MergeStatus = z.enum(['success', 'conflict', 'error']);
export type MergeStatus = z.infer<typeof MergeStatus>;

/**
 * Audit profile
 */
export const AuditProfile = z.enum(['basic', 'standard', 'compliance', 'debug']);
export type AuditProfile = z.infer<typeof AuditProfile>;

/**
 * Tool information schema
 */
export const ToolSchema = z.object({
	name: z.string(),
	version: z.string()
});
export type Tool = z.infer<typeof ToolSchema>;

/**
 * Actor information schema
 */
export const ActorSchema = z.object({
	type: ActorType,
	user: z.string().optional()
});
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Repository context schema
 */
export const RepoSchema = z.object({
	remote: z.string().optional(),
	branch: z.string().optional(),
	commit: z.string().optional()
});
export type Repo = z.infer<typeof RepoSchema>;

/**
 * Context blocks schema
 */
export const ContextSchema = z.object({
	git: z.record(z.any()).optional(),
	ci: z.record(z.any()).optional(),
	os: z.record(z.any()).optional()
}).optional();
export type Context = z.infer<typeof ContextSchema>;

/**
 * Event-specific payload schemas
 */

// Command invocation
export const CommandInvocationPayload = z.object({
	argv: z.array(z.string()),
	cwd: z.string()
});
export type CommandInvocationPayload = z.infer<typeof CommandInvocationPayload>;

// Plan discovered
export const PlanDiscoveredPayload = z.object({
	pr_ids: z.array(z.union([z.string(), z.number()])),
	base: z.string(),
	head: z.string(),
	plan_hash: z.string()
});
export type PlanDiscoveredPayload = z.infer<typeof PlanDiscoveredPayload>;

// Plan validated
export const PlanValidatedPayload = z.object({
	schema_version: z.string(),
	warnings: z.array(z.string()).optional()
});
export type PlanValidatedPayload = z.infer<typeof PlanValidatedPayload>;

// Merge order computed
export const MergeOrderComputedPayload = z.object({
	levels: z.number(),
	items_per_level: z.array(z.number())
});
export type MergeOrderComputedPayload = z.infer<typeof MergeOrderComputedPayload>;

// Gate started
export const GateStartedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	gate: z.string()
});
export type GateStartedPayload = z.infer<typeof GateStartedPayload>;

// Gate finished
export const GateFinishedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	gate: z.string(),
	duration_ms: z.number(),
	status: GateStatus,
	artifact_refs: z.array(z.string()).optional()
});
export type GateFinishedPayload = z.infer<typeof GateFinishedPayload>;

// Merge dry run started
export const MergeDryRunStartedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	base: z.string(),
	head: z.string()
});
export type MergeDryRunStartedPayload = z.infer<typeof MergeDryRunStartedPayload>;

// Merge dry run finished
export const MergeDryRunFinishedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	status: MergeStatus,
	conflicts: z.array(z.string()).optional()
});
export type MergeDryRunFinishedPayload = z.infer<typeof MergeDryRunFinishedPayload>;

// Merge execute started
export const MergeExecuteStartedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	base: z.string(),
	head: z.string()
});
export type MergeExecuteStartedPayload = z.infer<typeof MergeExecuteStartedPayload>;

// Merge conflict detected
export const MergeConflictDetectedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	files: z.array(z.string())
});
export type MergeConflictDetectedPayload = z.infer<typeof MergeConflictDetectedPayload>;

// Merge finished
export const MergeFinishedPayload = z.object({
	item: z.union([z.string(), z.number()]),
	status: MergeStatus,
	commit: z.string().optional()
});
export type MergeFinishedPayload = z.infer<typeof MergeFinishedPayload>;

// Artifact written
export const ArtifactWrittenPayload = z.object({
	path: z.string(),
	sha256: z.string(),
	bytes: z.number()
});
export type ArtifactWrittenPayload = z.infer<typeof ArtifactWrittenPayload>;

// Error
export const ErrorPayload = z.object({
	code: z.string(),
	message: z.string(),
	where: z.string().optional()
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;

// Run summary
export const RunSummaryPayload = z.object({
	totals: z.object({
		items: z.number(),
		gates: z.number(),
		passed: z.number(),
		failed: z.number()
	}),
	pass_fail_matrix: z.record(z.record(z.string())),
	final_status: z.string()
});
export type RunSummaryPayload = z.infer<typeof RunSummaryPayload>;

/**
 * Base event envelope schema (common fields for all events)
 */
export const EventEnvelopeSchema = z.object({
	schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
	event: EventType,
	ts: z.string().datetime(),
	level: EventLevel.default('info'),
	session_id: z.string(),
	run_id: z.string(),
	tool: ToolSchema,
	actor: ActorSchema,
	repo: RepoSchema,
	context: ContextSchema,
	payload: z.any()
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Typed event schemas (envelope + specific payload)
 */
export const CommandInvocationEvent = EventEnvelopeSchema.extend({
	event: z.literal('command_invocation'),
	payload: CommandInvocationPayload
});
export type CommandInvocationEvent = z.infer<typeof CommandInvocationEvent>;

export const PlanDiscoveredEvent = EventEnvelopeSchema.extend({
	event: z.literal('plan_discovered'),
	payload: PlanDiscoveredPayload
});
export type PlanDiscoveredEvent = z.infer<typeof PlanDiscoveredEvent>;

export const PlanValidatedEvent = EventEnvelopeSchema.extend({
	event: z.literal('plan_validated'),
	payload: PlanValidatedPayload
});
export type PlanValidatedEvent = z.infer<typeof PlanValidatedEvent>;

export const MergeOrderComputedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_order_computed'),
	payload: MergeOrderComputedPayload
});
export type MergeOrderComputedEvent = z.infer<typeof MergeOrderComputedEvent>;

export const GateStartedEvent = EventEnvelopeSchema.extend({
	event: z.literal('gate_started'),
	payload: GateStartedPayload
});
export type GateStartedEvent = z.infer<typeof GateStartedEvent>;

export const GateFinishedEvent = EventEnvelopeSchema.extend({
	event: z.literal('gate_finished'),
	payload: GateFinishedPayload
});
export type GateFinishedEvent = z.infer<typeof GateFinishedEvent>;

export const MergeDryRunStartedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_dry_run_started'),
	payload: MergeDryRunStartedPayload
});
export type MergeDryRunStartedEvent = z.infer<typeof MergeDryRunStartedEvent>;

export const MergeDryRunFinishedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_dry_run_finished'),
	payload: MergeDryRunFinishedPayload
});
export type MergeDryRunFinishedEvent = z.infer<typeof MergeDryRunFinishedEvent>;

export const MergeExecuteStartedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_execute_started'),
	payload: MergeExecuteStartedPayload
});
export type MergeExecuteStartedEvent = z.infer<typeof MergeExecuteStartedEvent>;

export const MergeConflictDetectedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_conflict_detected'),
	payload: MergeConflictDetectedPayload
});
export type MergeConflictDetectedEvent = z.infer<typeof MergeConflictDetectedEvent>;

export const MergeFinishedEvent = EventEnvelopeSchema.extend({
	event: z.literal('merge_finished'),
	payload: MergeFinishedPayload
});
export type MergeFinishedEvent = z.infer<typeof MergeFinishedEvent>;

export const ArtifactWrittenEvent = EventEnvelopeSchema.extend({
	event: z.literal('artifact_written'),
	payload: ArtifactWrittenPayload
});
export type ArtifactWrittenEvent = z.infer<typeof ArtifactWrittenEvent>;

export const ErrorEvent = EventEnvelopeSchema.extend({
	event: z.literal('error'),
	payload: ErrorPayload
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

export const RunSummaryEvent = EventEnvelopeSchema.extend({
	event: z.literal('run_summary'),
	payload: RunSummaryPayload
});
export type RunSummaryEvent = z.infer<typeof RunSummaryEvent>;

/**
 * Union type for all audit events
 */
export type AuditEvent =
	| CommandInvocationEvent
	| PlanDiscoveredEvent
	| PlanValidatedEvent
	| MergeOrderComputedEvent
	| GateStartedEvent
	| GateFinishedEvent
	| MergeDryRunStartedEvent
	| MergeDryRunFinishedEvent
	| MergeExecuteStartedEvent
	| MergeConflictDetectedEvent
	| MergeFinishedEvent
	| ArtifactWrittenEvent
	| ErrorEvent
	| RunSummaryEvent;

/**
 * Parse and validate an audit event from unknown data
 * 
 * @param data - Unknown data to validate
 * @returns Validated audit event
 * @throws ZodError if validation fails
 */
export function parseAuditEvent(data: unknown): AuditEvent {
	return EventEnvelopeSchema.parse(data) as AuditEvent;
}

/**
 * Validate an audit event (returns success/error instead of throwing)
 * 
 * @param data - Unknown data to validate
 * @returns SafeParseReturnType with success flag and data or error
 */
export function validateAuditEvent(data: unknown) {
	return EventEnvelopeSchema.safeParse(data);
}
