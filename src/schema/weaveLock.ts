/**
 * Weave lock file schema
 * Stores lock hash and metadata to ensure idempotent merge-weave runs
 */

import { z } from "zod";

/**
 * PR head entry in lock file
 */
export const PRHeadSchema = z.object({
  name: z.string(),
  sha: z.string(),
});

export type PRHead = z.infer<typeof PRHeadSchema>;

/**
 * Weave lock file schema
 */
export const WeaveLockSchema = z.object({
  lockHash: z.string(),
  planHash: z.string(),
  prHeads: z.array(PRHeadSchema),
  timestamp: z.string(), // ISO 8601 timestamp
  integrationBranch: z.string().optional(),
  status: z.enum(["in-progress", "completed", "failed"]).optional(),
});

export type WeaveLock = z.infer<typeof WeaveLockSchema>;

/**
 * Load and validate weave lock file
 */
export function parseWeaveLock(content: string): WeaveLock {
  const data = JSON.parse(content);
  const result = WeaveLockSchema.safeParse(data);

  if (!result.success) {
    throw new Error(`Invalid weave lock file: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Serialize weave lock to JSON string
 */
export function serializeWeaveLock(lock: WeaveLock): string {
  return JSON.stringify(lock, null, 2);
}
