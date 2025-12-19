/**
 * Fanout Templates Schema
 *
 * Zod schema for fanout-templates.yml validation.
 * Enables deterministic follow-up issue creation based on PR diff patterns.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// TRIGGER DEFINITIONS
// =============================================================================

/**
 * Pattern trigger - matches against PR diff content
 */
export const PatternTrigger = z.object({
	/** Regex pattern to match in PR diff */
	pattern: z.string().min(1),
	/** File glob patterns to limit search scope */
	files: z.array(z.string()).optional(),
	/** Named capture groups for template substitution */
	captures: z.array(z.string()).optional(),
});
export type PatternTrigger = z.infer<typeof PatternTrigger>;

/**
 * Trigger configuration - when to create follow-up issues
 */
export const TriggerConfig = z.object({
	/** Pattern to match in the PR diff */
	pattern: z.string().min(1),
	/** Glob patterns for files to check */
	files: z.array(z.string()).default(["**/*"]),
	/** Named regex groups to extract values */
	captures: z.record(z.string(), z.string()).optional(),
	/** If true, requires D2/D3 judgment for confirmation */
	requires_judgment: z.boolean().default(false),
});
export type TriggerConfig = z.infer<typeof TriggerConfig>;

// =============================================================================
// ISSUE TEMPLATE DEFINITIONS
// =============================================================================

/**
 * Issue body template with placeholders
 */
export const IssueTemplate = z.object({
	/** Issue title (supports {placeholder} substitution) */
	title: z.string().min(1),
	/** Labels to apply */
	labels: z.array(z.string()).default([]),
	/** Assignees (GitHub usernames) */
	assignees: z.array(z.string()).optional(),
	/** Issue body markdown (supports {placeholder} substitution) */
	body: z.string().min(1),
	/** Target repo: 'same' for trigger repo, or 'owner/repo' */
	repo: z.string().default("same"),
});
export type IssueTemplate = z.infer<typeof IssueTemplate>;

// =============================================================================
// FANOUT TEMPLATE DEFINITIONS
// =============================================================================

/**
 * A single fanout template definition
 */
export const FanoutTemplate = z.object({
	/** Unique template identifier */
	id: z.string().min(1),
	/** Human-readable description */
	description: z.string().optional(),
	/** When to trigger this template */
	trigger: TriggerConfig,
	/** Issue to create when triggered */
	issue: IssueTemplate,
	/** Priority: higher runs first (default: 100) */
	priority: z.number().int().default(100),
	/** Whether template is enabled */
	enabled: z.boolean().default(true),
});
export type FanoutTemplate = z.infer<typeof FanoutTemplate>;

// =============================================================================
// ROOT SCHEMA
// =============================================================================

/**
 * Root schema for fanout-templates.yml
 */
export const FanoutTemplates = z.object({
	/** Schema version */
	version: z.number().int().min(1).default(1),
	/** Template definitions */
	templates: z.array(FanoutTemplate).default([]),
});
export type FanoutTemplates = z.infer<typeof FanoutTemplates>;

// =============================================================================
// MATCHED TRIGGER RESULT
// =============================================================================

/**
 * Result of matching a trigger against a PR diff
 */
export interface TriggerMatch {
	/** Template that matched */
	templateId: string;
	/** File that matched the pattern */
	matchedFile: string;
	/** Line number where match occurred */
	lineNumber: number;
	/** The matched text */
	matchedText: string;
	/** Extracted capture values */
	captures: Record<string, string>;
	/** Whether this requires human judgment */
	requiresJudgment: boolean;
}

/**
 * Generated issue ready for creation
 */
export interface GeneratedIssue {
	/** Source template ID */
	templateId: string;
	/** Source trigger match */
	match: TriggerMatch;
	/** Resolved issue title */
	title: string;
	/** Resolved issue body */
	body: string;
	/** Labels to apply */
	labels: string[];
	/** Assignees */
	assignees: string[];
	/** Target repo (owner/name format) */
	repo: string;
	/** Whether creation should be confirmed by human */
	requiresConfirmation: boolean;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate fanout templates
 * @throws ZodError if validation fails
 */
export function parseFanoutTemplates(data: unknown): FanoutTemplates {
	return FanoutTemplates.parse(data);
}

/**
 * Safely parse fanout templates
 * @returns Success result with data or error result with issues
 */
export function safeParseFanoutTemplates(data: unknown) {
	return FanoutTemplates.safeParse(data);
}

/**
 * Validate a single template ID is unique
 */
export function validateTemplateIds(templates: FanoutTemplates): void {
	const ids = new Set<string>();
	for (const template of templates.templates) {
		if (ids.has(template.id)) {
			throw new Error(`Duplicate template ID: ${template.id}`);
		}
		ids.add(template.id);
	}
}
