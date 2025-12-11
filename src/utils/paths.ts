/**
 * Path validation utilities for safe artifact handling
 *
 * Purpose: Prevent writes to PR artifact directories and validate output paths
 */

import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

/**
 * Normalize path for current platform
 * 
 * - Converts backslashes to forward slashes on POSIX
 * - Resolves relative paths to absolute
 * - Expands ~ to home directory
 * 
 * @param inputPath - Raw path
 * @returns - Normalized absolute path
 */
export function normalizePath(inputPath: string): string {
	let normalized = inputPath;
	
	// Expand ~ to home directory
	if (normalized.startsWith('~')) {
		normalized = path.join(os.homedir(), normalized.slice(1));
	}
	
	// Resolve to absolute path
	normalized = path.resolve(normalized);
	
	// Convert to forward slashes on POSIX (consistent with Git)
	if (process.platform !== 'win32') {
		normalized = normalized.replace(/\\/g, '/');
	}
	
	return normalized;
}

/**
 * Normalize path for cross-platform comparison (internal helper)
 * Just converts slashes without resolving paths
 * 
 * @param inputPath - Path to normalize
 * @returns Path with forward slashes
 */
function normalizePathForComparison(inputPath: string): string {
	return inputPath.replace(/\\/g, "/");
}

/**
 * Check if path is safe for artifact writes
 *
 * Rules:
 * - Allow: .smartergpt.local/deliverables/_session/
 * - Allow: .smartergpt.local/runner/logs/
 * - Allow: .smartergpt/deliverables/_session/
 * - Block: /PR-number/, /pr-number/, /artifacts/PR-star/
 *
 * @param inputPath - Path to check
 * @returns true if path is safe, throws error if blocked
 * @throws Error if path is in a blocked PR artifact directory
 */
export function isSafeArtifactPath(inputPath: string): boolean {
	const normalized = normalizePathForComparison(inputPath).toLowerCase();

	// Allowed patterns
	const allowedPatterns = [
		".smartergpt.local/deliverables/_session",
		".smartergpt.local/runner/logs",
		".smartergpt/deliverables/_session",
	];

	const isAllowed = allowedPatterns.some((pattern) =>
		normalized.includes(pattern.toLowerCase())
	);

	// Blocked patterns
	const blockedPatterns = [
		/\/pr-\d+/,
		/\\pr-\d+/,
		/\/artifacts\/pr-/,
		/\\artifacts\\pr-/,
	];

	const isBlocked = blockedPatterns.some((pattern) =>
		pattern.test(normalized)
	);

	if (isBlocked) {
		throw new Error(
			`SAFETY VIOLATION: Cannot write to PR artifact directory\n` +
				`Blocked path: ${inputPath}\n` +
				`Use .smartergpt.local/deliverables/_session/ instead`
		);
	}

	return isAllowed || !isBlocked;
}

/**
 * Ensure directory exists, creating it if necessary
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDir(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (error) {
		// Ignore EEXIST errors
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	}
}

/**
 * Check if path is a WSL path
 *
 * @param inputPath - Path to check
 * @returns true if path is a WSL path
 */
export function isWSLPath(inputPath: string): boolean {
	return inputPath.startsWith("/mnt/");
}

/**
 * Convert WSL path to Windows path
 *
 * @param wslPath - WSL path (e.g., /mnt/c/Users/...)
 * @returns Windows path (e.g., C:\Users\...)
 */
export function wslToWindowsPath(wslPath: string): string {
	if (!isWSLPath(wslPath)) {
		return wslPath;
	}

	const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
	if (!match) {
		return wslPath;
	}

	const drive = match[1].toUpperCase();
	const restPath = (match[2] || "\\").replace(/\//g, "\\");
	return `${drive}:${restPath}`;
}

/**
 * Convert Windows path to WSL path
 *
 * @param winPath - Windows path (e.g., C:\Users\...)
 * @returns WSL path (e.g., /mnt/c/Users/...)
 */
export function windowsToWSLPath(winPath: string): string {
	const match = winPath.match(/^([A-Z]):(\\.*)?$/);
	if (!match) {
		return winPath;
	}

	const drive = match[1].toLowerCase();
	const restPath = (match[2] || "").replace(/\\/g, "/");
	return `/mnt/${drive}${restPath}`;
}

/**
 * Validate output path before write
 *
 * Checks:
 * 1. Path is safe for artifact writes (not in PR directory)
 * 2. Parent directory exists or can be created
 *
 * @param outputPath - Output path to validate
 * @throws Error if path is unsafe or parent directory cannot be created
 */
export async function validateOutputPath(outputPath: string): Promise<void> {
	const normalized = normalizePath(outputPath);

	// Check safe artifact path rules
	isSafeArtifactPath(normalized);

	// Check parent directory exists or can be created
	const parentDir = path.dirname(normalized);

	try {
		await ensureDir(parentDir);
	} catch (error) {
		throw new Error(
			`Cannot create output directory: ${parentDir}\n` + `Error: ${error}`
		);
	}
}
