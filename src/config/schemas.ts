/**
 * Configuration file schemas for validation
 * Defines Zod schemas for all profile configuration files
 */

import { z } from "zod";

/**
 * Gates configuration schema (gates.yml)
 */
export const GatesConfigSchema = z.object({
	version: z.number().int().min(1),
	levels: z.record(
		z.array(
			z.object({
				name: z.string(),
				run: z.string(),
				cwd: z.string().optional(),
				env: z.record(z.string()).optional(),
				runtime: z.enum(["local", "container", "ci-service"]).optional(),
				artifacts: z.array(z.string()).optional()
			})
		)
	)
}).strict();

export type GatesConfig = z.infer<typeof GatesConfigSchema>;

/**
 * Scope configuration schema (scope.yml)
 */
export const ScopeConfigSchema = z.object({
	version: z.number().int().min(1),
	target: z.string(),
	sources: z.array(z.object({
		query: z.string()
	})),
	selectors: z.object({
		include_labels: z.array(z.string()).default([]),
		exclude_labels: z.array(z.string()).default([])
	}).default({}),
	defaults: z.object({
		strategy: z.enum(["rebase-weave", "merge-weave", "squash-weave"]),
		base: z.string()
	}).default({ strategy: "merge-weave", base: "main" }),
	pin_commits: z.boolean().default(false)
}).strict();

export type ScopeConfig = z.infer<typeof ScopeConfigSchema>;

/**
 * Dependencies configuration schema (deps.yml)
 */
export const DepsConfigSchema = z.object({
	version: z.number().int().min(1),
	depends_on: z.array(z.string()).default([]),
	strategies: z.record(z.enum(["rebase-weave", "merge-weave", "squash-weave"])).default({})
}).strict();

export type DepsConfig = z.infer<typeof DepsConfigSchema>;

/**
 * Stack configuration schema (stack.yml)
 */
export const StackConfigSchema = z.object({
	version: z.number().int().min(1),
	target: z.string(),
	items: z.array(z.object({
		id: z.union([z.number(), z.string()]).optional(),
		name: z.string().optional(),
		branch: z.string(),
		sha: z.string().optional(),
		deps: z.array(z.string()).default([]),
		strategy: z.enum(["rebase-weave", "merge-weave", "squash-weave"]).default("merge-weave"),
		gates: z.array(z.object({
			name: z.string(),
			run: z.string(),
			cwd: z.string().optional(),
			env: z.record(z.string()).optional(),
			runtime: z.enum(["local", "container", "ci-service"]).optional(),
			artifacts: z.array(z.string()).optional()
		})).optional()
	}))
}).strict();

export type StackConfig = z.infer<typeof StackConfigSchema>;

/**
 * Merge policy configuration schema (merge-policy.yml)
 */
export const MergePolicyConfigSchema = z.object({
	rules: z.array(z.object({
		globs: z.array(z.string()),
		resolution: z.enum(["ours", "theirs", "auto", "keep-both"]),
		format: z.boolean().optional()
	}))
}).strict();

export type MergePolicyConfig = z.infer<typeof MergePolicyConfigSchema>;

/**
 * Map of config file names to their schemas
 */
export const CONFIG_SCHEMAS = {
	"gates.yml": GatesConfigSchema,
	"scope.yml": ScopeConfigSchema,
	"deps.yml": DepsConfigSchema,
	"stack.yml": StackConfigSchema,
	"merge-policy.yml": MergePolicyConfigSchema
} as const;

export type ConfigFileName = keyof typeof CONFIG_SCHEMAS;
