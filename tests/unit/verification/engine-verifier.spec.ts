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
	computeSnapshotHash,
	TASK_CONTRACT_VERSION,
} from '../../../src/schemas/task-contract.js';

/**
 * Create a minimal valid snapshot for testing
 */
function createTestSnapshot(
	taskId: string,
	cmd: string,
	expect: TaskSnapshot_v1['verification']['expect'],
): TaskSnapshot_v1 {
	const snapshotWithoutHash: Omit<TaskSnapshot_v1, 'snapshot_hash'> = {
		schema_version: TASK_CONTRACT_VERSION,
		task_id: taskId,
		procedure: 'test-procedure',
		determinism: 'D1',
		repo: {
			id: 'test/repo',
			root: '/test/workspace',
			commit_sha: 'abc123',
		},
		scope: {
			read_globs: ['**/*.ts'],
			write_globs: ['**/*.ts'],
			deny_globs: ['node_modules/**'],
			cross_repo_allowed: false,
		},
		failure: {
			message: 'Test failure',
			file_rel: 'test.ts',
			runner_output_snip: 'Test failed',
		},
		targets: [
			{
				path_rel: 'test.ts',
				hunk: 'test code',
				hunk_sha256: 'sha256:placeholder',
			},
		],
		verification: {
			cmd,
			expect,
		},
		budget: {
			truncated_fields: [],
		},
		receipt_schema_id: 'TaskReceipt_v1',
	};

	return {
		...snapshotWithoutHash,
		snapshot_hash: computeSnapshotHash(snapshotWithoutHash),
	};
}

/**
 * Create a minimal valid receipt for testing
 */
function createTestReceipt(
	taskId: string,
	snapshotHash: string,
	claimed: boolean,
	patch?: string,
): TaskReceipt_v1 {
	return {
		schema_version: TASK_CONTRACT_VERSION,
		task_id: taskId,
		snapshot_hash: snapshotHash,
		claims: {
			success: claimed,
			patch,
			files_touched: [],
			rationale: 'Test rationale',
			confidence: 'high',
			assumptions_made: [],
		},
		search_activity: [],
		cost: {},
		blockers: [],
	};
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
			const snapshot = createTestSnapshot('test-001', 'echo "Test passed"', {
				exit_code: 0,
				must_include: ['Test passed'],
			});

			const receipt = createTestReceipt(
				'test-001',
				snapshot.snapshot_hash,
				true,
			);

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
			expect(result.verification.agent_claimed).toBe(true);
			expect(result.trustGap).toBe(false);
			expect(result.verification.exit_code).toBe(0);
			expect(result.verification.stdout_snip).toContain('Test passed');
		});

		it('detects trust gap (agent claimed fixed but verification fails)', async () => {
			const snapshot = createTestSnapshot(
				'test-002',
				'echo "Tests failed" && exit 1',
				{
					exit_code: 0,
				},
			);

			const receipt = createTestReceipt(
				'test-002',
				snapshot.snapshot_hash,
				true, // Agent claims success
			);

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
			const snapshot = createTestSnapshot('test-003', 'echo "test"', {
				exit_code: 0,
			});

			const receipt = createTestReceipt(
				'test-003',
				'sha256:wrong_hash', // Mismatch!
				true,
			);

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

			const snapshot = createTestSnapshot(
				'test-004',
				`grep "line 2 modified" "${testFilePath}"`,
				{
					exit_code: 0,
				},
			);

			const unifiedDiff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
`;

			const receipt = createTestReceipt(
				'test-004',
				snapshot.snapshot_hash,
				true,
				unifiedDiff,
			);

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
			const snapshot = createTestSnapshot('test-005', 'exit 42', {
				exit_code: 42, // Expect specific non-zero code
			});

			const receipt = createTestReceipt(
				'test-005',
				snapshot.snapshot_hash,
				true,
			);

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
			expect(result.verification.exit_code).toBe(42);
		});

		it('validates must_include patterns', async () => {
			const snapshot = createTestSnapshot(
				'test-006',
				'echo "Success: all tests passed"',
				{
					exit_code: 0,
					must_include: ['Success', 'all tests'],
				},
			);

			const receipt = createTestReceipt(
				'test-006',
				snapshot.snapshot_hash,
				true,
			);

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
		});

		it('validates must_not_include patterns', async () => {
			const snapshot = createTestSnapshot(
				'test-007',
				'echo "All tests passed"',
				{
					exit_code: 0,
					must_not_include: ['FAILED', 'Error'],
				},
			);

			const receipt = createTestReceipt(
				'test-007',
				snapshot.snapshot_hash,
				true,
			);

			const result = await verifier.verify({
				snapshot,
				receipt,
				workingDir,
				applyPatch: false,
			});

			expect(result.verification.verified).toBe(true);
		});

		it('fails when must_not_include pattern is found', async () => {
			const snapshot = createTestSnapshot('test-008', 'echo "Test FAILED"', {
				exit_code: 0,
				must_not_include: ['FAILED'],
			});

			const receipt = createTestReceipt(
				'test-008',
				snapshot.snapshot_hash,
				true,
			);

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

