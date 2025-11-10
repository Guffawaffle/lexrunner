import { describe, it, expect } from 'vitest';
import { parseWeaveLock, serializeWeaveLock, WeaveLock } from '../src/schema/weaveLock.js';

describe('weaveLock schema', () => {
	const mockLock: WeaveLock = {
		lockHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
		planHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
		prHeads: [
			{ name: 'pr-123', sha: 'abc123' },
			{ name: 'pr-456', sha: 'def456' }
		],
		timestamp: '2025-11-10T08:00:00.000Z',
		status: 'completed'
	};

	describe('parseWeaveLock', () => {
		it('should parse valid lock file', () => {
			const json = JSON.stringify(mockLock);
			const parsed = parseWeaveLock(json);

			expect(parsed).toEqual(mockLock);
		});

		it('should validate required fields', () => {
			const incomplete = {
				lockHash: 'abc123'
				// Missing required fields
			};

			expect(() => parseWeaveLock(JSON.stringify(incomplete))).toThrow('Invalid weave lock file');
		});

		it('should validate status enum values', () => {
			const invalidStatus = {
				...mockLock,
				status: 'invalid-status'
			};

			expect(() => parseWeaveLock(JSON.stringify(invalidStatus))).toThrow();
		});

		it('should allow optional fields', () => {
			const minimalLock = {
				lockHash: 'abc123',
				planHash: 'def456',
				prHeads: [{ name: 'pr-1', sha: 'sha1' }],
				timestamp: '2025-11-10T08:00:00.000Z'
			};

			const parsed = parseWeaveLock(JSON.stringify(minimalLock));
			expect(parsed.lockHash).toBe('abc123');
			expect(parsed.status).toBeUndefined();
			expect(parsed.integrationBranch).toBeUndefined();
		});

		it('should validate PR heads array structure', () => {
			const invalidPrHeads = {
				...mockLock,
				prHeads: [
					{ name: 'pr-1' } // Missing sha
				]
			};

			expect(() => parseWeaveLock(JSON.stringify(invalidPrHeads))).toThrow();
		});
	});

	describe('serializeWeaveLock', () => {
		it('should serialize lock to formatted JSON', () => {
			const serialized = serializeWeaveLock(mockLock);
			const parsed = JSON.parse(serialized);

			expect(parsed).toEqual(mockLock);
		});

		it('should use 2-space indentation', () => {
			const serialized = serializeWeaveLock(mockLock);

			// Check that it's pretty-printed (contains newlines and spaces)
			expect(serialized).toContain('\n');
			expect(serialized).toContain('  ');
		});

		it('should handle minimal lock', () => {
			const minimalLock: WeaveLock = {
				lockHash: 'abc123',
				planHash: 'def456',
				prHeads: [],
				timestamp: '2025-11-10T08:00:00.000Z'
			};

			const serialized = serializeWeaveLock(minimalLock);
			const parsed = JSON.parse(serialized);

			expect(parsed.lockHash).toBe('abc123');
			expect(parsed.prHeads).toEqual([]);
		});
	});

	describe('round-trip', () => {
		it('should preserve data through serialize and parse', () => {
			const serialized = serializeWeaveLock(mockLock);
			const parsed = parseWeaveLock(serialized);

			expect(parsed).toEqual(mockLock);
		});

		it('should preserve all status values', () => {
			const statuses: Array<'in-progress' | 'completed' | 'failed'> = ['in-progress', 'completed', 'failed'];

			for (const status of statuses) {
				const lockWithStatus = { ...mockLock, status };
				const serialized = serializeWeaveLock(lockWithStatus);
				const parsed = parseWeaveLock(serialized);

				expect(parsed.status).toBe(status);
			}
		});

		it('should preserve integration branch when set', () => {
			const lockWithBranch = {
				...mockLock,
				integrationBranch: 'integration/weave-2025-11-10-abc123'
			};

			const serialized = serializeWeaveLock(lockWithBranch);
			const parsed = parseWeaveLock(serialized);

			expect(parsed.integrationBranch).toBe('integration/weave-2025-11-10-abc123');
		});
	});
});
