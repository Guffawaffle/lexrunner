import { z } from 'zod';

export const FeatureSpecV0Schema = z.object({
  schemaVersion: z.literal('0.1.0'),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  acceptanceCriteria: z.array(z.string().min(1)).min(1).max(20),
  technicalContext: z.string().max(2000).optional(),
  constraints: z.string().max(1000).optional(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  createdAt: z.string().datetime()
}).strict();

export type FeatureSpecV0 = z.infer<typeof FeatureSpecV0Schema>;
