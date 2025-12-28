import { z } from "zod";

/**
 * Runner Stack Configuration Schema
 * Corresponds to runner.stack.schema.json
 */

const StackComponentSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(), // Intentionally loose - allows any configuration
  })
  .strict();

export const RunnerStackSchema = z
  .object({
    version: z.string().optional(),
    stack: z.array(StackComponentSchema).optional(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
  })
  .strict();

export type RunnerStack = z.infer<typeof RunnerStackSchema>;
export type StackComponent = z.infer<typeof StackComponentSchema>;
