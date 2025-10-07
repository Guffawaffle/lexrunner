/**
 * Enhanced Audit Trail for Enterprise Compliance
 * 
 * Extends base audit functionality with:
 * - Digital signatures for audit entries
 * - Compliance export formats (SOX, SOC2, etc.)
 * - Tamper detection
 * - Structured compliance reporting
 */

import { createHash, createHmac } from 'crypto';
import { auditTrail, AuditEntry } from '../monitoring/audit.js';
import { AuthContext } from './authentication.js';

/**
 * Enhanced audit entry with security features
 */
export interface SecureAuditEntry extends AuditEntry {
	/** Digital signature of the entry */
	signature?: string;
	/** Hash of the entry for tamper detection */
	hash: string;
	/** Authentication context at time of entry */
	authContext?: {
		user: string;
		method: string;
		roles: string[];
	};
}

/**
 * Compliance export format types
 */
export enum ComplianceFormat {
	/** SOX (Sarbanes-Oxley) compliance format */
	SOX = 'sox',
	/** SOC2 compliance format */
	SOC2 = 'soc2',
	/** Generic JSON format */
	JSON = 'json',
	/** JSONL (JSON Lines) format */
	JSONL = 'jsonl',
	/** CSV format for spreadsheet analysis */
	CSV = 'csv',
}

/**
 * Compliance report metadata
 */
export interface ComplianceReport {
	/** Report format */
	format: ComplianceFormat;
	/** Report generation timestamp */
	generatedAt: string;
	/** Time range covered */
	timeRange: {
		start: string;
		end: string;
	};
	/** Total entries in report */
	totalEntries: number;
	/** Report signature for verification */
	signature?: string;
	/** Report content */
	content: string;
}

/**
 * Merge operation audit data
 */
export interface MergeAuditData {
	prNumbers: number[];
	targetBranch: string;
	mergeStrategy: string;
	gateResults: Record<string, any>;
	decision: 'approved' | 'rejected' | 'deferred';
	reason?: string;
}

/**
 * Enterprise Audit Service
 */
export class EnterpriseAuditService {
	private signingKey?: string;

	constructor(signingKey?: string) {
		// Use provided key or environment variable
		this.signingKey = signingKey || process.env.AUDIT_SIGNING_KEY;
	}

	/**
	 * Log a secure audit entry with signature
	 */
	logSecure(
		operation: string,
		decision: string,
		metadata: Record<string, any>,
		authContext?: AuthContext,
		correlationId?: string
	): SecureAuditEntry {
		// Create base entry
		const entry: AuditEntry = {
			timestamp: new Date().toISOString(),
			operation,
			decision,
			metadata,
			actor: authContext?.user || process.env.GITHUB_ACTOR,
			correlationId,
		};

		// Calculate hash
		const hash = this.calculateHash(entry);

		// Create secure entry
		const secureEntry: SecureAuditEntry = {
			...entry,
			hash,
			authContext: authContext ? {
				user: authContext.user,
				method: authContext.method,
				roles: authContext.roles,
			} : undefined,
		};

		// Add signature if signing key is available
		if (this.signingKey) {
			secureEntry.signature = this.signEntry(secureEntry);
		}

		// Log to base audit trail
		auditTrail.log(operation, decision, metadata, correlationId);

		return secureEntry;
	}

	/**
	 * Log merge operation with full audit trail
	 */
	logMergeOperation(
		data: MergeAuditData,
		authContext?: AuthContext,
		correlationId?: string
	): SecureAuditEntry {
		return this.logSecure(
			'merge_operation',
			data.decision,
			{
				prNumbers: data.prNumbers,
				targetBranch: data.targetBranch,
				mergeStrategy: data.mergeStrategy,
				gateResults: data.gateResults,
				reason: data.reason,
			},
			authContext,
			correlationId
		);
	}

	/**
	 * Calculate hash of audit entry
	 */
	private calculateHash(entry: Partial<SecureAuditEntry>): string {
		// Create deterministic string representation
		const content = JSON.stringify({
			timestamp: entry.timestamp,
			operation: entry.operation,
			decision: entry.decision,
			actor: entry.actor,
			metadata: entry.metadata,
			correlationId: entry.correlationId,
		});

		return createHash('sha256').update(content).digest('hex');
	}

	/**
	 * Sign audit entry with HMAC
	 */
	private signEntry(entry: SecureAuditEntry): string {
		if (!this.signingKey) {
			throw new Error('Signing key not configured');
		}

		return createHmac('sha256', this.signingKey)
			.update(entry.hash)
			.digest('hex');
	}

