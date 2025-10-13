import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeJsonOutput, formatHumanOutput, writeOutput } from '../../src/cli/output.js';
import { canonicalJSONStringify } from '../../src/util/canonicalJson.js';

describe('CLI Output Utilities', () => {
	// Store original stdout.write and console.error
	let stdoutWriteSpy: any;
	let consoleErrorSpy: any;
	let processExitSpy: any;

	beforeEach(() => {
		stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
			throw new Error(`process.exit(${code})`);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('writeJsonOutput()', () => {
		it('should output valid JSON to stdout', () => {
			const data = { status: 'ok', count: 42 };
			writeJsonOutput(data);

			expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
			const output = stdoutWriteSpy.mock.calls[0][0];
			
			// Should be valid JSON
			expect(() => JSON.parse(output)).not.toThrow();
			
			// Should match canonical format
			expect(output).toBe(canonicalJSONStringify(data));
		});

		it('should handle complex nested objects', () => {
			const data = {
				schemaVersion: '1.0.0',
				items: [
					{ id: 'item-1', deps: [] },
					{ id: 'item-2', deps: ['item-1'] }
				],
				metadata: {
					z: 'last',
					a: 'first'
				}
			};
			
			writeJsonOutput(data);

			expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
			const output = stdoutWriteSpy.mock.calls[0][0];
			
			// Should have sorted keys
			expect(output).toMatch(/"a".*"z"/s);
			expect(output).toMatch(/"items".*"metadata".*"schemaVersion"/s);
		});

		it('should handle circular references gracefully', () => {
			const circular: any = { a: 1 };
			circular.self = circular;

			// Should not throw, but should exit with error
			expect(() => writeJsonOutput(circular)).toThrow('process.exit(1)');
			
			// Should log error to stderr
			expect(consoleErrorSpy).toHaveBeenCalled();
			expect(consoleErrorSpy.mock.calls[0][0]).toContain('Error serializing JSON');
		});

		it('should handle primitives', () => {
			writeJsonOutput(42);
			expect(stdoutWriteSpy.mock.calls[0][0]).toBe('42\n');

			stdoutWriteSpy.mockClear();
			writeJsonOutput('hello');
			expect(stdoutWriteSpy.mock.calls[0][0]).toBe('"hello"\n');

			stdoutWriteSpy.mockClear();
			writeJsonOutput(true);
			expect(stdoutWriteSpy.mock.calls[0][0]).toBe('true\n');

			stdoutWriteSpy.mockClear();
			writeJsonOutput(null);
			expect(stdoutWriteSpy.mock.calls[0][0]).toBe('null\n');
		});

		it('should write errors to stderr, not stdout', () => {
			const circular: any = { a: 1 };
			circular.self = circular;

			expect(() => writeJsonOutput(circular)).toThrow('process.exit(1)');
			
			// Error message should go to stderr
			expect(consoleErrorSpy).toHaveBeenCalled();
			
			// Should not write to stdout for error case
			expect(stdoutWriteSpy).not.toHaveBeenCalled();
		});
	});

	describe('formatHumanOutput()', () => {
		it('should format data as JSON string by default', () => {
			const data = { status: 'ok', count: 42 };
			const result = formatHumanOutput(data);
			
			expect(() => JSON.parse(result)).not.toThrow();
			const parsed = JSON.parse(result);
			expect(parsed).toEqual(data);
		});

		it('should support plain format explicitly', () => {
			const data = { test: 'value' };
			const result = formatHumanOutput(data, 'plain');
			
			expect(() => JSON.parse(result)).not.toThrow();
			expect(JSON.parse(result)).toEqual(data);
		});

		it('should support table format (placeholder)', () => {
			const data = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
			const result = formatHumanOutput(data, 'table');
			
			// For now, just returns JSON
			expect(() => JSON.parse(result)).not.toThrow();
		});

		it('should support tree format (placeholder)', () => {
			const data = { root: { child1: {}, child2: {} } };
			const result = formatHumanOutput(data, 'tree');
			
			// For now, just returns JSON
			expect(() => JSON.parse(result)).not.toThrow();
		});
	});

	describe('writeOutput()', () => {
		let consoleLogSpy: any;

		beforeEach(() => {
			consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		});

		it('should write JSON when json flag is true', () => {
			const data = { status: 'ok' };
			writeOutput(data, { json: true });

			expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
			expect(consoleLogSpy).not.toHaveBeenCalled();
			
			const output = stdoutWriteSpy.mock.calls[0][0];
			expect(output).toBe(canonicalJSONStringify(data));
		});

		it('should write human-readable when json flag is false', () => {
			const data = { status: 'ok' };
			writeOutput(data, { json: false });

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			expect(stdoutWriteSpy).not.toHaveBeenCalled();
		});

		it('should write human-readable when json flag is undefined', () => {
			const data = { status: 'ok' };
			writeOutput(data, {});

			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
			expect(stdoutWriteSpy).not.toHaveBeenCalled();
		});

		it('should handle complex data in both modes', () => {
			const data = {
				items: [{ id: 1 }, { id: 2 }],
				metadata: { count: 2 }
			};

			// JSON mode
			writeOutput(data, { json: true });
			expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
			
			stdoutWriteSpy.mockClear();
			consoleLogSpy.mockClear();

			// Human mode
			writeOutput(data, { json: false });
			expect(consoleLogSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('Integration with canonicalJSONStringify', () => {
		it('should produce deterministic output across multiple calls', () => {
			const data = {
				z: 'last',
				a: 'first',
				items: [3, 1, 2]
			};

			writeJsonOutput(data);
			const output1 = stdoutWriteSpy.mock.calls[0][0];

			stdoutWriteSpy.mockClear();
			writeJsonOutput(data);
			const output2 = stdoutWriteSpy.mock.calls[0][0];

			expect(output1).toBe(output2);
		});

		it('should maintain trailing newline', () => {
			const data = { test: 'value' };
			writeJsonOutput(data);

			const output = stdoutWriteSpy.mock.calls[0][0];
			expect(output.endsWith('\n')).toBe(true);
		});
	});
});
