/**
 * Test failure enrichment utilities
 *
 * Provides functions to enrich test failures with:
 * - Deterministic failure IDs
 * - Failure signatures for grouping
 * - Parsed stack frames
 * - Actionable next steps
 * - Rerun command templates
 */

export { generateFailureId } from "./failureId.js";
export { generateSignature } from "./signature.js";
export { parseStackFrames } from "./stackParser.js";
export type { StackParserConfig } from "./stackParser.js";
export { generateNextActions, registerFailurePattern, FAILURE_PATTERNS } from "./nextActions.js";
export type { FailurePattern } from "./nextActions.js";
export {
  getRerunCommand,
  getAvailableRunners,
  getTemplate,
  detectRunner,
} from "./rerunTemplates.js";
export type { TestRunner } from "./rerunTemplates.js";
export type { StackFrame, AXNextAction, AXTestResult, AdapterContext } from "./types.js";
