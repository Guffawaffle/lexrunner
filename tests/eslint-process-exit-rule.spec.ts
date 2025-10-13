import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ESLint process.exit() ban rule', () => {
	it('should pass lint for production code using throwExit()', () => {
		// Test that current production code passes lint
		const result = execSync('npx eslint src/cli.ts src/cli-security.ts', {
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
		});
		expect(result).toBe('');
	});

	it('should fail lint when process.exit() is used in src/', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-test-'));
		const testFile = path.join(tmpDir, 'test-violation.ts');

		try {
			// Create a file with process.exit() violation
			fs.writeFileSync(testFile, `
export function badExit() {
	process.exit(0);
}
`);

			// Copy to src directory temporarily
			const srcTestFile = path.resolve(__dirname, '..', 'src', 'test-eslint-violation.ts');
			fs.copyFileSync(testFile, srcTestFile);

			try {
				// Run ESLint on the violation file - should fail
				execSync(`npx eslint ${srcTestFile}`, {
					cwd: path.resolve(__dirname, '..'),
					encoding: 'utf8',
				});
				// If we get here, the test should fail
				expect.fail('ESLint should have caught the process.exit() violation');
			} catch (error: any) {
				// Expect ESLint to fail with exit code 1
				expect(error.status).toBe(1);
				expect(error.stdout).toContain('Use throwExit() instead of process.exit()');
				expect(error.stdout).toContain('no-restricted-syntax');
			} finally {
				// Clean up test file
				if (fs.existsSync(srcTestFile)) {
					fs.unlinkSync(srcTestFile);
				}
			}
		} finally {
			// Clean up temp directory
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('should allow process.exit() in MCP server emergency handlers', () => {
		// MCP server is allowed to use process.exit() for emergency handlers
		const result = execSync('npx eslint src/mcp/server.ts', {
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
		});
		expect(result).toBe('');
	});

	it('should allow process.exit() in scripts/', () => {
		// Scripts are allowed to use process.exit()
		const result = execSync('npx eslint scripts/rotate-secrets-example.ts scripts/release-prepare.ts', {
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
		});
		expect(result).toBe('');
	});

	it('should allow process.exit() in tests/', () => {
		// This test file itself is allowed to reference process.exit() in strings/mocks
		const result = execSync('npx eslint tests/cliJsonPurity.spec.ts', {
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
		});
		expect(result).toBe('');
	});
});