	/**
	 * Verify audit entry signature
	 */
	verifyEntry(entry: SecureAuditEntry): boolean {
		if (!entry.signature || !this.signingKey) {
			return false;
		}

		// First verify the hash matches the current content
		const currentHash = this.calculateHash(entry);
		if (currentHash !== entry.hash) {
			// Entry has been tampered with
			return false;
		}

		// Then verify the signature
		const expectedSignature = createHmac('sha256', this.signingKey)
			.update(entry.hash)
			.digest('hex');

		return entry.signature === expectedSignature;
	}

	/**
	 * Generate compliance report in specified format
	 */
	generateComplianceReport(
		format: ComplianceFormat,
		startTime?: string,
		endTime?: string
	): ComplianceReport {
		const entries = auditTrail.getEntries();
		
		// Filter by time range if specified
		let filteredEntries = entries;
		if (startTime || endTime) {
			filteredEntries = entries.filter(entry => {
				const timestamp = new Date(entry.timestamp).getTime();
				const start = startTime ? new Date(startTime).getTime() : 0;
				const end = endTime ? new Date(endTime).getTime() : Date.now();
				return timestamp >= start && timestamp <= end;
			});
		}

		const report: ComplianceReport = {
			format,
			generatedAt: new Date().toISOString(),
			timeRange: {
				start: startTime || entries[0]?.timestamp || new Date().toISOString(),
				end: endTime || new Date().toISOString(),
			},
			totalEntries: filteredEntries.length,
			content: '',
		};

		// Generate content based on format
		switch (format) {
			case ComplianceFormat.SOX:
				report.content = this.generateSOXReport(filteredEntries);
				break;
			case ComplianceFormat.SOC2:
				report.content = this.generateSOC2Report(filteredEntries);
				break;
			case ComplianceFormat.CSV:
				report.content = this.generateCSVReport(filteredEntries);
				break;
			case ComplianceFormat.JSONL:
				report.content = filteredEntries.map(e => JSON.stringify(e)).join('\n');
				break;
			case ComplianceFormat.JSON:
			default:
				report.content = JSON.stringify(filteredEntries, null, 2);
				break;
		}

		// Sign the report if signing key is available
		if (this.signingKey) {
			report.signature = createHmac('sha256', this.signingKey)
				.update(report.content)
				.digest('hex');
		}

		return report;
	}

	/**
	 * Generate SOX-compliant report
	 */
	private generateSOXReport(entries: AuditEntry[]): string {
		const sections: string[] = [];

		sections.push('SOX COMPLIANCE AUDIT REPORT');
		sections.push('=' .repeat(80));
		sections.push('');
		sections.push(`Report Generated: ${new Date().toISOString()}`);
		sections.push(`Total Events: ${entries.length}`);
		sections.push('');

		// Group by operation type
		const byOperation = new Map<string, AuditEntry[]>();
		for (const entry of entries) {
			const ops = byOperation.get(entry.operation) || [];
			ops.push(entry);
			byOperation.set(entry.operation, ops);
		}

		sections.push('AUDIT TRAIL BY OPERATION TYPE');
		sections.push('-'.repeat(80));
		sections.push('');

		for (const [operation, ops] of byOperation) {
			sections.push(`Operation: ${operation.toUpperCase()}`);
			sections.push(`Count: ${ops.length}`);
			sections.push('');

			for (const entry of ops) {
				sections.push(`  Timestamp: ${entry.timestamp}`);
				sections.push(`  Actor: ${entry.actor || 'SYSTEM'}`);
				sections.push(`  Decision: ${entry.decision}`);
				sections.push(`  Correlation ID: ${entry.correlationId || 'N/A'}`);
				sections.push(`  Metadata: ${JSON.stringify(entry.metadata)}`);
				sections.push('');
			}
		}

		return sections.join('\n');
	}

	/**
	 * Generate SOC2-compliant report
	 */
	private generateSOC2Report(entries: AuditEntry[]): string {
		const sections: string[] = [];

		sections.push('SOC2 COMPLIANCE AUDIT REPORT');
		sections.push('=' .repeat(80));
		sections.push('');
		sections.push(`Report Date: ${new Date().toISOString()}`);
		sections.push(`Audit Period: ${entries[0]?.timestamp || 'N/A'} to ${entries[entries.length - 1]?.timestamp || 'N/A'}`);
		sections.push(`Total Audit Events: ${entries.length}`);
		sections.push('');

		// Access control events
		const accessEvents = entries.filter(e => 
			e.operation.includes('auth') || 
			e.operation.includes('permission') ||
			e.operation.includes('access')
		);

		sections.push('ACCESS CONTROL EVENTS');
		sections.push('-'.repeat(80));
		sections.push(`Total: ${accessEvents.length}`);
		sections.push('');

		// Change management events
		const changeEvents = entries.filter(e =>
			e.operation.includes('merge') ||
			e.operation.includes('gate') ||
			e.operation.includes('deployment')
		);

		sections.push('CHANGE MANAGEMENT EVENTS');
		sections.push('-'.repeat(80));
		sections.push(`Total: ${changeEvents.length}`);
		sections.push('');

		for (const entry of changeEvents) {
			sections.push(`[${entry.timestamp}] ${entry.operation}: ${entry.decision}`);
			sections.push(`  Actor: ${entry.actor || 'SYSTEM'}`);
			if (entry.metadata.prNumbers) {
				sections.push(`  PRs: ${entry.metadata.prNumbers.join(', ')}`);
			}
			sections.push('');
		}

		return sections.join('\n');
	}

