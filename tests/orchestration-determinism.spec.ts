/**
 * Tests for Determinism Framework - Toolchain Pinning
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
	generateToolchainManifest, 
	verifyToolchainPins, 
	allVersionsMatch 
} from '../src/orchestration/determinism.js';

describe('Determinism Framework', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-determinism-test');
	const originalCwd = process.cwd();

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		// Don't use process.chdir() - not supported in worker threads
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	describe('generateToolchainManifest', () => {
		it('should generate toolchain manifest with all fields', async () => {
			const manifest = await generateToolchainManifest();

			expect(manifest).toBeDefined();
			expect(manifest.recordedAt).toBeDefined();
			expect(new Date(manifest.recordedAt)).toBeInstanceOf(Date);

			expect(manifest.tools).toBeDefined();
			expect(manifest.tools.git).toBeDefined();
			expect(manifest.tools.node).toBeDefined();
			expect(manifest.tools.npm).toBeDefined();
			expect(manifest.tools.typescript).toBeDefined();
			expect(manifest.tools.eslint).toBeDefined();

			expect(manifest.environment).toBeDefined();
			expect(typeof manifest.environment).toBe('object');

			expect(manifest.os).toBeDefined();
			expect(manifest.os.platform).toBeDefined();
			expect(manifest.os.release).toBeDefined();
			expect(manifest.os.arch).toBeDefined();
		});

		it('should capture environment variables when set', async () => {
			process.env.TZ = 'UTC';
			process.env.LANG = 'en_US.UTF-8';

			const manifest = await generateToolchainManifest();

			expect(manifest.environment.TZ).toBe('UTC');
			expect(manifest.environment.LANG).toBe('en_US.UTF-8');
		});

		it('should include CI environment variable when set', async () => {
			process.env.CI = 'true';

			const manifest = await generateToolchainManifest();

			expect(manifest.environment.CI).toBe('true');

			delete process.env.CI;
		});
	});

	describe('verifyToolchainPins', () => {
		it('should verify toolchain versions with no pins', async () => {
			const results = await verifyToolchainPins();

			expect(results).toBeDefined();
			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBeGreaterThan(0);

			// All should match when no pins are defined
			results.forEach(result => {
				expect(result.matches).toBe(true);
			});
		});

		it('should detect mismatches with .tool-versions', async () => {
			// Create .tool-versions with different versions
			fs.writeFileSync('.tool-versions', `
git 1.0.0
node 10.0.0
npm 5.0.0
`);

			const results = await verifyToolchainPins();

			const gitResult = results.find(r => r.name === 'git');
			const nodeResult = results.find(r => r.name === 'node');
			const npmResult = results.find(r => r.name === 'npm');

			expect(gitResult?.pinned).toBe('1.0.0');
			expect(gitResult?.matches).toBe(false);

			expect(nodeResult?.pinned).toBe('10.0.0');
			expect(nodeResult?.matches).toBe(false);

			expect(npmResult?.pinned).toBe('5.0.0');
			expect(npmResult?.matches).toBe(false);
		});

		it('should read Node.js version from .nvmrc', async () => {
			fs.writeFileSync('.nvmrc', '16.20.0\n');

			const results = await verifyToolchainPins();

			const nodeResult = results.find(r => r.name === 'node');
			expect(nodeResult?.pinned).toBe('16.20.0');
		});

		it('should verify TypeScript version from package.json', async () => {
			const packageJson = {
				name: 'test-project',
				dependencies: {},
				devDependencies: {
					typescript: '^5.0.0'
				}
			};
			fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

			const results = await verifyToolchainPins();

			const tsResult = results.find(r => r.name === 'typescript');
			expect(tsResult?.version).toBe('5.0.0');
		});

		it('should verify ESLint version from package.json', async () => {
			const packageJson = {
				name: 'test-project',
				dependencies: {},
				devDependencies: {
					eslint: '^9.10.0'
				}
			};
			fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

			const results = await verifyToolchainPins();

			const eslintResult = results.find(r => r.name === 'eslint');
			expect(eslintResult?.version).toBe('9.10.0');
		});
	});

	describe('allVersionsMatch', () => {
		it('should return true when no pins are defined', async () => {
			const result = await allVersionsMatch();
			expect(result).toBe(true);
		});

		it('should return false when versions mismatch', async () => {
			fs.writeFileSync('.tool-versions', 'node 1.0.0\n');

			const result = await allVersionsMatch();
			expect(result).toBe(false);
		});

		it('should return true when all versions match', async () => {
			// Get current node version
			const nodeVersion = process.version.slice(1); // Remove 'v' prefix

			fs.writeFileSync('.tool-versions', `node ${nodeVersion}\n`);

			const result = await allVersionsMatch();
			expect(result).toBe(true);
		});
	});

	describe('Toolchain Manifest Schema', () => {
		it('should generate manifest with ISO timestamp', async () => {
			const manifest = await generateToolchainManifest();

			// Check ISO 8601 format
			expect(manifest.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		});

		it('should include OS information', async () => {
			const manifest = await generateToolchainManifest();

			expect(['linux', 'darwin', 'win32']).toContain(manifest.os.platform);
			expect(['x64', 'arm64', 'arm']).toContain(manifest.os.arch);
			expect(manifest.os.release).toBeDefined();
			expect(manifest.os.release.length).toBeGreaterThan(0);
		});
	});
});
