import { z } from 'zod';
import { FeatureSpecV0Schema } from './feature-spec-v0.js';
export const SubIssueSchema = z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(['feature', 'testing', 'docs']),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    dependsOn: z.array(z.string())
});
export const ExecutionPlanV1Schema = z.object({
    schemaVersion: z.literal('1.0.0'),
    sourceSpec: FeatureSpecV0Schema,
    epic: z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        acceptanceCriteria: z.array(z.string().min(1)).min(1)
    }),
    subIssues: z.array(SubIssueSchema).min(1),
    createdAt: z.string().datetime()
});
//# sourceMappingURL=execution-plan-v1.js.map