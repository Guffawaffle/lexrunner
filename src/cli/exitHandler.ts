/**
 * Exit handler utilities for CLI
 * Centralizes all exit behavior, signal handling, and error formatting
 */

/**
 * Custom error class for CLI exits
 * Used to propagate exit codes without calling process.exit() directly
 */
export class CLIExitSignal extends Error {
	exitCode: number;

	constructor(code: number, message?: string) {
		super(message ?? `CLI exited with code ${code}`);
		this.exitCode = code;
	}
}

/**
 * Exit with error message to stderr.
 * Throws CLIExitSignal which should be caught by the main error handler.
 * 
 * @param code - Exit code (0 = success, 1 = system error, 2 = user error)
 * @param message - Optional error message
 */
export function throwExit(code: number, message?: string): never {
	throw new CLIExitSignal(code, message);
}

/**
 * Exit with success (code 0).
 */
export function exitSuccess(): never {
	throw new CLIExitSignal(0);
}

/**
 * Format error for stderr output.
 * Returns a human-readable error message.
 * 
 * @param error - Error to format
 * @returns Formatted error string
 */
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
}

/**
 * Install global signal handlers for clean exits.
 * Handles SIGINT (Ctrl+C) and SIGTERM (termination signal).
 * Exits with standard codes: 130 for SIGINT, 143 for SIGTERM.
 */
export function installSignalHandlers(): void {
	process.on('SIGINT', () => {
		console.error('\nReceived SIGINT, exiting gracefully...');
		process.exit(130); // 128 + SIGINT(2)
	});

	process.on('SIGTERM', () => {
		console.error('\nReceived SIGTERM, exiting gracefully...');
		process.exit(143); // 128 + SIGTERM(15)
	});
}

/**
 * Install global unhandledRejection handler.
 * Catches async errors that are not properly handled.
 * Addresses Issue #158.
 */
export function installUnhandledRejectionHandler(): void {
	process.on('unhandledRejection', (reason: unknown) => {
		console.error('Unhandled async error:', formatError(reason));
		process.exit(1);
	});
}

