/**
 * Snapshot Builder
 *
 * Generates TaskSnapshot_v1 structures with anchored hunks, hashes, and scope boundaries.
 * This is the entry point for creating task handoff contracts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import {
	TaskSnapshot_v1,
	Scope_v1,
	SourceTruth_v1,
	AnchoredHunk_v1,
	FailureInfo_v1,
	computeSnapshotHash,
	computeCanonicalHash,
	TASK_CONTRACT_VERSION
} from "../schemas/task-contract.js";

/**
 * Options for configuring the SnapshotBuilder
 */
export interface SnapshotBuilderOptions {
	/** Absolute path to the repository root */
	repoRoot: string;
	/** Number of context lines to include around hunks (default: 5) */
	contextRadius?: number;
}

/**
 * Input parameters for building a snapshot
 */
export interface BuildSnapshotInput {
	/** Unique identifier for this task */
	taskId: string;
	/** Procedure/instructions for the agent */
	procedure: string;
	/** Target files that need to be modified (relative to repoRoot) */
	targetFiles: string[];
	/** Failure information (if this is a retry/fix task) */
	failureInfo?: {
		message: string;
		location?: { file: string; line: number; column?: number };
		exitCode?: number;
	};
	/** Git commit SHA this snapshot is based on */
	commitSha: string;
	/** Branch name (optional) */
	branchName?: string;
	/** Verification command to run after changes */
	verificationCmd: string;
	/** Expected exit code for verification (default: 0) */
	expectedExitCode?: number;
	/** Override default scope settings */
	scopeOverrides?: Partial<Scope_v1>;
}

/**
 * SnapshotBuilder Class
 *
 * Creates TaskSnapshot_v1 structures with proper hunk extraction, hashing, and scope management.
 */
export class SnapshotBuilder {
	private repoRoot: string;
	private contextRadius: number;
	
	// Hunk extraction thresholds
	private static readonly SMALL_FILE_LINE_THRESHOLD = 100;
	private static readonly LARGE_FILE_PREVIEW_LINES = 50;

	constructor(options: SnapshotBuilderOptions) {
		this.repoRoot = options.repoRoot;
		this.contextRadius = options.contextRadius ?? 5;
	}

	/**
	 * Build a complete TaskSnapshot from input parameters
	 */
	async buildSnapshot(input: BuildSnapshotInput): Promise<TaskSnapshot_v1> {
		// Extract anchored hunks for target files
		const anchoredHunks = await this.extractHunks(
			input.targetFiles,
			input.failureInfo?.location
		);

		// Build scope with defaults and overrides
		const scope = this.buildScope(input.targetFiles, input.scopeOverrides);

		// Convert failure info if present
		const failureInfo = input.failureInfo
			? {
					message: input.failureInfo.message,
					location: input.failureInfo.location,
					exit_code: input.failureInfo.exitCode,
					stack_trace: undefined
			  }
			: undefined;

		// Build the snapshot without hash first
		const snapshotWithoutHash: Omit<TaskSnapshot_v1, "snapshot_hash"> = {
			schema_version: TASK_CONTRACT_VERSION,
			task_id: input.taskId,
			created_at: new Date().toISOString(),
			commit_sha: input.commitSha,
			branch_name: input.branchName,
			procedure: input.procedure,
			target_files: input.targetFiles,
			anchored_hunks: anchoredHunks,
			failure_info: failureInfo,
			verification_cmd: input.verificationCmd,
			expected_exit_code: input.expectedExitCode ?? 0,
			scope
		};

		// Compute snapshot hash
		const snapshotHash = computeSnapshotHash(snapshotWithoutHash);

		// Return complete snapshot
		return {
			...snapshotWithoutHash,
			snapshot_hash: snapshotHash
		};
	}

