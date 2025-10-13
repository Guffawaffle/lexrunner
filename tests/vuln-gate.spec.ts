import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeItemGates } from '../src/gates.js';
import { loadPlan, Policy } from '../src/schema.js';
import { ExecutionState } from '../src/executionState.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Vuln Gate Integration', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vuln-gate-test-'));
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe('SARIF artifact processing', () => {
		it('should pass when SARIF has no vulnerabilities', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
				security: {
					blockCritical: true,
					blockHigh: true,
					maxMedium: 5,
					maxLow: 10,
				},
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			// Create item artifact directory with clean SARIF
			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const cleanSarif = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'scan-results-clean.sarif'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'scan-results.sarif'), cleanSarif);

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].gate).toBe('vuln');
			expect(results[0].status).toBe('pass');
			expect(results[0].stdout).toContain('✅ All thresholds met');
			expect(results[0].exitCode).toBe(0);
		});

		it('should fail when SARIF has critical vulnerabilities', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
				security: {
					blockCritical: true,
					blockHigh: true,
					maxMedium: 5,
					maxLow: 10,
				},
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			// Create item artifact directory with SARIF containing vulnerabilities
			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const vulnSarif = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'scan-results.sarif'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'scan-results.sarif'), vulnSarif);

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].gate).toBe('vuln');
			expect(results[0].status).toBe('fail');
			expect(results[0].stdout).toContain('❌ Policy violations');
			expect(results[0].stdout).toContain('1 critical vulnerabilities');
			expect(results[0].stdout).toContain('1 high vulnerabilities');
			expect(results[0].exitCode).toBe(1);
		});

		it('should fail when no vulnerability scan artifacts found', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			// Create empty artifact directory (no SARIF or npm audit)
			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].gate).toBe('vuln');
			expect(results[0].status).toBe('fail');
			expect(results[0].stderr).toContain('No vulnerability scan artifacts found');
		});
	});

	describe('npm audit fallback', () => {
		it('should fall back to npm audit JSON when SARIF not present', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
				security: {
					blockCritical: true,
					blockHigh: true,
					maxMedium: 5,
					maxLow: 10,
				},
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			// Create item artifact directory with npm audit JSON
			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const npmAudit = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'npm-audit.json'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'npm-audit.json'), npmAudit);

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].gate).toBe('vuln');
			expect(results[0].status).toBe('fail'); // Has high severity vuln
			expect(results[0].stdout).toContain('Vulnerability scan results');
		});
	});

	describe('threshold configuration', () => {
		it('should respect custom security thresholds', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
				security: {
					blockCritical: true,
					blockHigh: false, // Allow high
					maxMedium: 10,
					maxLow: 20,
				},
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			// Create SARIF with 1 critical, 1 high, 1 medium
			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const vulnSarif = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'scan-results.sarif'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'scan-results.sarif'), vulnSarif);

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe('fail');
			// Should fail on critical only, not high
			expect(results[0].stderr).toContain('1 critical vulnerabilities');
			expect(results[0].stderr).not.toContain('1 high vulnerabilities');
		});

		it('should use default security policy when not specified', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
				// No security policy specified
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const cleanSarif = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'scan-results-clean.sarif'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'scan-results.sarif'), cleanSarif);

			const results = await executeItemGates(item, policy, executionState, tempDir);

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe('pass');
		});
	});

	describe('deterministic output', () => {
		it('should produce stable, deterministic output messages', async () => {
			const policy: Policy = {
				requiredGates: ['vuln'],
				optionalGates: [],
				maxWorkers: 1,
				retries: {},
				overrides: {},
				blockOn: [],
				mergeRule: { type: 'strict-required' },
			};

			const item = {
				name: 'test-item',
				deps: [],
				gates: [{ name: 'vuln', run: 'echo test' }],
			};

			const executionState = new ExecutionState({
				schemaVersion: '1.0.0',
				target: 'main',
				items: [item],
			});

			const itemArtifactDir = path.join(tempDir, item.name);
			fs.mkdirSync(itemArtifactDir, { recursive: true });
			
			const vulnSarif = fs.readFileSync(
				path.join(__dirname, 'fixtures', 'scan-results.sarif'),
				'utf-8'
			);
			fs.writeFileSync(path.join(itemArtifactDir, 'scan-results.sarif'), vulnSarif);

			// Run twice and check outputs are identical
			const results1 = await executeItemGates(item, policy, executionState, tempDir);
			const results2 = await executeItemGates(item, policy, executionState, tempDir);

			expect(results1[0].stdout).toBe(results2[0].stdout);
			expect(results1[0].stderr).toBe(results2[0].stderr);
			
			// Verify output structure
			expect(results1[0].stdout).toMatch(/Vulnerability scan results \(.*\):/);
			expect(results1[0].stdout).toMatch(/Critical: \d+/);
			expect(results1[0].stdout).toMatch(/High: \d+/);
			expect(results1[0].stdout).toMatch(/Medium: \d+/);
			expect(results1[0].stdout).toMatch(/Low: \d+/);
			expect(results1[0].stdout).toMatch(/Total: \d+/);
		});
	});
});
