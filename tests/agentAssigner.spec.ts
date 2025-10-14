/**
 * Tests for Agent Assigner - Bulk assign GitHub Copilot agents to batched issues
 */

import { describe, it, expect, vi } from 'vitest';
import {
	assignAgentsToBatch,
	formatAssignmentLog,
	AssignmentResult,
	AssignmentLog,
} from '../src/orchestration/agentAssigner';

describe('assignAgentsToBatch', () => {
	it('should handle dry-run mode without making API calls', async () => {
		const mockAssign = vi.fn();
		const issues = [156, 157, 160];
		
		const result = await assignAgentsToBatch(
			issues,
			{ repo: 'test/repo', dryRun: true },
			mockAssign
		);
		
		expect(mockAssign).not.toHaveBeenCalled();
		expect(result.results).toHaveLength(3);
		expect(result.summary.assigned).toBe(0);
		expect(result.summary.skipped).toBe(0);
		expect(result.summary.failed).toBe(0);
	});

	it('should assign agents successfully', async () => {
		const mockAssign = vi.fn().mockResolvedValue({ url: 'https://github.com/test/repo/issues/156' });
		const issues = [156, 157];
		
		const result = await assignAgentsToBatch(
			issues,
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		expect(mockAssign).toHaveBeenCalledTimes(2);
		expect(result.results).toHaveLength(2);
		expect(result.results[0].status).toBe('success');
		expect(result.results[1].status).toBe('success');
		expect(result.summary.assigned).toBe(2);
		expect(result.summary.skipped).toBe(0);
		expect(result.summary.failed).toBe(0);
	});

	it('should handle rate limiting with retry', async () => {
		vi.useFakeTimers();
		
		let callCount = 0;
		const mockAssign = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				const error: any = new Error('Rate limit exceeded');
				error.status = 429;
				throw error;
			}
			return Promise.resolve({ url: 'https://github.com/test/repo/issues/156' });
		});
		
		const promise = assignAgentsToBatch(
			[156],
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		// Fast-forward through the backoff delay
		await vi.advanceTimersByTimeAsync(10000);
		
		const result = await promise;
		
		expect(mockAssign).toHaveBeenCalledTimes(2); // Initial + 1 retry
		expect(result.results[0].status).toBe('success');
		expect(result.summary.assigned).toBe(1);
		
		vi.useRealTimers();
	});

	it('should skip already assigned issues', async () => {
		const mockAssign = vi.fn().mockRejectedValue(new Error('Agent already exists for this issue'));
		
		const result = await assignAgentsToBatch(
			[156],
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		expect(result.results[0].status).toBe('skipped');
		expect(result.results[0].reason).toBe('Issue already assigned');
		expect(result.summary.skipped).toBe(1);
		expect(result.summary.assigned).toBe(0);
	});

	it('should handle permanent errors', async () => {
		const mockAssign = vi.fn().mockRejectedValue(new Error('Invalid repository'));
		
		const result = await assignAgentsToBatch(
			[156],
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		expect(result.results[0].status).toBe('failed');
		expect(result.results[0].error).toContain('Invalid repository');
		expect(result.summary.failed).toBe(1);
	});

	it('should fail after max retries on rate limiting', async () => {
		vi.useFakeTimers();
		
		const mockAssign = vi.fn().mockImplementation(() => {
			const error: any = new Error('Rate limit exceeded');
			error.status = 429;
			throw error;
		});
		
		const promise = assignAgentsToBatch(
			[156],
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		// Fast-forward through all backoff delays (10s + 20s + 40s + 80s)
		await vi.advanceTimersByTimeAsync(150000);
		
		const result = await promise;
		
		expect(mockAssign).toHaveBeenCalledTimes(4); // Initial attempt when retries=0, then retries=1,2,3
		expect(result.results[0].status).toBe('failed');
		expect(result.results[0].error).toContain('Max retries exceeded');
		expect(result.summary.failed).toBe(1);
		
		vi.useRealTimers();
	});

	it('should apply stagger delay between assignments', async () => {
		vi.useFakeTimers();
		
		const mockAssign = vi.fn().mockResolvedValue({ url: 'https://github.com/test/repo/issues/156' });
		
		const promise = assignAgentsToBatch(
			[156, 157],
			{ repo: 'test/repo', stagger: 0.1 }, // 0.1 seconds = 100ms
			mockAssign
		);
		
		// Fast-forward through stagger delay
		await vi.advanceTimersByTimeAsync(200);
		
		await promise;
		
		// Should have been called twice (one for each issue)
		expect(mockAssign).toHaveBeenCalledTimes(2);
		
		vi.useRealTimers();
	});

	it('should process multiple issues with mixed results', async () => {
		const mockAssign = vi.fn()
			.mockResolvedValueOnce({ url: 'https://github.com/test/repo/issues/156' })
			.mockRejectedValueOnce(new Error('Agent already exists'))
			.mockRejectedValueOnce(new Error('Permission denied'));
		
		const result = await assignAgentsToBatch(
			[156, 157, 158],
			{ repo: 'test/repo', stagger: 0 },
			mockAssign
		);
		
		expect(result.results[0].status).toBe('success');
		expect(result.results[1].status).toBe('skipped');
		expect(result.results[2].status).toBe('failed');
		expect(result.summary.assigned).toBe(1);
		expect(result.summary.skipped).toBe(1);
		expect(result.summary.failed).toBe(1);
	});
});

describe('formatAssignmentLog', () => {
	it('should format log with success entries', () => {
		const log: AssignmentLog = {
			batchId: 'batch-123',
			assignedAt: '2025-10-13T00:00:00Z',
			results: [
				{
					issueNumber: 156,
					status: 'success',
					assignedAt: '2025-10-13T00:00:01Z',
					agentUrl: 'https://github.com/test/repo/issues/156',
				},
			],
			summary: { assigned: 1, skipped: 0, failed: 0 },
		};
		
		const formatted = formatAssignmentLog(log, 'test/repo');
		
		expect(formatted).toContain('Agent Assignment (batch-123)');
		expect(formatted).toContain('✅ test/repo#156: assigned at 2025-10-13T00:00:01Z');
		expect(formatted).toContain('Summary: 1 assigned, 0 skipped, 0 failed');
	});

	it('should format log with skipped entries', () => {
		const log: AssignmentLog = {
			batchId: 'batch-123',
			assignedAt: '2025-10-13T00:00:00Z',
			results: [
				{
					issueNumber: 160,
					status: 'skipped',
					reason: 'Issue already assigned',
				},
			],
			summary: { assigned: 0, skipped: 1, failed: 0 },
		};
		
		const formatted = formatAssignmentLog(log, 'test/repo');
		
		expect(formatted).toContain('⏭️ test/repo#160: Issue already assigned');
		expect(formatted).toContain('Summary: 0 assigned, 1 skipped, 0 failed');
	});

	it('should format log with failed entries', () => {
		const log: AssignmentLog = {
			batchId: 'batch-123',
			assignedAt: '2025-10-13T00:00:00Z',
			results: [
				{
					issueNumber: 161,
					status: 'failed',
					error: 'Network error',
				},
			],
			summary: { assigned: 0, skipped: 0, failed: 1 },
		};
		
		const formatted = formatAssignmentLog(log, 'test/repo');
		
		expect(formatted).toContain('❌ test/repo#161: Network error');
		expect(formatted).toContain('Summary: 0 assigned, 0 skipped, 1 failed');
	});

	it('should format log with mixed results', () => {
		const log: AssignmentLog = {
			batchId: 'batch-456',
			assignedAt: '2025-10-13T00:00:00Z',
			results: [
				{
					issueNumber: 156,
					status: 'success',
					assignedAt: '2025-10-13T00:00:01Z',
				},
				{
					issueNumber: 157,
					status: 'skipped',
					reason: 'Already assigned',
				},
				{
					issueNumber: 158,
					status: 'failed',
					error: 'Timeout',
				},
			],
			summary: { assigned: 1, skipped: 1, failed: 1 },
		};
		
		const formatted = formatAssignmentLog(log, 'owner/repo');
		
		expect(formatted).toContain('✅ owner/repo#156');
		expect(formatted).toContain('⏭️ owner/repo#157');
		expect(formatted).toContain('❌ owner/repo#158');
		expect(formatted).toContain('Summary: 1 assigned, 1 skipped, 1 failed');
	});
});
