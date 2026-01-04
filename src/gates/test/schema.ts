/**
 * AXTestResult Schema (v1.0.0)
 *
 * Agent-optimized test result format as specified in ADR-009.
 * Design principle: This schema is a verifiable contract, not just a convenient shape.
 * Normalization is never a one-way door — `raw` preserves original data for auditability.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

import { z } from "zod";

// =============================================================================
// Schema Version
// =============================================================================

export const SCHEMA_VERSION = "1.0.0" as const;

// =============================================================================
// Primitive Schemas
// =============================================================================

/**
 * Structured next action for agent execution
 */
export const AXNextActionSchema = z.object({
  /** Action category */
  kind: z.enum(["rerun", "inspect", "fix", "doc"]),
  /** Executable command (optional) */
  cmd: z.string().optional(),
  /** Human-readable description */
  note: z.string(),
});

export type AXNextAction = z.infer<typeof AXNextActionSchema>;

/**
 * Next action can be a simple string or structured object
 */
export const NextActionItemSchema = z.union([z.string(), AXNextActionSchema]);

export type NextActionItem = z.infer<typeof NextActionItemSchema>;

/**
 * Confidence level for next actions
 */
export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export type Confidence = z.infer<typeof ConfidenceSchema>;

/**
 * Stack frame for structured navigation
 */
export const StackFrameSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  function: z.string().optional(),
});

export type StackFrame = z.infer<typeof StackFrameSchema>;

/**
 * Assertion details
 */
export const AssertionSchema = z.object({
  /** e.g., "toBe", "toEqual", "strictEqual" */
  operator: z.string().optional(),
  /** e.g., "string", "LexSonaError" */
  expectedType: z.string().optional(),
  /** e.g., "undefined", "TypeError" */
  actualType: z.string().optional(),
});

export type Assertion = z.infer<typeof AssertionSchema>;

/**
 * Diff information for assertion failures
 */
export const DiffSchema = z.object({
  expected: z.string(),
  actual: z.string(),
  /** Unified diff format when applicable */
  unified: z.string().optional(),
  /** Lines of context included */
  contextLines: z.number().int().nonnegative().optional(),
});

export type Diff = z.infer<typeof DiffSchema>;

/**
 * Error information
 */
export const ErrorInfoSchema = z.object({
  message: z.string(),
  /** e.g., "AssertionError", "TypeError" */
  type: z.string().optional(),
  /** Human-readable stack trace */
  stack: z.string().optional(),
});

export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

// =============================================================================
// AXTestFailure Schema
// =============================================================================

/**
 * Individual test failure with identity, location, and actionable guidance
 */
export const AXTestFailureSchema = z.object({
  // Identity & grouping (enables flaky detection, trend analysis)
  /** Deterministic hash of (file + name + error.type + canonicalized message) */
  failureId: z.string(),
  /** Normalized signature with volatile values scrubbed (timestamps, ports) */
  signature: z.string().optional(),

  // Location
  /** Relative path to test file */
  file: z.string(),
  /** 1-indexed line number */
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),

  /** Test name / describe path */
  name: z.string(),
  /** Parent suite/describe */
  suite: z.string().optional(),

  /** Error information */
  error: ErrorInfoSchema,

  /** Structured stack for agent navigation */
  stackFrames: z.array(StackFrameSchema).optional(),

  /** Assertion details */
  assertion: AssertionSchema.optional(),

  /** Diff information */
  diff: DiffSchema.optional(),

  /** AX-compliant recovery guidance (string or structured) */
  nextActions: z.array(NextActionItemSchema),

  /** Metadata about next actions */
  nextActionsMeta: z
    .object({
      confidence: ConfidenceSchema,
    })
    .optional(),

  /** Duration in milliseconds for identifying slow tests */
  durationMs: z.number().nonnegative().optional(),

  /** Original failure data from adapter — preserves runner-specific details */
  raw: z.unknown().optional(),
});

export type AXTestFailure = z.infer<typeof AXTestFailureSchema>;

