/**
 * Global CLI flags shared across commands.
 * Centralizes option parsing, validation, and env var fallback logic.
 */

import { Command } from 'commander';

/**
 * Global CLI flags shared across commands.
 */
export interface GlobalFlags {
	json?: boolean;
	noColor?: boolean;
	verbose?: boolean;
	quiet?: boolean;
}

/**
 * Register global flags on a Commander program.
 * These flags are available to all commands.
 */
export function registerGlobalFlags(program: Command): void {
	program
		.option('--no-color', 'Disable ANSI color codes in output')
		.option('--json', 'Enable JSON output mode (implies --no-color)')
		.option('--verbose', 'Enable verbose logging')
		.option('--quiet', 'Suppress non-essential output');
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
		if (process.env[envVar] === '1') {
			return true;
		}
		// Default to undefined
		return undefined;
	};
	
	return {
		json: getFlag(opts.json, 'LEX_PR_JSON'),
		noColor: getFlag(opts.noColor, 'NO_COLOR'),
		verbose: getFlag(opts.verbose, 'LEX_PR_VERBOSE'),
		quiet: opts.quiet ?? false,
	};
}

/**
 * Check for conflicting flag combinations.
 * @throws Error if conflicting flags are detected
 */
export function validateFlagCombinations(flags: GlobalFlags): void {
	// --quiet and --verbose are mutually exclusive
	if (flags.quiet && flags.verbose) {
		throw new Error('Cannot use --quiet and --verbose together');
	}

	// --json and --verbose may conflict (warn, but don't error)
	// JSON mode should suppress verbose output
	if (flags.json && flags.verbose) {
		// This is handled gracefully: JSON mode takes precedence
		// No error, but verbose is effectively ignored
	}
}
