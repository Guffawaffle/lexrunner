import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	getEnvWithAlias,
	getCIMutationPolicy,
	validateCIEnvironment,
	resetDeprecationNotices,
} from '../src/util/envUtils.js';
import type { ProfileManifest } from '../src/config/profileResolver.js';

describe('Environment Utils', () => {
	let originalEnv: NodeJS.ProcessEnv;
	let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		originalEnv = { ...process.env };
		// Clear environment variables that might interfere
		delete process.env.ALLOW_MUTATIONS;
		delete process.env.GITHUB_TOKEN;
		delete process.env.GH_TOKEN;
		delete process.env.LEX_PR_PROFILE_DIR;
		delete process.env.LEXRUNNER_PROFILE_DIR;
		delete process.env.LEX_PR_PLAN;
		delete process.env.LEXRUNNER_PLAN;
		delete process.env.LEX_PR_WORKSPACE;
		delete process.env.LEXRUNNER_WORKSPACE;
		
		// Reset deprecation notices
		resetDeprecationNotices();
		
		// Spy on console methods
		consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		process.env = originalEnv;
		consoleWarnSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	describe('getEnvWithAlias', () => {
		it('should return primary value when both are set', () => {
			process.env.LEX_PR_PROFILE_DIR = '/primary/path';
			process.env.LEXRUNNER_PROFILE_DIR = '/alias/path';

			const result = getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');

			expect(result).toBe('/primary/path');
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should return alias value when primary is not set', () => {
			process.env.LEXRUNNER_PROFILE_DIR = '/alias/path';

			const result = getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');

			expect(result).toBe('/alias/path');
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('LEXRUNNER_PROFILE_DIR is deprecated')
			);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Use LEX_PR_PROFILE_DIR instead')
			);
		});

		it('should return undefined when neither is set', () => {
			const result = getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');

			expect(result).toBeUndefined();
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should show deprecation notice only once per process', () => {
			process.env.LEXRUNNER_PROFILE_DIR = '/alias/path';

			// First call
			getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');
			expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

			// Second call
			getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');
			expect(consoleWarnSpy).toHaveBeenCalledTimes(1); // Still only once

			// Third call
			getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');
			expect(consoleWarnSpy).toHaveBeenCalledTimes(1); // Still only once
		});

		it('should not show deprecation notice when primary is used', () => {
			process.env.LEX_PR_PROFILE_DIR = '/primary/path';

			const result = getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');

			expect(result).toBe('/primary/path');
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should mention v2.0.0 in deprecation notice', () => {
			process.env.LEXRUNNER_PROFILE_DIR = '/alias/path';

			getEnvWithAlias('LEX_PR_PROFILE_DIR', 'LEXRUNNER_PROFILE_DIR');

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('v2.0.0')
			);
		});
	});

	describe('getCIMutationPolicy', () => {
		it('should allow mutations for non-CI roles when ALLOW_MUTATIONS=true', () => {
			process.env.ALLOW_MUTATIONS = 'true';
			const profile: ProfileManifest = { role: 'local' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(true);
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should disallow mutations for non-CI roles when ALLOW_MUTATIONS=false', () => {
			process.env.ALLOW_MUTATIONS = 'false';
			const profile: ProfileManifest = { role: 'local' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should disallow mutations for non-CI roles when ALLOW_MUTATIONS is not set', () => {
			const profile: ProfileManifest = { role: 'local' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should force false for CI role by default', () => {
			const profile: ProfileManifest = { role: 'ci' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should force false for CI role when ALLOW_MUTATIONS=false', () => {
			process.env.ALLOW_MUTATIONS = 'false';
			const profile: ProfileManifest = { role: 'ci' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});

		it('should allow explicit override for CI role with warning', () => {
			process.env.ALLOW_MUTATIONS = 'true';
			const profile: ProfileManifest = { role: 'ci' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(true);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				'⚠️  CI role with ALLOW_MUTATIONS=true (explicit override)'
			);
		});

		it('should warn about invalid ALLOW_MUTATIONS value for CI role', () => {
			process.env.ALLOW_MUTATIONS = 'yes';
			const profile: ProfileManifest = { role: 'ci' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				'⚠️  Invalid ALLOW_MUTATIONS value: "yes" (using false for CI)'
			);
		});

		it('should warn about invalid ALLOW_MUTATIONS value for CI role (1)', () => {
			process.env.ALLOW_MUTATIONS = '1';
			const profile: ProfileManifest = { role: 'ci' };

			const result = getCIMutationPolicy(profile);

			expect(result).toBe(false);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				'⚠️  Invalid ALLOW_MUTATIONS value: "1" (using false for CI)'
			);
		});
	});

	describe('validateCIEnvironment', () => {
		it('should not validate non-CI roles', () => {
			const profile: ProfileManifest = { role: 'local' };

			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('should require GITHUB_TOKEN for CI role', () => {
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).toThrow(
				'CI environment validation failed'
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'❌ CI environment validation failed:'
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Missing GITHUB_TOKEN')
			);
		});

		it('should accept GITHUB_TOKEN for CI role', () => {
			process.env.GITHUB_TOKEN = 'ghp_test123';
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('should accept GH_TOKEN as alternative for CI role', () => {
			process.env.GH_TOKEN = 'ghp_test123';
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('should warn about ALLOW_MUTATIONS=true in CI role', () => {
			process.env.GITHUB_TOKEN = 'ghp_test123';
			process.env.ALLOW_MUTATIONS = 'true';
			const profile: ProfileManifest = { role: 'ci' };

			// Should not throw, but should warn
			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'❌ CI environment validation failed:'
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('ALLOW_MUTATIONS=true in CI role (dangerous)')
			);
		});

		it('should throw when both GITHUB_TOKEN missing and ALLOW_MUTATIONS=true', () => {
			process.env.ALLOW_MUTATIONS = 'true';
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).toThrow(
				'CI environment validation failed'
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Missing GITHUB_TOKEN')
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('ALLOW_MUTATIONS=true in CI role (dangerous)')
			);
		});

		it('should handle CI role with GITHUB_TOKEN but ALLOW_MUTATIONS=false', () => {
			process.env.GITHUB_TOKEN = 'ghp_test123';
			process.env.ALLOW_MUTATIONS = 'false';
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('should handle CI role with GITHUB_TOKEN and no ALLOW_MUTATIONS', () => {
			process.env.GITHUB_TOKEN = 'ghp_test123';
			const profile: ProfileManifest = { role: 'ci' };

			expect(() => validateCIEnvironment(profile)).not.toThrow();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});
	});
});
