/**
 * Tests for idea command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execa } from 'execa';

const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js');
const TEST_OUTPUT_DIR = path.resolve(__dirname, '../../.smartergpt.local/deliverables/_session');

describe('idea command', () => {
	beforeEach(async () => {
		// Ensure clean output directory
		await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
	});

	afterEach(async () => {
		// Clean up test files
		try {
			const files = await fs.readdir(TEST_OUTPUT_DIR);
			for (const file of files) {
				if (file.startsWith('idea-')) {
					await fs.unlink(path.join(TEST_OUTPUT_DIR, file));
				}
			}
		} catch {
			// Ignore cleanup errors
		}
	});

	it('should show help message', async () => {
		const { stdout } = await execa('node', [CLI_PATH, 'idea', '--help']);

		expect(stdout).toContain('Capture feature idea');
		expect(stdout).toContain('--title');
		expect(stdout).toContain('--description');
		expect(stdout).toContain('--dry-run');
	});

	it('should create Feature Spec v0 in dry-run mode', async () => {
		const { stdout } = await execa('node', [
			CLI_PATH,
			'idea',
			'--title', 'Test Feature',
			'--description', 'Test description',
			'--repo', 'owner/repo',
			'--dry-run'
		]);

		expect(stdout).toContain('Feature Spec v0 written to');
		expect(stdout).toContain('Dry run: Issue not created/updated');
		expect(stdout).toContain('Fingerprint:');
	});

	it('should generate valid JSON spec file', async () => {
		await execa('node', [
			CLI_PATH,
			'idea',
			'--title', 'Test Feature',
			'--description', 'Test description',
			'--repo', 'owner/repo',
			'--dry-run'
		]);

		const files = await fs.readdir(TEST_OUTPUT_DIR);
		const specFile = files.find(f => f.startsWith('idea-'));
		expect(specFile).toBeDefined();

		const content = await fs.readFile(path.join(TEST_OUTPUT_DIR, specFile!), 'utf-8');
		const spec = JSON.parse(content);

		expect(spec.schemaVersion).toBe('0.1.0');
		expect(spec.title).toBe('Test Feature');
		expect(spec.description).toBe('Test description');
		expect(spec.repo).toBe('owner/repo');
		expect(spec.acceptanceCriteria).toEqual([]);
		expect(spec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('should generate consistent fingerprints', async () => {
		const { stdout: stdout1 } = await execa('node', [
			CLI_PATH,
			'idea',
			'--title', 'Same Feature',
			'--description', 'Same description',
			'--repo', 'owner/repo',
			'--dry-run'
		]);

		const { stdout: stdout2 } = await execa('node', [
			CLI_PATH,
			'idea',
			'--title', 'Same Feature',
			'--description', 'Same description',
			'--repo', 'owner/repo',
			'--dry-run'
		]);

		const fp1 = stdout1.match(/Fingerprint: ([a-f0-9]{16})/)?.[1];
		const fp2 = stdout2.match(/Fingerprint: ([a-f0-9]{16})/)?.[1];

		expect(fp1).toBeDefined();
		expect(fp2).toBeDefined();
		expect(fp1).toBe(fp2);
	});

	it('should require GITHUB_TOKEN for non-dry-run mode', async () => {
		const env = { ...process.env };
		delete env.GITHUB_TOKEN;

		await expect(
			execa('node', [
				CLI_PATH,
				'idea',
				'--title', 'Test',
				'--description', 'Test',
				'--repo', 'owner/repo'
			], { env })
		).rejects.toThrow();
	});

	it('should reject unsafe artifact paths', async () => {
		await expect(
			execa('node', [
				CLI_PATH,
				'idea',
				'--title', 'Test',
				'--description', 'Test',
				'--repo', 'owner/repo',
				'--output', '.smartergpt/deliverables/pr-123/unsafe.json',
				'--dry-run'
			])
		).rejects.toThrow();
	});

	it('should accept custom output path', async () => {
		const customOutput = '/tmp/test-idea-spec.json';

		await execa('node', [
			CLI_PATH,
			'idea',
			'--title', 'Test',
			'--description', 'Test',
			'--repo', 'owner/repo',
			'--output', customOutput,
			'--dry-run'
		]);

		const content = await fs.readFile(customOutput, 'utf-8');
		const spec = JSON.parse(content);

		expect(spec.title).toBe('Test');

		// Clean up
		await fs.unlink(customOutput);
	});
});