// =============================================================================
// Supporting Schemas
// =============================================================================

/**
 * Test run summary
 */
export const SummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});

export type Summary = z.infer<typeof SummarySchema>;

/**
 * Coverage summary (percentages, 0-100)
 */
export const CoverageSchema = z.object({
  linesPct: z.number().min(0).max(100),
  branchesPct: z.number().min(0).max(100),
  functionsPct: z.number().min(0).max(100),
  statementsPct: z.number().min(0).max(100).optional(),
});

export type Coverage = z.infer<typeof CoverageSchema>;

/**
 * Run metadata for reproducibility
 */
export const RunMetadataSchema = z.object({
  /** Working directory */
  cwd: z.string().optional(),
  /** Exact command executed */
  command: z.string().optional(),
  /** Running in CI environment */
  ci: z.boolean().optional(),
  /** e.g., "linux", "darwin", "win32" */
  os: z.string().optional(),
  /** e.g., "20.10.0" */
  nodeVersion: z.string().optional(),
});

export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/**
 * Adapter metadata
 */
export const AdapterMetadataSchema = z.object({
  /** e.g., "vitest-json" */
  name: z.string(),
  version: z.string(),
  /** Original output file/stream */
  source: z.string(),
});

export type AdapterMetadata = z.infer<typeof AdapterMetadataSchema>;

// =============================================================================
// AXTestResult Schema (Main)
// =============================================================================

/**
 * Agent-optimized test result (AX)
 *
 * Summary-first, failures-only, with actionable nextActions[].
 */
export const AXTestResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  timestamp: z.string().datetime(),

  summary: SummarySchema,

  /** Only populated for failures - passing tests omitted for token efficiency */
  failures: z.array(AXTestFailureSchema),

  /** Optional coverage summary (percentages, 0-100) */
  coverage: CoverageSchema.optional(),

  /** Run metadata for reproducibility */
  run: RunMetadataSchema.optional(),

  /** Adapter metadata */
  adapter: AdapterMetadataSchema,

  /** Original unparsed output — normalization is never a one-way door */
  raw: z.string().optional(),
});

export type AXTestResult = z.infer<typeof AXTestResultSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Parse and validate an AXTestResult from unknown input.
 * Returns the validated result or throws ZodError.
 */
export function parseAXTestResult(input: unknown): AXTestResult {
  return AXTestResultSchema.parse(input);
}

/**
 * Safely parse an AXTestResult from unknown input.
 * Returns a Zod SafeParseResult with success/error.
 */
export function safeParseAXTestResult(
  input: unknown
): z.SafeParseReturnType<unknown, AXTestResult> {
  return AXTestResultSchema.safeParse(input);
}

/**
 * Check if input is a valid AXTestResult.
 * Type guard for narrowing.
 */
export function isValidAXTestResult(input: unknown): input is AXTestResult {
  return AXTestResultSchema.safeParse(input).success;
}

/**
 * Parse and validate an AXTestFailure from unknown input.
 */
export function parseAXTestFailure(input: unknown): AXTestFailure {
  return AXTestFailureSchema.parse(input);
}

/**
 * Check if input is a valid AXTestFailure.
 */
export function isValidAXTestFailure(input: unknown): input is AXTestFailure {
  return AXTestFailureSchema.safeParse(input).success;
}

// =============================================================================
// Factory Helpers
// =============================================================================

/**
 * Create an AXTestResult with required fields and sensible defaults.
 */
export function createAXTestResult(
  params: Omit<AXTestResult, "schemaVersion" | "timestamp"> & {
    timestamp?: string;
  }
): AXTestResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    timestamp: params.timestamp ?? new Date().toISOString(),
    ...params,
  };
}

/**
 * Create an AXTestFailure with required fields.
 */
export function createAXTestFailure(
  params: Omit<AXTestFailure, "nextActions"> & {
    nextActions?: NextActionItem[];
  }
): AXTestFailure {
  return {
    nextActions: [],
    ...params,
  };
}
