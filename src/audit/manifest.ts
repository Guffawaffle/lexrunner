/**
 * Audit manifest generation
 */

import * as fs from 'fs';
import * as path from 'path';
import { sha256FileRaw } from '../util/hash.js';
import { AuditContext } from './context.js';

export interface AuditManifestEntry {
	file: string;
	sha256: string;
	bytes: number;
}

export interface AuditManifest {
	schemaVersion: string;
	timestamp: string;
	files: AuditManifestEntry[];
	totalBytes: number;
	ciContext?: AuditContext;
}

/**
 * Generate manifest for audit directory
 */
export async function generateManifest(
	auditDir: string,
	ciContext?: AuditContext
): Promise<AuditManifest> {
	const files: AuditManifestEntry[] = [];
	let totalBytes = 0;

	// List all files in audit directory
	const entries = fs.readdirSync(auditDir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile() && entry.name !== 'audit-manifest.json') {
			const filePath = path.join(auditDir, entry.name);
			const stats = fs.statSync(filePath);
			const hash = sha256FileRaw(filePath);

			files.push({
				file: entry.name,
				sha256: hash,
				bytes: stats.size
			});

			totalBytes += stats.size;
		}
	}

	// Sort files for deterministic output
	files.sort((a, b) => a.file.localeCompare(b.file));

	const manifest: AuditManifest = {
		schemaVersion: '1.0.0',
		timestamp: new Date().toISOString(),
		files,
		totalBytes
	};

	// Include CI context if provided
	if (ciContext) {
		manifest.ciContext = ciContext;
	}

	return manifest;
}

/**
 * Write manifest to file
 */
export async function writeManifest(auditDir: string, manifest: AuditManifest): Promise<string> {
	const manifestPath = path.join(auditDir, 'audit-manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return manifestPath;
}
