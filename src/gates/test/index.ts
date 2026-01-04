/**
 * AX Test Gate Module
 *
 * Agent-optimized test result parsing and normalization.
 *
 * @see docs/adr/ADR-009-ax-test-output-adapters.md
 */

// Schema exports
export {
  // Version
  SCHEMA_VERSION,
  // Main schemas
  AXTestResultSchema,
  AXTestFailureSchema,
  AXNextActionSchema,
  // Supporting schemas
  SummarySchema,
  CoverageSchema,
  RunMetadataSchema,
  AdapterMetadataSchema,
  StackFrameSchema,
  AssertionSchema,
  DiffSchema,
  ErrorInfoSchema,
  NextActionItemSchema,
  ConfidenceSchema,
  // Types
  type AXTestResult,
  type AXTestFailure,
  type AXNextAction,
  type NextActionItem,
  type Summary,
  type Coverage,
  type RunMetadata,
  type AdapterMetadata,
  type StackFrame,
  type Assertion,
  type Diff,
  type ErrorInfo,
  type Confidence,
  // Validation helpers
  parseAXTestResult,
  safeParseAXTestResult,
  isValidAXTestResult,
  parseAXTestFailure,
  isValidAXTestFailure,
  // Factory helpers
  createAXTestResult,
  createAXTestFailure,
} from "./schema.js";
