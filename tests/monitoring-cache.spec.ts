import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	purgeCacheIfNeeded,
	getCacheDir,
	cacheExists,
	formatCachePurgeResult,
	CachePurgeResult
} from '../src/monitoring/cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Cache Management', () => {
	let testProfileDir: string;

	beforeEach(() => {
		// Create temporary profile directory for tests
		testProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-pr-cache-test-'));
	});

	afterEach(() => {
		// Cleanup
		fs.rmSync(testProfileDir, { recursive: true, force: true });
	});

	describe('Cache Directory Management', () => {
		it('should create cache directory on first purge', () => {
			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });

			const cacheDir = getCacheDir(testProfileDir);
			expect(fs.existsSync(cacheDir)).toBe(true);
			expect(result.purged).toBe(true);
		});

		it('should use correct cache directory path', () => {
			const cacheDir = getCacheDir(testProfileDir);
			const expectedPath = path.join(testProfileDir, 'runner', '.cache');
			
			expect(cacheDir).toBe(expectedPath);
		});

		it('should detect cache existence', () => {
			expect(cacheExists(testProfileDir)).toBe(false);
			
			purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(cacheExists(testProfileDir)).toBe(true);
		});
	});

	describe('Cache Purge Without --keep-cache', () => {
		it('should purge empty cache directory', () => {
			// Create empty cache
			const cacheDir = getCacheDir(testProfileDir);
			fs.mkdirSync(cacheDir, { recursive: true });

			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });

			expect(result.purged).toBe(true);
			expect(result.bytesFreed).toBe(0);
			expect(result.path).toBe(cacheDir);
			expect(fs.existsSync(cacheDir)).toBe(true);
		});

		it('should purge cache with files and report size', () => {
			// Create cache with some files
			const cacheDir = getCacheDir(testProfileDir);
			fs.mkdirSync(cacheDir, { recursive: true });
			
			const file1 = path.join(cacheDir, 'file1.txt');
			const file2 = path.join(cacheDir, 'file2.txt');
			
			fs.writeFileSync(file1, 'a'.repeat(1000)); // 1000 bytes
			fs.writeFileSync(file2, 'b'.repeat(2000)); // 2000 bytes

			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });

			expect(result.purged).toBe(true);
			expect(result.bytesFreed).toBe(3000);
			expect(fs.existsSync(file1)).toBe(false);
			expect(fs.existsSync(file2)).toBe(false);
			expect(fs.existsSync(cacheDir)).toBe(true);
		});

		it('should purge nested directory structure', () => {
			// Create nested cache structure
			const cacheDir = getCacheDir(testProfileDir);
			const subDir1 = path.join(cacheDir, 'sub1');
			const subDir2 = path.join(cacheDir, 'sub2');
			
			fs.mkdirSync(subDir1, { recursive: true });
			fs.mkdirSync(subDir2, { recursive: true });
			
			fs.writeFileSync(path.join(subDir1, 'file1.txt'), 'data1');
			fs.writeFileSync(path.join(subDir2, 'file2.txt'), 'data2');

			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });

			expect(result.purged).toBe(true);
			expect(result.bytesFreed).toBeGreaterThan(0);
			expect(fs.existsSync(subDir1)).toBe(false);
			expect(fs.existsSync(subDir2)).toBe(false);
			
			// Cache dir should be recreated empty
			expect(fs.existsSync(cacheDir)).toBe(true);
			expect(fs.readdirSync(cacheDir)).toHaveLength(0);
		});

		it('should handle non-existent cache directory', () => {
			// Don't create cache directory
			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });

			expect(result.purged).toBe(true);
			expect(result.bytesFreed).toBe(0);
			
			// Should create new empty directory
			const cacheDir = getCacheDir(testProfileDir);
			expect(fs.existsSync(cacheDir)).toBe(true);
		});
	});

	describe('Cache Purge With --keep-cache', () => {
		it('should keep existing cache when --keep-cache is set', () => {
			// Create cache with files
			const cacheDir = getCacheDir(testProfileDir);
			fs.mkdirSync(cacheDir, { recursive: true });
			const testFile = path.join(cacheDir, 'test.txt');
			fs.writeFileSync(testFile, 'preserved data');

			const result = purgeCacheIfNeeded({
				profileDir: testProfileDir,
				keepCache: true
			});

			expect(result.purged).toBe(false);
			expect(result.bytesFreed).toBe(0);
			expect(fs.existsSync(testFile)).toBe(true);
			expect(fs.readFileSync(testFile, 'utf-8')).toBe('preserved data');
		});

		it('should not create cache directory if it does not exist with --keep-cache', () => {
			const result = purgeCacheIfNeeded({
				profileDir: testProfileDir,
				keepCache: true
			});

			expect(result.purged).toBe(false);
			expect(result.bytesFreed).toBe(0);
			
			const cacheDir = getCacheDir(testProfileDir);
			expect(fs.existsSync(cacheDir)).toBe(false);
		});
	});

	describe('Result Formatting', () => {
		it('should format kept cache message', () => {
			const result: CachePurgeResult = {
				purged: false,
				bytesFreed: 0,
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Keeping existing cache');
			expect(formatted).toContain('--keep-cache');
		});

		it('should format empty cache purge message', () => {
			const result: CachePurgeResult = {
				purged: true,
				bytesFreed: 0,
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Cache directory ready');
			expect(formatted).toContain('was empty');
		});

		it('should format purged cache with size in bytes', () => {
			const result: CachePurgeResult = {
				purged: true,
				bytesFreed: 512,
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Purged cache');
			expect(formatted).toContain('512.00 B');
		});

		it('should format purged cache with size in KB', () => {
			const result: CachePurgeResult = {
				purged: true,
				bytesFreed: 5120, // 5 KB
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Purged cache');
			expect(formatted).toContain('5.00 KB');
		});

		it('should format purged cache with size in MB', () => {
			const result: CachePurgeResult = {
				purged: true,
				bytesFreed: 5242880, // 5 MB
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Purged cache');
			expect(formatted).toContain('5.00 MB');
		});

		it('should format purged cache with size in GB', () => {
			const result: CachePurgeResult = {
				purged: true,
				bytesFreed: 5368709120, // 5 GB
				path: '/path/to/cache'
			};

			const formatted = formatCachePurgeResult(result);
			
			expect(formatted).toContain('Purged cache');
			expect(formatted).toContain('5.00 GB');
		});
	});

	describe('Real-world Scenarios', () => {
		it('should handle typical first-run scenario', () => {
			// No cache exists
			const result1 = purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(result1.purged).toBe(true);
			expect(result1.bytesFreed).toBe(0);
			expect(cacheExists(testProfileDir)).toBe(true);
		});

		it('should handle typical subsequent run with cached data', () => {
			// Create initial cache
			purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			// Add some cached data
			const cacheDir = getCacheDir(testProfileDir);
			fs.writeFileSync(path.join(cacheDir, 'cache.dat'), 'cached data');
			
			// Subsequent run should purge
			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(result.purged).toBe(true);
			expect(result.bytesFreed).toBeGreaterThan(0);
		});

		it('should handle development workflow with --keep-cache', () => {
			// Initial run
			purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			// Add cached data
			const cacheDir = getCacheDir(testProfileDir);
			const cacheFile = path.join(cacheDir, 'expensive-computation.cache');
			fs.writeFileSync(cacheFile, 'expensive result');
			
			// Run with --keep-cache
			const result = purgeCacheIfNeeded({
				profileDir: testProfileDir,
				keepCache: true
			});
			
			expect(result.purged).toBe(false);
			expect(fs.existsSync(cacheFile)).toBe(true);
		});

		it('should handle cache corruption recovery', () => {
			// Create corrupted/partial cache
			const cacheDir = getCacheDir(testProfileDir);
			fs.mkdirSync(cacheDir, { recursive: true });
			fs.writeFileSync(path.join(cacheDir, 'partial.tmp'), 'incomplete');
			
			// Purge should clean it up
			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(result.purged).toBe(true);
			
			// Verify cache is clean
			const files = fs.readdirSync(cacheDir);
			expect(files).toHaveLength(0);
		});
	});

	describe('Size Calculation Accuracy', () => {
		it('should accurately calculate total size with multiple files', () => {
			const cacheDir = getCacheDir(testProfileDir);
			fs.mkdirSync(cacheDir, { recursive: true });
			
			const sizes = [100, 200, 300, 400, 500];
			let expectedTotal = 0;
			
			sizes.forEach((size, index) => {
				const content = 'x'.repeat(size);
				fs.writeFileSync(path.join(cacheDir, `file${index}.txt`), content);
				expectedTotal += size;
			});

			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(result.bytesFreed).toBe(expectedTotal);
		});

		it('should include nested file sizes in calculation', () => {
			const cacheDir = getCacheDir(testProfileDir);
			const nested1 = path.join(cacheDir, 'level1');
			const nested2 = path.join(nested1, 'level2');
			
			fs.mkdirSync(nested2, { recursive: true });
			
			fs.writeFileSync(path.join(cacheDir, 'root.txt'), 'a'.repeat(100));
			fs.writeFileSync(path.join(nested1, 'l1.txt'), 'b'.repeat(200));
			fs.writeFileSync(path.join(nested2, 'l2.txt'), 'c'.repeat(300));

			const result = purgeCacheIfNeeded({ profileDir: testProfileDir });
			
			expect(result.bytesFreed).toBe(600);
		});
	});
});
