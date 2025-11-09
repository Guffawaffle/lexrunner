/**
 * Path utilities for file operations
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Normalize a file path to an absolute path
 * Handles Windows, WSL, and Linux path formats
 * 
 * @param inputPath - The path to normalize
 * @param baseDir - Base directory for relative paths (default: current working directory)
 * @returns Absolute normalized path
 */
export function normalizePath(inputPath: string, baseDir: string = process.cwd()): string {
	if (path.isAbsolute(inputPath)) {
		return path.normalize(inputPath);
	}
	return path.resolve(baseDir, inputPath);
}

/**
 * Ensure a directory exists, creating it if necessary
 * Creates parent directories recursively
 * 
 * @param dirPath - The directory path to ensure exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a path is a safe artifact path
 * Rejects writes to PR artifact directories to prevent pollution
 * 
 * @param filePath - The file path to check
 * @returns true if the path is safe for writing artifacts
 */
export function isSafeArtifactPath(filePath: string): boolean {
	const normalized = path.normalize(filePath);
	
	// Reject writes to PR artifact directories
	const dangerousPatterns = [
		'/pr-',
		'\\pr-',
		'/PR-',
		'\\PR-'
	];
	
	for (const pattern of dangerousPatterns) {
		if (normalized.includes(pattern)) {
			return false;
		}
	}
	
	return true;
}
