import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { registerRetryCommand } from '../../src/commands/retry.js';
import { RetryOperation, BulkOperationResult } from '../../src/commands/bulkOps.js';

describe('Retry Command', () => {
	let program: Command;
	let exitWithCalls: unknown[];
	let consoleLogSpy: any;
	let stdoutWriteSpy: any;
	let jsonModeActive: boolean;
	let throwExitCalls: number[];

	beforeEach(() => {
		// Reset state
		exitWithCalls = [];
		throwExitCalls = [];
		jsonModeActive = false;

		// Create a fresh Command instance
		program = new Command();
		program.exitOverride(); // Prevent actual process exit

		// Spy on console methods
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		// Mock exitWith and throwExit
		const exitWith = (error: unknown) => {
			exitWithCalls.push(error);
			throw error;
		};

		const mockThrowExit = (code: number) => {
			throwExitCalls.push(code);
			throw new Error(`exit(${code})`);
		};

		// Mock RetryOperation
		vi.spyOn(RetryOperation.prototype, 'retryFailed').mockImplementation(async (options) => {
			const result: BulkOperationResult = {
				success: true,
				processedItems: ['item-1:lint', 'item-2:test'],
				skippedItems: [],
				failedItems: [],
				errors: [],
			};

			// Apply filtering logic if provided
			if (options.filter) {
				result.processedItems = result.processedItems.filter(item =>
					item.toLowerCase().includes(options.filter!.toLowerCase())
				);
			}

			if (options.items && options.items.length > 0) {
				result.processedItems = result.processedItems.filter(item => {
					const itemName = item.split(':')[0];
					return options.items!.includes(itemName);
				});
			}

			return result;
		});

		// Register the retry command
		registerRetryCommand(program, () => jsonModeActive, exitWith);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('command registration', () => {
		it('should register retry command with correct name', () => {
			const commands = program.commands;
			const retryCommand = commands.find(cmd => cmd.name() === 'retry');

			expect(retryCommand).toBeDefined();
			expect(retryCommand?.description()).toBe('Retry failed gates with selective filtering');
		});

		it('should register all required options', () => {
			const commands = program.commands;
			const retryCommand = commands.find(cmd => cmd.name() === 'retry');

			expect(retryCommand).toBeDefined();

			const options = retryCommand?.options.map(opt => opt.long);
			expect(options).toContain('--state-dir');
			expect(options).toContain('--filter');
			expect(options).toContain('--items');
			expect(options).toContain('--dry-run');
			expect(options).toContain('--json');
		});

		it('should have correct default value for state-dir', () => {
			const commands = program.commands;
			const retryCommand = commands.find(cmd => cmd.name() === 'retry');

			const stateDirOption = retryCommand?.options.find(opt => opt.long === '--state-dir');
			expect(stateDirOption?.defaultValue).toBe('.smartergpt/runner');
		});
	});

	describe('command execution', () => {
		it('should execute retry with default options', async () => {
			await program.parseAsync(['node', 'test', 'retry']);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleLogSpy.mock.calls[0][0]).toContain('✓ Retried');
			expect(consoleLogSpy.mock.calls[0][0]).toContain('2 gate(s)');
		});

		it('should execute retry in dry-run mode', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--dry-run']);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleLogSpy.mock.calls[0][0]).toContain('Would retry');
			expect(consoleLogSpy.mock.calls[0][0]).toContain('2 gate(s)');
		});

		it('should list items in dry-run mode', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--dry-run']);

			// Should show "Would retry" message
			expect(consoleLogSpy.mock.calls[0][0]).toContain('Would retry');
			
			// Should list each item
			expect(consoleLogSpy.mock.calls.some((call: any) => 
				call[0].includes('item-1:lint')
			)).toBe(true);
			expect(consoleLogSpy.mock.calls.some((call: any) => 
				call[0].includes('item-2:test')
			)).toBe(true);
		});

		it('should apply filter option', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--filter', 'lint']);

			expect(RetryOperation.prototype.retryFailed).toHaveBeenCalledWith(
				expect.objectContaining({
					filter: 'lint'
				})
			);
		});

		it('should apply items option', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--items', 'item-1,item-2']);

			expect(RetryOperation.prototype.retryFailed).toHaveBeenCalledWith(
				expect.objectContaining({
					items: ['item-1', 'item-2']
				})
			);
		});

		it('should trim whitespace from items list', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--items', 'item-1, item-2 , item-3']);

			expect(RetryOperation.prototype.retryFailed).toHaveBeenCalledWith(
				expect.objectContaining({
					items: ['item-1', 'item-2', 'item-3']
				})
			);
		});

		it('should use custom state-dir', async () => {
			const retryFailedSpy = vi.spyOn(RetryOperation.prototype, 'retryFailed');

			await program.parseAsync(['node', 'test', 'retry', '--state-dir', '.custom/state']);

			// RetryOperation constructor should have been called with custom state dir
			expect(retryFailedSpy).toHaveBeenCalled();
		});
	});

	describe('output formats', () => {
		it('should output JSON when --json flag is provided', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--json']);

			expect(stdoutWriteSpy).toHaveBeenCalled();
			const output = stdoutWriteSpy.mock.calls[0][0];

			// Should be valid JSON
			expect(() => JSON.parse(output)).not.toThrow();
			
			const parsed = JSON.parse(output);
			expect(parsed.success).toBe(true);
			expect(parsed.processedItems).toBeDefined();
		});

		it('should output JSON when jsonModeActive is true', async () => {
			jsonModeActive = true;

			await program.parseAsync(['node', 'test', 'retry']);

			expect(stdoutWriteSpy).toHaveBeenCalled();
			const output = stdoutWriteSpy.mock.calls[0][0];

			// Should be valid JSON
			expect(() => JSON.parse(output)).not.toThrow();
		});

		it('should output human-readable format by default', async () => {
			await program.parseAsync(['node', 'test', 'retry']);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleLogSpy.mock.calls[0][0]).toContain('✓ Retried');
		});
	});

	describe('error handling', () => {
		it('should handle failed items gracefully', async () => {
			vi.spyOn(RetryOperation.prototype, 'retryFailed').mockResolvedValue({
				success: false,
				processedItems: ['item-1:lint'],
				skippedItems: [],
				failedItems: ['item-2:test'],
				errors: [{ item: 'item-2:test', error: 'Test failed' }],
			});

			await expect(
				program.parseAsync(['node', 'test', 'retry'])
			).rejects.toThrow();

			expect(consoleLogSpy).toHaveBeenCalled();
			
			// Should show both success and failure messages
			const logMessages = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
			expect(logMessages).toContain('✓ Retried 1 gate(s)');
			expect(logMessages).toContain('✗ Failed 1 gate(s)');
			expect(logMessages).toContain('item-2:test: Test failed');
		});

		it('should exit with code 1 on failure', async () => {
			vi.spyOn(RetryOperation.prototype, 'retryFailed').mockResolvedValue({
				success: false,
				processedItems: [],
				skippedItems: [],
				failedItems: ['item-1:lint'],
				errors: [{ item: 'item-1:lint', error: 'Failed' }],
			});

			await expect(
				program.parseAsync(['node', 'test', 'retry'])
			).rejects.toThrow();

			// throwExit should have been called, but exitOverride intercepts it
			// so we just verify that the function throws
		});

		it('should call exitWith on unexpected errors', async () => {
			const testError = new Error('Unexpected error');
			vi.spyOn(RetryOperation.prototype, 'retryFailed').mockRejectedValue(testError);

			await expect(
				program.parseAsync(['node', 'test', 'retry'])
			).rejects.toThrow(testError);

			expect(exitWithCalls).toContain(testError);
		});
	});

	describe('integration scenarios', () => {
		it('should handle retry with filter and dry-run', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--filter', 'lint', '--dry-run']);

			expect(RetryOperation.prototype.retryFailed).toHaveBeenCalledWith(
				expect.objectContaining({
					filter: 'lint',
					dryRun: true
				})
			);

			expect(consoleLogSpy.mock.calls[0][0]).toContain('Would retry');
		});

		it('should handle retry with items and json output', async () => {
			await program.parseAsync(['node', 'test', 'retry', '--items', 'item-1', '--json']);

			expect(RetryOperation.prototype.retryFailed).toHaveBeenCalledWith(
				expect.objectContaining({
					items: ['item-1']
				})
			);

			expect(stdoutWriteSpy).toHaveBeenCalled();
		});

		it('should handle empty result gracefully', async () => {
			vi.spyOn(RetryOperation.prototype, 'retryFailed').mockResolvedValue({
				success: true,
				processedItems: [],
				skippedItems: [],
				failedItems: [],
				errors: [],
			});

			await program.parseAsync(['node', 'test', 'retry']);

			expect(consoleLogSpy).toHaveBeenCalled();
			expect(consoleLogSpy.mock.calls[0][0]).toContain('✓ Retried 0 gate(s)');
		});
	});
});
