#!/usr/bin/env node
/**
 * Example vulnerability scanner gate using Audit SDK
 * 
 * Usage: node vuln-scanner.js [package.json path]
 */

import { initAuditSDK } from '../../src/audit/sdk/index.js';
import { execSync } from 'child_process';

const audit = initAuditSDK('vuln');

async function scanVulnerabilities(packageJsonPath: string = 'package.json') {
	try {
		await audit.emit('scan_start', {
			target: packageJsonPath,
			scanner: 'npm-audit',
			timestamp: new Date().toISOString()
		});

		// Run npm audit and capture output
		let output: string;
		let exitCode = 0;

		try {
			output = execSync('npm audit --json', { 
				encoding: 'utf-8',
				stdio: 'pipe'
			});
		} catch (error: any) {
			// npm audit exits with non-zero when vulnerabilities found
			output = error.stdout || '{}';
			exitCode = error.status || 1;
		}

		const auditData = JSON.parse(output);

		// Emit each vulnerability finding
		if (auditData.vulnerabilities) {
			for (const [id, vuln] of Object.entries(auditData.vulnerabilities) as any) {
				const cve = vuln.via?.[0]?.url?.match(/CVE-\d{4}-\d+/)?.[0] || id;
				
				await audit.emitVuln(cve, vuln.severity, {
					package: vuln.name,
					version: vuln.range || 'unknown',
					fixedIn: vuln.fixAvailable?.version || 'not available'
				});
			}
		}

		// Emit scan summary
		const totalVulns = auditData.metadata?.vulnerabilities?.total || 0;
		const severityBreakdown = auditData.metadata?.vulnerabilities || {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0
		};

		await audit.emit('scan_complete', {
			total: Object.keys(auditData.vulnerabilities || {}).length,
			vulnerable: totalVulns,
			severity_breakdown: severityBreakdown
		});

		// Exit with appropriate code
		if (totalVulns > 0) {
			console.log(`Found ${totalVulns} vulnerabilities`);
			process.exit(1);
		} else {
			console.log('No vulnerabilities found');
			process.exit(0);
		}
	} catch (error) {
		await audit.emit('scan_error', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined
		}, 'error');
		
		console.error('Scan failed:', error);
		process.exit(2);
	} finally {
		await audit.close();
	}
}

// Run scanner
const targetFile = process.argv[2] || 'package.json';
scanVulnerabilities(targetFile);
