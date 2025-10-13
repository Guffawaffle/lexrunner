import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { signManifest, verifyManifestSignature, computeManifestHash } from '../src/audit/signing.js';
import { canonicalJSONStringify } from '../src/util/canonicalJson.js';

/**
 * Audit Signing Tests
 * 
 * Tests signing and verification with mocked KMS and GPG
 */
describe('Audit Signing', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'audit-signing-test-'));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe('computeManifestHash', () => {
		it('should compute deterministic hash for same content', async () => {
			const manifest = {
				files: ['file1.txt', 'file2.txt'],
				metadata: { timestamp: '2025-10-13T00:00:00Z' }
			};

			const manifestPath = join(testDir, 'manifest.json');
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			const hash1 = computeManifestHash(manifestPath);
			const hash2 = computeManifestHash(manifestPath);

			expect(hash1).toBe(hash2);
			expect(hash1).toMatch(/^[a-f0-9]{64}$/);
		});

		it('should compute same hash regardless of key order', async () => {
			const manifest1 = {
				z: 'last',
				a: 'first',
				m: 'middle'
			};

			const manifest2 = {
				a: 'first',
				m: 'middle',
				z: 'last'
			};

			const path1 = join(testDir, 'manifest1.json');
			const path2 = join(testDir, 'manifest2.json');

			await writeFile(path1, canonicalJSONStringify(manifest1));
			await writeFile(path2, canonicalJSONStringify(manifest2));

			const hash1 = computeManifestHash(path1);
			const hash2 = computeManifestHash(path2);

			expect(hash1).toBe(hash2);
		});
	});

	describe('signManifest - GPG', () => {
		it('should handle GPG signing when binary not available', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock execFile to simulate GPG not available
			vi.doMock('util', async () => {
				const actual = await vi.importActual('util');
				return {
					...actual,
					promisify: (fn: any) => {
						if (fn.name === 'execFile') {
							return async () => {
								throw new Error('Command failed');
							};
						}
						return (actual as any).promisify(fn);
					}
				};
			});

			await expect(
				signManifest(manifestPath, {
					provider: 'gpg',
					keyRef: 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234'
				})
			).rejects.toThrow();
		});
	});

	describe('signManifest - KMS', () => {
		it('should throw error for invalid KMS key reference', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			await expect(
				signManifest(manifestPath, {
					provider: 'kms',
					keyRef: 'invalid-key-ref'
				})
			).rejects.toThrow('Unable to detect KMS provider');
		});

		it('should detect AWS KMS provider from ARN', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock AWS SDK
			vi.doMock('@aws-sdk/client-kms', () => ({
				KMSClient: vi.fn(() => ({
					send: vi.fn().mockResolvedValue({
						Signature: Buffer.from('mock-signature')
					})
				})),
				SignCommand: vi.fn()
			}));

			await signManifest(manifestPath, {
				provider: 'kms',
				keyRef: 'arn:aws:kms:us-east-1:123456789012:key/abcd-1234'
			});

			// Verify signature files were created
			const sigPath = join(testDir, 'manifest.sig');
			const metaPath = join(testDir, 'manifest.sig.meta');

			const sigExists = await readFile(sigPath).then(() => true).catch(() => false);
			const metaExists = await readFile(metaPath).then(() => true).catch(() => false);

			expect(sigExists).toBe(true);
			expect(metaExists).toBe(true);
		});

		it('should detect GCP KMS provider from key path', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock GCP SDK
			vi.doMock('@google-cloud/kms', () => ({
				KeyManagementServiceClient: vi.fn(() => ({
					asymmetricSign: vi.fn().mockResolvedValue([{
						signature: Buffer.from('mock-signature')
					}])
				}))
			}));

			await signManifest(manifestPath, {
				provider: 'kms',
				keyRef: 'projects/my-project/locations/us/keyRings/my-ring/cryptoKeys/my-key'
			});

			// Verify signature files were created
			const sigPath = join(testDir, 'manifest.sig');
			const metaPath = join(testDir, 'manifest.sig.meta');

			const sigExists = await readFile(sigPath).then(() => true).catch(() => false);
			const metaExists = await readFile(metaPath).then(() => true).catch(() => false);

			expect(sigExists).toBe(true);
			expect(metaExists).toBe(true);
		});

		it('should detect Azure Key Vault from URL', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock Azure SDK
			vi.doMock('@azure/keyvault-keys', () => ({
				CryptographyClient: vi.fn(() => ({
					sign: vi.fn().mockResolvedValue({
						result: Buffer.from('mock-signature')
					})
				}))
			}));

			vi.doMock('@azure/identity', () => ({
				DefaultAzureCredential: vi.fn()
			}));

			await signManifest(manifestPath, {
				provider: 'kms',
				keyRef: 'https://my-vault.vault.azure.net/keys/my-key/version'
			});

			// Verify signature files were created
			const sigPath = join(testDir, 'manifest.sig');
			const metaPath = join(testDir, 'manifest.sig.meta');

			const sigExists = await readFile(sigPath).then(() => true).catch(() => false);
			const metaExists = await readFile(metaPath).then(() => true).catch(() => false);

			expect(sigExists).toBe(true);
			expect(metaExists).toBe(true);
		});
	});

	describe('signManifest - none provider', () => {
		it('should do nothing when provider is none', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			await signManifest(manifestPath, { provider: 'none' });

			// Verify no signature files were created
			const sigPath = join(testDir, 'manifest.sig');
			const sigExists = await readFile(sigPath).then(() => true).catch(() => false);

			expect(sigExists).toBe(false);
		});

		it('should throw error when keyRef is missing for kms', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			await expect(
				signManifest(manifestPath, { provider: 'kms' })
			).rejects.toThrow('Key reference is required');
		});
	});

	describe('verifyManifestSignature', () => {
		it('should return error when no signing metadata in manifest', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: [], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			const result = await verifyManifestSignature(manifestPath);

			expect(result.valid).toBe(false);
			expect(result.provider).toBe('none');
			expect(result.error).toBe('No signing metadata found in manifest');
		});

		it('should return error when signature files are missing', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = {
				files: [],
				metadata: {},
				signing: {
					provider: 'kms',
					key_ref: 'arn:aws:kms:us-east-1:123456789012:key/abcd-1234',
					algorithm: 'RSASSA_PSS_SHA_256',
					signature_file: 'audit.sig',
					metadata_file: 'audit.sig.meta'
				}
			};
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			const result = await verifyManifestSignature(manifestPath);

			expect(result.valid).toBe(false);
			expect(result.provider).toBe('unknown');
			expect(result.error).toBeDefined();
		});

		it('should handle unsupported signing provider', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = {
				files: [],
				metadata: {},
				signing: {
					provider: 'unknown',
					algorithm: 'UNKNOWN',
					signature_file: 'audit.sig',
					metadata_file: 'audit.sig.meta'
				}
			};
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Create empty metadata file to avoid file not found error
			const metaPath = join(testDir, 'manifest.sig.meta');
			await writeFile(metaPath, JSON.stringify({
				provider: 'unknown',
				algorithm: 'UNKNOWN',
				signed_at: '2025-10-13T00:00:00Z',
				manifest_sha256: 'abc123'
			}));

			const result = await verifyManifestSignature(manifestPath);

			expect(result.valid).toBe(false);
			expect(result.provider).toBe('unknown');
			expect(result.error).toContain('Unsupported signing provider');
		});
	});

	describe('signature metadata', () => {
		it('should create proper signature metadata structure', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: ['test.txt'], metadata: { timestamp: '2025-10-13T00:00:00Z' } };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock AWS SDK
			vi.doMock('@aws-sdk/client-kms', () => ({
				KMSClient: vi.fn(() => ({
					send: vi.fn().mockResolvedValue({
						Signature: Buffer.from('mock-signature')
					})
				})),
				SignCommand: vi.fn()
			}));

			await signManifest(manifestPath, {
				provider: 'kms',
				keyRef: 'arn:aws:kms:us-east-1:123456789012:key/test-key'
			});

			const metaPath = join(testDir, 'manifest.sig.meta');
			const metaContent = await readFile(metaPath, 'utf-8');
			const metadata = JSON.parse(metaContent);

			expect(metadata).toHaveProperty('provider', 'kms');
			expect(metadata).toHaveProperty('algorithm');
			expect(metadata).toHaveProperty('key_ref');
			expect(metadata).toHaveProperty('signed_at');
			expect(metadata).toHaveProperty('manifest_sha256');
			expect(metadata.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});

		it('should update manifest with signing metadata', async () => {
			const manifestPath = join(testDir, 'manifest.json');
			const manifest = { files: ['test.txt'], metadata: {} };
			await writeFile(manifestPath, canonicalJSONStringify(manifest));

			// Mock AWS SDK
			vi.doMock('@aws-sdk/client-kms', () => ({
				KMSClient: vi.fn(() => ({
					send: vi.fn().mockResolvedValue({
						Signature: Buffer.from('mock-signature')
					})
				})),
				SignCommand: vi.fn()
			}));

			await signManifest(manifestPath, {
				provider: 'kms',
				keyRef: 'arn:aws:kms:us-east-1:123456789012:key/test-key'
			});

			const updatedContent = await readFile(manifestPath, 'utf-8');
			const updated = JSON.parse(updatedContent);

			expect(updated).toHaveProperty('signing');
			expect(updated.signing).toHaveProperty('provider', 'kms');
			expect(updated.signing).toHaveProperty('key_ref');
			expect(updated.signing).toHaveProperty('algorithm');
			expect(updated.signing).toHaveProperty('signature_file', 'audit.sig');
			expect(updated.signing).toHaveProperty('metadata_file', 'audit.sig.meta');
		});
	});
});
