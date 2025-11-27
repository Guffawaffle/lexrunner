/**
 * Integration tests for audit manifest signing with emitter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAuditEmitter, finalizeAudit } from '../../src/audit/emitter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Audit Signing Integration', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-audit-signing-int-'));
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	it('should create audit manifest without signing when signer is not specified', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tmpDir
		});

		await emitter.emit('test_event', { message: 'test' });
		await finalizeAudit(emitter, 'success');

		// Manifest should exist
		const manifestPath = path.join(tmpDir, 'audit-manifest.json');
		expect(fs.existsSync(manifestPath)).toBe(true);

		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		expect(manifest.schemaVersion).toBe('1.0.0');
		expect(manifest.files).toBeDefined();
		expect(Array.isArray(manifest.files)).toBe(true);

		// No signing files should exist
		expect(fs.existsSync(path.join(tmpDir, 'audit-manifest.sig'))).toBe(false);
		expect(fs.existsSync(path.join(tmpDir, 'audit-manifest.sig.meta'))).toBe(false);
	});

	it('should skip signing when profile is off', async () => {
		const emitter = await initAuditEmitter({
			profile: 'off',
			dir: tmpDir,
			signer: 'kms:arn:aws:kms:us-east-1:123456789012:key/test'
		});

		await emitter.emit('test_event', { message: 'test' });
		await finalizeAudit(emitter, 'success');

		// No manifest should be created when profile is off
		const manifestPath = path.join(tmpDir, 'audit-manifest.json');
		expect(fs.existsSync(manifestPath)).toBe(false);
	});

	it('should call signing when signer option is provided (KMS mocked)', async () => {
		// Mock AWS SDK
		const mockSend = vi.fn().mockResolvedValue({
			Signature: Buffer.from('mock-kms-signature')
		});

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		const keyArn = 'arn:aws:kms:us-east-1:123456789012:key/integration-test';
		
		const emitter = await initAuditEmitter({
			profile: 'soc2',
			dir: tmpDir,
			signer: `kms:${keyArn}`,
			context: ['git']
		});

		await emitter.emit('gate_started', { item: 'pr-1', gate: 'lint' });
		await emitter.emit('gate_finished', { item: 'pr-1', gate: 'lint', status: 'pass', duration_ms: 1000 });
		await finalizeAudit(emitter, 'success');

		// Verify all files exist
		const manifestPath = path.join(tmpDir, 'audit-manifest.json');
		const sigPath = path.join(tmpDir, 'audit-manifest.sig');
		const metaPath = path.join(tmpDir, 'audit-manifest.sig.meta');

		expect(fs.existsSync(manifestPath)).toBe(true);
		expect(fs.existsSync(sigPath)).toBe(true);
		expect(fs.existsSync(metaPath)).toBe(true);

		// Verify manifest has signing metadata
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		expect(manifest.signing).toBeDefined();
		expect(manifest.signing.provider).toBe('kms');
		expect(manifest.signing.key_ref).toBe(keyArn);
		expect(manifest.signing.algorithm).toBe('RSASSA_PSS_SHA_256');

		// Verify signature metadata
		const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
		expect(metadata.provider).toBe('kms');
		expect(metadata.key_ref).toBe(keyArn);
		expect(metadata.manifest_sha256).toBeDefined();
		expect(metadata.signed_at).toBeDefined();

		vi.doUnmock('@aws-sdk/client-kms');
	});

	it('should handle GPG signing failure gracefully', async () => {
		// Test GPG signing with missing key (expected to fail)
		const fingerprint = 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234';
		
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tmpDir,
			signer: `gpg:${fingerprint}`
		});

		await emitter.emit('test_event', { data: 'test-data' });

		// Should throw GPG signing error
		await expect(finalizeAudit(emitter, 'success')).rejects.toThrow('GPG signing failed');
	});

	it('should propagate signing errors during finalize', async () => {
		// Mock AWS SDK to throw error
		const mockSend = vi.fn().mockRejectedValue(new Error('KMS AccessDeniedException'));

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		const emitter = await initAuditEmitter({
			profile: 'soc2',
			dir: tmpDir,
			signer: 'kms:arn:aws:kms:us-east-1:123456789012:key/no-access'
		});

		await emitter.emit('test_event', { message: 'test' });

		// Finalize should throw signing error
		await expect(finalizeAudit(emitter, 'success')).rejects.toThrow('AWS KMS signing failed');

		vi.doUnmock('@aws-sdk/client-kms');
	});

	it('should work with encrypted audit logs and signing', async () => {
		// Mock KMS
		const mockSend = vi.fn().mockResolvedValue({
			Signature: Buffer.from('encrypted-audit-signature')
		});

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		// Generate 32-byte hex key for encryption
		const encryptionKey = Buffer.alloc(32).fill(0xAB).toString('hex');

		const emitter = await initAuditEmitter({
			profile: 'hipaa-strict',
			dir: tmpDir,
			signer: 'kms:arn:aws:kms:us-east-1:123456789012:key/hipaa-test',
			encryptionKeyHex: encryptionKey
		});

		await emitter.emit('phi_access', { record_id: 'patient-123' });
		await finalizeAudit(emitter, 'success');

		// Verify encrypted log exists
		expect(fs.existsSync(path.join(tmpDir, 'audit.ndjson.enc'))).toBe(true);
		expect(fs.existsSync(path.join(tmpDir, 'audit.ndjson'))).toBe(false); // Plaintext removed

		// Verify manifest includes encrypted file
		const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'audit-manifest.json'), 'utf-8'));
		const encFile = manifest.files.find((f: any) => f.file === 'audit.ndjson.enc');
		expect(encFile).toBeDefined();

		// Verify signing metadata
		expect(manifest.signing).toBeDefined();
		expect(manifest.signing.provider).toBe('kms');

		vi.doUnmock('@aws-sdk/client-kms');
	});

	it('should handle invalid signer format gracefully', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tmpDir,
			signer: 'invalid-format-no-colon'
		});

		await emitter.emit('test_event', { message: 'test' });

		await expect(finalizeAudit(emitter, 'success')).rejects.toThrow('Invalid signer option format');
	});

	it('should create deterministic manifest with signing metadata', async () => {
		// Mock KMS with deterministic response
		const mockSend = vi.fn().mockResolvedValue({
			Signature: Buffer.from('deterministic-signature')
		});

		vi.doMock('@aws-sdk/client-kms', () => ({
			KMSClient: vi.fn(function () {
				return { send: mockSend };
			}),
			SignCommand: vi.fn(function (params) {
				return params;
			})
		}));

		const keyArn = 'arn:aws:kms:us-east-1:123456789012:key/deterministic-test';
		
		const emitter = await initAuditEmitter({
			profile: 'soc2',
			dir: tmpDir,
			signer: `kms:${keyArn}`,
			sessionId: 'fixed-session-id',
			runId: 'fixed-run-id',
			tool: { name: 'lex-pr-runner', version: '1.0.0' }
		});

		await emitter.emit('gate_finished', { 
			item: 'pr-1', 
			gate: 'lint', 
			status: 'pass',
			duration_ms: 1000 
		});
		
		await finalizeAudit(emitter, 'success');

		// Read manifest
		const manifest1 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'audit-manifest.json'), 'utf-8'));

		// Verify signing metadata structure is consistent
		expect(manifest1.signing).toBeDefined();
		expect(manifest1.signing.provider).toBe('kms');
		expect(manifest1.signing.key_ref).toBe(keyArn);
		expect(manifest1.signing.signature_file).toBe('audit.sig');
		expect(manifest1.signing.metadata_file).toBe('audit.sig.meta');

		// Verify files array is sorted
		const files = manifest1.files;
		for (let i = 1; i < files.length; i++) {
			expect(files[i].file.localeCompare(files[i - 1].file)).toBeGreaterThanOrEqual(0);
		}

		vi.doUnmock('@aws-sdk/client-kms');
	});
});
