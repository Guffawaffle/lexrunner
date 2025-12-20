/**
 * Test Fix Pattern Matcher
 *
 * Matches test output against trigger patterns and finds code locations to fix.
 *
 * @module
 */

import { readFileSync } from "fs";
import { join } from "path";
import { globSync } from "glob";
import type {
	TestFixPattern,
	TriggerMatch,
	FixLocation,
} from "./schema.js";

/**
 * Match test output against trigger patterns
 *
 * @param testOutput - Test failure output
 * @param patterns - Patterns to match against
 * @returns Array of trigger matches
 */
export function matchTriggers(
	testOutput: string,
	patterns: TestFixPattern[]
): TriggerMatch[] {
	const matches: TriggerMatch[] = [];

	for (const pattern of patterns) {
		const { trigger } = pattern;

		// Check test_output pattern
		if (trigger.test_output) {
			// Use 's' flag to make . match newlines
			const regex = new RegExp(trigger.test_output, "ms");
			const match = testOutput.match(regex);

			if (match) {
				const captures: Record<string, string> = {};
				for (let i = 1; i < match.length; i++) {
					captures[String(i)] = match[i] || "";
				}

				matches.push({
					patternId: pattern.id,
					matchedOutput: match[0],
					triggerCaptures: captures,
					determinism: pattern.determinism,
				});
				continue;
			}
		}

		// Check error_message pattern
		if (trigger.error_message) {
			// Use 's' flag to make . match newlines
			const regex = new RegExp(trigger.error_message, "ms");
			const match = testOutput.match(regex);

			if (match) {
				const captures: Record<string, string> = {};
				for (let i = 1; i < match.length; i++) {
					captures[String(i)] = match[i] || "";
				}

				matches.push({
					patternId: pattern.id,
					matchedOutput: match[0],
					triggerCaptures: captures,
					determinism: pattern.determinism,
				});
			}
		}
	}

	return matches;
}

/**
 * Find code locations to fix based on detection pattern
 *
 * @param workspaceRoot - Root directory of the workspace
 * @param pattern - Pattern to use for detection
 * @returns Array of fix locations
 */
export function findFixLocations(
	workspaceRoot: string,
	pattern: TestFixPattern
): FixLocation[] {
	const locations: FixLocation[] = [];
	const { detection } = pattern;

	// Find files matching the file pattern
	const files = globSync(detection.file_pattern, {
		cwd: workspaceRoot,
		absolute: true,
		nodir: true,
	});

	const lineRegex = new RegExp(detection.line_pattern);

	for (const filePath of files) {
		try {
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(lineRegex);

				if (match) {
					const captures: Record<string, string> = {};
					for (let j = 1; j < match.length; j++) {
						captures[String(j)] = match[j] || "";
					}

					locations.push({
						filePath,
						lineNumber: i + 1,
						matchedLine: line,
						detectionCaptures: captures,
					});
				}
			}
		} catch (err) {
			// Skip files that can't be read (permissions, binary files, etc.)
			// Logging is intentionally silent to avoid noise during pattern matching
		}
	}

	return locations;
}

/**
 * Match triggers and find all fix locations
 *
 * @param testOutput - Test failure output
 * @param workspaceRoot - Root directory of the workspace
 * @param patterns - Patterns to match against
 * @returns Map of pattern IDs to their fix locations
 */
export function matchAndLocate(
	testOutput: string,
	workspaceRoot: string,
	patterns: TestFixPattern[]
): Map<string, { trigger: TriggerMatch; locations: FixLocation[] }> {
	const results = new Map<
		string,
		{ trigger: TriggerMatch; locations: FixLocation[] }
	>();

	// First, find which patterns triggered
	const triggerMatches = matchTriggers(testOutput, patterns);

	// For each triggered pattern, find fix locations
	for (const trigger of triggerMatches) {
		const pattern = patterns.find((p) => p.id === trigger.patternId);
		if (!pattern) continue;

		const locations = findFixLocations(workspaceRoot, pattern);

		results.set(trigger.patternId, {
			trigger,
			locations,
		});
	}

	return results;
}
