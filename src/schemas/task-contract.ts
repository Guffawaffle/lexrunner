/**
 * Task Contract Schema (v1.0.0)
 *
 * Defines the canonical data structure for task snapshots that are handed off
 * to LLM agents. This contract ensures deterministic, auditable task execution.
 *
 * Key invariants:
 * - All hashes are deterministic (same content → same hash)
 * - Scope defines read/write boundaries
 * - AnchoredHunks provide precise context for failures
 */

import { z } from "zod";
import { sha256 } from "../util/hash.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Task Contract Version
 * Follows semver: MAJOR.MINOR.PATCH
 */
export const TASK_CONTRACT_VERSION = "1.0.0";

/**
 * Scope Schema
 *
 * Defines the boundaries of what files an agent can read/write.
 * This is the policy enforcement layer for task isolation.
 */
export const Scope_v1_Schema = z.object({
	/** Glob patterns for files the agent can read */
	read_globs: z.array(z.string()),
	/** Glob patterns for files the agent can write/modify */
	write_globs: z.array(z.string()),
	/** Glob patterns that are explicitly denied (takes precedence) */
	deny_globs: z.array(z.string()),
	/** Whether the agent can access files in other repositories */
	cross_repo_allowed: z.boolean()
});

export type Scope_v1 = z.infer<typeof Scope_v1_Schema>;

/**
 * SourceTruth Schema
 *
 * Records the git provenance of a code symbol or hunk.
 * This helps track when and where code was introduced.
 */
export const SourceTruth_v1_Schema = z.object({
	/** The commit SHA that introduced this code */
	introducing_commit: z.string(),
	/** The author of the introducing commit */
	author: z.string().optional(),
	/** Timestamp when the code was introduced */
	introduced_at: z.string().datetime().optional(),
	/** The diff hunk from the introducing commit (optional in v1) */
	diff_hunk: z.string().optional()
});

export type SourceTruth_v1 = z.infer<typeof SourceTruth_v1_Schema>;

/**
 * AnchoredHunk Schema
 *
 * Represents a specific section of a file with context lines.
 * The "anchor" is the line range, and content includes surrounding context.
 */
export const AnchoredHunk_v1_Schema = z.object({
	/** Relative path from repo root */
	file_path: z.string(),
	/** Starting line number (1-indexed) */
	start_line: z.number().int().positive(),
	/** Ending line number (1-indexed, inclusive) */
	end_line: z.number().int().positive(),
	/** The actual content of the hunk (including context lines) */
	content: z.string(),
	/** SHA-256 hash of the content (for verification) */
	content_hash: z.string(),
	/** Source of truth for this hunk (optional) */
	source_truth: SourceTruth_v1_Schema.optional()
});

export type AnchoredHunk_v1 = z.infer<typeof AnchoredHunk_v1_Schema>;

/**
 * FailureInfo Schema
 *
 * Captures details about a verification failure.
 */
export const FailureInfo_v1_Schema = z.object({
	/** Error message from the failure */
	message: z.string(),
	/** Location where the failure occurred (if available) */
	location: z.object({
		file: z.string(),
		line: z.number().int().positive(),
		column: z.number().int().positive().optional()
	}).optional(),
	/** Exit code from the failed command */
	exit_code: z.number().int().optional(),
	/** Stack trace (if available) */
	stack_trace: z.string().optional()
});

export type FailureInfo_v1 = z.infer<typeof FailureInfo_v1_Schema>;

/**
 * TaskSnapshot Schema (v1)
 *
 * The complete snapshot of a task at a point in time.
 * This is the root schema that gets handed off to LLM agents.
 */
export const TaskSnapshot_v1_Schema = z.object({
	/** Schema version for this snapshot */
	schema_version: z.string().default(TASK_CONTRACT_VERSION),
	/** Unique identifier for this task */
	task_id: z.string(),
	/** Timestamp when this snapshot was created */
	created_at: z.string().datetime(),
	/** Git commit SHA this snapshot is based on */
	commit_sha: z.string(),
	/** Branch name (optional) */
	branch_name: z.string().optional(),
	/** The procedure/instructions for the agent */
	procedure: z.string(),
	/** Target files that need to be modified */
	target_files: z.array(z.string()),
	/** Anchored hunks providing context */
	anchored_hunks: z.array(AnchoredHunk_v1_Schema),
	/** Failure information (if this is a retry/fix task) */
	failure_info: FailureInfo_v1_Schema.optional(),
	/** Verification command to run */
	verification_cmd: z.string(),
	/** Expected exit code for verification (default: 0) */
	expected_exit_code: z.number().int().default(0),
	/** Scope boundaries for this task */
	scope: Scope_v1_Schema,
	/** SHA-256 hash of the entire snapshot (for verification) */
	snapshot_hash: z.string()
});

export type TaskSnapshot_v1 = z.infer<typeof TaskSnapshot_v1_Schema>;

/**
 * Compute canonical hash of a string or object
 *
 * This produces a deterministic SHA-256 hash that is stable across runs.
 * For objects, it uses canonical JSON serialization.
 *
 * @param content - String content or object to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function computeCanonicalHash(content: string | object): string {
	if (typeof content === "string") {
		return sha256(content);
	}
	// For objects, use canonical JSON serialization
	const canonical = canonicalJSONStringify(content);
	return sha256(canonical);
}

/**
 * Compute the snapshot hash for a TaskSnapshot
 *
 * This hash is computed over all fields except the snapshot_hash itself.
 * It provides a tamper-evident seal for the entire snapshot.
 *
 * @param snapshot - The task snapshot (without snapshot_hash)
 * @returns Hex-encoded SHA-256 hash
 */
export function computeSnapshotHash(
	snapshot: Omit<TaskSnapshot_v1, "snapshot_hash">
): string {
	// Create a stable representation by sorting keys
	const canonical = canonicalJSONStringify(snapshot);
	return sha256(canonical);
}
