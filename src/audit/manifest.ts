/**
 * Audit manifest generation
 */

import * as fs from 'fs';
import * as path from 'path';
import { sha256FileRaw } from '../util/hash.js';

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
}

/**
 * Generate manifest for audit directory
 */
export async function generateManifest(auditDir: string): Promise<AuditManifest> {
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

	return {
		schemaVersion: '1.0.0',
		timestamp: new Date().toISOString(),
		files,
		totalBytes
	};
}

/**
 * Write manifest to file
 */
export async function writeManifest(auditDir: string, manifest: AuditManifest): Promise<string> {
	const manifestPath = path.join(auditDir, 'audit-manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return manifestPath;
}
