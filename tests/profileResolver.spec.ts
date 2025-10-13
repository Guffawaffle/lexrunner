import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveProfile, ProfileResolverError, logProfileMessage } from '../src/config/profileResolver.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Profile Resolver', () => {
	let tempDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
		originalEnv = { ...process.env };
		// Spy on console.error since telemetry now uses stderr
		consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
		process.env = originalEnv;
		consoleSpy.mockRestore();
	});

	describe('Precedence Chain', () => {
		it('should use --profile-dir flag as highest precedence', () => {
			// Set up all options
			const customDir = path.join(tempDir, 'custom');
			fs.mkdirSync(customDir, { recursive: true });
			fs.writeFileSync(
				path.join(customDir, 'profile.yml'),
				'role: custom\nname: Custom Profile\nversion: 1.0.0'
			);

			process.env.LEX_PR_PROFILE_DIR = path.join(tempDir, 'env');
			fs.mkdirSync(path.join(tempDir, '.smartergpt.local'), { recursive: true });
			fs.mkdirSync(path.join(tempDir, '.smartergpt'), { recursive: true });

			const result = resolveProfile(customDir, tempDir);

			expect(result.path).toBe(customDir);
			expect(result.manifest.role).toBe('custom');
			expect(result.manifest.name).toBe('Custom Profile');
			expect(result.manifest.version).toBe('1.0.0');
		});

		it('should use LEX_PR_PROFILE_DIR env var when no flag provided', () => {
			const envDir = path.join(tempDir, 'env');
			fs.mkdirSync(envDir, { recursive: true });
			fs.writeFileSync(
				path.join(envDir, 'profile.yml'),
				'role: environment\nname: Env Profile'
			);

			process.env.LEX_PR_PROFILE_DIR = envDir;
			fs.mkdirSync(path.join(tempDir, '.smartergpt.local'), { recursive: true });
			fs.mkdirSync(path.join(tempDir, '.smartergpt'), { recursive: true });

			const result = resolveProfile(undefined, tempDir);

			expect(result.path).toBe(envDir);
			expect(result.manifest.role).toBe('environment');
			expect(result.manifest.name).toBe('Env Profile');
		});

		it('should use .smartergpt.local/ when it exists and no flag/env', () => {
			const localDir = path.join(tempDir, '.smartergpt.local');
			fs.mkdirSync(localDir, { recursive: true });
			fs.writeFileSync(
				path.join(localDir, 'profile.yml'),
				'role: local\nname: Local Profile'
			);

			fs.mkdirSync(path.join(tempDir, '.smartergpt'), { recursive: true });

			const result = resolveProfile(undefined, tempDir);

			expect(result.path).toBe(localDir);
			expect(result.manifest.role).toBe('local');
			expect(result.manifest.name).toBe('Local Profile');
		});

		it('should fallback to .smartergpt/ when no other options', () => {
			const trackedDir = path.join(tempDir, '.smartergpt');
			fs.mkdirSync(trackedDir, { recursive: true });
			fs.writeFileSync(
				path.join(trackedDir, 'profile.yml'),
				'role: tracked\nname: Tracked Profile'
			);

			const result = resolveProfile(undefined, tempDir);

			expect(result.path).toBe(trackedDir);
			expect(result.manifest.role).toBe('tracked');
			expect(result.manifest.name).toBe('Tracked Profile');
		});
	});

	describe('Manifest Parsing', () => {
		it('should parse complete manifest with all fields', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(
				path.join(profileDir, 'profile.yml'),
				'role: production\nname: Prod Profile\nversion: 2.1.0'
			);

			const result = resolveProfile(profileDir, tempDir);

			expect(result.manifest).toEqual({
				role: 'production',
				name: 'Prod Profile',
				version: '2.1.0'
			});
		});

		it('should parse manifest with only role field', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(path.join(profileDir, 'profile.yml'), 'role: minimal');

			const result = resolveProfile(profileDir, tempDir);

			expect(result.manifest).toEqual({
				role: 'minimal',
				name: undefined,
				version: undefined
			});
		});

		it('should default role to "example" when missing in manifest', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(
				path.join(profileDir, 'profile.yml'),
				'name: No Role Profile'
			);

			const result = resolveProfile(profileDir, tempDir);

			expect(result.manifest.role).toBe('example');
			expect(result.manifest.name).toBe('No Role Profile');
		});

		it('should default to role: example for .smartergpt/ without manifest', () => {
			const trackedDir = path.join(tempDir, '.smartergpt');
			fs.mkdirSync(trackedDir, { recursive: true });
			// No profile.yml created

			const result = resolveProfile(undefined, tempDir);

			expect(result.path).toBe(trackedDir);
			expect(result.manifest).toEqual({
				role: 'example'
			});
		});

		it('should throw error for missing manifest in custom directory', () => {
			const customDir = path.join(tempDir, 'custom');
			fs.mkdirSync(customDir, { recursive: true });
			// No profile.yml created

			expect(() => resolveProfile(customDir, tempDir)).toThrow(ProfileResolverError);
			expect(() => resolveProfile(customDir, tempDir)).toThrow(
				/is missing profile\.yml manifest/
			);
		});

		it('should throw error for missing manifest from env var', () => {
			const envDir = path.join(tempDir, 'env');
			fs.mkdirSync(envDir, { recursive: true });
			process.env.LEX_PR_PROFILE_DIR = envDir;
			// No profile.yml created

			expect(() => resolveProfile(undefined, tempDir)).toThrow(ProfileResolverError);
		});

		it('should throw error for missing manifest in .smartergpt.local/', () => {
			const localDir = path.join(tempDir, '.smartergpt.local');
			fs.mkdirSync(localDir, { recursive: true });
			// No profile.yml created

			expect(() => resolveProfile(undefined, tempDir)).toThrow(ProfileResolverError);
		});
	});

	describe('Path Resolution', () => {
		it('should resolve relative paths to absolute paths', () => {
			const relativeDir = 'custom';
			const absoluteDir = path.join(tempDir, relativeDir);
			fs.mkdirSync(absoluteDir, { recursive: true });
			fs.writeFileSync(
				path.join(absoluteDir, 'profile.yml'),
				'role: relative'
			);

			const result = resolveProfile(relativeDir, tempDir);

			expect(path.isAbsolute(result.path)).toBe(true);
			expect(result.path).toBe(absoluteDir);
		});

		it('should handle absolute paths correctly', () => {
			const absoluteDir = path.join(tempDir, 'absolute');
			fs.mkdirSync(absoluteDir, { recursive: true });
			fs.writeFileSync(
				path.join(absoluteDir, 'profile.yml'),
				'role: absolute'
			);

			const result = resolveProfile(absoluteDir, tempDir);

			expect(result.path).toBe(absoluteDir);
		});

		it('should resolve env var relative paths', () => {
			const relativeDir = 'env-relative';
			const absoluteDir = path.join(tempDir, relativeDir);
			fs.mkdirSync(absoluteDir, { recursive: true });
			fs.writeFileSync(
				path.join(absoluteDir, 'profile.yml'),
				'role: env-relative'
			);

			process.env.LEX_PR_PROFILE_DIR = relativeDir;

			const result = resolveProfile(undefined, tempDir);

			expect(path.isAbsolute(result.path)).toBe(true);
			expect(result.path).toBe(absoluteDir);
		});

		it('should always return absolute path for .smartergpt/', () => {
			const trackedDir = path.join(tempDir, '.smartergpt');
			fs.mkdirSync(trackedDir, { recursive: true });

			const result = resolveProfile(undefined, tempDir);

			expect(path.isAbsolute(result.path)).toBe(true);
			expect(result.path).toBe(trackedDir);
		});
	});

	describe('Telemetry', () => {
		it('should emit telemetry breadcrumb with profile path and role', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(
				path.join(profileDir, 'profile.yml'),
				'role: test-role'
			);

			resolveProfile(profileDir, tempDir);

			expect(consoleSpy).toHaveBeenCalledWith(
				`lex-pr-runner profile: using profile: ${profileDir} (role: test-role)`
			);
		});

		it('should emit telemetry with example role for .smartergpt/ without manifest', () => {
			const trackedDir = path.join(tempDir, '.smartergpt');
			fs.mkdirSync(trackedDir, { recursive: true });

			resolveProfile(undefined, tempDir);

			expect(consoleSpy).toHaveBeenCalledWith(
				`lex-pr-runner profile: using profile: ${trackedDir} (role: example)`
			);
		});

		it('should emit telemetry exactly once per resolution', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(
				path.join(profileDir, 'profile.yml'),
				'role: single'
			);

			resolveProfile(profileDir, tempDir);

			expect(consoleSpy).toHaveBeenCalledTimes(1);
		});

		it('should use consistent stderr prefix format', () => {
			const profileDir = path.join(tempDir, 'profile');
			fs.mkdirSync(profileDir, { recursive: true });
			fs.writeFileSync(
				path.join(profileDir, 'profile.yml'),
				'role: test-prefix'
			);

			resolveProfile(profileDir, tempDir);

			// Verify the message starts with the expected prefix
			const calls = consoleSpy.mock.calls;
			expect(calls.length).toBe(1);
			expect(calls[0][0]).toMatch(/^lex-pr-runner profile: /);
		});
	});

	describe('Error Handling', () => {
		it('should create ProfileResolverError instances', () => {
			const customDir = path.join(tempDir, 'custom');
			fs.mkdirSync(customDir, { recursive: true });

			try {
				resolveProfile(customDir, tempDir);
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).toBeInstanceOf(ProfileResolverError);
				expect((error as ProfileResolverError).name).toBe('ProfileResolverError');
			}
		});

		it('should include source information in error message', () => {
			const customDir = path.join(tempDir, 'custom');
			fs.mkdirSync(customDir, { recursive: true });

			expect(() => resolveProfile(customDir, tempDir)).toThrow(
				/from --profile-dir/
			);
		});
	});

	describe('Profile Message Helper', () => {
		it('should log messages with consistent prefix to stderr', () => {
			logProfileMessage('test message');

			expect(consoleSpy).toHaveBeenCalledWith('lex-pr-runner profile: test message');
		});

		it('should write to stderr not stdout', () => {
			const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			
			logProfileMessage('stderr test');

			expect(consoleSpy).toHaveBeenCalled();
			expect(stdoutSpy).not.toHaveBeenCalled();
			
			stdoutSpy.mockRestore();
		});
	});
});
