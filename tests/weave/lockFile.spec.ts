/**
 * Tests for weave lock file management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
	computePlanHash,
	createLockFile,
	writeLockFile,
	readLockFile,
	validateLockFile,
	deleteLockFile,
	updateLockFile,
	lockFileExists,
	getLockFilePath,
	loadContextFromLockFile,
	initializeLockFile
} from '../../src/weave/lockFile.js';
import { createWeaveContext } from '../../src/weave/stateMachine.js';
import { WeaveState } from '../../src/weave/types.js';
import { isAXError, ErrorCodes, type AXError } from '../../src/errors/index.js';

describe('Lock File Management', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-lock-test-'));
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('Plan Hash Computation', () => {
		it('should compute deterministic hash', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];

			const hash1 = computePlanHash(plan, prHeads);
			const hash2 = computePlanHash(plan, prHeads);

			expect(hash1).toBe(hash2);
			expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
		});

		it('should produce different hash for different plans', () => {
			const plan1 = { target: 'main', items: [] };
			const plan2 = { target: 'develop', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];

			const hash1 = computePlanHash(plan1, prHeads);
			const hash2 = computePlanHash(plan2, prHeads);

			expect(hash1).not.toBe(hash2);
		});

		it('should produce different hash for different PR heads', () => {
			const plan = { target: 'main', items: [] };
			const prHeads1 = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const prHeads2 = [{ name: 'pr-1', sha: 'def456', updatedAt: '2024-01-01' }];

			const hash1 = computePlanHash(plan, prHeads1);
			const hash2 = computePlanHash(plan, prHeads2);

			expect(hash1).not.toBe(hash2);
		});

		it('should be order-independent due to canonical JSON', () => {
			const plan1 = { items: [], target: 'main' };
			const plan2 = { target: 'main', items: [] };
			const prHeads = [];

			const hash1 = computePlanHash(plan1, prHeads);
			const hash2 = computePlanHash(plan2, prHeads);

			// Should be equal because canonical JSON sorts keys
			expect(hash1).toBe(hash2);
		});
	});

	describe('Lock File Creation', () => {
		it('should create valid lock file structure', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);

			const lockFile = createLockFile(context);

			expect(lockFile.schemaVersion).toBe('1.0.0');
			expect(lockFile.runId).toBe(context.runId);
			expect(lockFile.planHash).toBe(hash);
			expect(lockFile.state).toBe(WeaveState.IDLE);
			expect(lockFile.context).toBe(context);
			expect(lockFile.createdAt).toBe(context.startedAt);
			expect(lockFile.updatedAt).toBe(context.lastUpdatedAt);
		});
	});

	describe('Lock File I/O', () => {
		it('should write and read lock file', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);
			const lockFile = createLockFile(context);

			const filePath = writeLockFile(lockFile, testDir);
			expect(fs.existsSync(filePath)).toBe(true);

			const readBack = readLockFile(testDir);
			expect(readBack).not.toBeNull();
			expect(readBack!.runId).toBe(lockFile.runId);
			expect(readBack!.planHash).toBe(lockFile.planHash);
		});

		it('should return null when lock file does not exist', () => {
			const result = readLockFile(testDir);
			expect(result).toBeNull();
		});

		it('should throw error on invalid lock file', () => {
			const invalidPath = path.join(testDir, 'weave-lock.json');
			fs.writeFileSync(invalidPath, 'invalid json {', 'utf-8');

			expect(() => {
				readLockFile(testDir);
			}).toThrow(/Failed to read lock file/);
		});

		it('should throw AXError with WEAVE_LOCK_CONFLICT on invalid lock file', () => {
			const invalidPath = path.join(testDir, 'weave-lock.json');
			fs.writeFileSync(invalidPath, 'invalid json {', 'utf-8');

			try {
				readLockFile(testDir);
				expect.fail('Expected an error to be thrown');
			} catch (error) {
				expect(isAXError(error)).toBe(true);
				const axError = error as AXError;
				expect(axError.code).toBe(ErrorCodes.WEAVE_LOCK_CONFLICT);
				expect(axError.nextActions.length).toBeGreaterThanOrEqual(1);
			}
		});

		it('should throw error on incompatible schema version', () => {
			const lockFile = {
				schemaVersion: '2.0.0',
				runId: 'test',
				planHash: 'hash',
				state: 'idle',
				context: {},
				createdAt: '2024-01-01',
				updatedAt: '2024-01-01'
			};

			const filePath = path.join(testDir, 'weave-lock.json');
			fs.writeFileSync(filePath, JSON.stringify(lockFile), 'utf-8');

			expect(() => {
				readLockFile(testDir);
			}).toThrow(/Incompatible lock file version/);
		});

		it('should throw AXError with version info on incompatible schema', () => {
			const lockFile = {
				schemaVersion: '2.0.0',
				runId: 'test',
				planHash: 'hash',
				state: 'idle',
				context: {},
				createdAt: '2024-01-01',
				updatedAt: '2024-01-01'
			};

			const filePath = path.join(testDir, 'weave-lock.json');
			fs.writeFileSync(filePath, JSON.stringify(lockFile), 'utf-8');

			try {
				readLockFile(testDir);
				expect.fail('Expected an error to be thrown');
			} catch (error) {
				expect(isAXError(error)).toBe(true);
				const axError = error as AXError;
				expect(axError.code).toBe(ErrorCodes.WEAVE_LOCK_CONFLICT);
				expect(axError.context?.expectedVersion).toBe('1.0.0');
				expect(axError.context?.actualVersion).toBe('2.0.0');
				expect(axError.nextActions.length).toBeGreaterThanOrEqual(1);
			}
		});

		it('should delete lock file', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);
			const lockFile = createLockFile(context);

			writeLockFile(lockFile, testDir);
			expect(lockFileExists(testDir)).toBe(true);

			deleteLockFile(testDir);
			expect(lockFileExists(testDir)).toBe(false);
		});

		it('should not throw when deleting non-existent lock file', () => {
			expect(() => {
				deleteLockFile(testDir);
			}).not.toThrow();
		});
	});

	describe('Lock File Validation', () => {
		it('should validate matching lock file', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);
			const lockFile = createLockFile(context);

			const result = validateLockFile(lockFile, plan, prHeads);

			expect(result.valid).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it('should reject lock file with different plan', () => {
			const plan1 = { target: 'main', items: [] };
			const plan2 = { target: 'develop', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan1, prHeads);
			const context = createWeaveContext(plan1, prHeads, hash);
			const lockFile = createLockFile(context);

			const result = validateLockFile(lockFile, plan2, prHeads);

			expect(result.valid).toBe(false);
			expect(result.reason).toContain('Plan or PR heads have changed');
		});

		it('should reject lock file with different PR heads', () => {
			const plan = { target: 'main', items: [] };
			const prHeads1 = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const prHeads2 = [{ name: 'pr-1', sha: 'def456', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads1);
			const context = createWeaveContext(plan, prHeads1, hash);
			const lockFile = createLockFile(context);

			const result = validateLockFile(lockFile, plan, prHeads2);

			expect(result.valid).toBe(false);
			expect(result.reason).toContain('Plan or PR heads have changed');
		});
	});

	describe('Lock File Updates', () => {
		it('should update lock file with new context', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);

			// Write initial
			const lockFile = createLockFile(context);
			writeLockFile(lockFile, testDir);

			// Update context
			context.state = WeaveState.PLANNING;
			context.successfulMerges = 5;
			updateLockFile(context, testDir);

			// Read back
			const updated = readLockFile(testDir);
			expect(updated).not.toBeNull();
			expect(updated!.context.state).toBe(WeaveState.PLANNING);
			expect(updated!.context.successfulMerges).toBe(5);
		});
	});

	describe('Resume Context Loading', () => {
		it('should load valid context for resume', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);
			context.state = WeaveState.PAUSED;

			const lockFile = createLockFile(context);
			writeLockFile(lockFile, testDir);

			const result = loadContextFromLockFile(plan, prHeads, testDir);

			expect(result.valid).toBe(true);
			expect(result.context.state).toBe(WeaveState.PAUSED);
			expect(result.context.runId).toBe(context.runId);
		});

		it('should reject resume with no lock file', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];

			const result = loadContextFromLockFile(plan, prHeads, testDir);

			expect(result.valid).toBe(false);
			expect(result.reason).toBe('Lock file not found');
		});

		it('should reject resume with mismatched plan', () => {
			const plan1 = { target: 'main', items: [] };
			const plan2 = { target: 'develop', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan1, prHeads);
			const context = createWeaveContext(plan1, prHeads, hash);

			const lockFile = createLockFile(context);
			writeLockFile(lockFile, testDir);

			const result = loadContextFromLockFile(plan2, prHeads, testDir);

			expect(result.valid).toBe(false);
			expect(result.reason).toContain('Plan or PR heads have changed');
		});
	});

	describe('Lock File Initialization', () => {
		it('should initialize clean lock file', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);

			const filePath = initializeLockFile(context, testDir);

			expect(fs.existsSync(filePath)).toBe(true);
			const lockFile = readLockFile(testDir);
			expect(lockFile).not.toBeNull();
			expect(lockFile!.runId).toBe(context.runId);
		});

		it('should replace existing lock file on init', () => {
			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);

			// Create first context and lock file
			const context1 = createWeaveContext(plan, prHeads, hash);
			initializeLockFile(context1, testDir);

			const firstRunId = readLockFile(testDir)!.runId;

			// Create second context and init (should replace)
			const context2 = createWeaveContext(plan, prHeads, hash);
			initializeLockFile(context2, testDir);

			const secondRunId = readLockFile(testDir)!.runId;

			expect(firstRunId).not.toBe(secondRunId);
		});
	});

	describe('Lock File Path', () => {
		it('should return correct lock file path', () => {
			const filePath = getLockFilePath(testDir);
			expect(filePath).toBe(path.join(testDir, 'weave-lock.json'));
		});
	});

	describe('Lock File Existence Check', () => {
		it('should detect existing lock file', () => {
			expect(lockFileExists(testDir)).toBe(false);

			const plan = { target: 'main', items: [] };
			const prHeads = [{ name: 'pr-1', sha: 'abc123', updatedAt: '2024-01-01' }];
			const hash = computePlanHash(plan, prHeads);
			const context = createWeaveContext(plan, prHeads, hash);
			const lockFile = createLockFile(context);
			writeLockFile(lockFile, testDir);

			expect(lockFileExists(testDir)).toBe(true);
		});
	});
});
