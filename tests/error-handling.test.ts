import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { skipIfCliNotBuilt } from './helpers/cli';
import { generatePlan } from '../src/core/plan';
import { loadInputs } from '../src/core/inputs';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('error handling and validation', () => {
	const testDir = path.join(os.tmpdir(), 'lexrunner-error-test');

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
	});

	afterEach(() => {
		// Cleanup
		process.chdir('/');
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('should validate unknown dependencies and fail deterministically', () => {
		// Create .smartergpt directory structure
		fs.mkdirSync('.smartergpt', { recursive: true });

		// Create config with unknown dependency
		fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: existing-item
    branch: feat/existing
    deps: []
    gates:
      - name: lint
        run: npm run lint
  - id: broken-item
    branch: feat/broken
    deps: ["nonexistent-item"]
    gates:
      - name: test
        run: npm test
`);

		// Should throw with specific error message
		expect(() => {
			const inputs = loadInputs();
			generatePlan(inputs);
		}).toThrow(/Unknown dependency 'nonexistent-item' for item 'broken-item'/);
	});

	it('should exit with code 2 via CLI for unknown dependencies', (ctx) => {
		if (skipIfCliNotBuilt({ skip: ctx.skip })) return;
		// Create .smartergpt directory structure
		fs.mkdirSync('.smartergpt', { recursive: true });

		// Create config with unknown dependency
		fs.writeFileSync('.smartergpt/stack.yml', `
version: 1
target: main
items:
  - id: item-1
    branch: feat/item-1
    deps: ["missing-dep"]
    gates:
      - name: lint
        run: npm run lint
`);

		// CLI should exit with code 2 for validation errors
		const repoRoot = path.resolve(__dirname, '..');
		const cliPath = path.join(repoRoot, 'dist/cli.js');

		let caughtError: any;
		try {
			execSync(`node ${cliPath} plan --json`, {
				cwd: testDir,
				encoding: 'utf-8',
				stdio: 'pipe'
			});
		} catch (error: any) {
			caughtError = error;
		}

		expect(caughtError).toBeDefined();
		expect(caughtError.status).toBe(2);
		expect(caughtError.stderr.toString()).toContain("Unknown dependency 'missing-dep' for item 'item-1'");
	});
});
