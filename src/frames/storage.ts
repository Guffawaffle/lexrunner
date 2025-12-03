/**
 * Frame Storage
 *
 * Persists Frames to .lexrunner/frames/ directory for audit trail.
 * Implements AX-005: Frame emission for core workflows.
 *
 * AX Principle: Memory Is a Feature
 */

import * as fs from "fs";
import * as path from "path";
import type { ExecutionFrame, FrameEmitResult } from "./types.js";

/** Default frames directory relative to cwd */
const DEFAULT_FRAMES_DIR = ".lexrunner/frames";

/**
 * Get the frames directory path
 */
export function getFramesDir(baseDir: string = process.cwd()): string {
	return path.join(baseDir, DEFAULT_FRAMES_DIR);
}

/**
 * Ensure the frames directory exists
 */
export function ensureFramesDir(baseDir: string = process.cwd()): string {
	const framesDir = getFramesDir(baseDir);
	if (!fs.existsSync(framesDir)) {
		fs.mkdirSync(framesDir, { recursive: true });
	}
	return framesDir;
}

/**
 * Get the path for a Frame file
 */
export function getFramePath(frameId: string, baseDir: string = process.cwd()): string {
	const framesDir = getFramesDir(baseDir);
	return path.join(framesDir, `${frameId}.json`);
}

/**
 * Store a Frame to disk
 *
 * @param frame - The Frame to store
 * @param frameId - Unique identifier for the Frame (typically the reference_point)
 * @param baseDir - Base directory (defaults to cwd)
 * @returns Path to the stored Frame file
 */
export function storeFrame(
	frame: ExecutionFrame,
	frameId: string,
	baseDir: string = process.cwd()
): string {
	const framesDir = ensureFramesDir(baseDir);
	const framePath = getFramePath(frameId, baseDir);
	const tempPath = path.join(framesDir, `.${frameId}.tmp`);

	// Add timestamp if not present
	const frameWithTimestamp = {
		...frame,
		stored_at: new Date().toISOString(),
	};

	try {
		// Write to temp file
		fs.writeFileSync(tempPath, JSON.stringify(frameWithTimestamp, null, 2), "utf-8");
		// Atomic rename
		fs.renameSync(tempPath, framePath);
		return framePath;
	} catch (error) {
		// Clean up temp file on failure
		if (fs.existsSync(tempPath)) {
			fs.unlinkSync(tempPath);
		}
		throw error;
	}
}

/**
 * Store a Frame from FrameEmitResult
 *
 * Convenience function that extracts the Frame and frameId from a FrameEmitResult
 * and stores it to disk.
 *
 * @param result - The FrameEmitResult from an emit function
 * @param baseDir - Base directory (defaults to cwd)
 * @returns Path to the stored Frame file, or null if result was unsuccessful
 */
export function storeFrameResult(
	result: FrameEmitResult,
	baseDir: string = process.cwd()
): string | null {
	if (!result.success || !result.frame || !result.frameId) {
		return null;
	}

	return storeFrame(result.frame, result.frameId, baseDir);
}

/**
 * Read a Frame from disk
 *
 * @param frameId - The Frame identifier
 * @param baseDir - Base directory (defaults to cwd)
 * @returns The stored Frame, or null if not found
 */
export function readFrame(
	frameId: string,
	baseDir: string = process.cwd()
): (ExecutionFrame & { stored_at?: string }) | null {
	const framePath = getFramePath(frameId, baseDir);

	if (!fs.existsSync(framePath)) {
		return null;
	}

	const content = fs.readFileSync(framePath, "utf-8");
	return JSON.parse(content) as ExecutionFrame & { stored_at?: string };
}

/**
 * List all stored Frame IDs
 *
 * @param baseDir - Base directory (defaults to cwd)
 * @returns Array of Frame IDs
 */
export function listFrameIds(baseDir: string = process.cwd()): string[] {
	const framesDir = getFramesDir(baseDir);

	if (!fs.existsSync(framesDir)) {
		return [];
	}

	return fs.readdirSync(framesDir)
		.filter(file => file.endsWith(".json"))
		.map(file => file.slice(0, -5)) // Remove .json extension
		.sort();
}

/**
 * List all stored Frames
 *
 * @param baseDir - Base directory (defaults to cwd)
 * @returns Array of Frames with their IDs
 */
export function listFrames(
	baseDir: string = process.cwd()
): Array<ExecutionFrame & { stored_at?: string }> {
	const frameIds = listFrameIds(baseDir);
	const frames: Array<ExecutionFrame & { stored_at?: string }> = [];

	for (const id of frameIds) {
		const frame = readFrame(id, baseDir);
		if (frame) {
			frames.push(frame);
		}
	}

	return frames;
}

/**
 * Delete a Frame from disk
 *
 * @param frameId - The Frame identifier
 * @param baseDir - Base directory (defaults to cwd)
 * @returns true if deleted, false if not found
 */
export function deleteFrame(
	frameId: string,
	baseDir: string = process.cwd()
): boolean {
	const framePath = getFramePath(frameId, baseDir);

	if (!fs.existsSync(framePath)) {
		return false;
	}

	fs.unlinkSync(framePath);
	return true;
}
