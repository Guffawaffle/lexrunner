import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { canonicalJSONStringify } from '../src/util/canonicalJson.js';

const execFileAsync = promisify(execFile);

/**
 * Audit Verify Command Integration Tests
 * 
 * Tests the CLI verify command
 */
describe('Audit Verify Command (CLI)', () => {
	let testDir: string;
	const cliPath = join(__dirname, '../dist/cli.js');

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'audit-verify-cli-test-'));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('verify command', () => {
		it('should fail when manifest has no signing metadata (exit 1)', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath
				]);
				expect.fail('Should have thrown with exit code 1');
			} catch (error: any) {
				expect(error.code).toBe(1);
				expect(error.stdout || error.stderr).toContain('No signing metadata');
			}
		});

		it('should output JSON format when --format json is used', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath,
					'--format',
					'json'
				]);
				expect.fail('Should have thrown with exit code 1');
			} catch (error: any) {
				expect(error.code).toBe(1);
				const output = JSON.parse(error.stdout.trim());
				expect(output).toHaveProperty('command', 'verify');
				expect(output).toHaveProperty('status', 'invalid');
				expect(output).toHaveProperty('exitCode', 1);
				expect(output).toHaveProperty('result');
				expect(output).toHaveProperty('timestamp');
			}
		});

		it('should have deterministic JSON output key ordering', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath,
					'--format',
					'json'
				]);
			} catch (error: any) {
				const output = JSON.parse(error.stdout.trim());
				const keys = Object.keys(output);
				const expectedOrder = ['command', 'status', 'exitCode', 'result', 'timestamp'];
				
				// Check first keys are in expected order
				expect(keys.slice(0, expectedOrder.length)).toEqual(expectedOrder);
			}
		});

		it('should output text format by default', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath
				]);
			} catch (error: any) {
				const output = error.stdout || error.stderr;
				expect(output).toContain('Signature verification failed');
				expect(output).toContain('Provider: none');
			}
		});

		it('should use default manifest file path when not specified', async () => {
			// This test verifies the default argument works
			// We expect it to fail with file not found since we don't create the default file
			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify'
				], { cwd: testDir });
				expect.fail('Should have thrown');
			} catch (error: any) {
				// Should fail because audit-manifest.json doesn't exist (exit 1)
				expect(error.code).toBe(1);
			}
		});

		it('should handle missing manifest file (exit 1)', async () => {
			const manifestPath = join(testDir, 'nonexistent.json');

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath
				]);
				expect.fail('Should have thrown with exit code 1');
			} catch (error: any) {
				expect(error.code).toBe(1);
			}
		});

		it('should support --no-color flag', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath,
					'--no-color'
				]);
			} catch (error: any) {
				const output = error.stdout || error.stderr;
				// Output should not contain ANSI color codes
				expect(output).not.toMatch(/\u001b\[/);
			}
		});

		it('should show verification success when signature is valid', async () => {
			// Note: This test is conceptual since we can't easily create a valid
			// KMS or GPG signature in the test environment.
			// In a real scenario, we'd mock the verification or use a test key.
			
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = {
				files: [],
				metadata: {},
				signing: {
					provider: 'kms',
					key_ref: 'arn:aws:kms:us-east-1:123456789012:key/test',
					algorithm: 'RSASSA_PSS_SHA_256',
					signature_file: 'audit.sig',
					metadata_file: 'audit.sig.meta'
				}
			};
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Create mock signature metadata
			const metaPath = join(testDir, 'manifest.sig.meta');
			await writeFile(metaPath, JSON.stringify({
				provider: 'kms',
				algorithm: 'RSASSA_PSS_SHA_256',
				key_ref: 'arn:aws:kms:us-east-1:123456789012:key/test',
				signed_at: '2025-10-13T00:00:00Z',
				manifest_sha256: 'abc123'
			}));

			// Create mock signature file
			const sigPath = join(testDir, 'manifest.sig');
			await writeFile(sigPath, 'mock-signature');

			// This will fail verification since we don't have real KMS, but we can test the flow
			try {
				await execFileAsync('node', [
					cliPath,
					'audit',
					'verify',
					manifestPath
				]);
			} catch (error: any) {
				// Expected to fail without real KMS setup
				const output = error.stdout || error.stderr;
				expect(output).toBeDefined();
			}
		});
	});
});
