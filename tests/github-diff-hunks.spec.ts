import { describe, it, expect } from 'vitest';
import {
	extractDiffHunks,
	optimizeHunkSize,
	formatMinimalDiff,
	calculateContextMetrics,
} from '../src/github/diffHunks.js';

describe('Diff Hunk Extraction', () => {
	describe('extractDiffHunks', () => {
		it('should extract hunks from a simple unified diff', () => {
			const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,6 @@
 function test() {
-  console.log('old');
+  console.log('new');
+  console.log('added');
   return true;
 }
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].path).toBe('src/test.ts');
			expect(result.files[0].changeType).toBe('modified');
			expect(result.files[0].hunks).toHaveLength(1);
			expect(result.files[0].additions).toBe(2);
			expect(result.files[0].deletions).toBe(1);
		});

		it('should handle new file additions', () => {
			const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function newFunc() {
+  return 'new';
+}
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].path).toBe('src/new.ts');
			expect(result.files[0].changeType).toBe('added');
			expect(result.files[0].additions).toBe(3);
			expect(result.files[0].deletions).toBe(0);
		});

		it('should handle file deletions', () => {
			const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldFunc() {
-  return 'old';
-}
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].path).toBe('src/old.ts');
			expect(result.files[0].changeType).toBe('deleted');
			expect(result.files[0].additions).toBe(0);
			expect(result.files[0].deletions).toBe(3);
		});

		it('should handle file renames', () => {
			const diff = `diff --git a/src/old-name.ts b/src/new-name.ts
rename from src/old-name.ts
rename to src/new-name.ts
index 1234567..abcdefg 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function func() {
-  return 'old';
+  return 'new';
 }
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].path).toBe('src/new-name.ts');
			expect(result.files[0].previousPath).toBe('src/old-name.ts');
			expect(result.files[0].changeType).toBe('renamed');
		});

		it('should extract multiple hunks from the same file', () => {
			const diff = `diff --git a/src/multi.ts b/src/multi.ts
index 1234567..abcdefg 100644
--- a/src/multi.ts
+++ b/src/multi.ts
@@ -1,3 +1,3 @@
 function first() {
-  return 'old';
+  return 'new';
 }
@@ -10,3 +10,3 @@
 function second() {
-  return 'old2';
+  return 'new2';
 }
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(1);
			expect(result.files[0].hunks).toHaveLength(2);
			expect(result.hunkCount).toBe(2);
		});

		it('should handle multiple files', () => {
			const diff = `diff --git a/src/file1.ts b/src/file1.ts
index 1234567..abcdefg 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,3 +1,3 @@
-old line
+new line
 unchanged
diff --git a/src/file2.ts b/src/file2.ts
index 2345678..bcdefgh 100644
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1,3 +1,3 @@
-old line 2
+new line 2
 unchanged 2
`;

			const result = extractDiffHunks(diff);

			expect(result.fileCount).toBe(2);
			expect(result.files[0].path).toBe('src/file1.ts');
			expect(result.files[1].path).toBe('src/file2.ts');
		});

		it('should calculate total size correctly', () => {
			const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,3 @@
-old
+new
 line
`;

			const result = extractDiffHunks(diff);

			expect(result.totalSize).toBeGreaterThan(0);
			expect(result.totalSize).toBe(result.files[0].hunks[0].content.length);
		});
	});

	describe('optimizeHunkSize', () => {
		it('should split large hunks into smaller chunks', () => {
			// Create a large hunk with 60 lines
			const largeHunkLines = Array(60).fill(0).map((_, i) => ` line ${i + 1}`);
			const largeHunk = `@@ -1,60 +1,60 @@\n${largeHunkLines.join('\n')}`;

			const context = {
				files: [{
					path: 'large.ts',
					changeType: 'modified' as const,
					hunks: [{
						path: 'large.ts',
						oldStart: 1,
						oldLines: 60,
						newStart: 1,
						newLines: 60,
						content: largeHunk,
						changeType: 'modified' as const,
					}],
					additions: 0,
					deletions: 0,
				}],
				totalSize: largeHunk.length,
				hunkCount: 1,
				fileCount: 1,
			};

			const optimized = optimizeHunkSize(context);

			// Should be split into multiple hunks
			expect(optimized.files[0].hunks.length).toBeGreaterThan(1);
			
			// Each hunk should be within the max size
			for (const hunk of optimized.files[0].hunks) {
				const lineCount = hunk.content.split('\n').length;
				expect(lineCount).toBeLessThanOrEqual(40);
			}
		});

		it('should keep small hunks unchanged', () => {
			const smallHunk = `@@ -1,20 +1,20 @@\n${Array(20).fill(' line').join('\n')}`;

			const context = {
				files: [{
					path: 'small.ts',
					changeType: 'modified' as const,
					hunks: [{
						path: 'small.ts',
						oldStart: 1,
						oldLines: 20,
						newStart: 1,
						newLines: 20,
						content: smallHunk,
						changeType: 'modified' as const,
					}],
					additions: 0,
					deletions: 0,
				}],
				totalSize: smallHunk.length,
				hunkCount: 1,
				fileCount: 1,
			};

			const optimized = optimizeHunkSize(context);

			expect(optimized.files[0].hunks).toHaveLength(1);
			expect(optimized.files[0].hunks[0].content).toBe(smallHunk);
		});

		it('should recalculate metrics after optimization', () => {
			const hunk = `@@ -1,30 +1,30 @@\n${Array(30).fill(' line').join('\n')}`;

			const context = {
				files: [{
					path: 'test.ts',
					changeType: 'modified' as const,
					hunks: [{
						path: 'test.ts',
						oldStart: 1,
						oldLines: 30,
						newStart: 1,
						newLines: 30,
						content: hunk,
						changeType: 'modified' as const,
					}],
					additions: 0,
					deletions: 0,
				}],
				totalSize: hunk.length,
				hunkCount: 1,
				fileCount: 1,
			};

			const optimized = optimizeHunkSize(context);

			expect(optimized.totalSize).toBeGreaterThan(0);
			expect(optimized.hunkCount).toBeGreaterThanOrEqual(1);
			expect(optimized.fileCount).toBe(1);
		});
	});

	describe('formatMinimalDiff', () => {
		it('should format diff context as readable text', () => {
			const context = {
				files: [{
					path: 'src/test.ts',
					changeType: 'modified' as const,
					hunks: [{
						path: 'src/test.ts',
						oldStart: 1,
						oldLines: 3,
						newStart: 1,
						newLines: 3,
						content: '@@ -1,3 +1,3 @@\n-old\n+new\n line',
						changeType: 'modified' as const,
					}],
					additions: 1,
					deletions: 1,
				}],
				totalSize: 100,
				hunkCount: 1,
				fileCount: 1,
			};

			const formatted = formatMinimalDiff(context);

			expect(formatted).toContain('Diff Context');
			expect(formatted).toContain('src/test.ts');
			expect(formatted).toContain('modified');
			expect(formatted).toContain('+1 -1');
		});

		it('should include rename information', () => {
			const context = {
				files: [{
					path: 'src/new.ts',
					previousPath: 'src/old.ts',
					changeType: 'renamed' as const,
					hunks: [],
					additions: 0,
					deletions: 0,
				}],
				totalSize: 0,
				hunkCount: 0,
				fileCount: 1,
			};

			const formatted = formatMinimalDiff(context);

			expect(formatted).toContain('src/new.ts');
			expect(formatted).toContain('from src/old.ts');
		});
	});

	describe('calculateContextMetrics', () => {
		it('should calculate size reduction metrics', () => {
			const rawDiff = 'a'.repeat(1000);
			const minimalContext = {
				files: [],
				totalSize: 500,
				hunkCount: 0,
				fileCount: 0,
			};

			const metrics = calculateContextMetrics(rawDiff, minimalContext);

			expect(metrics.rawSize).toBe(1000);
			expect(metrics.minimalSize).toBe(500);
			expect(metrics.reductionPercent).toBe(50);
		});

		it('should calculate average hunk size', () => {
			const minimalContext = {
				files: [],
				totalSize: 600,
				hunkCount: 3,
				fileCount: 1,
			};

			const metrics = calculateContextMetrics('', minimalContext);

			expect(metrics.avgHunkSize).toBe(200);
		});

		it('should handle empty context', () => {
			const minimalContext = {
				files: [],
				totalSize: 0,
				hunkCount: 0,
				fileCount: 0,
			};

			const metrics = calculateContextMetrics('', minimalContext);

			expect(metrics.rawSize).toBe(0);
			expect(metrics.minimalSize).toBe(0);
			expect(metrics.reductionPercent).toBe(0);
			expect(metrics.avgHunkSize).toBe(0);
		});
	});
});
