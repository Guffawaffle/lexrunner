/**
 * CLI Output Utilities
 * Centralized JSON and human-readable output functions for CLI commands
 */

import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Write JSON to stdout with error handling.
 * Ensures clean stdout for JSON purity.
 * Errors are written to stderr to maintain stdout purity.
 */
export function writeJsonOutput(data: unknown): void {
  try {
    const json = canonicalJSONStringify(data);
    process.stdout.write(json);
  } catch (error) {
    // Error to stderr, not stdout (preserve JSON purity)
    console.error("Error serializing JSON:", error);
    process.exit(1);
  }
}

/**
 * Format data for human-readable output.
 * Currently a placeholder for future formatting enhancements.
 * Supports tables, trees, and plain text formats.
 *
 * @param data - Data to format
 * @param format - Output format (default: 'plain')
 * @returns Formatted string
 */
export function formatHumanOutput(
  data: unknown,
  format: "table" | "tree" | "plain" = "plain"
): string {
  // For now, just return JSON string for any format
  // Future: implement table and tree formatting
  switch (format) {
    case "table":
    case "tree":
    case "plain":
    default:
      return JSON.stringify(data, null, 2);
  }
}

/**
 * Conditional output based on --json flag.
 * Writes JSON to stdout if json flag is true, otherwise uses human-readable format.
 *
 * @param data - Data to output
 * @param opts - Options object with optional json flag
 */
export function writeOutput(data: unknown, opts: { json?: boolean }): void {
  if (opts.json) {
    writeJsonOutput(data);
  } else {
    console.log(formatHumanOutput(data));
  }
}
