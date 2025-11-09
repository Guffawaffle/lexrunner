/**
 * Path validation utilities for safe artifact handling
 * 
 * Purpose: Prevent writes to PR artifact directories and validate output paths
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Normalize path for cross-platform comparison
 * 
 * @param inputPath - Path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePath(inputPath: string): string {
return inputPath.replace(/\\/g, '/');
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
const normalized = normalizePath(inputPath).toLowerCase();

// Allowed patterns
const allowedPatterns = [
'.smartergpt.local/deliverables/_session',
'.smartergpt.local/runner/logs',
'.smartergpt/deliverables/_session'
];

const isAllowed = allowedPatterns.some(pattern => 
normalized.includes(pattern.toLowerCase())
);

// Blocked patterns
const blockedPatterns = [
/\/pr-\d+/,
/\\pr-\d+/,
/\/artifacts\/pr-/,
/\\artifacts\\pr-/
];

const isBlocked = blockedPatterns.some(pattern => pattern.test(normalized));

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
async function ensureDir(dirPath: string): Promise<void> {
try {
await fs.mkdir(dirPath, { recursive: true });
} catch (error) {
// Ignore EEXIST errors
if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
throw error;
}
}
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
`Cannot create output directory: ${parentDir}\n` +
`Error: ${error}`
);
}
}
