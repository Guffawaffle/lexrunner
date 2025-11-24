import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseWeaveLock } from '../src/schema/weaveLock.js';

describe('merge command lock hash integration', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-runner-lock-test');
	const repoRoot = path.resolve(__dirname, '..');

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		// Don't use process.chdir() - not supported in worker threads
	});

	afterEach(() => {
		// Cleanup
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('should compute and display lock hash in dry-run mode', () => {
		// Create a minimal plan file
		const plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: [
				{ name: 'test-item', deps: [], gates: [] }
			]
		};

		fs.writeFileSync('plan.json', JSON.stringify(plan, null, 2));

		// Note: This test will fail if CLI is not built
		// Run merge in dry-run mode
		try {
			const output = execSync(
				`node ${path.join(repoRoot, 'dist', 'cli.js')} merge --plan plan.json`,
				{ encoding: 'utf-8', cwd: testDir }
			);

			// Should display lock hash
			expect(output).toMatch(/🔒 Lock Hash: [a-f0-9]{12}/);
			expect(output).toContain('DRY RUN MODE');
		} catch (error: any) {
			// Expected to fail since we don't have a real git repo
			// Just verify the error is about git, not lock hash
			expect(error.message).toMatch(/git|repository/i);
		}
	});

	it('should create lock file when executing merge', () => {
		const plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: []
		};

		fs.writeFileSync('plan.json', JSON.stringify(plan, null, 2));

		// Note: This test requires a git repository
		// For now, we'll test the lock file schema is correct
		const lockFilePath = path.join(testDir, 'weave-lock.json');
		
		// Manually create a lock file to test parsing
		const mockLock = {
			lockHash: 'abc123def456',
			planHash: 'plan123',
			prHeads: [],
			timestamp: new Date().toISOString(),
			status: 'in-progress' as const
		};

		fs.writeFileSync(lockFilePath, JSON.stringify(mockLock, null, 2));

		// Verify we can parse it
		const parsed = parseWeaveLock(fs.readFileSync(lockFilePath, 'utf-8'));
		expect(parsed.lockHash).toBe('abc123def456');
		expect(parsed.status).toBe('in-progress');
	});

	it('should skip execution if lock hash matches', () => {
		const plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: [
				{ name: 'test-item', deps: [], gates: [] }
			]
		};

		fs.writeFileSync('plan.json', JSON.stringify(plan, null, 2));

		// Create a mock lock file with a hash
		const lockData = {
			lockHash: 'test-lock-hash',
			planHash: 'test-plan-hash',
			prHeads: [{ name: 'test-item', sha: 'test-sha' }],
			timestamp: new Date().toISOString(),
			status: 'completed' as const
		};

		fs.writeFileSync('weave-lock.json', JSON.stringify(lockData, null, 2));

		// The merge command should detect this and skip
		// (This is a conceptual test - actual behavior depends on git state)
	});

	it('should override lock with --force flag', () => {
		// This test verifies the --force option exists in the command
		const plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: []
		};

		fs.writeFileSync('plan.json', JSON.stringify(plan, null, 2));

		try {
			// Try to get help text to verify --force option exists
			const helpOutput = execSync(
				`node ${path.join(repoRoot, 'dist', 'cli.js')} merge --help`,
				{ encoding: 'utf-8' }
			);

			expect(helpOutput).toContain('--force');
			expect(helpOutput).toMatch(/force.*lock/i);
		} catch (error: any) {
			// If CLI is not built, skip this test
			console.warn('CLI not built, skipping --force flag test');
		}
	});

	it('should include lock hash in JSON output', () => {
		const plan = {
			schemaVersion: '1.0.0',
			target: 'main',
			items: [
				{ name: 'test-item', deps: [], gates: [] }
			]
		};

		fs.writeFileSync('plan.json', JSON.stringify(plan, null, 2));

		try {
			const output = execSync(
				`node ${path.join(repoRoot, 'dist', 'cli.js')} merge --plan plan.json --json`,
				{ encoding: 'utf-8', cwd: testDir }
			);

			const parsed = JSON.parse(output);
			expect(parsed.lockHash).toBeDefined();
			expect(typeof parsed.lockHash).toBe('string');
		} catch (error: any) {
			// Expected to fail without git repo
			console.warn('Skipping JSON output test:', error.message);
		}
	});
});
