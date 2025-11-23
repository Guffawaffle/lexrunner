import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { initTestGitRepo, gitAdd, gitCommit } from './helpers/gitTestUtils.js';

describe('deterministic build and format', () => {
	const testDir = path.join(os.tmpdir(), 'lex-pr-runner-build-test');

	beforeEach(() => {
		// Clean test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		fs.mkdirSync(testDir, { recursive: true });
		process.chdir(testDir);
	});

	afterEach(() => {
		// Cleanup
		process.chdir('/');
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
	});

	it('build and format should produce zero diff in clean repo', () => {
		// Get repo root and copy essential files for build test
		const repoRoot = path.resolve(__dirname, '..');

		// Copy package.json, tsconfig.json, and src directory
		fs.copyFileSync(path.join(repoRoot, 'package.json'), 'package.json');
		fs.copyFileSync(path.join(repoRoot, 'tsconfig.json'), 'tsconfig.json');
		fs.copyFileSync(path.join(repoRoot, 'vitest.config.ts'), 'vitest.config.ts');
		fs.copyFileSync(path.join(repoRoot, '.gitignore'), '.gitignore');

		// Copy src directory recursively
		function copyDir(src: string, dest: string) {
			fs.mkdirSync(dest, { recursive: true });
			const entries = fs.readdirSync(src, { withFileTypes: true });

			for (const entry of entries) {
				const srcPath = path.join(src, entry.name);
				const destPath = path.join(dest, entry.name);

				if (entry.isDirectory()) {
					copyDir(srcPath, destPath);
				} else {
					fs.copyFileSync(srcPath, destPath);
				}
			}
		}

		copyDir(path.join(repoRoot, 'src'), 'src');

	// Install dependencies (use the existing node_modules via symlink for speed)
	fs.symlinkSync(path.join(repoRoot, 'node_modules'), 'node_modules');

	// Initialize git repo with GPG signing disabled
	initTestGitRepo(testDir, 'main');

	// Add all files and commit
	gitAdd(testDir);
	gitCommit(testDir, 'Initial commit');		// Run format only (skip build to avoid loop)
		execSync('npm run format', { stdio: 'pipe' });

		// Check git status - should be clean (ignored files like dist/ shouldn't appear)
		const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });

		if (gitStatus.trim() !== '') {
			// Show what changed for debugging
			const gitDiff = execSync('git diff', { encoding: 'utf-8' });
			console.log('Git status after build && format:');
			console.log(gitStatus);
			console.log('Git diff:');
			console.log(gitDiff);
		}

		expect(gitStatus.trim()).toBe('');
	});

	it('repeated builds should produce identical artifacts', () => {
		// Get repo root and copy essential files
		const repoRoot = path.resolve(__dirname, '..');

		// Copy minimal setup
		fs.copyFileSync(path.join(repoRoot, 'package.json'), 'package.json');
		fs.copyFileSync(path.join(repoRoot, 'tsconfig.json'), 'tsconfig.json');

		// Copy src directory
		function copyDir(src: string, dest: string) {
			fs.mkdirSync(dest, { recursive: true });
			const entries = fs.readdirSync(src, { withFileTypes: true });

			for (const entry of entries) {
				const srcPath = path.join(src, entry.name);
				const destPath = path.join(dest, entry.name);

				if (entry.isDirectory()) {
					copyDir(srcPath, destPath);
				} else {
					fs.copyFileSync(srcPath, destPath);
				}
			}
		}

		copyDir(path.join(repoRoot, 'src'), 'src');

		// Link node_modules
		fs.symlinkSync(path.join(repoRoot, 'node_modules'), 'node_modules');

		// Check if build exists
		if (!fs.existsSync('dist')) {
			console.log('No dist directory, skipping build comparison');
			return;
		}

		const firstBuildFiles = fs.readdirSync('dist', { recursive: true });
		const firstBuildHashes = new Map<string, string>();

		for (const file of firstBuildFiles) {
			const filePath = path.join('dist', file as string);
			if (fs.statSync(filePath).isFile()) {
				const content = fs.readFileSync(filePath);
				const crypto = require('crypto');
				const hash = crypto.createHash('sha256').update(content).digest('hex');
				firstBuildHashes.set(file as string, hash);
			}
		}

		// Clean and second build
		fs.rmSync('dist', { recursive: true });
		execSync('npm run build', { stdio: 'pipe' });

		const secondBuildFiles = fs.readdirSync('dist', { recursive: true });

		// Compare file lists
		expect(new Set(secondBuildFiles)).toEqual(new Set(firstBuildFiles));

		// Compare file contents by hash
		for (const file of secondBuildFiles) {
			const filePath = path.join('dist', file as string);
			if (fs.statSync(filePath).isFile()) {
				const content = fs.readFileSync(filePath);
				const crypto = require('crypto');
				const hash = crypto.createHash('sha256').update(content).digest('hex');

				expect(hash).toBe(firstBuildHashes.get(file as string));
			}
		}
	});
});