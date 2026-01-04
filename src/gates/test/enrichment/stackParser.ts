/**
 * Parse stack traces into structured frames
 */

import type { StackFrame } from "./types.js";

/**
 * Configuration for stack parsing
 */
export interface StackParserConfig {
  /** Maximum number of frames to return */
  maxFrames?: number;
  /** Whether to filter out node_modules frames */
  filterNodeModules?: boolean;
  /** Additional patterns to filter out */
  filterPatterns?: RegExp[];
}

const DEFAULT_CONFIG: Required<StackParserConfig> = {
  maxFrames: 5,
  filterNodeModules: true,
  filterPatterns: [],
};

/**
 * Parse a Node.js/V8 stack trace into structured frames
 *
 * Supports formats like:
 * - at functionName (file:line:col)
 * - at file:line:col
 * - at async functionName (file:line:col)
 *
 * @param stack - Raw stack trace string
 * @param config - Parsing configuration
 * @returns Array of parsed stack frames
 */
export function parseStackFrames(stack: string, config: StackParserConfig = {}): StackFrame[] {
  if (!stack) return [];

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const frames: StackFrame[] = [];

  // Split into lines and process each
  const lines = stack.split("\n");

  for (const line of lines) {
    // Skip empty lines and error message line
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("at ")) {
      continue;
    }

    // Parse the frame
    const frame = parseFrame(trimmed);
    if (!frame) continue;

    // Apply filters
    if (shouldFilterFrame(frame, cfg)) {
      continue;
    }

    frames.push(frame);

    // Check if we've reached the limit
    if (frames.length >= cfg.maxFrames) {
      break;
    }
  }

  return frames;
}

/**
 * Parse a single stack frame line
 */
function parseFrame(line: string): StackFrame | null {
  // Remove "at " prefix and "async " prefix if present
  let cleaned = line.replace(/^\s*at\s+/, "").replace(/^async\s+/, "");

  // Try to match: functionName (file:line:col)
  let match = cleaned.match(/^(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
  if (match) {
    return {
      function: match[1].trim(),
      file: match[2].trim(),
      line: parseInt(match[3], 10),
      column: parseInt(match[4], 10),
    };
  }

  // Try to match: file:line:col
  match = cleaned.match(/^(.+?):(\d+):(\d+)$/);
  if (match) {
    return {
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
    };
  }

  // Try to match: functionName (file)
  match = cleaned.match(/^(.+?)\s+\((.+?)\)$/);
  if (match) {
    return {
      function: match[1].trim(),
      file: match[2].trim(),
    };
  }

  // Just a file path
  if (cleaned.length > 0) {
    return {
      file: cleaned.trim(),
    };
  }

  return null;
}

/**
 * Check if a frame should be filtered out
 */
function shouldFilterFrame(frame: StackFrame, config: Required<StackParserConfig>): boolean {
  // Filter node_modules if configured
  if (config.filterNodeModules && frame.file.includes("node_modules")) {
    return true;
  }

  // Check custom filter patterns
  for (const pattern of config.filterPatterns) {
    if (pattern.test(frame.file)) {
      return true;
    }
  }

  // Filter internal Node.js frames
  if (
    frame.file.startsWith("node:") ||
    frame.file.startsWith("internal/") ||
    frame.file === "<anonymous>"
  ) {
    return true;
  }

  // Note: We keep frames with <anonymous> function names as they may have valuable file/line info
  // Only filter if the function is <anonymous> AND we have no useful file information

  return false;
}
