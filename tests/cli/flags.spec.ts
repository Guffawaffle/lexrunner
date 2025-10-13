import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseGlobalFlags, validateFlagCombinations, GlobalFlags } from '../../src/cli/flags.js';

describe('CLI Global Flags', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		// Reset environment before each test
		process.env = { ...originalEnv };
		delete process.env.LEX_PR_JSON;
		delete process.env.NO_COLOR;
		delete process.env.LEX_PR_VERBOSE;
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe('parseGlobalFlags()', () => {
		describe('CLI arguments', () => {
			it('should parse --json flag from CLI args', () => {
				const opts = { json: true };
				const flags = parseGlobalFlags(opts);
				expect(flags.json).toBe(true);
			});

			it('should parse --no-color flag from CLI args', () => {
				const opts = { noColor: true };
				const flags = parseGlobalFlags(opts);
				expect(flags.noColor).toBe(true);
			});

			it('should parse --verbose flag from CLI args', () => {
				const opts = { verbose: true };
				const flags = parseGlobalFlags(opts);
				expect(flags.verbose).toBe(true);
			});

			it('should parse --quiet flag from CLI args', () => {
				const opts = { quiet: true };
				const flags = parseGlobalFlags(opts);
				expect(flags.quiet).toBe(true);
			});

			it('should handle multiple flags', () => {
				const opts = { json: true, noColor: true };
				const flags = parseGlobalFlags(opts);
				expect(flags.json).toBe(true);
				expect(flags.noColor).toBe(true);
			});

			it('should default to undefined when no flags are set', () => {
				const opts = {};
				const flags = parseGlobalFlags(opts);
				expect(flags.json).toBeUndefined();
				expect(flags.noColor).toBeUndefined();
				expect(flags.verbose).toBeUndefined();
				expect(flags.quiet).toBe(false); // quiet defaults to false
			});
		});

		describe('Environment variables', () => {
			it('should parse LEX_PR_JSON=1 from environment', () => {
				process.env.LEX_PR_JSON = '1';
				const flags = parseGlobalFlags({});
				expect(flags.json).toBe(true);
			});

			it('should parse NO_COLOR=1 from environment', () => {
				process.env.NO_COLOR = '1';
				const flags = parseGlobalFlags({});
				expect(flags.noColor).toBe(true);
			});

			it('should parse LEX_PR_VERBOSE=1 from environment', () => {
				process.env.LEX_PR_VERBOSE = '1';
				const flags = parseGlobalFlags({});
				expect(flags.verbose).toBe(true);
			});

			it('should ignore LEX_PR_JSON when not set to "1"', () => {
				process.env.LEX_PR_JSON = '0';
				const flags = parseGlobalFlags({});
				expect(flags.json).toBeUndefined();
			});

			it('should ignore NO_COLOR when not set to "1"', () => {
				process.env.NO_COLOR = 'false';
				const flags = parseGlobalFlags({});
				expect(flags.noColor).toBeUndefined();
			});

			it('should handle multiple environment variables', () => {
				process.env.LEX_PR_JSON = '1';
				process.env.NO_COLOR = '1';
				const flags = parseGlobalFlags({});
				expect(flags.json).toBe(true);
				expect(flags.noColor).toBe(true);
			});
		});

		describe('CLI args override env vars', () => {
			it('should prefer CLI --json over LEX_PR_JSON env var', () => {
				process.env.LEX_PR_JSON = '1';
				const flags = parseGlobalFlags({ json: false });
				expect(flags.json).toBe(false);
			});

			it('should prefer CLI --no-color over NO_COLOR env var', () => {
				process.env.NO_COLOR = '1';
				const flags = parseGlobalFlags({ noColor: false });
				expect(flags.noColor).toBe(false);
			});

			it('should prefer CLI --verbose over LEX_PR_VERBOSE env var', () => {
				process.env.LEX_PR_VERBOSE = '1';
				const flags = parseGlobalFlags({ verbose: false });
				expect(flags.verbose).toBe(false);
			});

			it('should use CLI args when explicitly true even if env is not set', () => {
				const flags = parseGlobalFlags({ json: true, verbose: true });
				expect(flags.json).toBe(true);
				expect(flags.verbose).toBe(true);
			});

			it('should use env vars when CLI args are undefined', () => {
				process.env.LEX_PR_JSON = '1';
				process.env.LEX_PR_VERBOSE = '1';
				const flags = parseGlobalFlags({});
				expect(flags.json).toBe(true);
				expect(flags.verbose).toBe(true);
			});
		});
	});

	describe('validateFlagCombinations()', () => {
		it('should not throw for valid flag combinations', () => {
			expect(() => validateFlagCombinations({ json: true })).not.toThrow();
			expect(() => validateFlagCombinations({ verbose: true })).not.toThrow();
			expect(() => validateFlagCombinations({ quiet: true })).not.toThrow();
			expect(() => validateFlagCombinations({ noColor: true })).not.toThrow();
		});

		it('should throw error for --quiet and --verbose together', () => {
			const flags: GlobalFlags = { quiet: true, verbose: true };
			expect(() => validateFlagCombinations(flags)).toThrow('Cannot use --quiet and --verbose together');
		});

		it('should not throw for --json and --verbose together', () => {
			// JSON mode takes precedence, but no error is thrown
			const flags: GlobalFlags = { json: true, verbose: true };
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should not throw for --json and --no-color together', () => {
			const flags: GlobalFlags = { json: true, noColor: true };
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should not throw for empty flags', () => {
			expect(() => validateFlagCombinations({})).not.toThrow();
		});

		it('should not throw when only one of quiet/verbose is set', () => {
			expect(() => validateFlagCombinations({ quiet: true, verbose: false })).not.toThrow();
			expect(() => validateFlagCombinations({ quiet: false, verbose: true })).not.toThrow();
		});
	});

	describe('Integration scenarios', () => {
		it('should handle JSON mode with all env vars set', () => {
			process.env.LEX_PR_JSON = '1';
			process.env.NO_COLOR = '1';
			process.env.LEX_PR_VERBOSE = '1';
			
			const flags = parseGlobalFlags({ json: true });
			expect(flags.json).toBe(true);
			expect(flags.noColor).toBe(true);
			expect(flags.verbose).toBe(true);
			
			// Should not throw despite verbose+json
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should handle typical CI/CD scenario (json + no-color via env)', () => {
			process.env.LEX_PR_JSON = '1';
			process.env.NO_COLOR = '1';
			
			const flags = parseGlobalFlags({});
			expect(flags.json).toBe(true);
			expect(flags.noColor).toBe(true);
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should handle typical local dev scenario (no flags)', () => {
			const flags = parseGlobalFlags({});
			expect(flags.json).toBeUndefined();
			expect(flags.noColor).toBeUndefined();
			expect(flags.verbose).toBeUndefined();
			expect(flags.quiet).toBe(false);
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should handle debug scenario (verbose only)', () => {
			const flags = parseGlobalFlags({ verbose: true });
			expect(flags.verbose).toBe(true);
			expect(flags.quiet).toBe(false);
			expect(() => validateFlagCombinations(flags)).not.toThrow();
		});

		it('should detect quiet+verbose conflict from mixed sources', () => {
			process.env.LEX_PR_VERBOSE = '1';
			const flags = parseGlobalFlags({ quiet: true });
			expect(flags.quiet).toBe(true);
			expect(flags.verbose).toBe(true);
			expect(() => validateFlagCombinations(flags)).toThrow();
		});
	});
});
