/**
 * Schema definitions for Feature Spec v0 and Execution Plan v1
 * These schemas will eventually be imported from @guffawaffle/lex package
 */

import { z } from "zod";

/**
 * Feature Spec v0 Schema
 * Input specification for a feature idea
 */
export const FeatureSpecV0Schema = z.object({
  schemaVersion: z.string().default("0.1.0"),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  acceptanceCriteria: z.array(z.string()).min(1, "At least one acceptance criterion is required"),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "Repository must be in format 'owner/repo'"),
  labels: z.array(z.string()).default([]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  estimatedComplexity: z.enum(["simple", "moderate", "complex"]).optional(),
  createdAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type FeatureSpecV0 = {
  schemaVersion: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  repo: string;
  labels: string[];
  priority: "low" | "medium" | "high" | "critical";
  estimatedComplexity?: "simple" | "moderate" | "complex";
  createdAt?: string;
  metadata?: Record<string, any>;
};

/**
 * Sub-Issue Type
 */
export const SubIssueType = z.enum(["feature", "testing", "docs", "refactor", "bugfix"]);
export type SubIssueType = z.infer<typeof SubIssueType>;

/**
 * Sub-Issue Schema
 */
export const SubIssueSchema = z.object({
  id: z.string().min(1, "Sub-issue ID is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  type: SubIssueType,
  acceptanceCriteria: z.array(z.string()).min(1),
  dependsOn: z.array(z.string()).default([]),
  estimatedHours: z.number().optional(),
  assignee: z.string().optional(),
});

export type SubIssue = z.infer<typeof SubIssueSchema>;

/**
 * Epic Schema
 */
export const EpicSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  acceptanceCriteria: z.array(z.string()).min(1),
});

export type Epic = z.infer<typeof EpicSchema>;

/**
 * Execution Plan v1 Schema
 * Generated plan with Epic and Sub-Issues
 */
export const ExecutionPlanV1Schema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  sourceSpec: FeatureSpecV0Schema,
  epic: EpicSchema,
  subIssues: z.array(SubIssueSchema).min(1, "At least one sub-issue is required"),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ExecutionPlanV1 = {
  schemaVersion: string;
  sourceSpec: FeatureSpecV0;
  epic: Epic;
  subIssues: SubIssue[];
  createdAt: string;
  metadata?: Record<string, any>;
};
