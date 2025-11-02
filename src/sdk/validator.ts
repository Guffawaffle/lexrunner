/**
 * Validation utilities for audit SDK (Phase 3A)
 */

import { validateAuditManifest as zodValidateManifest, parseAuditManifest } from '../audit/schema/manifest.js';
import { validateAuditEvent as zodValidateEvent, parseAuditEvent } from '../audit/schema/events.js';
import type { AuditManifest } from '../audit/schema/manifest.js';
import type { AuditEvent } from '../audit/schema/events.js';

/**
 * Validate an audit manifest
 * 
 * @param manifest - Manifest object to validate
 * @returns Validated audit manifest
 * @throws ZodError if validation fails
 * 
 * @example
 * ```typescript
 * const manifest = JSON.parse(fs.readFileSync('./audit-manifest.json', 'utf8'));
 * const validated = validateAuditManifest(manifest);
 * console.log(`Total bytes: ${validated.totalBytes}`);
 * ```
 */
export function validateAuditManifest(manifest: unknown): AuditManifest {
	return parseAuditManifest(manifest);
}

/**
 * Validate an audit manifest (safe version that returns result object)
 * 
 * @param manifest - Manifest object to validate
 * @returns Validation result with success flag
 * 
 * @example
 * ```typescript
 * const result = validateAuditManifestSafe(manifest);
 * if (result.success) {
 *   console.log('Valid manifest:', result.data);
 * } else {
 *   console.error('Validation errors:', result.error);
 * }
 * ```
 */
export function validateAuditManifestSafe(manifest: unknown) {
	return zodValidateManifest(manifest);
}

/**
 * Validate a single audit event
 * 
 * @param event - Event object to validate
 * @returns Validated audit event
 * @throws ZodError if validation fails
 */
export function validateAuditEvent(event: unknown): AuditEvent {
	return parseAuditEvent(event);
}

/**
 * Validate a single audit event (safe version that returns result object)
 * 
 * @param event - Event object to validate
 * @returns Validation result with success flag
 */
export function validateAuditEventSafe(event: unknown) {
	return zodValidateEvent(event);
}

/**
 * Check if a schema version is compatible with a given major version
 * 
 * @param schemaVersion - Version string (e.g., "1.2.3")
 * @param majorVersion - Major version to check compatibility (default: 1)
 * @returns true if compatible, false otherwise
 * 
 * @example
 * ```typescript
 * if (!isSchemaCompatible(event.schema_version, 1)) {
 *   console.warn(`Incompatible schema version: ${event.schema_version}`);
 * }
 * ```
 */
export function isSchemaCompatible(schemaVersion: string, majorVersion: number = 1): boolean {
	const match = schemaVersion.match(/^(\d+)\.\d+\.\d+$/);
	if (!match) {
		return false;
	}
	const major = parseInt(match[1], 10);
	return major === majorVersion;
}

/**
 * Validate multiple audit events
 * 
 * @param events - Array of event objects to validate
 * @returns Array of validated audit events
 * @throws ZodError if any validation fails
 */
export function validateAuditEvents(events: unknown[]): AuditEvent[] {
	return events.map(event => validateAuditEvent(event));
}

/**
 * Validate multiple audit events (safe version)
 * 
 * @param events - Array of event objects to validate
 * @returns Validation results with success/failure for each event
 */
export function validateAuditEventsSafe(events: unknown[]) {
	return events.map(event => zodValidateEvent(event));
}
