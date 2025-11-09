/**
 * Tests for path utilities
 */

import { describe, it, expect } from 'vitest';
import { normalizePath, isSafeArtifactPath } from '../src/utils/paths';
import * as path from 'path';

describe('path utilities', () => {
	describe('normalizePath', () => {
		it('should normalize path separators', () => {
			const result = normalizePath('src\\utils\\test.ts');
			
			expect(result).not.toContain('\\');
			expect(result).toContain('src/utils/test.ts');
		});

		it('should resolve relative paths', () => {
			const result = normalizePath('./test.ts');
			
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should handle absolute paths', () => {
			const absPath = '/home/user/project/test.ts';
			const result = normalizePath(absPath);
			
			expect(result).toContain('test.ts');
		});
	});

	describe('isSafeArtifactPath', () => {
		it('should allow safe paths', () => {
			const safePaths = [
				'.smartergpt.local/deliverables/_session/idea.json',
				'./output/spec.json',
				'/tmp/test.json'
			];

			for (const p of safePaths) {
				expect(isSafeArtifactPath(p)).toBe(true);
			}
		});

		it('should reject PR artifact directories', () => {
			const unsafePaths = [
				'.smartergpt/deliverables/pr-123/idea.json',
				'.smartergpt.local/deliverables/pr-456/spec.json',
				'/home/user/project/deliverables/pr-789/test.json'
			];

			for (const p of unsafePaths) {
				expect(isSafeArtifactPath(p)).toBe(false);
			}
		});

		it('should handle normalized paths', () => {
			const unsafePath = '.smartergpt/deliverables/pr-123/test.json';
			const normalized = normalizePath(unsafePath);
			
			expect(isSafeArtifactPath(normalized)).toBe(false);
		});
	});
});
