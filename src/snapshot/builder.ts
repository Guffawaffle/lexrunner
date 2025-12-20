/**
 * Snapshot Builder
 *
 * Generates `TaskSnapshot_v1` structures (ADR-007) with anchored hunks, hashes,
 * and scope boundaries.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
	TaskSnapshot_v1,
	computeSnapshotHash,
	computeCanonicalHash,
	TASK_CONTRACT_VERSION,
	DeterminismLevel,
	RepoProvenance,
	ScopeBoundary,
	FailureEvidence,
	Target,
} from "../schemas/task-contract.js";

/**
 * Options for configuring the SnapshotBuilder
 */
export interface SnapshotBuilderOptions {
	/** Absolute path to the repository root */
	repoRoot: string;
	/** Repository identifier (owner/repo) */
	repoId: string;
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
	/** Determinism level (default: D1) */
	determinism?: DeterminismLevel;
	/** Target files that need to be modified (relative to repoRoot) */
	targetFiles: string[];
	/** Failure evidence (required by the contract) */
	failure: {
		message: string;
		fileRel: string;
		line?: number;
		runnerOutputSnip: string;
		excerpt?: string;
	};
	/** Git commit SHA this snapshot is based on */
	commitSha: string;
	/** Verification command to run after changes */
	verificationCmd: string;
	/** Expected exit code for verification (default: 0) */
	expectedExitCode?: number;
	/** Override default scope settings */
	scopeOverrides?: Partial<ScopeBoundary>;
	/** Receipt schema identifier for downstream validation (default: task-receipt-v1) */
	receiptSchemaId?: string;
}

/**
 * SnapshotBuilder Class
 *
 * Creates TaskSnapshot_v1 structures with proper hunk extraction, hashing, and scope management.
 */
export class SnapshotBuilder {
	private repoRoot: string;
	private repoId: string;
	private contextRadius: number;

	// Hunk extraction thresholds
	private static readonly SMALL_FILE_LINE_THRESHOLD = 100;
	private static readonly LARGE_FILE_PREVIEW_LINES = 50;

	constructor(options: SnapshotBuilderOptions) {
		this.repoRoot = options.repoRoot;
		this.repoId = options.repoId;
		this.contextRadius = options.contextRadius ?? 5;
	}

	/**
	 * Build a complete TaskSnapshot from input parameters
	 */
	async buildSnapshot(input: BuildSnapshotInput): Promise<TaskSnapshot_v1> {
		const targets = await this.buildTargets(
			input.targetFiles,
			input.failure.fileRel,
			input.failure.line
		);

		const repo: RepoProvenance = {
			id: this.repoId,
			root: this.repoRoot,
			commit_sha: input.commitSha,
		};

		const scope = this.buildScope(input.targetFiles, input.scopeOverrides);

		const failure: FailureEvidence = {
			message: input.failure.message,
			file_rel: input.failure.fileRel,
			line: input.failure.line,
			runner_output_snip: input.failure.runnerOutputSnip,
			excerpt: input.failure.excerpt,
		};

		const snapshotWithoutHash: Omit<TaskSnapshot_v1, "snapshot_hash"> = {
			schema_version: TASK_CONTRACT_VERSION,
			task_id: input.taskId,
			procedure: input.procedure,
			determinism: input.determinism ?? DeterminismLevel.enum.D1,
			repo,
			scope,
			failure,
			targets,
			verification: {
				cmd: input.verificationCmd,
				expect: {
					exit_code: input.expectedExitCode ?? 0,
				},
			},
			budget: {
				truncated_fields: [],
			},
			receipt_schema_id: input.receiptSchemaId ?? "task-receipt-v1",
		};

		return {
			...snapshotWithoutHash,
			snapshot_hash: computeSnapshotHash(snapshotWithoutHash),
		};
	}

	/**
	 * Extract anchored hunks from target files
	 *
	 * For each target file:
	 * - If failure location is specified and in this file: extract context around that line
	 * - Otherwise: extract entire file (for small files) or first N lines (for large files)
	 */
	private async buildTargets(
		targetFiles: string[],
		failureFileRel: string,
		failureLine?: number
	): Promise<Target[]> {
		const targets: Target[] = [];

		for (const targetFile of targetFiles) {
			const absolutePath = path.join(this.repoRoot, targetFile);
			const hunk = await this.extractHunkForTarget(
				absolutePath,
				targetFile,
				failureFileRel,
				failureLine
			);

			targets.push({
				path_rel: this.normalizeFilePath(targetFile),
				hunk,
				hunk_sha256: computeCanonicalHash(hunk),
			});
		}

		return targets;
	}

	private async extractHunkForTarget(
		absolutePath: string,
		targetFileRel: string,
		failureFileRel: string,
		failureLine?: number
	): Promise<string> {
		let content = "";
		try {
			content = await fs.readFile(absolutePath, "utf-8");
		} catch {
			return "";
		}

		const lines = content.split("\n");

		const isFailureFile =
			this.normalizeFilePath(failureFileRel) ===
			this.normalizeFilePath(targetFileRel);

		let startLine = 1;
		let endLine = lines.length;

		if (
			isFailureFile &&
			typeof failureLine === "number" &&
			Number.isFinite(failureLine)
		) {
			startLine = Math.max(1, failureLine - this.contextRadius);
			endLine = Math.min(lines.length, failureLine + this.contextRadius);
		} else if (lines.length > SnapshotBuilder.SMALL_FILE_LINE_THRESHOLD) {
			endLine = Math.min(
				SnapshotBuilder.LARGE_FILE_PREVIEW_LINES,
				lines.length
			);
		}

		return lines.slice(startLine - 1, endLine).join("\n");
	}

	/**
	 * Build scope with defaults and overrides
	 */
	private buildScope(
		targetFiles: string[],
		overrides?: Partial<ScopeBoundary>
	): ScopeBoundary {
		const defaultScope: ScopeBoundary = {
			read_globs: ["**/*.ts", "**/*.json", "docs/**"],
			write_globs: targetFiles.map((f) => this.normalizeFilePath(f)),
			deny_globs: ["node_modules/**", "dist/**", ".git/**", "*.lock"],
			cross_repo_allowed: false,
		};

		return {
			...defaultScope,
			...overrides,
			// Ensure write_globs defaults to the passed targets unless explicitly overridden
			write_globs: overrides?.write_globs ?? defaultScope.write_globs,
		};
	}

	/**
	 * Normalize file path for comparison (handle different separators, leading slashes)
	 */
	private normalizeFilePath(filePath: string): string {
		// Convert to posix-style path and remove leading slashes
		return path.posix
			.normalize(filePath.replace(/\\/g, "/"))
			.replace(/^\/+/, "");
	}
}
