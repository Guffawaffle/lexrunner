import { z } from "zod";

/**
 * Schema for flake report - tracks retry attempts and transient failures
 */

/**
 * Single attempt record for a gate execution
 */
export const AttemptRecord = z
  .object({
    /** Attempt number (1-based) */
    attempt: z.number().int().min(1),
    /** ISO-8601 timestamp when attempt started */
    timestamp: z.string(),
    /** Attempt status */
    status: z.enum(["pass", "fail"]),
    /** Duration in milliseconds */
    duration_ms: z.number().min(0),
    /** Error type if failed */
    error_type: z.enum(["transient", "permanent", "unknown"]).optional(),
    /** Error message if failed */
    error_message: z.string().optional(),
  })
  .strict();

export type AttemptRecord = z.infer<typeof AttemptRecord>;

/**
 * Flake report for a single gate with retry attempts
 */
export const FlakeReport = z
  .object({
    /** Schema version */
    schemaVersion: z
      .string()
      .regex(/^1\.\d+\.\d+$/)
      .default("1.0.0"),
    /** Item identifier */
    item: z.string(),
    /** Gate name */
    gate: z.string(),
    /** Total number of attempts */
    total_attempts: z.number().int().min(1),
    /** Final status after all attempts */
    final_status: z.enum(["pass", "fail"]),
    /** All attempt records in chronological order */
    attempts: z.array(AttemptRecord).min(1),
    /** Total duration across all attempts in milliseconds */
    total_duration_ms: z.number().min(0),
  })
  .strict();

export type FlakeReport = z.infer<typeof FlakeReport>;

/**
 * Validate a flake report
 */
export function validateFlakeReport(data: unknown): FlakeReport {
  return FlakeReport.parse(data);
}

/**
 * Safe validation that returns success/error result
 */
export function safeValidateFlakeReport(
  data: unknown
): { success: true; data: FlakeReport } | { success: false; error: z.ZodError } {
  const result = FlakeReport.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
