import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
	resolveConfigPath,
	resetMigrationNotice
} from '../src/config/pathResolver.js';

describe('Config Path Resolver', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-resolver-test-'));
		resetMigrationNotice();
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe('resolveConfigPath', () => {
		it('should prefer runner/ structure over flat', () => {
			const runnerDir = path.join(tempDir, 'runner');
			fs.mkdirSync(runnerDir, { recursive: true });

			// Create files in both locations
			fs.writeFileSync(path.join(runnerDir, 'scope.yml'), 'version: 1 # runner');
			fs.writeFileSync(path.join(tempDir, 'scope.yml'), 'version: 1 # flat');

			const resolved = resolveConfigPath(tempDir, 'scope.yml');

			expect(resolved.exists).toBe(true);
			expect(resolved.source).toBe('runner/');
			expect(resolved.path).toBe(path.join(runnerDir, 'scope.yml'));
			expect(resolved.shouldNotifyMigration).toBe(false);
		});

		it('should fallback to flat structure when runner/ does not exist', () => {
			fs.writeFileSync(path.join(tempDir, 'scope.yml'), 'version: 1');

			const resolved = resolveConfigPath(tempDir, 'scope.yml');

			expect(resolved.exists).toBe(true);
			expect(resolved.source).toBe('flat (legacy)');
			expect(resolved.path).toBe(path.join(tempDir, 'scope.yml'));
			expect(resolved.shouldNotifyMigration).toBe(true);
		});

		it('should return non-existent path when file does not exist', () => {
			const resolved = resolveConfigPath(tempDir, 'nonexistent.yml');

			expect(resolved.exists).toBe(false);
			expect(resolved.source).toBe('flat (legacy)');
			expect(resolved.shouldNotifyMigration).toBe(false);
		});

		it('should only notify migration once per process', () => {
			fs.writeFileSync(path.join(tempDir, 'scope.yml'), 'version: 1');
			fs.writeFileSync(path.join(tempDir, 'deps.yml'), 'version: 1');

			const resolved1 = resolveConfigPath(tempDir, 'scope.yml');
			expect(resolved1.shouldNotifyMigration).toBe(true);

			const resolved2 = resolveConfigPath(tempDir, 'deps.yml');
			expect(resolved2.shouldNotifyMigration).toBe(false); // Already notified
		});

		it('should prefer runner/ even when flat file exists', () => {
			const runnerDir = path.join(tempDir, 'runner');
			fs.mkdirSync(runnerDir, { recursive: true });

			fs.writeFileSync(path.join(runnerDir, 'gates.yml'), 'version: 1 # new');
			fs.writeFileSync(path.join(tempDir, 'gates.yml'), 'version: 1 # old');

			const resolved = resolveConfigPath(tempDir, 'gates.yml');

			expect(resolved.source).toBe('runner/');
			expect(resolved.path).toContain('runner');
		});
	});

	describe('migration notice state', () => {
		it('should reset migration notice state', () => {
			fs.writeFileSync(path.join(tempDir, 'scope.yml'), 'version: 1');

			// First resolve should notify
			const resolved1 = resolveConfigPath(tempDir, 'scope.yml');
			expect(resolved1.shouldNotifyMigration).toBe(true);

			// Second resolve should not notify
			const resolved2 = resolveConfigPath(tempDir, 'deps.yml');
			expect(resolved2.shouldNotifyMigration).toBe(false);

			// After reset, should notify again
			resetMigrationNotice();
			fs.writeFileSync(path.join(tempDir, 'deps.yml'), 'version: 1');
			const resolved3 = resolveConfigPath(tempDir, 'deps.yml');
			expect(resolved3.shouldNotifyMigration).toBe(true);
		});
	});

	describe('multiple config files', () => {
		it('should handle multiple config files with consistent behavior', () => {
			const runnerDir = path.join(tempDir, 'runner');
			fs.mkdirSync(runnerDir, { recursive: true });

			// Mix of runner/ and flat files
			fs.writeFileSync(path.join(runnerDir, 'scope.yml'), 'version: 1');
			fs.writeFileSync(path.join(tempDir, 'deps.yml'), 'version: 1');
			fs.writeFileSync(path.join(runnerDir, 'gates.yml'), 'version: 1');

			const scopeResolved = resolveConfigPath(tempDir, 'scope.yml');
			expect(scopeResolved.source).toBe('runner/');

			const depsResolved = resolveConfigPath(tempDir, 'deps.yml');
			expect(depsResolved.source).toBe('flat (legacy)');

			const gatesResolved = resolveConfigPath(tempDir, 'gates.yml');
			expect(gatesResolved.source).toBe('runner/');
		});
	});
});
