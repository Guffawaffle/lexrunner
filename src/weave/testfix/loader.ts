/**
 * Test Fix Patterns Loader
 *
 * Loads and validates test-fix-patterns.yml from the workspace.
 *
 * @module
 */

import { readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";
import {
	parseTestFixPatterns,
	safeParseTestFixPatterns,
	validatePatternIds,
	type TestFixPatterns,
} from "./schema.js";

/**
 * Default path to test fix patterns file
 */
export const DEFAULT_PATTERNS_PATH = ".smartergpt/test-fix-patterns.yml";

/**
 * Load test fix patterns from YAML file
 *
 * @param workspaceRoot - Root directory of the workspace
 * @param patternsPath - Path to patterns file (relative to workspace root)
 * @returns Parsed and validated test fix patterns
 * @throws Error if file doesn't exist or validation fails
 */
export function loadTestFixPatterns(
	workspaceRoot: string,
	patternsPath: string = DEFAULT_PATTERNS_PATH
): TestFixPatterns {
	const fullPath = join(workspaceRoot, patternsPath);

	let content: string;
	try {
		content = readFileSync(fullPath, "utf-8");
	} catch (err) {
		throw new Error(
			`Failed to read test fix patterns from ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	let data: unknown;
	try {
		data = YAML.parse(content);
	} catch (err) {
		throw new Error(
			`Failed to parse YAML in ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const patterns = parseTestFixPatterns(data);
	validatePatternIds(patterns);

	return patterns;
}

/**
 * Safely load test fix patterns from YAML file
 *
 * @param workspaceRoot - Root directory of the workspace
 * @param patternsPath - Path to patterns file (relative to workspace root)
 * @returns Success result with patterns or error result with message
 */
export function safeLoadTestFixPatterns(
	workspaceRoot: string,
	patternsPath: string = DEFAULT_PATTERNS_PATH
): { success: true; patterns: TestFixPatterns } | { success: false; error: string } {
	const fullPath = join(workspaceRoot, patternsPath);

	let content: string;
	try {
		content = readFileSync(fullPath, "utf-8");
	} catch (err) {
		return {
			success: false,
			error: `Failed to read ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	let data: unknown;
	try {
		data = YAML.parse(content);
	} catch (err) {
		return {
			success: false,
			error: `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const result = safeParseTestFixPatterns(data);
	if (!result.success) {
		return {
			success: false,
			error: `Schema validation failed: ${JSON.stringify(result.error.issues)}`,
		};
	}

	try {
		validatePatternIds(result.data);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	return {
		success: true,
		patterns: result.data,
	};
}
