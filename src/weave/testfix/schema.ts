/**
 * Test Fix Patterns Schema
 *
 * Zod schema for test-fix-patterns.yml validation.
 * Enables deterministic test repair based on test output patterns.
 *
 * @module
 */

import { z } from "zod";

// =============================================================================
// DETERMINISM LEVELS
// =============================================================================

export const DeterminismLevel = z.enum(["D1", "D2", "D3"]);
export type DeterminismLevel = z.infer<typeof DeterminismLevel>;

// =============================================================================
// TRIGGER DEFINITIONS
// =============================================================================

/**
 * Trigger configuration - when to apply a test fix pattern
 */
export const TriggerConfig = z.object({
  /** Regex pattern to match in test output/error */
  test_output: z.string().optional(),
  /** Regex pattern to match in error message */
  error_message: z.string().optional(),
});
export type TriggerConfig = z.infer<typeof TriggerConfig>;

// =============================================================================
// DETECTION DEFINITIONS
// =============================================================================

/**
 * Detection configuration - where to find code to fix
 */
export const DetectionConfig = z.object({
  /** Glob pattern to limit file search scope */
  file_pattern: z.string().min(1),
  /** Regex pattern to find specific lines to fix */
  line_pattern: z.string().min(1),
});
export type DetectionConfig = z.infer<typeof DetectionConfig>;

// =============================================================================
// FIX ACTION DEFINITIONS
// =============================================================================

/**
 * Fix configuration - how to repair the test
 */
export const FixConfig = z.object({
  /** Action type to perform */
  action: z.enum(["update_number", "update_string", "replace", "make_environment_aware"]),
  /** Capture group number for "from" value (for update_number, update_string) */
  from_group: z.number().int().optional(),
  /** Capture group number for "to" value (for update_number, update_string) */
  to_group: z.number().int().optional(),
  /** Replacement text (for replace action) */
  with: z.string().optional(),
  /** Template code (for make_environment_aware action) */
  template: z.string().optional(),
});
export type FixConfig = z.infer<typeof FixConfig>;

// =============================================================================
// TEST FIX PATTERN DEFINITION
// =============================================================================

/**
 * A single test fix pattern definition
 */
export const TestFixPattern = z.object({
  /** Unique pattern identifier */
  id: z.string().min(1),
  /** Human-readable description */
  description: z.string().optional(),
  /** Determinism level for this fix */
  determinism: DeterminismLevel.default("D2"),
  /** When to trigger this pattern */
  trigger: TriggerConfig,
  /** Where to find code to fix */
  detection: DetectionConfig,
  /** How to repair the test */
  fix: FixConfig,
  /** Priority: higher runs first (default: 100) */
  priority: z.number().int().default(100),
  /** Whether pattern is enabled */
  enabled: z.boolean().default(true),
});
export type TestFixPattern = z.infer<typeof TestFixPattern>;

// =============================================================================
// ROOT SCHEMA
// =============================================================================

/**
 * Root schema for test-fix-patterns.yml
 */
export const TestFixPatterns = z.object({
  /** Schema version */
  version: z.number().int().min(1).default(1),
  /** Pattern definitions */
  patterns: z.array(TestFixPattern).default([]),
});
export type TestFixPatterns = z.infer<typeof TestFixPatterns>;

// =============================================================================
// MATCH RESULT DEFINITIONS
// =============================================================================

/**
 * Result of matching a trigger against test output
 */
export interface TriggerMatch {
  /** Pattern that matched */
  patternId: string;
  /** Matched test output */
  matchedOutput: string;
  /** Captured groups from trigger pattern */
  triggerCaptures: Record<string, string>;
  /** Determinism level of the pattern */
  determinism: DeterminismLevel;
}

/**
 * File location where fix should be applied
 */
export interface FixLocation {
  /** File path (absolute or relative) */
  filePath: string;
  /** Line number where match occurred */
  lineNumber: number;
  /** The matched line content */
  matchedLine: string;
  /** Captured groups from detection pattern */
  detectionCaptures: Record<string, string>;
}

/**
 * Complete fix instruction ready to apply
 */
export interface FixInstruction {
  /** Source pattern ID */
  patternId: string;
  /** Trigger match that initiated this fix */
  trigger: TriggerMatch;
  /** Where to apply the fix */
  location: FixLocation;
  /** Fix configuration from pattern */
  fix: FixConfig;
  /** Resolved replacement text */
  replacement: string;
  /** Whether this requires human confirmation */
  requiresConfirmation: boolean;
}

/**
 * Result of applying a fix
 */
export interface FixResult {
  /** Whether the fix was successful */
  success: boolean;
  /** Pattern ID that was applied */
  patternId: string;
  /** File that was modified */
  filePath: string;
  /** Old line content */
  oldContent: string;
  /** New line content */
  newContent: string;
  /** Error message if unsuccessful */
  error?: string;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate test fix patterns
 * @throws ZodError if validation fails
 */
export function parseTestFixPatterns(data: unknown): TestFixPatterns {
  return TestFixPatterns.parse(data);
}

/**
 * Safely parse test fix patterns
 * @returns Success result with data or error result with issues
 */
export function safeParseTestFixPatterns(data: unknown) {
  return TestFixPatterns.safeParse(data);
}

/**
 * Validate pattern IDs are unique
 */
export function validatePatternIds(patterns: TestFixPatterns): void {
  const ids = new Set<string>();
  for (const pattern of patterns.patterns) {
    if (ids.has(pattern.id)) {
      throw new Error(`Duplicate pattern ID: ${pattern.id}`);
    }
    ids.add(pattern.id);
  }
}

/**
 * Get enabled patterns sorted by priority (descending)
 */
export function getEnabledPatterns(patterns: TestFixPatterns): TestFixPattern[] {
  return patterns.patterns.filter((p) => p.enabled).sort((a, b) => b.priority - a.priority);
}
