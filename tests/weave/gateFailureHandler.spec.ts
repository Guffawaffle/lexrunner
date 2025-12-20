/**
 * Tests for Gate Failure Handler (ADR-007)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GateFailureHandler } from '../../src/weave/gateFailureHandler.js';
import { GateResult } from '../../src/schema.js';
import { TaskReceipt_v1, DeterminismLevel } from '../../src/schemas/task-contract.js';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GateFailureHandler (ADR-007)', () => {
	let tempDir: string;
	let handler: GateFailureHandler;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'lexrunner-test-'));
		handler = new GateFailureHandler(
			tempDir,
			'test-org/test-repo'
		);

		// Create a test file
		await mkdir(join(tempDir, 'tests'), { recursive: true });
		await writeFile(
			join(tempDir, 'tests', 'example.spec.ts'),
			'describe("test", () => { it("should pass", () => { expect(1).toBe(1); }); });'
		);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('handleGateFailure', () => {
		it('should generate snapshot for gate failure', async () => {
			const gateResult: GateResult = {
				gate: 'test',
				status: 'fail',
				exitCode: 1,
				attempts: 1,
				stdout: '',
				stderr: 'FAIL tests/example.spec.ts\n  ✕ should pass (3ms)\n    Expected: 1\n    Received: 2'
			};

			const context = {
				itemName: 'PR-123',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'abc123def456',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-001'
			};

			const result = await handler.handleGateFailure(context);

			// Verify snapshot structure
			expect(result.snapshot).toBeDefined();
			expect(result.snapshot.schema_version).toBe('1.0.0');
			expect(result.snapshot.task_id).toContain('fix-PR-123-test');
			expect(result.snapshot.procedure).toBe('post-gate-fix:test');
			expect(result.snapshot.determinism).toBe('D1');
			expect(result.snapshot.repo.id).toBe('test-org/test-repo');
			expect(result.snapshot.repo.commit_sha).toBe('abc123def456');
			expect(result.snapshot.verification.cmd).toContain('test');

			// Verify routing
			expect(result.routeToLocalFix).toBe(true); // D1 should route locally
			expect(result.determinism).toBe('D1');
		});

		it('should route D2/D3 tasks to agent handoff', async () => {
			const gateResult: GateResult = {
				gate: 'integration-test',
				attempts: 1,
				status: 'fail' as const,
				exitCode: 1,
				stdout: '',
				stderr: 'Integration test failed'
			};

			const context = {
				itemName: 'PR-456',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'def789ghi012',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-002'
			};

			const result = await handler.handleGateFailure(context);

			// D2 should not route locally
			expect(result.determinism).toBe('D2');
			expect(result.routeToLocalFix).toBe(false);
		});

		it('should parse failure files from output', async () => {
			const gateResult: GateResult = {
				gate: 'lint',
				status: 'fail',
				exitCode: 1,
				attempts: 1,
				stdout: '',
				stderr: 'Error: file: src/utils.ts - Unexpected token'
			};

			const context = {
				itemName: 'PR-789',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'ghi345jkl678',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-003'
			};

			const result = await handler.handleGateFailure(context);

			// Should have extracted the file from error output
			expect(result.snapshot.targets.length).toBeGreaterThan(0);
		});

		it('should generate valid snapshot hash', async () => {
			const gateResult: GateResult = {
				gate: 'build',
				status: 'fail',
				exitCode: 1,
				attempts: 1,
				stdout: '',
				stderr: 'Build failed'
			};

			const context = {
				itemName: 'PR-101',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'jkl901mno234',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-004'
			};

			const result = await handler.handleGateFailure(context);

			// Snapshot hash should be present and valid
			expect(result.snapshot.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
		});
	});

	describe('processReceipt', () => {
		it('should process successful receipt with verification', async () => {
			// First generate a snapshot
			const gateResult: GateResult = {
				gate: 'test',
				status: 'fail',
				exitCode: 1,
				attempts: 1,
				stdout: '',
				stderr: 'Test failed'
			};

			const context = {
				itemName: 'PR-202',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'mno567pqr890',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-005'
			};

			const snapshotResult = await handler.handleGateFailure(context);

			// Create a mock receipt
			const receipt: TaskReceipt_v1 = {
				schema_version: '1.0.0',
				task_id: snapshotResult.snapshot.task_id,
				snapshot_hash: snapshotResult.snapshot.snapshot_hash,
				claims: {
					success: true,
					files_touched: [],
					rationale: 'Fixed the test',
					confidence: 'high',
					assumptions_made: []
				},
				search_activity: [],
				cost: {},
				blockers: []
			};

			// Process the receipt
			const result = await handler.processReceipt(
				snapshotResult.snapshot,
				receipt,
				tempDir
			);

			// Verify processing result
			expect(result.verification).toBeDefined();
			expect(result.verification.verification.task_id).toBe(snapshotResult.snapshot.task_id);
		});

		it('should detect trust gap when agent claims success but verification fails', async () => {
			// Generate snapshot
			const gateResult: GateResult = {
				gate: 'test',
				status: 'fail',
				exitCode: 1,
				attempts: 1,
				stdout: '',
				stderr: 'Test failed'
			};

			const context = {
				itemName: 'PR-303',
				gate: gateResult,
				repoRoot: tempDir,
				repoId: 'test-org/test-repo',
				commitSha: 'pqr123stu456',
				gateOutput: gateResult.stderr || '',
				runId: 'test-run-006'
			};

			const snapshotResult = await handler.handleGateFailure(context);

			// Receipt claims success but verification will fail
			const receipt: TaskReceipt_v1 = {
				schema_version: '1.0.0',
				task_id: snapshotResult.snapshot.task_id,
				snapshot_hash: snapshotResult.snapshot.snapshot_hash,
				claims: {
					success: true, // Agent claims success
					files_touched: [],
					rationale: 'Fixed the test',
					confidence: 'high',
					assumptions_made: []
				},
				search_activity: [],
				cost: {},
				blockers: []
			};

			const result = await handler.processReceipt(
				snapshotResult.snapshot,
				receipt,
				tempDir
			);

			// Should detect trust gap
			expect(result.verification.trustGap).toBe(true);
			expect(result.requiresHumanReview).toBe(true);
			expect(result.continueWeave).toBe(false);
		});
	});
});
