/**
 * Preflight conflict detection for merge operations
 * Uses git merge-tree to simulate merges without modifying working tree
 */

import { execa } from "execa";
import { Plan } from "../schema.js";
import { PreflightItemConflict, PreflightResults } from "./types.js";

/**
 * Detect conflicts for all items in a plan by simulating merges sequentially
 */
export async function detectPreflightConflicts(
	plan: Plan,
	workingDir: string = process.cwd()
): Promise<PreflightResults> {
	const items: PreflightItemConflict[] = [];
	let totalConflicts = 0;

	// Simulate merging each item into the target branch
	for (const item of plan.items) {
		try {
			const result = await simulateItemMerge(
				plan.target,
				item.name,
				workingDir
			);
			
			items.push(result);
			if (result.hasConflicts) {
				totalConflicts += result.conflicts.length;
			}
		} catch (error) {
			// If simulation fails, record as error
			items.push({
				name: item.name,
				hasConflicts: false,
				conflicts: [],
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		conflictsDetected: totalConflicts,
		items,
	};
}

/**
 * Simulate merging a single item into the target branch
 */
async function simulateItemMerge(
	targetBranch: string,
	itemBranch: string,
	workingDir: string
): Promise<PreflightItemConflict> {
	try {
		// Try to fetch from origin (will fail if no remote configured, which is fine for local testing)
		await execa("git", ["fetch", "origin", targetBranch, itemBranch], {
			cwd: workingDir,
			reject: false, // Don't throw on non-zero exit
		});

		// Try with origin/ prefix first, fallback to local branches
		let targetRef = `origin/${targetBranch}`;
		let itemRef = `origin/${itemBranch}`;
		
		// Check if origin refs exist
		const { exitCode: targetExists } = await execa(
			"git",
			["rev-parse", "--verify", targetRef],
			{ cwd: workingDir, reject: false }
		);
		
		if (targetExists !== 0) {
			// Fallback to local branch
			targetRef = targetBranch;
		}
		
		const { exitCode: itemExists } = await execa(
			"git",
			["rev-parse", "--verify", itemRef],
			{ cwd: workingDir, reject: false }
		);
		
		if (itemExists !== 0) {
			// Fallback to local branch
			itemRef = itemBranch;
		}

	// Get the merge base
	const { stdout: mergeBase } = await execa(
		"git",
		["merge-base", targetRef, itemRef],
		{ cwd: workingDir }
	);

	// Run git merge-tree to simulate the merge
	const { stdout } = await execa(
		"git",
		[
			"merge-tree",
			mergeBase.trim(),
			targetRef,
			itemRef,
		],
		{
			cwd: workingDir,
			reject: false, // Don't throw on non-zero exit
		}
	);

	// Parse the output for conflicts
	const conflicts = parseMergeTreeOutput(stdout);		return {
			name: itemBranch,
			hasConflicts: conflicts.length > 0,
			conflicts,
			mergeBase: mergeBase.trim(),
		};
	} catch (error) {
		// If git commands fail, treat as potential conflict
		throw new Error(
			`Failed to simulate merge for ${itemBranch}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

/**
 * Parse git merge-tree output to extract conflict information
 */
function parseMergeTreeOutput(output: string): Array<{
	path: string;
	type: 'both-modified' | 'rename' | 'delete-modify' | 'add-add' | 'unknown';
	oursChanged: boolean;
	theirsChanged: boolean;
	lines?: string;
}> {
	const conflicts: Array<{
		path: string;
		type: 'both-modified' | 'rename' | 'delete-modify' | 'add-add' | 'unknown';
		oursChanged: boolean;
		theirsChanged: boolean;
		lines?: string;
	}> = [];

	const lines = output.split("\n");
	const conflictFiles = new Set<string>();

	// Track current file being processed
	let currentFile: string | null = null;
	let inConflictMarker = false;
	let conflictStartLine = 0;
	let lineNumber = 0;

	for (const line of lines) {
		lineNumber++;

		// Look for conflict markers
		if (line.includes("<<<<<<<")) {
			inConflictMarker = true;
			conflictStartLine = lineNumber;

			// Extract filename from marker if present
			const match = line.match(/<<<<<<< (.+)/);
			if (match && match[1]) {
				currentFile = match[1].trim();
			}
		} else if (line.includes(">>>>>>>") && inConflictMarker) {
			inConflictMarker = false;

			if (currentFile && !conflictFiles.has(currentFile)) {
				conflictFiles.add(currentFile);
				conflicts.push({
					path: currentFile,
					type: "both-modified",
					oursChanged: true,
					theirsChanged: true,
					lines: `${conflictStartLine}-${lineNumber}`,
				});
			}

			currentFile = null;
		}

		// Also look for CONFLICT messages in stderr-style output
		if (line.startsWith("CONFLICT")) {
			const fileMatch = line.match(/CONFLICT \(([^)]+)\):\s+(.+)/);
			if (fileMatch) {
				const conflictType = fileMatch[1];
				const filePath = fileMatch[2].trim();

				if (!conflictFiles.has(filePath)) {
					conflictFiles.add(filePath);

					let type: 'both-modified' | 'rename' | 'delete-modify' | 'add-add' | 'unknown' = "unknown";
					if (conflictType.includes("content")) {
						type = "both-modified";
					} else if (conflictType.includes("rename")) {
						type = "rename";
					} else if (conflictType.includes("delete")) {
						type = "delete-modify";
					} else if (conflictType.includes("add")) {
						type = "add-add";
					}

					conflicts.push({
						path: filePath,
						type,
						oursChanged: true,
						theirsChanged: true,
					});
				}
			}
		}

		// Look for "changed in both" messages
		if (line.includes("changed in both") || line.includes("both modified")) {
			const pathMatch = line.match(/[:\s](.+)$/);
			if (pathMatch) {
				const filePath = pathMatch[1].trim();
				if (!conflictFiles.has(filePath)) {
					conflictFiles.add(filePath);
					conflicts.push({
						path: filePath,
						type: "both-modified",
						oursChanged: true,
						theirsChanged: true,
					});
				}
			}
		}
	}

	return conflicts;
}

/**
 * Skip preflight detection with a reason
 */
export function skipPreflightDetection(reason: string): PreflightResults {
	return {
		conflictsDetected: 0,
		items: [],
		skipped: true,
		skipReason: reason,
	};
}
