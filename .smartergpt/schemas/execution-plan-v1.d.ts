import { z } from 'zod';
export declare const SubIssueSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    type: z.ZodEnum<{
        feature: "feature";
        testing: "testing";
        docs: "docs";
    }>;
    acceptanceCriteria: z.ZodArray<z.ZodString>;
    dependsOn: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const ExecutionPlanV1Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"1.0.0">;
    sourceSpec: z.ZodObject<{
        schemaVersion: z.ZodLiteral<"0.1.0">;
        title: z.ZodString;
        description: z.ZodString;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        technicalContext: z.ZodOptional<z.ZodString>;
        constraints: z.ZodOptional<z.ZodString>;
        repo: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strip>;
    epic: z.ZodObject<{
        title: z.ZodString;
        description: z.ZodString;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    subIssues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        type: z.ZodEnum<{
            feature: "feature";
            testing: "testing";
            docs: "docs";
        }>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        dependsOn: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type ExecutionPlanV1 = z.infer<typeof ExecutionPlanV1Schema>;
export type SubIssue = z.infer<typeof SubIssueSchema>;
//# sourceMappingURL=execution-plan-v1.d.ts.map