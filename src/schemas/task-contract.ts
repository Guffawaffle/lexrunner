/**
 * Task Contract Schemas (ADR-007)
 * 
 * Defines the contract between agent and engine for task verification.
 * Version: 1.0.0
 */

import { z } from 'zod';
import { createHash } from 'crypto';

export const TASK_CONTRACT_VERSION = '1.0.0';

/**
 * TaskSnapshot_v1: Immutable task context sent to agent
 */
export const TaskSnapshot_v1_Schema = z.object({
	version: z.literal('1.0.0'),
	task_id: z.string().min(1),
	snapshot_hash: z.string().min(1),
	snapshot_timestamp: z.string().datetime(),
	
	verification: z.object({
		command: z.string().min(1),
		timeout_ms: z.number().int().positive().optional(),
		expect: z.object({
			exit_code: z.number().int().optional(),
			must_include: z.array(z.string()).optional(),
			must_not_include: z.array(z.string()).optional(),
		}),
	}),
	
	initial_state: z.object({
		files: z.array(z.object({
			path: z.string(),
			hash: z.string(),
		})),
		git_ref: z.string().optional(),
	}),
});

export type TaskSnapshot_v1 = z.infer<typeof TaskSnapshot_v1_Schema>;

/**
 * TaskReceipt_v1: Agent's signed attestation of work done
 */
export const TaskReceipt_v1_Schema = z.object({
	version: z.literal('1.0.0'),
	task_id: z.string().min(1),
	snapshot_hash: z.string().min(1),
	receipt_timestamp: z.string().datetime(),
	
	agent_decision: z.object({
		claimed_fixed: z.boolean(),
		confidence: z.number().min(0).max(1).optional(),
		reasoning: z.string().optional(),
	}),
	
	patch: z.object({
		unified_diff: z.string().optional(),
		files_changed: z.array(z.string()).optional(),
	}).optional(),
	
	agent_metadata: z.object({
		agent_id: z.string().optional(),
		model: z.string().optional(),
		attempts: z.number().int().positive().optional(),
	}).optional(),
});

export type TaskReceipt_v1 = z.infer<typeof TaskReceipt_v1_Schema>;

/**
 * EngineVerification_v1: Engine's independent verification result
 */
export const EngineVerification_v1_Schema = z.object({
	version: z.literal('1.0.0'),
	task_id: z.string().min(1),
	snapshot_hash: z.string().min(1),
	receipt_hash: z.string().min(1),
	
	agent_claimed: z.boolean(),
	verified: z.boolean(),
	trust_gap: z.boolean(),
	
	verification_output: z.object({
		exit_code: z.number().int(),
		stdout: z.string(),
		stderr: z.string(),
		duration_ms: z.number().int().nonnegative(),
	}),
	
	engine_timestamp: z.string().datetime(),
});

export type EngineVerification_v1 = z.infer<typeof EngineVerification_v1_Schema>;

/**
 * Compute canonical hash of an object for binding verification
 */
export function computeCanonicalHash(obj: unknown): string {
	// Use deterministic JSON serialization (sorted keys)
	const canonical = JSON.stringify(obj, (key, value) => {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			// Sort object keys for deterministic serialization
			return Object.keys(value)
				.sort()
				.reduce((sorted: any, key: string) => {
					sorted[key] = value[key];
					return sorted;
				}, {});
		}
		return value;
	});
	return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Verify that a snapshot hash matches the computed hash
 * Excludes snapshot_hash field from the computation to avoid circular dependency
 */
export function verifySnapshotBinding(snapshot: TaskSnapshot_v1, claimedHash: string): boolean {
	// Create a copy without the snapshot_hash field for hashing
	const { snapshot_hash, ...snapshotWithoutHash } = snapshot;
	const actualHash = computeCanonicalHash(snapshotWithoutHash);
	return actualHash === claimedHash;
}
