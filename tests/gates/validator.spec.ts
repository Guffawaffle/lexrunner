import { describe, it, expect } from 'vitest';
import { validateGateInput, GateInputValidationError, hasGateInputSchema } from '../../src/gates/validator.js';

describe('Gate Input Validation', () => {
	describe('lint gate', () => {
		it('passes valid input', () => {
			const input = { files: ['src/index.ts'], linter: 'eslint' };
			expect(() => validateGateInput('lint', input)).not.toThrow();
		});

		it('fails on missing required field "files"', () => {
			const input = { linter: 'eslint' };
			expect(() => validateGateInput('lint', input))
				.toThrow(GateInputValidationError);
			expect(() => validateGateInput('lint', input))
				.toThrow(/required property 'files'/i);
		});

	it('fails on empty files array', () => {
		const input = { files: [], linter: 'eslint' };
		expect(() => validateGateInput('lint', input))
			.toThrow(/should NOT have fewer than 1 items/i);
	});

	it('fails on invalid linter enum', () => {
		const input = { files: ['src/index.ts'], linter: 'magic-linter' };
		expect(() => validateGateInput('lint', input))
			.toThrow(/should be equal to one of the allowed values/i);
	});

	it('allows optional "fix" parameter', () => {
		const input = { files: ['src/index.ts'], linter: 'eslint', fix: true };
		expect(() => validateGateInput('lint', input)).not.toThrow();
	});

	it('rejects additional properties', () => {
		const input = { files: ['src/index.ts'], linter: 'eslint', unknownProp: 'value' };
		expect(() => validateGateInput('lint', input))
			.toThrow(/should NOT have additional properties/i);
	});		it('provides actionable error messages', () => {
			const input = { files: [], linter: 'eslint' };
			try {
				validateGateInput('lint', input);
				expect.fail('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(GateInputValidationError);
				expect((err as GateInputValidationError).gate).toBe('lint');
				expect((err as GateInputValidationError).errors).toHaveLength(1);
			}
		});
	});

	describe('schema existence checks', () => {
		it('returns true for gates with schemas', () => {
			expect(hasGateInputSchema('lint')).toBe(true);
			expect(hasGateInputSchema('test')).toBe(true);
			expect(hasGateInputSchema('build')).toBe(true);
			expect(hasGateInputSchema('security-scan')).toBe(true);
			expect(hasGateInputSchema('coverage')).toBe(true);
		});

		it('returns false for gates without schemas', () => {
			expect(hasGateInputSchema('nonexistent-gate')).toBe(false);
		});

		it('does not throw when validating gate without schema', () => {
			expect(() => validateGateInput('custom-gate', {})).not.toThrow();
		});
	});

	describe('test gate', () => {
		it('validates test gate input', () => {
			const input = {
				framework: 'vitest',
				files: ['tests/**/*.spec.ts'],
				coverage: true
			};
			expect(() => validateGateInput('test', input)).not.toThrow();
		});

		it('fails on missing required fields', () => {
			const input = { framework: 'vitest' };
			expect(() => validateGateInput('test', input))
				.toThrow(/required property 'files'/i);
		});

		it('fails on invalid framework', () => {
			const input = { framework: 'unknown', files: ['test.ts'] };
			expect(() => validateGateInput('test', input))
				.toThrow(/should be equal to one of the allowed values/i);
		});
	});

	describe('build gate', () => {
		it('validates build gate input', () => {
			const input = {
				command: 'npm run build',
				outputDir: 'dist'
			};
			expect(() => validateGateInput('build', input)).not.toThrow();
		});

		it('fails on missing command', () => {
			const input = { outputDir: 'dist' };
			expect(() => validateGateInput('build', input))
				.toThrow(/required property 'command'/i);
		});

		it('allows optional fields', () => {
			const input = {
				command: 'npm run build',
				outputDir: 'dist',
				clean: true,
				targets: ['main', 'worker']
			};
			expect(() => validateGateInput('build', input)).not.toThrow();
		});
	});

	describe('security-scan gate', () => {
		it('validates security-scan gate input', () => {
			const input = {
				scanner: 'npm-audit',
				severity: 'high',
				failOn: 'critical'
			};
			expect(() => validateGateInput('security-scan', input)).not.toThrow();
		});

		it('fails on invalid scanner', () => {
			const input = { scanner: 'invalid-scanner' };
			expect(() => validateGateInput('security-scan', input))
				.toThrow(/should be equal to one of the allowed values/i);
		});

		it('fails on invalid severity', () => {
			const input = { scanner: 'npm-audit', severity: 'invalid' };
			expect(() => validateGateInput('security-scan', input))
				.toThrow(/should be equal to one of the allowed values/i);
		});
	});

	describe('coverage gate', () => {
		it('validates coverage gate input', () => {
			const input = {
				tool: 'vitest',
				threshold: 80,
				files: ['src/**/*.ts'],
				exclude: ['**/*.test.ts']
			};
			expect(() => validateGateInput('coverage', input)).not.toThrow();
		});

		it('fails on threshold out of range', () => {
			const input = { tool: 'vitest', threshold: 150 };
			expect(() => validateGateInput('coverage', input))
				.toThrow(/should be <= 100/i);
		});

		it('fails on negative threshold', () => {
			const input = { tool: 'vitest', threshold: -10 };
			expect(() => validateGateInput('coverage', input))
				.toThrow(/should be >= 0/i);
		});
	});

	describe('error handling', () => {
		it('includes gate name in error', () => {
			const input = { invalid: 'data' };
			try {
				validateGateInput('lint', input);
				expect.fail('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(GateInputValidationError);
				const validationError = err as GateInputValidationError;
				expect(validationError.gate).toBe('lint');
				expect(validationError.message).toContain('lint');
			}
		});

		it('provides JSON serializable error details', () => {
			const input = { files: [], linter: 'eslint' };
			try {
				validateGateInput('lint', input);
				expect.fail('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(GateInputValidationError);
				const validationError = err as GateInputValidationError;
				const json = validationError.toJSON();
				expect(json.gate).toBe('lint');
				expect(json.errors).toBeDefined();
				expect(Array.isArray(json.errors)).toBe(true);
			}
		});
	});
});
