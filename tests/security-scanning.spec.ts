import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	Severity,
	SecurityScanResult,
	SecurityPolicy,
	DEFAULT_SECURITY_POLICY,
	SecurityScanner,
	NpmAuditScanner,
	SecurityScanningService,
} from '../src/security/scanning.js';

describe('Security - Vulnerability Scanning', () => {
	describe('NpmAuditScanner', () => {
		it('should have correct scanner name', () => {
			const scanner = new NpmAuditScanner();
			expect(scanner.getName()).toBe('npm-audit');
		});

		it('should parse npm audit v7+ format correctly', async () => {
			const scanner = new NpmAuditScanner();
			
			// Mock npm audit response
			const mockAuditData = {
				vulnerabilities: {
					'test-package': {
						range: '1.0.0 - 1.2.0',
						via: [{
							source: 1234,
							severity: 'high',
							title: 'Cross-Site Scripting (XSS)',
							url: 'https://github.com/advisories/GHSA-xxxx',
							cve: 'CVE-2024-1234',
							cvss: { score: 7.5 }
						}],
						fixAvailable: true
					}
				}
			};

			// Use private method directly for testing
			const result = (scanner as any).parseNpmAudit(mockAuditData);

			expect(result.scanner).toBe('npm-audit');
			expect(result.totalVulnerabilities).toBe(1);
			expect(result.highCount).toBe(1);
			expect(result.criticalCount).toBe(0);
			expect(result.vulnerabilities[0]).toMatchObject({
				id: '1234',
				package: 'test-package',
				severity: Severity.HIGH,
				title: 'Cross-Site Scripting (XSS)',
				cve: 'CVE-2024-1234',
				cvssScore: 7.5,
				fixedIn: 'available'
			});
		});

		it('should handle multiple vulnerabilities', async () => {
			const scanner = new NpmAuditScanner();
			
			const mockAuditData = {
				vulnerabilities: {
					'package-a': {
						via: [{
							severity: 'critical',
							title: 'RCE vulnerability',
						}]
					},
					'package-b': {
						via: [{
							severity: 'high',
							title: 'SQL injection',
						}]
					},
					'package-c': {
						via: [{
							severity: 'moderate',
							title: 'XSS vulnerability',
						}]
					}
				}
			};

			const result = (scanner as any).parseNpmAudit(mockAuditData);

			expect(result.totalVulnerabilities).toBe(3);
			expect(result.criticalCount).toBe(1);
			expect(result.highCount).toBe(1);
			expect(result.mediumCount).toBe(1);
		});

		it('should map severity levels correctly', () => {
			const scanner = new NpmAuditScanner();
			
			expect((scanner as any).mapSeverity('critical')).toBe(Severity.CRITICAL);
			expect((scanner as any).mapSeverity('high')).toBe(Severity.HIGH);
			expect((scanner as any).mapSeverity('moderate')).toBe(Severity.MEDIUM);
			expect((scanner as any).mapSeverity('medium')).toBe(Severity.MEDIUM);
			expect((scanner as any).mapSeverity('low')).toBe(Severity.LOW);
			expect((scanner as any).mapSeverity('unknown')).toBe(Severity.INFO);
		});

		it('should handle empty audit results', () => {
			const scanner = new NpmAuditScanner();
			
			const mockAuditData = {
				vulnerabilities: {}
			};

			const result = (scanner as any).parseNpmAudit(mockAuditData);

			expect(result.totalVulnerabilities).toBe(0);
			expect(result.criticalCount).toBe(0);
			expect(result.highCount).toBe(0);
			expect(result.passed).toBe(true);
		});
	});

	describe('SecurityScanningService', () => {
		let service: SecurityScanningService;

		beforeEach(() => {
			service = new SecurityScanningService();
		});

		it('should use default security policy', () => {
			const service = new SecurityScanningService();
			expect((service as any).policy).toEqual(DEFAULT_SECURITY_POLICY);
		});

		it('should allow custom security policy', () => {
			const customPolicy: Partial<SecurityPolicy> = {
				blockCritical: false,
				maxMedium: 10
			};

			const service = new SecurityScanningService(customPolicy);
			
			expect((service as any).policy.blockCritical).toBe(false);
			expect((service as any).policy.maxMedium).toBe(10);
			expect((service as any).policy.blockHigh).toBe(true); // From default
		});

		it('should register scanners', () => {
			const mockScanner: SecurityScanner = {
				getName: () => 'mock-scanner',
				scan: async () => ({
					timestamp: new Date(),
					scanner: 'mock',
					totalVulnerabilities: 0,
					vulnerabilities: [],
					criticalCount: 0,
					highCount: 0,
					mediumCount: 0,
					lowCount: 0,
					passed: true
				})
			};

			service.registerScanner(mockScanner);
			expect((service as any).scanners.length).toBeGreaterThan(1); // NPM scanner + mock
		});

		it('should evaluate policy for critical vulnerabilities', () => {
			const result: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'test',
				totalVulnerabilities: 2,
				vulnerabilities: [],
				criticalCount: 2,
				highCount: 0,
				mediumCount: 0,
				lowCount: 0,
				passed: false
			};

			const evaluation = service.evaluatePolicy(result);
			
			expect(evaluation.passed).toBe(false);
			expect(evaluation.violations).toHaveLength(1);
			expect(evaluation.violations[0]).toContain('2 critical vulnerabilities');
		});

		it('should evaluate policy for high vulnerabilities', () => {
			const result: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'test',
				totalVulnerabilities: 3,
				vulnerabilities: [],
				criticalCount: 0,
				highCount: 3,
				mediumCount: 0,
				lowCount: 0,
				passed: false
			};

			const evaluation = service.evaluatePolicy(result);
			
			expect(evaluation.passed).toBe(false);
			expect(evaluation.violations).toHaveLength(1);
			expect(evaluation.violations[0]).toContain('3 high vulnerabilities');
		});

		it('should evaluate policy for medium vulnerabilities exceeding threshold', () => {
			const result: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'test',
				totalVulnerabilities: 10,
				vulnerabilities: [],
				criticalCount: 0,
				highCount: 0,
				mediumCount: 10,
				lowCount: 0,
				passed: false
			};

			const evaluation = service.evaluatePolicy(result);
			
			expect(evaluation.passed).toBe(false);
			expect(evaluation.violations).toHaveLength(1);
			expect(evaluation.violations[0]).toContain('10 medium vulnerabilities');
			expect(evaluation.violations[0]).toContain('max allowed: 5');
		});

		it('should pass policy when under thresholds', () => {
			const result: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'test',
				totalVulnerabilities: 8,
				vulnerabilities: [],
				criticalCount: 0,
				highCount: 0,
				mediumCount: 3,
				lowCount: 5,
				passed: true
			};

			const evaluation = service.evaluatePolicy(result);
			
			expect(evaluation.passed).toBe(true);
			expect(evaluation.violations).toHaveLength(0);
		});

		it('should collect multiple policy violations', () => {
			const result: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'test',
				totalVulnerabilities: 30,
				vulnerabilities: [],
				criticalCount: 2,
				highCount: 5,
				mediumCount: 10,
				lowCount: 13,
				passed: false
			};

			const evaluation = service.evaluatePolicy(result);
			
			expect(evaluation.passed).toBe(false);
			expect(evaluation.violations.length).toBeGreaterThan(1);
		});

		it('should generate security report', () => {
			const mockResult: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'npm-audit',
				totalVulnerabilities: 2,
				vulnerabilities: [
					{
						id: 'GHSA-1234',
						package: 'test-pkg',
						version: '1.0.0',
						severity: Severity.HIGH,
						title: 'XSS vulnerability',
						description: 'Description here',
						cve: 'CVE-2024-1234',
						cvssScore: 7.5,
						fixedIn: '1.1.0'
					},
					{
						id: 'GHSA-5678',
						package: 'other-pkg',
						version: '2.0.0',
						severity: Severity.MEDIUM,
						title: 'SQL injection',
						description: 'SQL injection flaw'
					}
				],
				criticalCount: 0,
				highCount: 1,
				mediumCount: 1,
				lowCount: 0,
				passed: false
			};

			const report = service.generateReport([mockResult]);

			expect(report).toContain('Security Scan Report');
			expect(report).toContain('Scanner: npm-audit');
			expect(report).toContain('Total Vulnerabilities: 2');
			expect(report).toContain('Critical: 0');
			expect(report).toContain('High: 1');
			expect(report).toContain('test-pkg@1.0.0');
			expect(report).toContain('XSS vulnerability');
			expect(report).toContain('CVE: CVE-2024-1234');
			expect(report).toContain('CVSS Score: 7.5');
			expect(report).toContain('Fixed in: 1.1.0');
			expect(report).toContain('❌ FAILED');
		});

		it('should show passed status in report when clean', () => {
			const cleanResult: SecurityScanResult = {
				timestamp: new Date(),
				scanner: 'npm-audit',
				totalVulnerabilities: 0,
				vulnerabilities: [],
				criticalCount: 0,
				highCount: 0,
				mediumCount: 0,
				lowCount: 0,
				passed: true
			};

			const report = service.generateReport([cleanResult]);

			expect(report).toContain('✅ PASSED');
		});
	});

	describe('Default Security Policy', () => {
		it('should block critical and high vulnerabilities by default', () => {
			expect(DEFAULT_SECURITY_POLICY.blockCritical).toBe(true);
			expect(DEFAULT_SECURITY_POLICY.blockHigh).toBe(true);
		});

		it('should allow some medium and low vulnerabilities', () => {
			expect(DEFAULT_SECURITY_POLICY.maxMedium).toBe(5);
			expect(DEFAULT_SECURITY_POLICY.maxLow).toBe(10);
		});
	});
});
