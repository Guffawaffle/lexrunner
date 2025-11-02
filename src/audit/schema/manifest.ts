/**
 * Audit manifest schema and validation (Phase 3A)
 */

import { z } from 'zod';

/**
 * Manifest file entry schema
 */
export const ManifestEntrySchema = z.object({
	file: z.string(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	bytes: z.number().int().nonnegative()
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * Audit manifest schema
 */
export const AuditManifestSchema = z.object({
	schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
	timestamp: z.string().datetime(),
	files: z.array(ManifestEntrySchema),
	totalBytes: z.number().int().nonnegative()
});
export type AuditManifest = z.infer<typeof AuditManifestSchema>;

/**
 * Parse and validate an audit manifest from unknown data
 *
 * @param data - Unknown data to validate
 * @returns Validated audit manifest
 * @throws ZodError if validation fails
 */
export function parseAuditManifest(data: unknown): AuditManifest {
	return AuditManifestSchema.parse(data);
}

/**
 * Validate an audit manifest (returns success/error instead of throwing)
 *
 * @param data - Unknown data to validate
 * @returns SafeParseReturnType with success flag and data or error
 */
export function validateAuditManifest(data: unknown) {
	return AuditManifestSchema.safeParse(data);
}
