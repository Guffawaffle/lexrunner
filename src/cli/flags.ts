/**
 * Global CLI flags shared across commands.
 * Centralizes option parsing, validation, and env var fallback logic.
 */

import { Command } from "commander";

/**
 * Global CLI flags shared across commands.
 */
export interface GlobalFlags {
  json?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  tokenBudget?: number;
  maxPrompts?: number;
}

/**
 * Register global flags on a Commander program.
 * These flags are available to all commands.
 */
export function registerGlobalFlags(program: Command): void {
  program
    .option("--no-color", "Disable ANSI color codes in output")
    .option("--json", "Enable JSON output mode (implies --no-color)")
    .option("--verbose", "Enable verbose logging")
    .option("--quiet", "Suppress non-essential output")
    .option("--token-budget <number>", "Maximum token budget (default: 5000)", "5000")
    .option("--max-prompts <number>", "Maximum number of prompts (default: 3)", "3");
}

/**
 * Parse and validate global flags.
 * Handles env var fallbacks and precedence rules.
 *
 * Priority: CLI args (explicit) > Environment variables > Defaults (undefined)
 *
 * Note: Commander passes boolean flags as:
 * - true when flag is present (e.g., --json)
 * - false when negated flag is present (e.g., --no-json)
 * - undefined when flag is not provided at all
 */
export function parseGlobalFlags(opts: any): GlobalFlags {
  // Helper to get flag value with proper precedence
  const getFlag = (cliValue: any, envVar: string): boolean | undefined => {
    // If CLI value is explicitly set (true or false), use it
    if (cliValue !== undefined) {
      return cliValue;
    }
    // Otherwise check environment variable
    if (process.env[envVar] === "1") {
      return true;
    }
    // Default to undefined
    return undefined;
  };

  // Helper to parse numeric value with env fallback
  const getNumeric = (cliValue: any, envVar: string, defaultValue: number): number => {
    if (cliValue !== undefined) {
      const parsed = parseInt(cliValue, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    if (process.env[envVar]) {
      const parsed = parseInt(process.env[envVar]!, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    return defaultValue;
  };

  return {
    json: getFlag(opts.json, "LEX_PR_JSON"),
    noColor: getFlag(opts.noColor, "NO_COLOR"),
    verbose: getFlag(opts.verbose, "LEX_PR_VERBOSE"),
    quiet: opts.quiet ?? false,
    tokenBudget: getNumeric(opts.tokenBudget, "LEX_PR_TOKEN_BUDGET", 5000),
    maxPrompts: getNumeric(opts.maxPrompts, "LEX_PR_MAX_PROMPTS", 3),
  };
}

/**
 * Check for conflicting flag combinations.
 * @throws Error if conflicting flags are detected
 */
export function validateFlagCombinations(flags: GlobalFlags): void {
  // --quiet and --verbose are mutually exclusive
  if (flags.quiet && flags.verbose) {
    throw new Error("Cannot use --quiet and --verbose together");
  }

  // --json and --verbose may conflict (warn, but don't error)
  // JSON mode should suppress verbose output
  if (flags.json && flags.verbose) {
    // This is handled gracefully: JSON mode takes precedence
    // No error, but verbose is effectively ignored
  }
}
