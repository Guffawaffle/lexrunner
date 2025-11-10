import { z } from 'zod';
export declare const FeatureSpecV0Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"0.1.0">;
    title: z.ZodString;
    description: z.ZodString;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    technicalContext: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodString>;
    repo: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type FeatureSpecV0 = z.infer<typeof FeatureSpecV0Schema>;
//# sourceMappingURL=feature-spec-v0.d.ts.map