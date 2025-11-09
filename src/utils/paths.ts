/**
 * Path normalization and safety utilities
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Normalize path to use forward slashes and resolve relative paths
 */
export function normalizePath(p: string): string {
	return path.resolve(p).replace(/\\/g, '/');
}

/**
 * Ensure directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if path is safe for artifact writes (not in PR artifact directories)
 */
export function isSafeArtifactPath(p: string): boolean {
	const normalized = normalizePath(p);
	
	// Reject writes to PR artifact directories
	const unsafePatterns = [
		'/deliverables/pr-',
		'/.smartergpt/deliverables/pr-',
		'/.smartergpt.local/deliverables/pr-'
	];
	
	return !unsafePatterns.some(pattern => normalized.includes(pattern));
}
