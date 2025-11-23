/**
 * WSL2-safe cleanup utilities for tests
 * 
 * WSL2 has issues with rapid temp directory creation/deletion and concurrent
 * child process spawning. These helpers mitigate those issues.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Safely remove a directory with retry logic for WSL2 file system delays
 */
export function safeRmSync(dirPath: string, maxRetries = 3): void {
	if (!fs.existsSync(dirPath)) {
		return;
	}

	for (let i = 0; i < maxRetries; i++) {
		try {
			fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			return;
		} catch (err: any) {
			if (i === maxRetries - 1) {
				// Last attempt failed, log but don't throw to avoid test pollution
				console.warn(`Failed to remove ${dirPath}: ${err.message}`);
				return;
			}
			// Wait before retry (WSL2 file system can be slow)
			const delay = (i + 1) * 100;
			const start = Date.now();
			while (Date.now() - start < delay) {
				// Busy wait (we're in a test cleanup, blocking is fine)
			}
		}
	}
}

/**
 * Ensure directory exists without triggering multiple mkdir calls
 */
export function safeMkdirSync(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}
