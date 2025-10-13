/**
 * Audit SDK for gates to emit audit events via the sidecar pattern
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
	AuditSDK,
	AuditLevel,
	VulnerabilitySeverity,
	TestStatus,
	VulnFoundPayload,
	AuditEvent
} from './types.js';

/**
 * No-op implementation when audit environment is not configured
 */
class NoOpAuditSDK implements AuditSDK {
	async emit(_event: string, _payload: any, _level?: AuditLevel): Promise<void> {
		// No-op
	}

	async emitVuln(_cve: string, _severity: VulnerabilitySeverity, _details?: Partial<VulnFoundPayload>): Promise<void> {
		// No-op
	}

	async emitTestResult(_name: string, _status: TestStatus, _duration_ms?: number): Promise<void> {
		// No-op
	}

	async close(): Promise<void> {
		// No-op
	}
}

/**
 * Active audit SDK implementation that writes to sidecar files
 */
class ActiveAuditSDK implements AuditSDK {
	private stream: fs.WriteStream;
	private gateName: string;

	constructor(gateName: string, sidecarPath: string) {
		this.gateName = gateName;
		// Open stream in append mode
		this.stream = fs.createWriteStream(sidecarPath, { flags: 'a' });
	}

	async emit(event: string, payload: any, level: AuditLevel = 'info'): Promise<void> {
		const auditEvent: AuditEvent = {
			event,
			ts: new Date().toISOString(),
			level,
			gate: this.gateName,
			payload
		};

		const line = JSON.stringify(auditEvent) + '\n';
		
		// Write to stream (this is async but we use callback to ensure it's written)
		return new Promise((resolve, reject) => {
			this.stream.write(line, (err) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	async emitVuln(cve: string, severity: VulnerabilitySeverity, details?: Partial<VulnFoundPayload>): Promise<void> {
		const payload: VulnFoundPayload = {
			cve,
			severity,
			...details
		};
		await this.emit('vuln_found', payload, 'warn');
	}

	async emitTestResult(name: string, status: TestStatus, duration_ms?: number): Promise<void> {
		const payload = {
			name,
			status,
			...(duration_ms !== undefined && { duration_ms })
		};
		await this.emit('test_result', payload);
	}

	async close(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.stream.end((err?: Error) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}
}

/**
 * Initialize the Audit SDK for a gate
 * 
 * Reads LEX_AUDIT_DROP_DIR and LEX_AUDIT_SESSION_ID from environment.
 * If not set, returns a no-op implementation (gate runs standalone).
 * 
 * @param gateName - Name of the gate (used in event metadata and file naming)
 * @returns AuditSDK instance
 */
export function initAuditSDK(gateName: string): AuditSDK {
	const dropDir = process.env.LEX_AUDIT_DROP_DIR;
	const sessionId = process.env.LEX_AUDIT_SESSION_ID;

	// Return no-op SDK if environment not configured
	if (!dropDir || !sessionId) {
		return new NoOpAuditSDK();
	}

	// Construct sidecar file path: {dropDir}/{gateName}.{pid}.ndjson
	const sidecarPath = path.join(dropDir, `${gateName}.${process.pid}.ndjson`);

	return new ActiveAuditSDK(gateName, sidecarPath);
}

// Re-export types for convenience
export type {
	AuditSDK,
	AuditLevel,
	VulnerabilitySeverity,
	TestStatus,
	VulnFoundPayload,
	TestResultPayload,
	AuditEvent
} from './types.js';
