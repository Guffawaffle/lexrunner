import { z } from "zod";

/**
 * Safety Gates Configuration Schema
 * Corresponds to gates.schema.json
 */

const GateItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(["validation", "approval", "check"]),
    enabled: z.boolean(),
    description: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(), // Intentionally loose - allows any configuration
  })
  .strict(); // Strict on gate item properties, but config is a free-form object

export const GatesSchema = z
  .object({
    version: z.string().optional(),
    gates: z.array(GateItemSchema).optional(),
  })
  .strict();

export type Gates = z.infer<typeof GatesSchema>;
export type GateItem = z.infer<typeof GateItemSchema>;
