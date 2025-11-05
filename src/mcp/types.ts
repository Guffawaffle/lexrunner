/**
 * MCP server types and configurations
 */

import { z } from "zod";

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
 */
export function getMCPEnvironment(): MCPEnvironment {
	return {
		LEX_PR_PROFILE_DIR: process.env.LEX_PR_PROFILE_DIR,
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
