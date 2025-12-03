/**
 * Tests for weave state machine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WeaveStateMachine,
	createWeaveContext,
	generateMermaidDiagram,
	STATE_TRANSITIONS
} from '../../src/weave/stateMachine.js';
import { WeaveState, WeaveEvent, BatchState } from '../../src/weave/types.js';
import { isAXError, ErrorCodes } from '../../src/errors/index.js';

describe('WeaveStateMachine', () => {
	describe('State Transitions', () => {
		it('should start in idle state', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			expect(sm.getCurrentState()).toBe(WeaveState.IDLE);
		});

		it('should transition from idle to planning on START', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			const newState = sm.transition(WeaveEvent.START);
			expect(newState).toBe(WeaveState.PLANNING);
			expect(sm.getCurrentState()).toBe(WeaveState.PLANNING);
		});

		it('should follow complete execution flow', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Complete flow
			sm.transition(WeaveEvent.START);
			expect(sm.getCurrentState()).toBe(WeaveState.PLANNING);

			sm.transition(WeaveEvent.PLAN_READY);
			expect(sm.getCurrentState()).toBe(WeaveState.COMPUTING_ORDER);

			sm.transition(WeaveEvent.ORDER_COMPUTED);
			expect(sm.getCurrentState()).toBe(WeaveState.READY);

			sm.transition(WeaveEvent.BEGIN_MERGE);
			expect(sm.getCurrentState()).toBe(WeaveState.MERGING);

			sm.transition(WeaveEvent.MERGE_SUCCESS);
			expect(sm.getCurrentState()).toBe(WeaveState.VALIDATING);

			sm.transition(WeaveEvent.ALL_COMPLETE);
			expect(sm.getCurrentState()).toBe(WeaveState.COMPLETED);
		});

		it('should handle merge failure', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Navigate to merging
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);

			// Fail
			sm.transition(WeaveEvent.MERGE_FAILED);
			expect(sm.getCurrentState()).toBe(WeaveState.FAILED);
		});

		it('should handle validation failure', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Navigate to validating
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);

			// Fail validation
			sm.transition(WeaveEvent.VALIDATION_FAILED);
			expect(sm.getCurrentState()).toBe(WeaveState.FAILED);
		});

		it('should throw error on invalid transition', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			expect(() => {
				sm.transition(WeaveEvent.MERGE_SUCCESS);
			}).toThrow(/Invalid transition/);
		});

		it('should throw AXError with WEAVE_STATE_INVALID code on invalid transition', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			try {
				sm.transition(WeaveEvent.MERGE_SUCCESS);
				expect.fail('Expected an error to be thrown');
			} catch (error) {
				expect(isAXError(error)).toBe(true);
				const axError = error as { code: string; message: string; nextActions: string[] };
				expect(axError.code).toBe(ErrorCodes.WEAVE_STATE_INVALID);
				expect(axError.message).toContain('merge_success');
				expect(axError.message).toContain('idle');
				expect(axError.nextActions.length).toBeGreaterThanOrEqual(1);
			}
		});

		it('should support pause and resume', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Navigate to ready
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);

			// Pause
			sm.transition(WeaveEvent.PAUSE);
			expect(sm.getCurrentState()).toBe(WeaveState.PAUSED);

			// Resume
			sm.transition(WeaveEvent.RESUME);
			expect(sm.getCurrentState()).toBe(WeaveState.READY);
		});

		it('should support reset from terminal states', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Navigate to completed
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.ALL_COMPLETE);

			expect(sm.getCurrentState()).toBe(WeaveState.COMPLETED);

			// Reset
			sm.transition(WeaveEvent.RESET);
			expect(sm.getCurrentState()).toBe(WeaveState.IDLE);
		});
	});

	describe('Context Management', () => {
		it('should update lastUpdatedAt on transitions', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			const initialTime = sm.getContext().lastUpdatedAt;

			// Small delay to ensure timestamp changes
			setTimeout(() => {
				sm.transition(WeaveEvent.START);
				const newTime = sm.getContext().lastUpdatedAt;
				expect(newTime).not.toBe(initialTime);
			}, 10);
		});

		it('should update context with custom values', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			sm.updateContext({
				successfulMerges: 5,
				failedMerges: 2
			});

			const updated = sm.getContext();
			expect(updated.successfulMerges).toBe(5);
			expect(updated.failedMerges).toBe(2);
		});

		it('should set completedAt on completion', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			// Navigate to completed
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.ALL_COMPLETE);

			const ctx = sm.getContext();
			expect(ctx.completedAt).toBeDefined();
		});

		it('should emit Frame on completion (AX-005)', () => {
			const batch: BatchState = {
				batchNumber: 0,
				items: ['PR-101', 'PR-102'],
				state: 'pending'
			};

			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			context.batches = [batch];

			const sm = new WeaveStateMachine(context);

			// Navigate to completed
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.ALL_COMPLETE);

			const frameResult = sm.getLastFrameResult();
			expect(frameResult).toBeDefined();
			expect(frameResult!.success).toBe(true);
			expect(frameResult!.frame).toBeDefined();
			expect(frameResult!.frame!.type).toBe('merge-weave');
			expect(frameResult!.frame!.outcome).toBe('success');
		});

		it('should emit Frame on failure (AX-005)', () => {
			const batch: BatchState = {
				batchNumber: 0,
				items: ['PR-101'],
				state: 'pending'
			};

			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			context.batches = [batch];

			const sm = new WeaveStateMachine(context);

			// Navigate to failed
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_FAILED);

			const frameResult = sm.getLastFrameResult();
			expect(frameResult).toBeDefined();
			expect(frameResult!.success).toBe(true);
			expect(frameResult!.frame).toBeDefined();
			expect(frameResult!.frame!.type).toBe('merge-weave');
			expect(frameResult!.frame!.outcome).toBe('failure');
		});

		it('should mark batch as in-progress when merging', () => {
			const batch: BatchState = {
				batchNumber: 0,
				items: ['pr-1', 'pr-2'],
				state: 'pending'
			};

			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			context.batches = [batch];

			const sm = new WeaveStateMachine(context);

			// Navigate to merging
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);

			const updatedBatch = sm.getContext().batches[0];
			expect(updatedBatch.state).toBe('in-progress');
			expect(updatedBatch.startedAt).toBeDefined();
		});

		it('should mark batch as completed after validation', () => {
			const batch: BatchState = {
				batchNumber: 0,
				items: ['pr-1', 'pr-2'],
				state: 'pending'
			};

			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			context.batches = [batch];

			const sm = new WeaveStateMachine(context);

			// Navigate through merge and validation
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.VALIDATION_PASSED);

			const updatedBatch = sm.getContext().batches[0];
			expect(updatedBatch.state).toBe('completed');
			expect(updatedBatch.completedAt).toBeDefined();
		});

		it('should advance batch index after successful validation', () => {
			const batches: BatchState[] = [
				{ batchNumber: 0, items: ['pr-1'], state: 'pending' },
				{ batchNumber: 1, items: ['pr-2'], state: 'pending' }
			];

			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			context.batches = batches;

			const sm = new WeaveStateMachine(context);

			expect(sm.getContext().currentBatchIndex).toBe(0);

			// Complete first batch
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.VALIDATION_PASSED);

			expect(sm.getContext().currentBatchIndex).toBe(1);
		});
	});

	describe('State Queries', () => {
		it('should report available transitions', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			const available = sm.getAvailableTransitions();
			expect(available).toContain(WeaveEvent.START);
			expect(available.length).toBe(1);
		});

		it('should check if transition is valid', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			expect(sm.canTransition(WeaveEvent.START)).toBe(true);
			expect(sm.canTransition(WeaveEvent.MERGE_SUCCESS)).toBe(false);
		});

		it('should identify terminal states', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			expect(sm.isTerminalState()).toBe(false);

			// Navigate to completed
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.BEGIN_MERGE);
			sm.transition(WeaveEvent.MERGE_SUCCESS);
			sm.transition(WeaveEvent.ALL_COMPLETE);

			expect(sm.isTerminalState()).toBe(true);
		});

		it('should check if can resume', () => {
			const context = createWeaveContext(
				{ target: 'main', items: [] },
				[],
				'test-hash'
			);
			const sm = new WeaveStateMachine(context);

			expect(sm.canResume()).toBe(false);

			// Navigate to paused
			sm.transition(WeaveEvent.START);
			sm.transition(WeaveEvent.PLAN_READY);
			sm.transition(WeaveEvent.ORDER_COMPUTED);
			sm.transition(WeaveEvent.PAUSE);

			expect(sm.canResume()).toBe(true);
		});
	});

	describe('Context Creation', () => {
		it('should create context with unique run ID', () => {
			const ctx1 = createWeaveContext({ target: 'main', items: [] }, [], 'hash1');
			const ctx2 = createWeaveContext({ target: 'main', items: [] }, [], 'hash2');

			expect(ctx1.runId).not.toBe(ctx2.runId);
		});

		it('should initialize context with correct defaults', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = 'test-hash';

			const ctx = createWeaveContext(plan, prHeads, hash, true);

			expect(ctx.state).toBe(WeaveState.IDLE);
			expect(ctx.plan).toBe(plan);
			expect(ctx.prHeads).toBe(prHeads);
			expect(ctx.batches).toEqual([]);
			expect(ctx.currentBatchIndex).toBe(0);
			expect(ctx.successfulMerges).toBe(0);
			expect(ctx.failedMerges).toBe(0);
			expect(ctx.metadata.planHash).toBe(hash);
			expect(ctx.metadata.targetBranch).toBe('main');
			expect(ctx.metadata.dryRun).toBe(true);
		});
	});

	describe('Mermaid Diagram', () => {
		it('should generate valid mermaid diagram', () => {
			const diagram = generateMermaidDiagram();

			expect(diagram).toContain('stateDiagram-v2');
			expect(diagram).toContain('[*] --> idle');
			expect(diagram).toContain('idle --> planning : START');
			expect(diagram).toContain('completed --> [*]');
			expect(diagram).toContain('failed --> [*]');
		});
	});

	describe('State Transition Coverage', () => {
		it('should have all transitions defined', () => {
			expect(STATE_TRANSITIONS.length).toBeGreaterThan(0);

			// Verify critical transitions exist
			const hasStart = STATE_TRANSITIONS.some(
				t => t.from === WeaveState.IDLE && t.event === WeaveEvent.START
			);
			const hasComplete = STATE_TRANSITIONS.some(
				t => t.to === WeaveState.COMPLETED
			);
			const hasPause = STATE_TRANSITIONS.some(
				t => t.event === WeaveEvent.PAUSE
			);
			const hasResume = STATE_TRANSITIONS.some(
				t => t.event === WeaveEvent.RESUME
			);

			expect(hasStart).toBe(true);
			expect(hasComplete).toBe(true);
			expect(hasPause).toBe(true);
			expect(hasResume).toBe(true);
		});
	});
});
