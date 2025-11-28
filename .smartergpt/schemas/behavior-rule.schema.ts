import { z } from "zod";

/**
 * Behavior Rule Schema
 * Corresponds to behavior-rule.schema.json
 *
 * Defines the structure for behavioral rules that provide guidance
 * and policy enforcement for AI agents in the LexRunner ecosystem.
 */

/**
 * Rule scope metadata for context filtering
 */
const RuleScopeSchema = z
	.object({
		/** Environment (e.g., "development", "production") */
		environment: z.string().optional(),
		/** Project identifier */
		project: z.string().optional(),
		/** Agent family (e.g., "copilot", "claude") */
		agentFamily: z.string().optional(),
	})
	.strict();

/**
 * Single behavioral rule
 */
const BehaviorRuleItemSchema = z
	.object({
		/** Unique rule identifier */
		id: z.string(),
		/** Rule title/name */
		title: z.string(),
		/** Rule description */
		description: z.string(),
		/** Rule content/guidance */
		content: z.string(),
		/** Scope metadata for context filtering */
		scope: RuleScopeSchema.optional(),
		/** Priority (higher = more important) */
		priority: z.number().int().min(0).optional(),
	})
	.strict();

/**
 * Behavior Rules Configuration Schema
 * Container for a set of behavioral rules
 */
export const BehaviorRuleSchema = z
	.object({
		/** Schema version for behavior rules configuration */
		version: z.string().optional(),
		/** Array of behavioral rules */
		rules: z.array(BehaviorRuleItemSchema).optional(),
	})
	.strict();

export type BehaviorRule = z.infer<typeof BehaviorRuleSchema>;
export type BehaviorRuleItem = z.infer<typeof BehaviorRuleItemSchema>;
export type RuleScope = z.infer<typeof RuleScopeSchema>;
