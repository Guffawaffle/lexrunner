import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runMigrateProfile } from '../src/commands/migrateProfile.js';

describe('Migrate Profile Command', () => {
	let tempDir: string;
	let profileDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-profile-test-'));
		profileDir = path.join(tempDir, '.smartergpt.local');
		fs.mkdirSync(profileDir, { recursive: true });

		// Create profile manifest
		fs.writeFileSync(
			path.join(profileDir, 'profile.yml'),
			'role: local\nname: Test Profile\n'
		);
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe('basic migration', () => {
		it('should migrate config files from flat to runner/', async () => {
			// Create flat structure files
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');
			fs.writeFileSync(path.join(profileDir, 'deps.yml'), 'version: 1');
			fs.writeFileSync(path.join(profileDir, 'gates.yml'), 'version: 1');

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles.length).toBe(3);
			expect(result.migratedFiles).toContain('scope.yml');
			expect(result.migratedFiles).toContain('deps.yml');
			expect(result.migratedFiles).toContain('gates.yml');

			// Verify files moved to runner/
			const runnerDir = path.join(profileDir, 'runner');
			expect(fs.existsSync(path.join(runnerDir, 'scope.yml'))).toBe(true);
			expect(fs.existsSync(path.join(runnerDir, 'deps.yml'))).toBe(true);
			expect(fs.existsSync(path.join(runnerDir, 'gates.yml'))).toBe(true);

			// Verify files removed from flat structure
			expect(fs.existsSync(path.join(profileDir, 'scope.yml'))).toBe(false);
			expect(fs.existsSync(path.join(profileDir, 'deps.yml'))).toBe(false);
			expect(fs.existsSync(path.join(profileDir, 'gates.yml'))).toBe(false);
		});

		it('should create backup before migration', async () => {
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.backupPath).toBeDefined();
			expect(fs.existsSync(result.backupPath!)).toBe(true);
			expect(fs.existsSync(path.join(result.backupPath!, 'scope.yml'))).toBe(true);
		});

		it('should preserve file contents during migration', async () => {
			const scopeContent = 'version: 1\ntarget: main\nsources:\n  - query: "is:pr"';
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), scopeContent);

			await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			const migratedContent = fs.readFileSync(
				path.join(profileDir, 'runner', 'scope.yml'),
				'utf-8'
			);
			expect(migratedContent).toBe(scopeContent);
		});
	});

	describe('dry-run mode', () => {
		it('should not migrate files in dry-run mode', async () => {
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');
			fs.writeFileSync(path.join(profileDir, 'deps.yml'), 'version: 1');

			const result = await runMigrateProfile({
				fromFlat: true,
				dryRun: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles.length).toBe(2);
			expect(result.migratedFiles[0]).toContain('(would migrate)');

			// Verify files not moved
			expect(fs.existsSync(path.join(profileDir, 'scope.yml'))).toBe(true);
			expect(fs.existsSync(path.join(profileDir, 'deps.yml'))).toBe(true);
			expect(fs.existsSync(path.join(profileDir, 'runner', 'scope.yml'))).toBe(false);
		});

		it('should report what would be migrated in dry-run', async () => {
			fs.writeFileSync(path.join(profileDir, 'intent.md'), '# Intent');
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');

			const result = await runMigrateProfile({
				fromFlat: true,
				dryRun: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.message).toContain('Would migrate 2 file(s)');
		});
	});

	describe('idempotency', () => {
		it('should be idempotent - safe to run multiple times', async () => {
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');

			// First migration
			const result1 = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});
			expect(result1.success).toBe(true);
			expect(result1.migratedFiles.length).toBe(1);

			// Second migration should report already complete
			const result2 = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});
			expect(result2.success).toBe(true);
			expect(result2.migratedFiles.length).toBe(0);
			expect(result2.message).toContain('already complete');
		});

		it('should skip files already in runner/', async () => {
			const runnerDir = path.join(profileDir, 'runner');
			fs.mkdirSync(runnerDir, { recursive: true });

			// File already in runner/
			fs.writeFileSync(path.join(runnerDir, 'scope.yml'), 'version: 1 # runner');
			// File in flat structure
			fs.writeFileSync(path.join(profileDir, 'deps.yml'), 'version: 1 # flat');

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles).toContain('deps.yml');
			expect(result.migratedFiles).not.toContain('scope.yml');
			expect(result.skippedFiles.some(f => f.includes('scope.yml'))).toBe(true);

			// Verify scope.yml in runner/ unchanged
			const scopeContent = fs.readFileSync(
				path.join(runnerDir, 'scope.yml'),
				'utf-8'
			);
			expect(scopeContent).toContain('# runner');
		});
	});

	describe('error handling', () => {
		it('should report when no files need migration', async () => {
			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles.length).toBe(0);
			expect(result.message).toContain('No config files found');
		});

		it('should report when profile directory does not exist', async () => {
			const nonExistentDir = path.join(tempDir, 'nonexistent');

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir: nonExistentDir
			});

			expect(result.success).toBe(false);
			expect(result.message).toContain('Profile directory error');
		});

		it('should require --from-flat flag', async () => {
			const result = await runMigrateProfile({
				profileDir
			});

			expect(result.success).toBe(false);
			expect(result.message).toContain('No migration type specified');
		});
	});

	describe('all config files', () => {
		it('should migrate all supported config files', async () => {
			const configFiles = [
				'intent.md',
				'scope.yml',
				'deps.yml',
				'gates.yml',
				'stack.yml',
				'pull-request-template.md'
			];

			// Create all config files in flat structure
			configFiles.forEach(file => {
				fs.writeFileSync(path.join(profileDir, file), `# ${file}`);
			});

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles.length).toBe(configFiles.length);

			// Verify all files moved to runner/
			const runnerDir = path.join(profileDir, 'runner');
			configFiles.forEach(file => {
				expect(fs.existsSync(path.join(runnerDir, file))).toBe(true);
			});
		});
	});

	describe('partial migration', () => {
		it('should migrate only files that exist in flat structure', async () => {
			// Only create some files
			fs.writeFileSync(path.join(profileDir, 'scope.yml'), 'version: 1');
			fs.writeFileSync(path.join(profileDir, 'gates.yml'), 'version: 1');

			const result = await runMigrateProfile({
				fromFlat: true,
				profileDir
			});

			expect(result.success).toBe(true);
			expect(result.migratedFiles.length).toBe(2);
			expect(result.migratedFiles).toContain('scope.yml');
			expect(result.migratedFiles).toContain('gates.yml');
			expect(result.migratedFiles).not.toContain('deps.yml');
		});
	});
});
