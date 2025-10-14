import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeGate } from '../../src/gates.js';
import { Gate, Policy } from '../../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Gate Input Validation Integration', () => {
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

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-validation-test-'));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it('validates gate input before execution', async () => {
		const gate: Gate = {
			name: 'lint',
			run: 'echo "should not run"',
			runtime: 'local',
			input: {
				files: [],  // Invalid: empty array
				linter: 'eslint'
			}
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

		expect(result.status).toBe('fail');
		expect(result.stderr).toContain('Invalid input for gate "lint"');
		expect(result.stderr).toContain('must NOT have fewer than 1 items');
		expect(result.attempts).toBe(0);  // Validation failure, no execution attempts
	});

	it('executes gate when input is valid', async () => {
		const gate: Gate = {
			name: 'lint',
			run: 'echo "linting complete"',
			runtime: 'local',
			input: {
				files: ['src/index.ts'],
				linter: 'eslint'
			}
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

		expect(result.status).toBe('pass');
		expect(result.stdout).toContain('linting complete');
		expect(result.attempts).toBe(1);
	});

	it('skips validation when skipValidation is true', async () => {
		const gate: Gate = {
			name: 'lint',
			run: 'echo "executed without validation"',
			runtime: 'local',
			input: {
				files: [],  // Invalid but will be skipped
				linter: 'eslint'
			}
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000, undefined, true);

		expect(result.status).toBe('pass');
		expect(result.stdout).toContain('executed without validation');
	});

	it('executes gate without input field normally', async () => {
		const gate: Gate = {
			name: 'test-no-input',
			run: 'echo "no input validation"',
			runtime: 'local'
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

		expect(result.status).toBe('pass');
		expect(result.stdout).toContain('no input validation');
	});

	it('validates multiple gate types correctly', async () => {
		const testGate: Gate = {
			name: 'test',
			run: 'echo "test"',
			runtime: 'local',
			input: {
				framework: 'vitest',
				files: ['tests/*.spec.ts']
			}
		};

		const buildGate: Gate = {
			name: 'build',
			run: 'echo "build"',
			runtime: 'local',
			input: {
				command: 'npm run build',
				outputDir: 'dist'
			}
		};

		const testResult = await executeGate(testGate, defaultPolicy, tempDir, 5000);
		const buildResult = await executeGate(buildGate, defaultPolicy, tempDir, 5000);

		expect(testResult.status).toBe('pass');
		expect(buildResult.status).toBe('pass');
	});

	it('provides detailed error for multiple validation failures', async () => {
		const gate: Gate = {
			name: 'lint',
			run: 'echo "should not run"',
			runtime: 'local',
			input: {
				files: [],  // Invalid: empty
				linter: 'invalid-linter',  // Invalid: not in enum
				unknownField: 'value'  // Invalid: additional property
			}
		};

		const result = await executeGate(gate, defaultPolicy, tempDir, 5000);

		expect(result.status).toBe('fail');
		expect(result.stderr).toContain('Invalid input for gate "lint"');
		// Should contain multiple error messages
		expect(result.stderr.length).toBeGreaterThan(50);
	});
});
