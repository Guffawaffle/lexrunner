/**
 * Type definitions for test failure enrichment
 */

/**
 * Stack frame from parsed stack trace
 */
export interface StackFrame {
  /** File path */
  file: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Function name */
  function?: string;
}

/**
 * Next action suggestion for test failure
 */
export interface AXNextAction {
  /** Action description */
  action: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Reasoning for the suggestion */
  reason?: string;
}

/**
 * Test result with enrichment data
 */
export interface AXTestResult {
  /** Test file path */
  file: string;
  /** Test name */
  name: string;
  /** Test status */
  status: "pass" | "fail" | "skip";
  /** Duration in milliseconds */
  duration_ms?: number;
  /** Error message (for failures) */
  error?: string;
  /** Error type/name */
  errorType?: string;
  /** Stack trace */
  stack?: string;
  /** Unique failure identifier */
  failureId?: string;
  /** Failure signature for grouping */
  signature?: string;
  /** Parsed stack frames */
  stackFrames?: StackFrame[];
  /** Suggested next actions */
  nextActions?: AXNextAction[];
}

/**
 * Context for adapter when generating next actions
 */
export interface AdapterContext {
  /** Test framework being used */
  framework?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}
