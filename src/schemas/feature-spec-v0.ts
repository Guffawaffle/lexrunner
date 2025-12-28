/**
 * Feature Spec v0 Schema - Initial idea capture format
 */

import { z } from "zod";

/**
 * Feature Spec v0 Schema
 * Used for capturing initial feature ideas
 */
export const FeatureSpecV0Schema = z.object({
  schemaVersion: z.string().regex(/^0\.\d+\.\d+$/, "Must be v0.x.y format"),
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  acceptanceCriteria: z.array(z.string()),
  technicalContext: z.string().optional(),
  constraints: z.string().optional(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "Must be owner/repo format"),
  createdAt: z.string().datetime(),
});

export type FeatureSpecV0 = z.infer<typeof FeatureSpecV0Schema>;

/**
 * Idea Prompt Template Schema (optional)
 */
export const IdeaPromptTemplateSchema = z.object({
  title: z.string(),
  description: z.string(),
  sections: z
    .array(
      z.object({
        name: z.string(),
        content: z.string(),
      })
    )
    .optional(),
});

export type IdeaPromptTemplate = z.infer<typeof IdeaPromptTemplateSchema>;
