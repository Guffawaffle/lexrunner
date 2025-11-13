/**
 * PID/commit lock mechanism for re-entrant safety
 * Prevents concurrent runner executions on the same profile
 */

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';

export interface LockInfo {
	pid: number;
	commit: string;
	started: string;
	command: string;
	profile: string;
}

export class LockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LockError';
	}
}

/**
 * Runner lock for preventing concurrent executions
 */
export class RunnerLock {
	private lockFile: string;
	private lockDir: string;
	private profileDir: string;
	private acquired: boolean = false;

	constructor(profileDir: string) {
		this.profileDir = profileDir;
		this.lockDir = path.join(profileDir, 'runner', 'locks');
		this.lockFile = path.join(this.lockDir, 'runner.lock');
	}

	/**
	 * Check if a process is running
	 */
	private isProcessRunning(pid: number): boolean {
		try {
			// Signal 0 checks if process exists without actually sending a signal
			process.kill(pid, 0);
			return true;
		} catch (error) {
			// ESRCH means process doesn't exist
			return false;
		}
	}

	/**
	 * Get current git commit SHA
	 */
	private async getCurrentCommit(): Promise<string> {
		try {
			const git = simpleGit();
			const log = await git.log(['-1']);
			return log.latest?.hash?.substring(0, 7) || 'unknown';
		} catch (error) {
			return 'unknown';
		}
	}

	/**
	 * Acquire the lock
	 * @throws {LockError} if another runner is active
	 */
	async acquire(): Promise<void> {
		// Create locks directory
		fs.mkdirSync(this.lockDir, { recursive: true });

		// Check for existing lock
		if (fs.existsSync(this.lockFile)) {
			let lock: LockInfo;
			
			try {
				const content = fs.readFileSync(this.lockFile, 'utf-8');
				lock = JSON.parse(content);
			} catch (error) {
				// Corrupted lock file, remove it
				fs.unlinkSync(this.lockFile);
				return this.acquire(); // Retry
			}

			// Check if process still running
			if (this.isProcessRunning(lock.pid)) {
				throw new LockError(
					`Another runner is active (PID ${lock.pid}).\n` +
					`Started: ${lock.started}\n` +
					`Command: ${lock.command}\n` +
					`If stale, remove: ${this.lockFile}`
				);
			}

			// Stale lock, remove it
			fs.unlinkSync(this.lockFile);
		}

		// Create new lock
		const commit = await this.getCurrentCommit();
		const lockInfo: LockInfo = {
			pid: process.pid,
			commit,
			started: new Date().toISOString(),
			command: process.argv.join(' '),
			profile: this.profileDir,
		};

		fs.writeFileSync(this.lockFile, JSON.stringify(lockInfo, null, 2));
		this.acquired = true;
	}

	/**
	 * Release the lock
	 */
	release(): void {
		if (!this.acquired) {
			return;
		}

		try {
			if (fs.existsSync(this.lockFile)) {
				fs.unlinkSync(this.lockFile);
			}
		} catch (error) {
			// Best effort - log but don't throw
			console.warn(`Failed to release lock: ${error instanceof Error ? error.message : String(error)}`);
		}

		this.acquired = false;
	}

	/**
	 * Check if lock is currently acquired by this instance
	 */
	isAcquired(): boolean {
		return this.acquired;
	}

	/**
	 * Get lock file path
	 */
	getLockFile(): string {
		return this.lockFile;
	}
}

/**
 * Create a runner lock instance
 */
export function createRunnerLock(profileDir: string): RunnerLock {
	return new RunnerLock(profileDir);
}
