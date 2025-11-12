/**
 * Lock file management for weave execution
 * Handles persistence and validation of execution state
 */

import * as fs from 'fs';
import * as path from 'path';
import { WeaveLockFile, WeaveContext } from './types.js';
import { canonicalJSONStringify } from '../util/canonicalJson.js';
import { sha256 } from '../util/hash.js';

const LOCK_FILE_SCHEMA_VERSION = '1.0.0';
const LOCK_FILE_NAME = 'weave-lock.json';

/**
 * Compute hash of plan + PR heads for validation
 */
export function computePlanHash(plan: any, prHeads: any[]): string {
	const planJson = canonicalJSONStringify(plan);
	const headsJson = canonicalJSONStringify(prHeads);
	const combined = `${planJson}:${headsJson}`;
	return sha256(Buffer.from(combined));
}

/**
 * Create lock file from execution context
 */
export function createLockFile(context: WeaveContext): WeaveLockFile {
	return {
		schemaVersion: LOCK_FILE_SCHEMA_VERSION,
		runId: context.runId,
		planHash: context.metadata.planHash,
		state: context.state,
		context,
		createdAt: context.startedAt,
		updatedAt: context.lastUpdatedAt
	};
}

/**
 * Write lock file to disk
 */
export function writeLockFile(
	lockFile: WeaveLockFile,
	workingDir: string = process.cwd()
): string {
	const lockFilePath = path.join(workingDir, LOCK_FILE_NAME);
	const content = canonicalJSONStringify(lockFile);
	
	fs.writeFileSync(lockFilePath, content, 'utf-8');
	
	return lockFilePath;
}

/**
 * Read lock file from disk
 */
export function readLockFile(
	workingDir: string = process.cwd()
): WeaveLockFile | null {
	const lockFilePath = path.join(workingDir, LOCK_FILE_NAME);
	
	if (!fs.existsSync(lockFilePath)) {
		return null;
	}
	
	try {
		const content = fs.readFileSync(lockFilePath, 'utf-8');
		const lockFile = JSON.parse(content) as WeaveLockFile;
		
		// Validate schema version
		if (lockFile.schemaVersion !== LOCK_FILE_SCHEMA_VERSION) {
			throw new Error(
				`Incompatible lock file version: ${lockFile.schemaVersion} ` +
				`(expected ${LOCK_FILE_SCHEMA_VERSION})`
			);
		}
		
		return lockFile;
	} catch (error) {
		throw new Error(
			`Failed to read lock file: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Validate lock file against current plan and PR heads
 */
export function validateLockFile(
	lockFile: WeaveLockFile,
	plan: any,
	prHeads: any[]
): { valid: boolean; reason?: string } {
	const currentHash = computePlanHash(plan, prHeads);
	
	if (lockFile.planHash !== currentHash) {
		return {
			valid: false,
			reason: 'Plan or PR heads have changed since lock file was created. ' +
				`Lock hash: ${lockFile.planHash}, current hash: ${currentHash}`
		};
	}
	
	return { valid: true };
}

/**
 * Delete lock file
 */
export function deleteLockFile(workingDir: string = process.cwd()): void {
	const lockFilePath = path.join(workingDir, LOCK_FILE_NAME);
	
	if (fs.existsSync(lockFilePath)) {
		fs.unlinkSync(lockFilePath);
	}
}

/**
 * Update lock file with new context
 */
export function updateLockFile(
	context: WeaveContext,
	workingDir: string = process.cwd()
): string {
	const lockFile = createLockFile(context);
	lockFile.updatedAt = new Date().toISOString();
	return writeLockFile(lockFile, workingDir);
}

/**
 * Check if lock file exists
 */
export function lockFileExists(workingDir: string = process.cwd()): boolean {
	const lockFilePath = path.join(workingDir, LOCK_FILE_NAME);
	return fs.existsSync(lockFilePath);
}

/**
 * Get lock file path
 */
export function getLockFilePath(workingDir: string = process.cwd()): string {
	return path.join(workingDir, LOCK_FILE_NAME);
}

/**
 * Load execution context from lock file for resume
 */
export function loadContextFromLockFile(
	plan: any,
	prHeads: any[],
	workingDir: string = process.cwd()
): { context: WeaveContext; valid: boolean; reason?: string } {
	const lockFile = readLockFile(workingDir);
	
	if (!lockFile) {
		return {
			context: null as any,
			valid: false,
			reason: 'Lock file not found'
		};
	}
	
	const validation = validateLockFile(lockFile, plan, prHeads);
	
	if (!validation.valid) {
		return {
			context: null as any,
			valid: false,
			reason: validation.reason
		};
	}
	
	return {
		context: lockFile.context,
		valid: true
	};
}

/**
 * Create a clean lock file for a new execution
 */
export function initializeLockFile(
	context: WeaveContext,
	workingDir: string = process.cwd()
): string {
	// Delete any existing lock file
	deleteLockFile(workingDir);
	
	// Create new lock file
	return writeLockFile(createLockFile(context), workingDir);
}
