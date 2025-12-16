/**
 * MCP server types and configurations
 */

import { z } from "zod";
import { getEnvWithAlias } from "../util/envUtils.js";

/**
 * Environment configuration for MCP server
 */
export interface MCPEnvironment {
	LEX_PR_PROFILE_DIR?: string;
	ALLOW_MUTATIONS: boolean;
}

/**
 * Get MCP environment configuration with defaults
 * Supports LEX_PR_PROFILE_DIR for profile resolution precedence
 * Supports LEXRUNNER_* aliases for backward compatibility
 */
export function getMCPEnvironment(): MCPEnvironment {
	return {
		LEX_PR_PROFILE_DIR: getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR'),
		ALLOW_MUTATIONS: process.env.ALLOW_MUTATIONS === "true"
	};
}

/**
 * Validation schemas for MCP tool parameters
 */

export const PlanCreateArgs = z.object({
	json: z.boolean().optional(),
	outDir: z.string().optional(),
	// GitHub auto-discovery options
	fromGithub: z.boolean().optional(),
	query: z.string().optional(),
	labels: z.array(z.string()).optional(),
	includeDrafts: z.boolean().optional(),
	excludePRs: z.array(z.number()).optional(),
	githubToken: z.string().optional(),
	owner: z.string().optional(),
	repo: z.string().optional(),
	requiredGates: z.array(z.string()).optional(),
	maxWorkers: z.number().optional(),
	target: z.string().optional()
});
export type PlanCreateArgs = z.infer<typeof PlanCreateArgs>;

export const GatesRunArgs = z.object({
	planFile: z.string().optional(),
	onlyItem: z.string().optional(),
	onlyGate: z.string().optional(),
	outDir: z.string().optional()
});
export type GatesRunArgs = z.infer<typeof GatesRunArgs>;

export const MergeApplyArgs = z.object({
	dryRun: z.boolean().optional()
});
export type MergeApplyArgs = z.infer<typeof MergeApplyArgs>;

export const InitLocalArgs = z.object({
	force: z.boolean().optional()
});
export type InitLocalArgs = z.infer<typeof InitLocalArgs>;

export const ProfileResolveArgs = z.object({
	profileDir: z.string().optional()
});
export type ProfileResolveArgs = z.infer<typeof ProfileResolveArgs>;

/**
 * MCP tool result types
 */

export interface PlanCreateResult {
	plan: object;
	outDir: string;
}

export interface GatesRunResult {
	items: Array<{
		name: string;
		status: string;
		gates: Array<{
			name: string;
			status: string;
		}>;
	}>;
	allGreen: boolean;
}

export interface MergeApplyResult {
	allowed: boolean;
	message: string;
}

export interface InitLocalResult {
	created: boolean;
	path: string;
	config: {
		role: string;
		projectType: string;
		name?: string;
		version?: string;
	};
	copiedFiles: string[];
}

export interface ProfileResolveResult {
	path: string;
	source: string;
	manifest: {
		role: string;
		name?: string;
		version?: string;
	};
}

/**
 * AX-004 Parity tools - argument schemas
 */

export const DiscoverArgs = z.object({
	owner: z.string().optional(),
	repo: z.string().optional(),
	state: z.enum(["open", "closed", "all"]).optional(),
	suggest: z.boolean().optional()
});
export type DiscoverArgs = z.infer<typeof DiscoverArgs>;

export const StatusArgs = z.object({
	planFile: z.string().optional()
});
export type StatusArgs = z.infer<typeof StatusArgs>;

export const MergeOrderArgs = z.object({
	planFile: z.string().optional()
});
export type MergeOrderArgs = z.infer<typeof MergeOrderArgs>;

export const ConfigShowArgs = z.object({
	key: z.string().optional()
});
export type ConfigShowArgs = z.infer<typeof ConfigShowArgs>;

export const WorkflowGuideArgs = z.object({
	phase: z.enum([
		"initial",
		"post-plan-creation",
		"post-gates-run",
		"pre-merge",
		"post-merge",
		"error-recovery"
	])
});
export type WorkflowGuideArgs = z.infer<typeof WorkflowGuideArgs>;

/**
 * AX-004 Parity tools - result types
 */

export interface DiscoverResult {
	pullRequests: Array<{
		number: number;
		title: string;
		branch: string;
		author: string;
		labels: string[];
		sha: string;
	}>;
	suggestions?: Array<{
		from: string;
		to: string;
		confidence: number;
		heuristic: string;
		reason: string;
	}>;
	total: number;
	suggestionsCount?: number;
	authenticated: boolean;
	user?: string;
}

export interface StatusResult {
	plan: {
		schemaVersion: string;
		target: string;
		itemCount: number;
		policy?: object;
	};
	mergeSummary: {
		eligible: string[];
		pending: string[];
		blocked: string[];
		failed: string[];
	};
}

export interface DoctorResult {
	hasErrors: boolean;
	issues: string[];
	suggestions: string[];
	nodejs?: { status: string; current: string; expected?: string };
	configuration?: { hasConfiguration: boolean; missingFiles: string[]; suggestions: string[] };
	projectType?: string;
	environmentSuggestions?: string[];
	github?: { detected: boolean; authenticated?: boolean; user?: string; error?: string };
	git?: { status: string; isClean?: boolean; currentBranch?: string; error?: string };
}

export interface MergeOrderResult {
	levels: string[][];
	totalItems: number;
	maxParallelism: number;
}

export interface ConfigShowResult {
	config?: {
		items: unknown[];
		target: string;
		version: string;
	};
	provenance?: Record<string, string>;
	sources?: Array<{ exists: boolean; file: string }>;
	key?: string;
	value?: unknown;
}
