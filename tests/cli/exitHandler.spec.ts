import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
	CLIExitSignal, 
	throwExit, 
	exitSuccess,
	formatError,
	installSignalHandlers,
	installUnhandledRejectionHandler
} from '../../src/cli/exitHandler.js';

describe('Exit Handler Utilities', () => {
	describe('CLIExitSignal', () => {
		it('should create signal with exit code', () => {
			const signal = new CLIExitSignal(2);
			expect(signal.exitCode).toBe(2);
			expect(signal.message).toBe('CLI exited with code 2');
		});

		it('should create signal with custom message', () => {
			const signal = new CLIExitSignal(1, 'Custom error message');
			expect(signal.exitCode).toBe(1);
			expect(signal.message).toBe('Custom error message');
		});

		it('should be instanceof Error', () => {
			const signal = new CLIExitSignal(1);
			expect(signal).toBeInstanceOf(Error);
		});
	});

	describe('throwExit()', () => {
		it('should throw CLIExitSignal with correct exit code', () => {
			expect(() => throwExit(2)).toThrow(CLIExitSignal);
			
			try {
				throwExit(2);
			} catch (error) {
				expect(error).toBeInstanceOf(CLIExitSignal);
				expect((error as CLIExitSignal).exitCode).toBe(2);
			}
		});

		it('should throw with custom message', () => {
			try {
				throwExit(1, 'Test error');
			} catch (error) {
				expect(error).toBeInstanceOf(CLIExitSignal);
				expect((error as CLIExitSignal).exitCode).toBe(1);
				expect((error as CLIExitSignal).message).toBe('Test error');
			}
		});

		it('should support exit code 0 for success', () => {
			try {
				throwExit(0);
			} catch (error) {
				expect(error).toBeInstanceOf(CLIExitSignal);
				expect((error as CLIExitSignal).exitCode).toBe(0);
			}
		});
	});

	describe('exitSuccess()', () => {
		it('should throw CLIExitSignal with exit code 0', () => {
			expect(() => exitSuccess()).toThrow(CLIExitSignal);
			
			try {
				exitSuccess();
			} catch (error) {
				expect(error).toBeInstanceOf(CLIExitSignal);
				expect((error as CLIExitSignal).exitCode).toBe(0);
			}
		});
	});

	describe('formatError()', () => {
		it('should format Error objects correctly', () => {
			const error = new Error('Test error message');
			const formatted = formatError(error);
			expect(formatted).toBe('Error: Test error message');
		});

		it('should format custom error classes', () => {
			class CustomError extends Error {
				constructor(message: string) {
					super(message);
					this.name = 'CustomError';
				}
			}
			const error = new CustomError('Custom message');
			const formatted = formatError(error);
			expect(formatted).toBe('CustomError: Custom message');
		});

		it('should format non-Error values as strings', () => {
			expect(formatError('string error')).toBe('string error');
			expect(formatError(42)).toBe('42');
			expect(formatError(null)).toBe('null');
			expect(formatError(undefined)).toBe('undefined');
		});

		it('should format objects without toString', () => {
			const obj = { error: 'details' };
			const formatted = formatError(obj);
			expect(formatted).toBe('[object Object]');
		});
	});

	describe('installSignalHandlers()', () => {
		let processExitSpy: ReturnType<typeof vi.spyOn>;
		let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
		let originalListeners: { SIGINT: NodeJS.SignalsListener[]; SIGTERM: NodeJS.SignalsListener[] };

		beforeEach(() => {
			// Save original listeners
			originalListeners = {
				SIGINT: process.listeners('SIGINT').slice() as NodeJS.SignalsListener[],
				SIGTERM: process.listeners('SIGTERM').slice() as NodeJS.SignalsListener[]
			};
			
			// Remove all existing listeners
			process.removeAllListeners('SIGINT');
			process.removeAllListeners('SIGTERM');
			
			// Spy on process.exit and console.error
			processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
			consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		});

		afterEach(() => {
			// Restore spies
			processExitSpy.mockRestore();
			consoleErrorSpy.mockRestore();
			
			// Remove test listeners
			process.removeAllListeners('SIGINT');
			process.removeAllListeners('SIGTERM');
			
			// Restore original listeners
			originalListeners.SIGINT.forEach(listener => process.on('SIGINT', listener));
			originalListeners.SIGTERM.forEach(listener => process.on('SIGTERM', listener));
		});

		it('should install SIGINT handler', () => {
			installSignalHandlers();
			
			const sigintListeners = process.listeners('SIGINT');
			expect(sigintListeners.length).toBeGreaterThan(0);
			
			// Emit SIGINT signal
			process.emit('SIGINT', 'SIGINT');
			
			expect(consoleErrorSpy).toHaveBeenCalledWith('\nReceived SIGINT, exiting gracefully...');
			expect(processExitSpy).toHaveBeenCalledWith(130); // 128 + SIGINT(2)
		});

		it('should install SIGTERM handler', () => {
			installSignalHandlers();
			
			const sigtermListeners = process.listeners('SIGTERM');
			expect(sigtermListeners.length).toBeGreaterThan(0);
			
			// Emit SIGTERM signal
			process.emit('SIGTERM', 'SIGTERM');
			
			expect(consoleErrorSpy).toHaveBeenCalledWith('\nReceived SIGTERM, exiting gracefully...');
			expect(processExitSpy).toHaveBeenCalledWith(143); // 128 + SIGTERM(15)
		});

		it('should use correct exit codes for signals', () => {
			installSignalHandlers();
			
			// Test SIGINT code
			process.emit('SIGINT', 'SIGINT');
			expect(processExitSpy).toHaveBeenLastCalledWith(130);
			
			processExitSpy.mockClear();
			
			// Test SIGTERM code
			process.emit('SIGTERM', 'SIGTERM');
			expect(processExitSpy).toHaveBeenLastCalledWith(143);
		});
	});

	describe('installUnhandledRejectionHandler()', () => {
		let processExitSpy: ReturnType<typeof vi.spyOn>;
		let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
		let originalListeners: NodeJS.UnhandledRejectionListener[];

		beforeEach(() => {
			// Save original listeners
			originalListeners = process.listeners('unhandledRejection').slice() as NodeJS.UnhandledRejectionListener[];
			
			// Remove all existing listeners
			process.removeAllListeners('unhandledRejection');
			
			// Spy on process.exit and console.error
			processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
			consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		});

		afterEach(() => {
			// Restore spies
			processExitSpy.mockRestore();
			consoleErrorSpy.mockRestore();
			
			// Remove test listeners
			process.removeAllListeners('unhandledRejection');
			
			// Restore original listeners
			originalListeners.forEach(listener => process.on('unhandledRejection', listener));
		});

		it('should install unhandledRejection handler', () => {
			installUnhandledRejectionHandler();
			
			const listeners = process.listeners('unhandledRejection');
			expect(listeners.length).toBeGreaterThan(0);
		});

		it('should handle unhandled promise rejections with Error', () => {
			installUnhandledRejectionHandler();
			
			const error = new Error('Async error');
			// Don't create an actual rejected promise - just emit the event
			const fakePromise = {} as Promise<any>;
			process.emit('unhandledRejection', error, fakePromise);
			
			expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled async error:', 'Error: Async error');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it('should handle unhandled promise rejections with string', () => {
			installUnhandledRejectionHandler();
			
			// Don't create an actual rejected promise - just emit the event
			const fakePromise = {} as Promise<any>;
			process.emit('unhandledRejection', 'String rejection', fakePromise);
			
			expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled async error:', 'String rejection');
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it('should exit with code 1 on unhandled rejection', () => {
			installUnhandledRejectionHandler();
			
			const fakePromise = {} as Promise<any>;
			process.emit('unhandledRejection', new Error('Test'), fakePromise);
			
			expect(processExitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe('Integration tests', () => {
		it('should provide consistent error handling flow', () => {
			// Simulate CLI error flow
			const errors = [
				new Error('Validation failed'),
				'String error',
				new CLIExitSignal(2, 'User error'),
			];

			errors.forEach(error => {
				if (error instanceof CLIExitSignal) {
					expect(error.exitCode).toBeGreaterThanOrEqual(0);
				} else {
					const formatted = formatError(error);
					expect(formatted).toBeTruthy();
					expect(typeof formatted).toBe('string');
				}
			});
		});

		it('should allow chaining exit patterns', () => {
			expect(() => {
				try {
					throwExit(2);
				} catch (error) {
					if (error instanceof CLIExitSignal) {
						// Re-throw or handle
						throw error;
					}
				}
			}).toThrow(CLIExitSignal);
		});
	});
});
