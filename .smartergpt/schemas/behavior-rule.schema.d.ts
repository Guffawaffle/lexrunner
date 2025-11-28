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
declare const RuleScopeSchema: z.ZodObject<{
    environment: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
    agentFamily: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * Single behavioral rule
 */
declare const BehaviorRuleItemSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    content: z.ZodString;
    scope: z.ZodOptional<z.ZodObject<{
        environment: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        agentFamily: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    priority: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/**
 * Behavior Rules Configuration Schema
 * Container for a set of behavioral rules
 */
export declare const BehaviorRuleSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodString>;
    rules: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        content: z.ZodString;
        scope: z.ZodOptional<z.ZodObject<{
            environment: z.ZodOptional<z.ZodString>;
            project: z.ZodOptional<z.ZodString>;
            agentFamily: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        priority: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type BehaviorRule = z.infer<typeof BehaviorRuleSchema>;
export type BehaviorRuleItem = z.infer<typeof BehaviorRuleItemSchema>;
export type RuleScope = z.infer<typeof RuleScopeSchema>;
export {};
