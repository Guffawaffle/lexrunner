/**
 * Tests for audit manifest signing (KMS + GPG)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSignerOption, signManifest, verifyManifestSignature, computeManifestHash } from '../../src/audit/signing.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { canonicalJSONStringify } from '../../src/util/canonicalJson.js';

describe('Audit Signing - parseSignerOption', () => {
	it('should parse KMS signer option', () => {
		const result = parseSignerOption('kms:arn:aws:kms:us-east-1:123456789012:key/abc-123');
		expect(result).toEqual({
			provider: 'kms',
			keyRef: 'arn:aws:kms:us-east-1:123456789012:key/abc-123'
		});
	});

	it('should parse GPG signer option', () => {
		const result = parseSignerOption('gpg:ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234');
		expect(result).toEqual({
			provider: 'gpg',
			keyRef: 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234'
		});
	});

	it('should handle none provider', () => {
		const result = parseSignerOption('none');
		expect(result).toEqual({
			provider: 'none'
		});
	});

	it('should handle empty string', () => {
		const result = parseSignerOption('');
		expect(result).toEqual({
			provider: 'none'
		});
	});

	it('should throw on invalid format', () => {
		expect(() => parseSignerOption('invalid-format')).toThrow('Invalid signer option format');
	});

	it('should throw on unsupported provider', () => {
		expect(() => parseSignerOption('unsupported:key123')).toThrow('Unsupported signing provider');
	});

	it('should throw on missing key reference', () => {
		expect(() => parseSignerOption('kms:')).toThrow('Key reference is required');
	});
});

describe('Audit Signing - computeManifestHash', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-test-'));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('should compute SHA-256 hash of manifest using canonical JSON', () => {
		const manifestPath = path.join(tmpDir, 'audit-manifest.json');
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [
				{ file: 'audit.ndjson', sha256: 'abc123', bytes: 100 }
			],
			totalBytes: 100
		};
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const hash = computeManifestHash(manifestPath);
		
		// Hash should be deterministic based on canonical JSON
		expect(hash).toBeDefined();
		expect(hash).toHaveLength(64); // SHA-256 hex string
		expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
	});

	it('should produce consistent hash regardless of JSON formatting', () => {
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [
				{ file: 'audit.ndjson', sha256: 'abc123', bytes: 100 }
			],
			totalBytes: 100
		};

		// Write with different formatting
		const path1 = path.join(tmpDir, 'manifest1.json');
		const path2 = path.join(tmpDir, 'manifest2.json');
		
		fs.writeFileSync(path1, JSON.stringify(manifest, null, 2)); // Pretty
		fs.writeFileSync(path2, JSON.stringify(manifest)); // Compact

		const hash1 = computeManifestHash(path1);
		const hash2 = computeManifestHash(path2);

		expect(hash1).toBe(hash2);
	});
});

describe('Audit Signing - KMS mocked', () => {
	let tmpDir: string;
	let manifestPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-kms-'));
		manifestPath = path.join(tmpDir, 'audit-manifest.json');
		
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [
				{ file: 'audit.ndjson', sha256: 'abc123', bytes: 100 }
			],
			totalBytes: 100
		};
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	it('should sign with AWS KMS (mocked)', async () => {
		// Mock AWS SDK
		const mockSend = vi.fn().mockResolvedValue({
			Signature: Buffer.from('mock-signature-data')
		});

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		const keyArn = 'arn:aws:kms:us-east-1:123456789012:key/abc-123';
		
		await signManifest(manifestPath, {
			provider: 'kms',
			keyRef: keyArn
		});

		// Verify signature files were created
		const sigPath = path.join(tmpDir, 'audit-manifest.sig');
		const metaPath = path.join(tmpDir, 'audit-manifest.sig.meta');

		expect(fs.existsSync(sigPath)).toBe(true);
		expect(fs.existsSync(metaPath)).toBe(true);

		// Verify metadata structure
		const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
		expect(metadata.provider).toBe('kms');
		expect(metadata.algorithm).toBe('RSASSA_PSS_SHA_256');
		expect(metadata.key_ref).toBe(keyArn);
		expect(metadata.signed_at).toBeDefined();
		expect(metadata.manifest_sha256).toBeDefined();
		expect(metadata.manifest_sha256).toHaveLength(64);

		// Verify manifest was updated with signing metadata
		const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		expect(updatedManifest.signing).toBeDefined();
		expect(updatedManifest.signing.provider).toBe('kms');
		expect(updatedManifest.signing.key_ref).toBe(keyArn);
		expect(updatedManifest.signing.signature_file).toBe('audit.sig');
		expect(updatedManifest.signing.metadata_file).toBe('audit.sig.meta');

		vi.doUnmock('@aws-sdk/client-kms');
	});

	it('should handle AWS KMS signing errors gracefully', async () => {
		// Mock AWS SDK to throw error
		const mockSend = vi.fn().mockRejectedValue(new Error('KMS key not found'));

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		const keyArn = 'arn:aws:kms:us-east-1:123456789012:key/invalid';

		await expect(
			signManifest(manifestPath, { provider: 'kms', keyRef: keyArn })
		).rejects.toThrow('AWS KMS signing failed');

		vi.doUnmock('@aws-sdk/client-kms');
	});
});

describe('Audit Signing - GPG behavior', () => {
	let tmpDir: string;
	let manifestPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-gpg-'));
		manifestPath = path.join(tmpDir, 'audit-manifest.json');
		
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [
				{ file: 'audit.ndjson', sha256: 'abc123', bytes: 100 }
			],
			totalBytes: 100
		};
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	it('should handle GPG signing failure with missing key', async () => {
		// This test uses real GPG, expects it to fail with missing key
		const fingerprint = 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';

		await expect(
			signManifest(manifestPath, {
				provider: 'gpg',
				keyRef: fingerprint
			})
		).rejects.toThrow('GPG signing failed');
	});

	it('should validate GPG signature structure requirements', () => {
		// Test that the GPG signing metadata structure is correct
		const fingerprint = 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';
		const options = parseSignerOption(`gpg:${fingerprint}`);
		
		expect(options.provider).toBe('gpg');
		expect(options.keyRef).toBe(fingerprint);
	});
});

describe('Audit Signing - Integration with none provider', () => {
	let tmpDir: string;
	let manifestPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-none-'));
		manifestPath = path.join(tmpDir, 'audit-manifest.json');
		
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [],
			totalBytes: 0
		};
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('should skip signing when provider is none', async () => {
		await signManifest(manifestPath, { provider: 'none' });

		// No signature files should be created
		const sigPath = path.join(tmpDir, 'audit-manifest.sig');
		const metaPath = path.join(tmpDir, 'audit-manifest.sig.meta');

		expect(fs.existsSync(sigPath)).toBe(false);
		expect(fs.existsSync(metaPath)).toBe(false);

		// Manifest should remain unchanged
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		expect(manifest.signing).toBeUndefined();
	});
});

describe('Audit Signing - Deterministic behavior', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-det-'));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('should produce deterministic manifest hash for same content', () => {
		const manifest = {
			schemaVersion: '1.0.0',
			timestamp: '2025-01-01T00:00:00Z',
			files: [
				{ file: 'file1.txt', sha256: 'hash1', bytes: 100 },
				{ file: 'file2.txt', sha256: 'hash2', bytes: 200 }
			],
			totalBytes: 300
		};

		const path1 = path.join(tmpDir, 'manifest1.json');
		const path2 = path.join(tmpDir, 'manifest2.json');

		// Write with different whitespace
		fs.writeFileSync(path1, JSON.stringify(manifest, null, 2));
		fs.writeFileSync(path2, JSON.stringify(manifest, null, 4));

		const hash1 = computeManifestHash(path1);
		const hash2 = computeManifestHash(path2);

		expect(hash1).toBe(hash2);
	});

	it('should use canonical JSON for hash computation', () => {
		// Create two manifests with different key ordering
		const manifestPath1 = path.join(tmpDir, 'manifest1.json');
		const manifestPath2 = path.join(tmpDir, 'manifest2.json');

		// Keys in different order
		const manifest1 = { b: 2, a: 1 };
		const manifest2 = { a: 1, b: 2 };

		fs.writeFileSync(manifestPath1, JSON.stringify(manifest1));
		fs.writeFileSync(manifestPath2, JSON.stringify(manifest2));

		const hash1 = computeManifestHash(manifestPath1);
		const hash2 = computeManifestHash(manifestPath2);

		// Canonical JSON should produce same hash
		expect(hash1).toBe(hash2);
	});
});
