import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeGate } from '../src/gates.js';
import { Policy, Gate } from '../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Gate Working Directory Stability', () => {
	const defaultPolicy: Policy = {
		requiredGates: [],
		optionalGates: [],
		maxWorkers: 1,
		retries: {},
		overrides: {},
		blockOn: [],
		mergeRule: { type: "strict-required" }
	};

	let tempDir: string;
	let repoRoot: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cwd-test-'));
		repoRoot = process.cwd();
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('should use repoRoot as working directory when gate.cwd is not specified', async () => {
		const gate: Gate = {
			name: 'test-cwd',
			run: 'pwd',
			runtime: 'local'
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, false, repoRoot);

		expect(result.status).toBe('pass');
		expect(result.stdout?.trim()).toBe(repoRoot);
	});

	it('should use gate.cwd when explicitly specified', async () => {
		const customCwd = tempDir;
		const gate: Gate = {
			name: 'test-custom-cwd',
			run: 'pwd',
			cwd: customCwd,
			runtime: 'local'
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, false, repoRoot);

		expect(result.status).toBe('pass');
		expect(result.stdout?.trim()).toBe(customCwd);
	});

	it('should maintain stable working directory across multiple gate executions', async () => {
		const gates: Gate[] = [
			{
				name: 'test-cwd-1',
				run: 'pwd',
				runtime: 'local'
			},
			{
				name: 'test-cwd-2',
				run: 'pwd',
				runtime: 'local'
			},
			{
				name: 'test-cwd-3',
				run: 'pwd',
				runtime: 'local'
			}
		];

		const results = await Promise.all(
			gates.map(gate => executeGate(gate, defaultPolicy, tempDir, 5000, undefined, false, repoRoot))
		);

		// All gates should execute in the same working directory
		for (const result of results) {
			expect(result.status).toBe('pass');
			expect(result.stdout?.trim()).toBe(repoRoot);
		}
	});

	it('should allow npm test to access package.json when running in repoRoot', async () => {
		// This test simulates the real-world scenario where npm test needs to find package.json
		// We create a minimal package.json in a temp directory to test this
		const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-npm-'));
		
		try {
			// Create a minimal package.json
			const packageJson = {
				name: "test-package",
				version: "1.0.0",
				scripts: {
					test: "echo 'Test passed'"
				}
			};
			fs.writeFileSync(path.join(testRepoDir, 'package.json'), JSON.stringify(packageJson, null, 2));

			const gate: Gate = {
				name: 'test-npm',
				run: 'npm test --silent',
				runtime: 'local'
			};

			const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, false, testRepoDir);

			expect(result.status).toBe('pass');
			expect(result.stdout).toContain('Test passed');
		} finally {
			fs.rmSync(testRepoDir, { recursive: true });
		}
	});

	it('should handle gates that change directory internally without affecting subsequent gates', async () => {
		// First gate changes directory but should not affect the second gate
		const gate1: Gate = {
			name: 'test-cd-internal',
			run: `cd ${tempDir} && pwd`,
			runtime: 'local'
		};

		const gate2: Gate = {
			name: 'test-after-cd',
			run: 'pwd',
			runtime: 'local'
		};

		const result1 = await executeGate(gate1, defaultPolicy, tempDir, 5000, undefined, false, repoRoot);
		const result2 = await executeGate(gate2, defaultPolicy, tempDir, 5000, undefined, false, repoRoot);

		expect(result1.status).toBe('pass');
		expect(result1.stdout?.trim()).toBe(tempDir);
		
		expect(result2.status).toBe('pass');
		expect(result2.stdout?.trim()).toBe(repoRoot);
	});

	it('should fall back to process.cwd() when repoRoot is not provided', async () => {
		const gate: Gate = {
			name: 'test-fallback',
			run: 'pwd',
			runtime: 'local'
		};

		// Don't pass repoRoot parameter
		const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, false);

		expect(result.status).toBe('pass');
		expect(result.stdout?.trim()).toBe(process.cwd());
	});
});
