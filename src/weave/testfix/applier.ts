/**
 * Test Fix Applier
 *
 * Applies fixes to test files based on matched patterns.
 *
 * @module
 */

import { readFileSync, writeFileSync } from "fs";
import type {
	FixConfig,
	FixInstruction,
	FixResult,
	TriggerMatch,
	FixLocation,
	TestFixPattern,
} from "./schema.js";

/**
 * Build fix instruction from trigger match and fix location
 *
 * @param pattern - Pattern that matched
 * @param trigger - Trigger match
 * @param location - Fix location
 * @returns Fix instruction ready to apply
 */
export function buildFixInstruction(
	pattern: TestFixPattern,
	trigger: TriggerMatch,
	location: FixLocation
): FixInstruction | null {
	const { fix } = pattern;
	let replacement: string;

	switch (fix.action) {
		case "update_number": {
			// Extract new value from trigger captures
			const newValue = trigger.triggerCaptures[String(fix.to_group || 2)];
			if (!newValue) {
				return null;
			}

			// Replace old number with new number in matched line
			const oldValue = location.detectionCaptures[String(fix.from_group || 1)];
			if (!oldValue) {
				return null;
			}

			replacement = location.matchedLine.replace(oldValue, newValue);
			break;
		}

		case "update_string": {
			// Extract new value from trigger captures
			const newValue = trigger.triggerCaptures[String(fix.to_group || 2)];
			if (!newValue) {
				return null;
			}

			// Replace old string with new string in matched line
			const oldValue = location.detectionCaptures[String(fix.from_group || 1)];
			if (!oldValue) {
				return null;
			}

			replacement = location.matchedLine.replace(oldValue, newValue);
			break;
		}

		case "replace": {
			// Simple replacement with fixed text
			if (!fix.with) {
				return null;
			}

			// Replace the entire matched portion
			const lineRegex = new RegExp(pattern.detection.line_pattern);
			replacement = location.matchedLine.replace(lineRegex, fix.with);
			break;
		}

		case "make_environment_aware": {
			// Template-based replacement (requires more context)
			if (!fix.template) {
				return null;
			}

			// For now, just use the template as-is
			// In a real implementation, this would be more sophisticated
			replacement = fix.template;
			break;
		}

		default:
			return null;
	}

	return {
		patternId: pattern.id,
		trigger,
		location,
		fix,
		replacement,
		requiresConfirmation: pattern.determinism !== "D1",
	};
}

/**
 * Apply a fix instruction to a file
 *
 * @param instruction - Fix instruction to apply
 * @param dryRun - If true, don't actually write the file
 * @returns Fix result
 */
export function applyFix(
	instruction: FixInstruction,
	dryRun: boolean = false
): FixResult {
	const { location, replacement } = instruction;

	try {
		// Read the file
		const content = readFileSync(location.filePath, "utf-8");
		const lines = content.split("\n");

		// Validate line number
		if (location.lineNumber < 1 || location.lineNumber > lines.length) {
			return {
				success: false,
				patternId: instruction.patternId,
				filePath: location.filePath,
				oldContent: location.matchedLine,
				newContent: replacement,
				error: `Line number ${location.lineNumber} out of range (1-${lines.length})`,
			};
		}

		// Get the old line content
		const oldLine = lines[location.lineNumber - 1];

		// Verify it matches what we expect
		if (oldLine !== location.matchedLine) {
			return {
				success: false,
				patternId: instruction.patternId,
				filePath: location.filePath,
				oldContent: oldLine,
				newContent: replacement,
				error: `Line content changed since detection. Expected: "${location.matchedLine}", Found: "${oldLine}"`,
			};
		}

		// Apply the fix
		lines[location.lineNumber - 1] = replacement;

		// Write back (unless dry run)
		if (!dryRun) {
			writeFileSync(location.filePath, lines.join("\n"), "utf-8");
		}

		return {
			success: true,
			patternId: instruction.patternId,
			filePath: location.filePath,
			oldContent: oldLine,
			newContent: replacement,
		};
	} catch (err) {
		return {
			success: false,
			patternId: instruction.patternId,
			filePath: location.filePath,
			oldContent: location.matchedLine,
			newContent: replacement,
			error: `Failed to apply fix: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Apply multiple fix instructions
 *
 * @param instructions - Fix instructions to apply
 * @param dryRun - If true, don't actually write files
 * @returns Array of fix results
 */
export function applyFixes(
	instructions: FixInstruction[],
	dryRun: boolean = false
): FixResult[] {
	return instructions.map((instruction) => applyFix(instruction, dryRun));
}
