/**
 * JSON Envelope Utilities
 * Standardized JSON output format for all CLI commands
 * 
 * This module provides consistent JSON envelope structures for success and error responses
 * across all LexRunner CLI commands, making it easier for AI agents and scripts to parse
 * command outputs reliably.
 */

import { canonicalJSONStringify } from "../util/canonicalJson.js";

/**
 * Metadata included in all JSON responses
 */
export interface JsonMeta {
	command: string;
	timestamp: string;
	version: string;
}

/**
 * Error details structure
 */
export interface JsonError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

/**
 * Success envelope structure
 */
export interface JsonSuccessEnvelope<T = unknown> {
	success: true;
	data: T;
	meta: JsonMeta;
}

/**
 * Error envelope structure
 */
export interface JsonErrorEnvelope {
	success: false;
	error: JsonError;
	meta: JsonMeta;
}

/**
 * Union type for all JSON envelopes
 */
export type JsonEnvelope<T = unknown> = JsonSuccessEnvelope<T> | JsonErrorEnvelope;

/**
 * Get the current CLI version
 */
function getVersion(): string {
	// Version is hardcoded in cli.ts for now
	// TODO: Read from package.json or build-time constant
	return "0.5.0";
}

/**
 * Create metadata for JSON envelope
 */
function createMeta(command: string): JsonMeta {
	return {
		command,
		timestamp: new Date().toISOString(),
		version: getVersion(),
	};
}

/**
 * Create a success JSON envelope
 * 
 * @param command - Command name (e.g., "weave discover", "weave plan")
 * @param data - Command-specific payload
 * @returns Standardized success envelope
 */
export function createSuccessEnvelope<T = unknown>(
	command: string,
	data: T
): JsonSuccessEnvelope<T> {
	return {
		success: true,
		data,
		meta: createMeta(command),
	};
}

/**
 * Create an error JSON envelope
 * 
 * @param command - Command name (e.g., "weave discover", "weave plan")
 * @param error - Error code and details
 * @returns Standardized error envelope
 */
export function createErrorEnvelope(
	command: string,
	error: JsonError
): JsonErrorEnvelope {
	return {
		success: false,
		error,
		meta: createMeta(command),
	};
}

/**
 * Write a success envelope to stdout
 * 
 * @param command - Command name
 * @param data - Command-specific payload
 */
export function writeSuccessEnvelope<T = unknown>(
	command: string,
	data: T
): void {
	const envelope = createSuccessEnvelope(command, data);
	process.stdout.write(canonicalJSONStringify(envelope) + "\n");
}

/**
 * Write an error envelope to stdout
 * 
 * @param command - Command name
 * @param error - Error details
 */
export function writeErrorEnvelope(
	command: string,
	error: JsonError
): void {
	const envelope = createErrorEnvelope(command, error);
	process.stdout.write(canonicalJSONStringify(envelope) + "\n");
}

/**
 * Convert an Error object to JsonError format
 * 
 * @param error - Error object or unknown error
 * @param code - Optional error code (defaults to EUNKNOWN)
 * @returns JsonError structure
 */
export function errorToJsonError(
	error: unknown,
	code: string = "EUNKNOWN"
): JsonError {
	if (error instanceof Error) {
		return {
			code,
			message: error.message,
			details: {
				name: error.name,
				stack: error.stack,
			},
		};
	}
	
	return {
		code,
		message: String(error),
		details: {},
	};
}
