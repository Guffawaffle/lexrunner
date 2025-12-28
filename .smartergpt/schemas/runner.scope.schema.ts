import { z } from "zod";

/**
 * Runner Scope Configuration Schema
 * Corresponds to runner.scope.schema.json
 */

const ScopeBoundariesSchema = z
  .object({
    modules: z.array(z.string()).optional(),
    directories: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();

const ResourceLimitsSchema = z
  .object({
    maxFiles: z.number().optional(),
    maxLines: z.number().optional(),
    maxDuration: z.number().optional(),
  })
  .strict();

export const RunnerScopeSchema = z
  .object({
    version: z.string().optional(),
    scope: ScopeBoundariesSchema.optional(),
    permissions: z.array(z.string()).optional(),
    limits: ResourceLimitsSchema.optional(),
  })
  .strict();

export type RunnerScope = z.infer<typeof RunnerScopeSchema>;
export type ScopeBoundaries = z.infer<typeof ScopeBoundariesSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
