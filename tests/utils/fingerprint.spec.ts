/**
 * Tests for fingerprint utilities
 */

import { describe, it, expect } from 'vitest';
import { generateFingerprint, extractFingerprint, injectFingerprint } from '../../src/utils/fingerprint';

describe('generateFingerprint', () => {
  it('generates deterministic hash', () => {
    const data = { title: 'Test', description: 'Desc', ac: ['A', 'B'] };
    const fp1 = generateFingerprint(data);
    const fp2 = generateFingerprint(data);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
  });

  it('produces different hashes for different data', () => {
    const data1 = { title: 'Test1', description: 'Desc' };
    const data2 = { title: 'Test2', description: 'Desc' };
    expect(generateFingerprint(data1)).not.toBe(generateFingerprint(data2));
  });

  it('is order-independent for object keys', () => {
    const data1 = { a: 1, b: 2, c: 3 };
    const data2 = { c: 3, a: 1, b: 2 };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it('handles nested objects consistently', () => {
    const data1 = { outer: { b: 2, a: 1 }, array: [1, 2, 3] };
    const data2 = { outer: { a: 1, b: 2 }, array: [1, 2, 3] };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it('handles arrays in deterministic order', () => {
    const data1 = { items: ['a', 'b', 'c'] };
    const data2 = { items: ['a', 'b', 'c'] };
    expect(generateFingerprint(data1)).toBe(generateFingerprint(data2));
  });

  it('produces valid hex string', () => {
    const data = { test: 'value' };
    const fp = generateFingerprint(data);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it('handles empty object', () => {
    const fp = generateFingerprint({});
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it('handles complex nested structures', () => {
    const data = {
      title: 'Complex Issue',
      description: 'Multi-line\ndescription',
      acceptance_criteria: ['AC1', 'AC2', 'AC3'],
      metadata: {
        priority: 'high',
        tags: ['bug', 'urgent']
      }
    };
    const fp = generateFingerprint(data);
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('extractFingerprint', () => {
  it('extracts fingerprint from comment', () => {
    const body = '<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n## Content';
    expect(extractFingerprint(body)).toBe('abc123def456');
  });

  it('returns null if no fingerprint', () => {
    expect(extractFingerprint('No fingerprint here')).toBeNull();
  });

  it('extracts fingerprint from body with multiple comments', () => {
    const body = '<!-- other comment -->\n<!-- lex-pr-idea-fingerprint: 1234567890abcdef -->\n## Title';
    expect(extractFingerprint(body)).toBe('1234567890abcdef');
  });

  it('returns null for malformed fingerprint', () => {
    const body = '<!-- lex-pr-idea-fingerprint: xyz -->';
    expect(extractFingerprint(body)).toBeNull();
  });

  it('handles fingerprint at end of body', () => {
    const body = '## Issue Content\n\n<!-- lex-pr-idea-fingerprint: fedcba9876543210 -->';
    expect(extractFingerprint(body)).toBe('fedcba9876543210');
  });
});

describe('injectFingerprint', () => {
  it('injects fingerprint comment at beginning', () => {
    const body = '## Title\n\nContent';
    const result = injectFingerprint(body, 'abc123def456');
    expect(result).toBe('<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n## Title\n\nContent');
  });

  it('injects fingerprint into empty body', () => {
    const result = injectFingerprint('', 'abc123def456');
    expect(result).toBe('<!-- lex-pr-idea-fingerprint: abc123def456 -->\n\n');
  });

  it('preserves existing content', () => {
    const body = '# Header\n\n- List item\n- Another item';
    const result = injectFingerprint(body, '1234567890abcdef');
    expect(result).toContain('# Header');
    expect(result).toContain('- List item');
    expect(result).toContain('<!-- lex-pr-idea-fingerprint: 1234567890abcdef -->');
  });

  it('can roundtrip inject and extract', () => {
    const body = '## Test Issue';
    const fingerprint = 'abc123def456';
    const injected = injectFingerprint(body, fingerprint);
    const extracted = extractFingerprint(injected);
    expect(extracted).toBe(fingerprint);
  });
});
