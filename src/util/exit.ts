/**
 * CLI Exit Signal and Utilities
 * 
 * Provides clean exit handling pattern using exceptions instead of process.exit().
 * This allows proper cleanup and testing of CLI commands.
 * 
 * See PR #154 for context on why we use throwExit() instead of process.exit().
 */

export class CLIExitSignal extends Error {
	exitCode: number;

	constructor(code: number, message?: string) {
		super(message ?? `CLI exited with code ${code}`);
		this.exitCode = code;
	}
}

/**
 * Throw a CLI exit signal with the given exit code.
 * Use this instead of process.exit() for clean error handling.
 * 
 * @param code - Exit code (0 for success, non-zero for failure)
 * @throws {CLIExitSignal}
 */
export const throwExit = (code: number): never => {
	throw new CLIExitSignal(code);
};
