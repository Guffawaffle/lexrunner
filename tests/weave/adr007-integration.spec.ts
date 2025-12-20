/**
 * End-to-end integration test for ADR-007 task snapshot contract
 * with merge-weave loop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WeaveStateMachine, createWeaveContext } from '../../src/weave/stateMachine.js';
import { WeaveState, WeaveEvent } from '../../src/weave/types.js';
import { GateFailureHandler } from '../../src/weave/gateFailureHandler.js';
import { GateResult, Plan } from '../../src/schema.js';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskReceipt_v1 } from '../../src/schemas/task-contract.js';

describe('ADR-007 Integration: Gate Failure Flow', () => {
	let tempDir: string;
	let handler: GateFailureHandler;
	let stateMachine: WeaveStateMachine;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'lexrunner-e2e-'));
		handler = new GateFailureHandler(tempDir, 'test-org/test-repo');

		// Create test files
		await mkdir(join(tempDir, 'tests'), { recursive: true });
		await writeFile(
			join(tempDir, 'tests', 'example.spec.ts'),
			`describe('example', () => {
				it('should pass', () => {
					expect(true).toBe(true);
				});
			});`
		);

		// Create fixture plan
		const plan: Plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: [
				{
					name: 'PR-1',
					branch: 'feature/test',
					deps: [],
					gates: [
						{
							name: 'test',
							cmd: 'npm test'
						}
					]
				}
			]
		};

		const context = createWeaveContext(plan, [], 'test-hash-001');
		stateMachine = new WeaveStateMachine(context);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('should complete full gate failure → fix → verify flow', async () => {
		// Step 1: Start execution
		stateMachine.transition(WeaveEvent.START);
		stateMachine.transition(WeaveEvent.PLAN_READY);
		stateMachine.transition(WeaveEvent.ORDER_COMPUTED);
		stateMachine.transition(WeaveEvent.BEGIN_MERGE);
		stateMachine.transition(WeaveEvent.MERGE_SUCCESS);
		
		expect(stateMachine.getCurrentState()).toBe(WeaveState.VALIDATING);

		// Step 2: Gate fails
		const failedGate: GateResult = {
			name: 'test',
			cmd: 'npm test',
			status: 'failed',
			exitCode: 1,
			stdout: '',
			stderr: 'FAIL tests/example.spec.ts\n  ✕ should pass\n    Expected: true\n    Received: false'
		};

		// Generate snapshot on gate failure
		const failureResult = await handler.handleGateFailure({
			itemName: 'PR-1',
			gate: failedGate,
			repoRoot: tempDir,
			repoId: 'test-org/test-repo',
			commitSha: 'test-commit-sha',
			gateOutput: failedGate.stderr || '',
			runId: stateMachine.getContext().runId
		});

		// Verify snapshot was generated
		expect(failureResult.snapshot).toBeDefined();
		expect(failureResult.snapshot.task_id).toContain('fix-PR-1-test');
		expect(failureResult.determinism).toBe('D1');
		expect(failureResult.routeToLocalFix).toBe(true);

		// Step 3: Transition to awaiting_fix state
		stateMachine.transition(WeaveEvent.GATE_FAILED);
		expect(stateMachine.getCurrentState()).toBe(WeaveState.AWAITING_FIX);

		// Step 4: Agent submits fix receipt
		const receipt: TaskReceipt_v1 = {
			schema_version: '1.0.0',
			task_id: failureResult.snapshot.task_id,
			snapshot_hash: failureResult.snapshot.snapshot_hash,
			claims: {
				success: true,
				patch: `--- a/tests/example.spec.ts
+++ b/tests/example.spec.ts
@@ -1,5 +1,5 @@
 describe('example', () => {
   it('should pass', () => {
-    expect(true).toBe(false);
+    expect(true).toBe(true);
   });
 });`,
				files_touched: ['tests/example.spec.ts'],
				rationale: 'Fixed the assertion from false to true',
				confidence: 'high',
				assumptions_made: [
					{
						type: 'test',
						text: 'The test was checking the wrong value',
						validated: true,
						evidence: 'Error message indicated Expected: true, Received: false'
					}
				]
			},
			search_activity: [],
			cost: {
				token_usage: {
					input: 500,
					output: 150,
					total: 650
				},
				elapsed_ms: 2500
			},
			agent_verification: {
				cmd_ran: true,
				exit_code: 0,
				output_snip: 'PASS tests/example.spec.ts'
			},
			blockers: []
		};

		stateMachine.transition(WeaveEvent.FIX_SUBMITTED);
		expect(stateMachine.getCurrentState()).toBe(WeaveState.FIX_SUBMITTED);

		// Step 5: Begin verification
		stateMachine.transition(WeaveEvent.BEGIN_VERIFICATION);
		expect(stateMachine.getCurrentState()).toBe(WeaveState.VERIFYING);

		// Process receipt with verification (skip patch application for test)
		// In real scenarios, the patch would be applied and tests would run
		const processingResult = await handler.processReceipt(
			failureResult.snapshot,
			receipt,
			tempDir,
			{ applyPatch: false } // Skip actual patch application in test
		);

		// Verify processing happened
		expect(processingResult.verification).toBeDefined();
		expect(processingResult.verification.verification.task_id).toBe(failureResult.snapshot.task_id);

		// Step 6a: If verified successfully
		if (processingResult.verification.verification.verified) {
			stateMachine.transition(WeaveEvent.FIX_VERIFIED);
			expect(stateMachine.getCurrentState()).toBe(WeaveState.VERIFIED);

			// Continue with weave
			stateMachine.transition(WeaveEvent.VALIDATION_PASSED);
			expect(stateMachine.getCurrentState()).toBe(WeaveState.VALIDATING);
		}
		// Step 6b: If trust gap detected
		else if (processingResult.verification.trustGap) {
			stateMachine.transition(WeaveEvent.TRUST_GAP_DETECTED);
			expect(stateMachine.getCurrentState()).toBe(WeaveState.TRUST_GAP);

			// Trust gap requires human review
			expect(processingResult.requiresHumanReview).toBe(true);
		}

		// Verify audit trail would be created
		expect(failureResult.snapshot.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(receipt.snapshot_hash).toBe(failureResult.snapshot.snapshot_hash);
	});

	it('should handle D2 task routing to agent handoff', async () => {
		// Start execution
		stateMachine.transition(WeaveEvent.START);
		stateMachine.transition(WeaveEvent.PLAN_READY);
		stateMachine.transition(WeaveEvent.ORDER_COMPUTED);
		stateMachine.transition(WeaveEvent.BEGIN_MERGE);
		stateMachine.transition(WeaveEvent.MERGE_SUCCESS);

		// Integration test fails (D2)
		const failedGate: GateResult = {
			name: 'integration-test',
			cmd: 'npm run test:integration',
			status: 'failed',
			exitCode: 1,
			stdout: '',
			stderr: 'Integration test failed: database connection timeout'
		};

		const failureResult = await handler.handleGateFailure({
			itemName: 'PR-2',
			gate: failedGate,
			repoRoot: tempDir,
			repoId: 'test-org/test-repo',
			commitSha: 'test-commit-sha-2',
			gateOutput: failedGate.stderr || '',
			runId: stateMachine.getContext().runId
		});

		// D2 task should not route to local fix
		expect(failureResult.determinism).toBe('D2');
		expect(failureResult.routeToLocalFix).toBe(false);

		// Snapshot should still be generated for agent handoff
		expect(failureResult.snapshot).toBeDefined();
		expect(failureResult.snapshot.determinism).toBe('D2');
	});

	it('should detect and flag trust gaps', async () => {
		stateMachine.transition(WeaveEvent.START);
		stateMachine.transition(WeaveEvent.PLAN_READY);
		stateMachine.transition(WeaveEvent.ORDER_COMPUTED);
		stateMachine.transition(WeaveEvent.BEGIN_MERGE);
		stateMachine.transition(WeaveEvent.MERGE_SUCCESS);

		const failedGate: GateResult = {
			name: 'test',
			cmd: 'exit 1', // Always fails
			status: 'failed',
			exitCode: 1,
			stdout: '',
			stderr: 'Test failed'
		};

		const failureResult = await handler.handleGateFailure({
			itemName: 'PR-3',
			gate: failedGate,
			repoRoot: tempDir,
			repoId: 'test-org/test-repo',
			commitSha: 'test-commit-sha-3',
			gateOutput: failedGate.stderr || '',
			runId: stateMachine.getContext().runId
		});

		// Agent claims success but verification will fail
		const receipt: TaskReceipt_v1 = {
			schema_version: '1.0.0',
			task_id: failureResult.snapshot.task_id,
			snapshot_hash: failureResult.snapshot.snapshot_hash,
			claims: {
				success: true, // False claim
				files_touched: [],
				rationale: 'Fixed the issue',
				confidence: 'high',
				assumptions_made: []
			},
			search_activity: [],
			cost: {},
			blockers: []
		};

		const processingResult = await handler.processReceipt(
			failureResult.snapshot,
			receipt,
			tempDir
		);

		// Trust gap should be detected
		expect(processingResult.verification.trustGap).toBe(true);
		expect(processingResult.requiresHumanReview).toBe(true);
		expect(processingResult.continueWeave).toBe(false);

		// Transition to trust gap state
		stateMachine.transition(WeaveEvent.GATE_FAILED);
		stateMachine.transition(WeaveEvent.FIX_SUBMITTED);
		stateMachine.transition(WeaveEvent.BEGIN_VERIFICATION);
		stateMachine.transition(WeaveEvent.TRUST_GAP_DETECTED);

		expect(stateMachine.getCurrentState()).toBe(WeaveState.TRUST_GAP);
	});

	it('should support state machine reset after trust gap', async () => {
		// Set up trust gap state
		stateMachine.transition(WeaveEvent.START);
		stateMachine.transition(WeaveEvent.PLAN_READY);
		stateMachine.transition(WeaveEvent.ORDER_COMPUTED);
		stateMachine.transition(WeaveEvent.BEGIN_MERGE);
		stateMachine.transition(WeaveEvent.MERGE_SUCCESS);
		stateMachine.transition(WeaveEvent.GATE_FAILED);
		stateMachine.transition(WeaveEvent.FIX_SUBMITTED);
		stateMachine.transition(WeaveEvent.BEGIN_VERIFICATION);
		stateMachine.transition(WeaveEvent.TRUST_GAP_DETECTED);

		expect(stateMachine.getCurrentState()).toBe(WeaveState.TRUST_GAP);

		// Reset should be available
		expect(stateMachine.canTransition(WeaveEvent.RESET)).toBe(true);

		stateMachine.transition(WeaveEvent.RESET);
		expect(stateMachine.getCurrentState()).toBe(WeaveState.IDLE);
	});
});