	/**
	 * Generate CSV report
	 */
	private generateCSVReport(entries: AuditEntry[]): string {
		const rows: string[] = [];

		// Header
		rows.push('Timestamp,Operation,Decision,Actor,Correlation ID,Metadata');

		// Data rows
		for (const entry of entries) {
			const metadata = JSON.stringify(entry.metadata).replace(/"/g, '""');
			rows.push([
				entry.timestamp,
				entry.operation,
				entry.decision,
				entry.actor || '',
				entry.correlationId || '',
				`"${metadata}"`,
			].join(','));
		}

		return rows.join('\n');
	}

	/**
	 * Export compliance report to file
	 */
	exportReport(report: ComplianceReport, filepath: string): void {
		const fs = require('fs');
		
		// Create report with metadata
		const exportData = {
			metadata: {
				format: report.format,
				generatedAt: report.generatedAt,
				timeRange: report.timeRange,
				totalEntries: report.totalEntries,
				signature: report.signature,
			},
			content: report.content,
		};

		fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));
	}

	/**
	 * Prune old audit entries based on retention policy
	 * @param retentionDays Number of days to retain audit logs
	 * @returns Number of entries pruned
	 */
	pruneOldEntries(retentionDays: number): number {
		const entries = auditTrail.getEntries();
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

		let prunedCount = 0;
		const entriesToKeep: AuditEntry[] = [];

		for (const entry of entries) {
			const entryDate = new Date(entry.timestamp);
			if (entryDate >= cutoffDate) {
				entriesToKeep.push(entry);
			} else {
				prunedCount++;
			}
		}

		// Replace audit trail with filtered entries
		if (typeof auditTrail.setEntries === 'function') {
			auditTrail.setEntries(entriesToKeep);
		} else {
			console.warn('Audit trail pruning is not supported: missing setEntries API. No entries were actually removed.');
		}
		
		return prunedCount;
	}

	/**
	 * Get retention policy recommendations based on compliance requirements
	 */
	getRetentionRecommendations(): { framework: string; minDays: number; description: string }[] {
		return [
			{
				framework: 'SOX',
				minDays: 2555, // 7 years
				description: 'Sarbanes-Oxley requires 7 years retention for financial records'
			},
			{
				framework: 'SOC2',
				minDays: 365, // 1 year
				description: 'SOC2 Type II typically requires 1 year of audit logs'
			},
			{
				framework: 'GDPR',
				minDays: 90, // 3 months minimum
				description: 'GDPR requires retention only as long as necessary, typically 90 days minimum'
			},
			{
				framework: 'HIPAA',
				minDays: 2190, // 6 years
				description: 'HIPAA requires 6 years retention for audit logs'
			},
			{
				framework: 'ISO 27001',
				minDays: 365, // 1 year
				description: 'ISO 27001 recommends at least 1 year of security logs'
			},
			{
				framework: 'PCI DSS',
				minDays: 365, // 1 year minimum, 3 years recommended
				description: 'PCI DSS requires 1 year retention (3 years recommended)'
			},
		];
	}

	/**
	 * Apply retention policy based on compliance framework
	 */
	applyRetentionPolicy(framework: 'SOX' | 'SOC2' | 'GDPR' | 'HIPAA' | 'ISO27001' | 'PCI'): {
		applied: boolean;
		retentionDays: number;
		prunedCount: number;
	} {
		const policies = this.getRetentionRecommendations();
		const policy = policies.find(p => p.framework.toUpperCase().replace(/\s+/g, '') === framework.toUpperCase().replace(/\s+/g, ''));

		if (!policy) {
			return {
				applied: false,
				retentionDays: 0,
				prunedCount: 0,
			};
		}

		const prunedCount = this.pruneOldEntries(policy.minDays);

		return {
			applied: true,
			retentionDays: policy.minDays,
			prunedCount,
		};
	}
}

