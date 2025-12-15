/**
 * SARIF adapter tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { generateSARIF, writeSARIF } from '../../src/audit/sarif.js';
import type { EventEnvelope } from '../../src/audit/events.js';

describe('SARIF Adapter', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'sarif-test-'));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('generateSARIF', () => {
		it('should generate valid SARIF 2.1.0 report from vuln_found events', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						package: 'lodash',
						version: '4.17.20',
						fixedIn: '4.17.21'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');

			expect(report.$schema).toBe('https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json');
			expect(report.version).toBe('2.1.0');
			expect(report.runs).toHaveLength(1);
			
			const run = report.runs[0];
			expect(run.tool.driver.name).toBe('lexrunner');
			expect(run.tool.driver.version).toBe('0.1.0');
			expect(run.tool.driver.informationUri).toBe('https://smartergpt.dev/lexrunner');
			expect(run.tool.driver.rules).toHaveLength(1);
			expect(run.results).toHaveLength(1);
		});

		it('should map severity levels correctly to SARIF levels', async () => {
			const severities: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; expectedLevel: 'error' | 'warning' | 'note' }> = [
				{ severity: 'critical', expectedLevel: 'error' },
				{ severity: 'high', expectedLevel: 'error' },
				{ severity: 'medium', expectedLevel: 'warning' },
				{ severity: 'low', expectedLevel: 'note' }
			];

			for (const { severity, expectedLevel } of severities) {
				const events: EventEnvelope[] = [
					{
						schema_version: '0.1.0',
						event: 'vuln_found',
						ts: '2024-11-05T00:00:00.000Z',
						level: 'warn',
						session_id: 'test-session',
						run_id: 'test-run',
						tool: { name: 'lexrunner', version: '0.1.0' },
						actor: { type: 'cli' },
						repo: {},
						payload: {
							cve: `CVE-2024-${severity}`,
							severity,
							package: 'test-package',
							version: '1.0.0'
						}
					}
				];

				const report = await generateSARIF(events, '0.1.0');
				
				expect(report.runs[0].results[0].level).toBe(expectedLevel);
				expect(report.runs[0].tool.driver.rules[0].defaultConfiguration.level).toBe(expectedLevel);
			}
		});

		it('should handle multiple vulnerabilities and deduplicate rules', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						package: 'lodash',
						version: '4.17.20'
					}
				},
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:01.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						package: 'lodash',
						version: '4.17.19'
					}
				},
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:02.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-5678',
						severity: 'medium',
						package: 'axios',
						version: '0.21.0'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');

			// Should have 2 unique rules (CVE-2024-1234 and CVE-2024-5678)
			expect(report.runs[0].tool.driver.rules).toHaveLength(2);
			
			// Should have 3 results (one for each event)
			expect(report.runs[0].results).toHaveLength(3);

			// Rules should be sorted by CVE ID
			expect(report.runs[0].tool.driver.rules[0].id).toBe('CVE-2024-1234');
			expect(report.runs[0].tool.driver.rules[1].id).toBe('CVE-2024-5678');
		});

		it('should handle optional fields correctly', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-9999',
						severity: 'critical'
						// No package, version, or fixedIn
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			
			const result = report.runs[0].results[0];
			expect(result.ruleId).toBe('CVE-2024-9999');
			expect(result.level).toBe('error');
			expect(result.properties.severity).toBe('critical');
			expect(result.properties.package).toBeUndefined();
			expect(result.properties.version).toBeUndefined();
			expect(result.properties.fixedIn).toBeUndefined();
		});

		it('should default location to package.json when file not specified', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			
			const result = report.runs[0].results[0];
			expect(result.locations).toHaveLength(1);
			expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('package.json');
		});

		it('should use custom file location when specified', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						file: 'src/dependencies.txt'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			
			const result = report.runs[0].results[0];
			expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('src/dependencies.txt');
		});

		it('should return empty results when no vuln_found events', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'gate_started',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'info',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						item: 'PR-123',
						gate: 'lint'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			
			expect(report.runs[0].tool.driver.rules).toHaveLength(0);
			expect(report.runs[0].results).toHaveLength(0);
		});

		it('should include all required SARIF properties', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						package: 'lodash',
						version: '4.17.20',
						fixedIn: '4.17.21'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			
			// Check rule structure
			const rule = report.runs[0].tool.driver.rules[0];
			expect(rule.id).toBe('CVE-2024-1234');
			expect(rule.name).toBe('CVE-2024-1234');
			expect(rule.shortDescription).toBeDefined();
			expect(rule.shortDescription.text).toBeTruthy();
			expect(rule.fullDescription).toBeDefined();
			expect(rule.fullDescription.text).toBeTruthy();
			expect(rule.defaultConfiguration).toBeDefined();
			expect(rule.defaultConfiguration.level).toBe('error');
			expect(rule.properties).toBeDefined();
			expect(rule.properties.tags).toContain('security');
			expect(rule.properties.tags).toContain('cve');
			expect(rule.properties.precision).toBe('high');

			// Check result structure
			const result = report.runs[0].results[0];
			expect(result.ruleId).toBe('CVE-2024-1234');
			expect(result.level).toBe('error');
			expect(result.message).toBeDefined();
			expect(result.message.text).toBeTruthy();
			expect(result.locations).toHaveLength(1);
			expect(result.properties).toBeDefined();
			expect(result.properties.severity).toBe('high');
			expect(result.properties.package).toBe('lodash');
			expect(result.properties.version).toBe('4.17.20');
			expect(result.properties.fixedIn).toBe('4.17.21');
		});
	});

	describe('writeSARIF', () => {
		it('should write SARIF report to file', async () => {
			const report = {
				$schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
				version: '2.1.0',
				runs: [
					{
						tool: {
							driver: {
								name: 'lexrunner',
								version: '0.1.0',
								informationUri: 'https://smartergpt.dev/lexrunner',
								rules: []
							}
						},
						results: []
					}
				]
			};

			const outputPath = join(testDir, 'audit-sarif.json');
			await writeSARIF(report, outputPath);

			expect(existsSync(outputPath)).toBe(true);
			
			const content = await readFile(outputPath, 'utf-8');
			const parsed = JSON.parse(content);
			
			expect(parsed.$schema).toBe(report.$schema);
			expect(parsed.version).toBe('2.1.0');
		});

		it('should create directory if it does not exist', async () => {
			const report = {
				$schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
				version: '2.1.0',
				runs: [
					{
						tool: {
							driver: {
								name: 'lexrunner',
								version: '0.1.0',
								informationUri: 'https://smartergpt.dev/lexrunner',
								rules: []
							}
						},
						results: []
					}
				]
			};

			const outputPath = join(testDir, 'nested', 'dir', 'audit-sarif.json');
			await writeSARIF(report, outputPath);

			expect(existsSync(outputPath)).toBe(true);
		});

		it('should format JSON with proper indentation', async () => {
			const report = {
				$schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
				version: '2.1.0',
				runs: [
					{
						tool: {
							driver: {
								name: 'lexrunner',
								version: '0.1.0',
								informationUri: 'https://smartergpt.dev/lexrunner',
								rules: []
							}
						},
						results: []
					}
				]
			};

			const outputPath = join(testDir, 'audit-sarif.json');
			await writeSARIF(report, outputPath);

			const content = await readFile(outputPath, 'utf-8');
			
			// Check that it's pretty-printed (has newlines and indentation)
			expect(content).toContain('\n');
			expect(content).toContain('  ');
		});

		it('should generate SARIF parseable by existing SARIF parser', async () => {
			const events: EventEnvelope[] = [
				{
					schema_version: '0.1.0',
					event: 'vuln_found',
					ts: '2024-11-05T00:00:00.000Z',
					level: 'warn',
					session_id: 'test-session',
					run_id: 'test-run',
					tool: { name: 'lexrunner', version: '0.1.0' },
					actor: { type: 'cli' },
					repo: {},
					payload: {
						cve: 'CVE-2024-1234',
						severity: 'high',
						package: 'lodash',
						version: '4.17.20',
						fixedIn: '4.17.21'
					}
				}
			];

			const report = await generateSARIF(events, '0.1.0');
			const outputPath = join(testDir, 'audit-sarif.json');
			await writeSARIF(report, outputPath);

			// Verify it can be read back and parsed by the SARIF parser
			const content = await readFile(outputPath, 'utf-8');
			const { parseSarif } = await import('../../src/security/sarif.js');
			
			const scanResult = parseSarif(content);
			expect(scanResult.vulnerabilities.length).toBeGreaterThan(0);
			expect(scanResult.scanner).toBe('lexrunner');
		});
	});
});
