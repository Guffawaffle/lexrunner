/**
 * Token usage logger - JSONL-based tracking for context analysis
 * Writes to .smartergpt.local/runner/logs/token-usage.jsonl (or profile-specific location)
 */

import * as fs from 'fs';
import * as path from 'path';
import { estimateTokens } from '../util/tokenEstimator.js';

export interface TokenUsageEntry {
	timestamp: string;
	operation: string;
	source: string;
	estimatedTokens: number;
	metadata?: Record<string, any>;
}

export interface TokenLoggerOptions {
	profileDir: string;
	enabled?: boolean;
}

/**
 * Token usage logger for structured JSONL logging
 */
export class TokenLogger {
	private logFilePath: string;
	private enabled: boolean;
	private logStream: fs.WriteStream | null = null;

	constructor(options: TokenLoggerOptions) {
		this.enabled = options.enabled !== false;

		// Create logs directory
		const logsDir = path.join(options.profileDir, 'runner', 'logs');
		if (this.enabled) {
			fs.mkdirSync(logsDir, { recursive: true });
		}

		this.logFilePath = path.join(logsDir, 'token-usage.jsonl');
	}

	/**
	 * Initialize log stream (lazy initialization)
	 */
	private ensureStream(): void {
		if (!this.enabled || this.logStream) {
			return;
		}

		this.logStream = fs.createWriteStream(this.logFilePath, {
			flags: 'a', // append mode
			encoding: 'utf8',
		});
	}

	/**
	 * Log a token usage entry
	 */
	log(
		operation: string,
		source: string,
		estimatedTokens: number,
		metadata?: Record<string, any>
	): void {
		if (!this.enabled) {
			return;
		}

		this.ensureStream();

		const entry: TokenUsageEntry = {
			timestamp: new Date().toISOString(),
			operation,
			source,
			estimatedTokens,
			...(metadata && { metadata }),
		};

		const line = JSON.stringify(entry) + '\n';
		this.logStream?.write(line);
	}

	/**
	 * Log token usage from text content
	 */
	logText(operation: string, source: string, text: string, metadata?: Record<string, any>): void {
		const tokens = estimateTokens(text);
		this.log(operation, source, tokens, metadata);
	}

	/**
	 * Log token usage from a file
	 */
	logFile(operation: string, filePath: string, metadata?: Record<string, any>): void {
		if (!this.enabled) {
			return;
		}

		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const tokens = estimateTokens(content);
			this.log(operation, filePath, tokens, metadata);
		} catch (error) {
			// File doesn't exist or can't be read - log 0 tokens
			this.log(operation, filePath, 0, {
				...metadata,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Close the log stream
	 */
	async close(): Promise<void> {
		if (this.logStream) {
			return new Promise((resolve, reject) => {
				this.logStream!.end((err?: Error) => {
					if (err) reject(err);
					else resolve();
				});
				this.logStream = null;
			});
		}
	}

	/**
	 * Get the path to the log file
	 */
	getLogFilePath(): string {
		return this.logFilePath;
	}
}

/**
 * Create a token logger instance
 */
export function createTokenLogger(options: TokenLoggerOptions): TokenLogger {
	return new TokenLogger(options);
}
