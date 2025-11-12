import { describe, it, expect } from 'vitest';
import { computeLockHash, formatLockHash, generateLockBranchName, generateLockFilename } from '../src/util/lockHash.js';
import type { Plan } from '../src/schema.js';

describe('lockHash', () => {
	const mockPlan: Plan = {
		schemaVersion: '1.0.0',
		target: 'main',
		items: [
			{ name: 'pr-123', deps: [], gates: [] },
			{ name: 'pr-456', deps: ['pr-123'], gates: [] }
		]
	};

	describe('computeLockHash', () => {
		it('should compute lock hash from plan and PR heads', () => {
			const prHeads = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'def456' }
			];

			const result = computeLockHash(mockPlan, prHeads);

			expect(result.hash).toBeDefined();
			expect(result.hash).toHaveLength(64); // SHA-256 produces 64 hex characters
			expect(result.inputs.planHash).toBeDefined();
			expect(result.inputs.prHeads).toEqual(prHeads);
			expect(result.timestamp).toBeDefined();
		});

		it('should produce same hash for same inputs', () => {
			const prHeads = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'def456' }
			];

			const result1 = computeLockHash(mockPlan, prHeads);
			const result2 = computeLockHash(mockPlan, prHeads);

			expect(result1.hash).toBe(result2.hash);
		});

		it('should produce different hash when PR head changes', () => {
			const prHeads1 = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'def456' }
			];

			const prHeads2 = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'different' }
			];

			const result1 = computeLockHash(mockPlan, prHeads1);
			const result2 = computeLockHash(mockPlan, prHeads2);

			expect(result1.hash).not.toBe(result2.hash);
		});

		it('should produce different hash when plan changes', () => {
			const prHeads = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'def456' }
			];

			const modifiedPlan: Plan = {
				...mockPlan,
				items: [
					...mockPlan.items,
					{ name: 'pr-789', deps: [], gates: [] }
				]
			};

			const result1 = computeLockHash(mockPlan, prHeads);
			const result2 = computeLockHash(modifiedPlan, prHeads);

			expect(result1.hash).not.toBe(result2.hash);
		});

		it('should sort PR heads by name for deterministic hash', () => {
			const prHeadsUnsorted = [
				{ name: 'pr-456', sha: 'def456' },
				{ name: 'pr-123', sha: 'abc123' }
			];

			const prHeadsSorted = [
				{ name: 'pr-123', sha: 'abc123' },
				{ name: 'pr-456', sha: 'def456' }
			];

			const result1 = computeLockHash(mockPlan, prHeadsUnsorted);
			const result2 = computeLockHash(mockPlan, prHeadsSorted);

			expect(result1.hash).toBe(result2.hash);
		});

		it('should not mutate input PR heads array', () => {
			const prHeads = [
				{ name: 'pr-456', sha: 'def456' },
				{ name: 'pr-123', sha: 'abc123' }
			];

			const originalOrder = [...prHeads];
			computeLockHash(mockPlan, prHeads);

			expect(prHeads).toEqual(originalOrder);
		});
	});

	describe('formatLockHash', () => {
		it('should return first 12 characters of hash', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const formatted = formatLockHash(hash);

			expect(formatted).toBe('abcdef123456');
			expect(formatted).toHaveLength(12);
		});

		it('should handle short hashes', () => {
			const hash = 'abc123';
			const formatted = formatLockHash(hash);

			expect(formatted).toBe('abc123');
		});
	});

	describe('generateLockBranchName', () => {
		it('should generate branch name with prefix and short hash', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const branchName = generateLockBranchName('weave/', hash);

			expect(branchName).toMatch(/^weave\/\d{4}-\d{2}-\d{2}-abcdef123456$/);
		});

		it('should use custom prefix', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const branchName = generateLockBranchName('integration/', hash);

			expect(branchName).toMatch(/^integration\/\d{4}-\d{2}-\d{2}-abcdef123456$/);
		});
	});

	describe('generateLockFilename', () => {
		it('should generate filename with base and short hash', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const filename = generateLockFilename('weave-lock', hash, 'json');

			expect(filename).toBe('weave-lock-abcdef123456.json');
		});

		it('should work without extension', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const filename = generateLockFilename('weave-lock', hash);

			expect(filename).toBe('weave-lock-abcdef123456');
		});

		it('should handle empty extension', () => {
			const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const filename = generateLockFilename('weave-lock', hash, '');

			expect(filename).toBe('weave-lock-abcdef123456');
		});
	});
});
