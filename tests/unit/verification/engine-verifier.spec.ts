/**
 * Engine Verifier Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	EngineVerifier,
	SnapshotMismatchError,
} from '../../../src/verification/index.js';
import type {
	TaskSnapshot_v1,
	TaskReceipt_v1,
} from '../../../src/schemas/task-contract.js';
import {
	computeCanonicalHash,
	TASK_CONTRACT_VERSION,
} from '../../../src/schemas/task-contract.js';

/**
 * Helper to compute snapshot hash correctly (excluding snapshot_hash field)
 */
function computeSnapshotHash(snapshot: TaskSnapshot_v1): string {
	const { snapshot_hash, ...snapshotWithoutHash } = snapshot;
	return computeCanonicalHash(snapshotWithoutHash);
}

describe('EngineVerifier', () => {
	let verifier: EngineVerifier;
	let workingDir: string;

	beforeEach(async () => {
		verifier = new EngineVerifier();
		workingDir = await mkdtemp(join(tmpdir(), 'lexrunner-test-'));
	});

	afterEach(async () => {
		if (workingDir) {
			await rm(workingDir, { recursive: true, force: true });
		}
	});

	describe('verify', () => {
		it('succeeds when verification passes', async () => {
			// Create a simple test command that will pass
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-001',
				snapshot_hash: 'hash-001',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "Test passed"',
					expect: {
						exit_code: 0,
						must_include: ['Test passed'],
					},
				},
				initial_state: {
					files: [],
				},
			};

			// Compute correct snapshot hash
			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-001',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
			expect(result.verification.agent_claimed).toBe(true);
			expect(result.trustGap).toBe(false);
			expect(result.verification.verification_output.exit_code).toBe(0);
			expect(result.verification.verification_output.stdout).toContain(
				'Test passed',
			);
		});

		it('detects trust gap (agent claimed fixed but verification fails)', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-002',
				snapshot_hash: 'hash-002',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "Tests failed" && exit 1',
					expect: {
						exit_code: 0,
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-002',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true, // Agent claims success
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(false);
			expect(result.verification.agent_claimed).toBe(true);
			expect(result.trustGap).toBe(true); // Trust gap detected!
		});

		it('throws on snapshot hash mismatch', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-003',
				snapshot_hash: 'correct-hash',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "test"',
					expect: {
						exit_code: 0,
					},
				},
				initial_state: {
					files: [],
				},
			};

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-003',
				snapshot_hash: 'wrong-hash', // Mismatch!
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			await expect(
				verifier.verify({
					snapshot,
					receipt,
					workingDir,
					applyPatch: false,
				}),
			).rejects.toThrow(SnapshotMismatchError);
		});

		it('applies unified diff when provided', async () => {
			// Create a test file
			const testFilePath = join(workingDir, 'test.txt');
			await writeFile(testFilePath, 'line 1\nline 2\nline 3\n', 'utf8');

			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-004',
				snapshot_hash: 'hash-004',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: `grep "line 2 modified" "${testFilePath}"`,
					expect: {
						exit_code: 0,
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const unifiedDiff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
`;

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-004',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
				patch: {
					unified_diff: unifiedDiff,
					files_changed: ['test.txt'],
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: true,
			});

			expect(result.patchApplied).toBe(true);
			expect(result.verification.verified).toBe(true);
		});
	});

	describe('checkExpectations', () => {
		it('validates exit code', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-005',
				snapshot_hash: 'hash-005',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'exit 42',
					expect: {
						exit_code: 42, // Expect specific non-zero code
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-005',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
			expect(result.verification.verification_output.exit_code).toBe(42);
		});

		it('validates must_include patterns', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-006',
				snapshot_hash: 'hash-006',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "Success: all tests passed"',
					expect: {
						exit_code: 0,
						must_include: ['Success', 'all tests'],
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-006',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
		});

		it('validates must_not_include patterns', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-007',
				snapshot_hash: 'hash-007',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "All tests passed"',
					expect: {
						exit_code: 0,
						must_not_include: ['FAILED', 'Error'],
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-007',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
		});

		it('fails when must_not_include pattern is found', async () => {
			const snapshot: TaskSnapshot_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-008',
				snapshot_hash: 'hash-008',
				snapshot_timestamp: new Date().toISOString(),
				verification: {
					command: 'echo "Test FAILED"',
					expect: {
						exit_code: 0,
						must_not_include: ['FAILED'],
					},
				},
				initial_state: {
					files: [],
				},
			};

			snapshot.snapshot_hash = computeSnapshotHash(snapshot);

			const receipt: TaskReceipt_v1 = {
				version: TASK_CONTRACT_VERSION,
				task_id: 'test-008',
				snapshot_hash: snapshot.snapshot_hash,
				receipt_timestamp: new Date().toISOString(),
				agent_decision: {
					claimed_fixed: true,
				},
			};

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(false);
		});
	});
});
