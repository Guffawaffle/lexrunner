/**
 * Tests for fingerprint utilities
 */

import { describe, it, expect } from 'vitest';
import { generateFingerprint, extractFingerprint, injectFingerprint } from '../src/utils/fingerprint';

describe('fingerprint utilities', () => {
	describe('generateFingerprint', () => {
		it('should generate consistent fingerprint for same input', () => {
			const content = {
				title: 'Test Feature',
				description: 'Test description',
				acceptanceCriteria: ['AC1', 'AC2']
			};

			const fp1 = generateFingerprint(content);
			const fp2 = generateFingerprint(content);

			expect(fp1).toBe(fp2);
			expect(fp1).toHaveLength(16);
			expect(fp1).toMatch(/^[a-f0-9]{16}$/);
		});

		it('should generate different fingerprints for different inputs', () => {
			const content1 = { title: 'Feature A' };
			const content2 = { title: 'Feature B' };

			const fp1 = generateFingerprint(content1);
			const fp2 = generateFingerprint(content2);

			expect(fp1).not.toBe(fp2);
		});

		it('should be deterministic regardless of object key order', () => {
			const content1 = { title: 'Test', description: 'Desc' };
			const content2 = { description: 'Desc', title: 'Test' };

			const fp1 = generateFingerprint(content1);
			const fp2 = generateFingerprint(content2);

			expect(fp1).toBe(fp2);
		});
	});

	describe('extractFingerprint', () => {
		it('should extract fingerprint from HTML comment', () => {
			const text = 'Some content\n\n<!-- fingerprint:abc123def4567890 -->';
			const fp = extractFingerprint(text);

			expect(fp).toBe('abc123def4567890');
		});

		it('should return null if no fingerprint found', () => {
			const text = 'Some content without fingerprint';
			const fp = extractFingerprint(text);

			expect(fp).toBeNull();
		});

		it('should extract fingerprint from middle of text', () => {
			const text = 'Header\n<!-- fingerprint:1234567890abcdef -->\nFooter';
			const fp = extractFingerprint(text);

			expect(fp).toBe('1234567890abcdef');
		});
	});

	describe('injectFingerprint', () => {
		it('should inject fingerprint as HTML comment', () => {
			const text = 'Some content';
			const fp = 'abc123def4567890';
			const result = injectFingerprint(text, fp);

			expect(result).toContain('<!-- fingerprint:abc123def4567890 -->');
			expect(result).toContain('Some content');
		});

		it('should preserve original content', () => {
			const text = 'Line 1\nLine 2\nLine 3';
			const fp = '1234567890abcdef';
			const result = injectFingerprint(text, fp);

			expect(result).toContain('Line 1\nLine 2\nLine 3');
		});

		it('should allow extraction after injection', () => {
			const text = 'Test content';
			const fp = '1234567890abcdef';
			const injected = injectFingerprint(text, fp);
			const extracted = extractFingerprint(injected);

			expect(extracted).toBe(fp);
		});
	});
});