	/**
	 * Extract anchored hunks from target files
	 *
	 * For each target file:
	 * - If failure location is specified and in this file: extract context around that line
	 * - Otherwise: extract entire file (for small files) or first N lines (for large files)
	 */
	private async extractHunks(
		targetFiles: string[],
		failureLocation?: { file: string; line: number; column?: number }
	): Promise<AnchoredHunk_v1[]> {
		const hunks: AnchoredHunk_v1[] = [];

		for (const targetFile of targetFiles) {
			const absolutePath = path.join(this.repoRoot, targetFile);

			// Read file content
			let content: string;
			try {
				content = await fs.readFile(absolutePath, "utf-8");
			} catch (error) {
				// If file doesn't exist, create an empty hunk as placeholder
				hunks.push({
					file_path: targetFile,
					start_line: 1,
					end_line: 1,
					content: "",
					content_hash: computeCanonicalHash("")
				});
				continue;
			}

			const lines = content.split("\n");

			// Determine which lines to extract
			let startLine: number;
			let endLine: number;

			if (
				failureLocation &&
				this.normalizeFilePath(failureLocation.file) === this.normalizeFilePath(targetFile)
			) {
				// Extract context around failure location
				const targetLine = failureLocation.line;
				startLine = Math.max(1, targetLine - this.contextRadius);
				endLine = Math.min(lines.length, targetLine + this.contextRadius);
			} else {
				// Extract entire file for small files, or first portion for large files
				startLine = 1;
				if (lines.length <= SnapshotBuilder.SMALL_FILE_LINE_THRESHOLD) {
					endLine = lines.length;
				} else {
					endLine = Math.min(SnapshotBuilder.LARGE_FILE_PREVIEW_LINES, lines.length);
				}
			}

			// Extract the content
			const hunkLines = lines.slice(startLine - 1, endLine);
			const hunkContent = hunkLines.join("\n");

			// Get source truth for this file
			const sourceTruth = await this.getSourceTruth(targetFile);

			hunks.push({
				file_path: targetFile,
				start_line: startLine,
				end_line: endLine,
				content: hunkContent,
				content_hash: computeCanonicalHash(hunkContent),
				source_truth: sourceTruth
			});
		}

		return hunks;
	}

	/**
	 * Get source of truth for a file (git provenance)
	 */
	private async getSourceTruth(filePath: string): Promise<SourceTruth_v1 | undefined> {
		try {
			// Get the commit that last modified this file
			const result = await execa(
				"git",
				["log", "-1", "--format=%H", "--", filePath],
				{ cwd: this.repoRoot }
			);

			const introducingCommit = result.stdout.trim();

			if (!introducingCommit) {
				return undefined;
			}

			// Optionally get author and timestamp
			const detailsResult = await execa(
				"git",
				["log", "-1", "--format=%an|%aI", introducingCommit],
				{ cwd: this.repoRoot }
			);

			const [author, timestamp] = detailsResult.stdout.trim().split("|");

			return {
				introducing_commit: introducingCommit,
				author,
				introduced_at: timestamp
			};
		} catch (error) {
			// If git command fails, return undefined (e.g., file not in git yet)
			return undefined;
		}
	}

	/**
	 * Build scope with defaults and overrides
	 */
	private buildScope(targetFiles: string[], overrides?: Partial<Scope_v1>): Scope_v1 {
		const defaultScope: Scope_v1 = {
			read_globs: ["**/*.ts", "**/*.json", "docs/**"],
			write_globs: targetFiles.map(f => f),
			deny_globs: [
				"node_modules/**",
				"dist/**",
				".git/**",
				"*.lock",
				"package-lock.json",
				"pnpm-lock.yaml",
				"yarn.lock"
			],
			cross_repo_allowed: false
		};

		// Merge overrides
		return {
			...defaultScope,
			...overrides
		};
	}

	/**
	 * Normalize file path for comparison (handle different separators, leading slashes)
	 */
	private normalizeFilePath(filePath: string): string {
		// Convert to posix-style path and remove leading slashes
		return path.posix.normalize(filePath.replace(/\\/g, "/")).replace(/^\/+/, "");
	}
}
