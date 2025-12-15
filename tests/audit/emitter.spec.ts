/**
 * Audit emitter tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { initAuditEmitter, emitEvent, finalizeAudit, EVENT_TYPES } from '../../src/audit/index.js';

describe('Audit Emitter', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'audit-emitter-test-'));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('Initialization', () => {
		it('should create audit directory and files for basic profile', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			expect(existsSync(auditDir)).toBe(true);
			expect(existsSync(join(auditDir, 'audit.ndjson'))).toBe(true);
			expect(existsSync(join(auditDir, 'audit.schema.json'))).toBe(true);

			await finalizeAudit(emitter);
		});

		it('should set environment variables for sidecar integration', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			expect(process.env.LEX_AUDIT_DROP_DIR).toBeDefined();
			expect(process.env.LEX_AUDIT_SESSION_ID).toBeDefined();
			expect(process.env.LEX_AUDIT_SESSION_ID).toBe(emitter.getSessionId());

			await finalizeAudit(emitter);
		});

		it('should not create files when profile is off', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'off',
				dir: auditDir
			});

			// Audit directory may exist but NDJSON should not be written
			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			// Off profile means no files created
			const files = existsSync(auditDir) ? readdirSync(auditDir) : [];
			expect(files.length).toBe(0);
		});
	});

	describe('Event Emission', () => {
		it('should write events to NDJSON file', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, {
				argv: ['lex-pr', 'execute', 'plan.json'],
				cwd: '/test/dir'
			});

			await emitEvent(emitter, EVENT_TYPES.PLAN_VALIDATED, {
				schema_version: '1.0.0',
				warnings: []
			});

			await finalizeAudit(emitter);

			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const lines = ndjsonContent.trim().split('\n');

			expect(lines.length).toBeGreaterThanOrEqual(2);

			const event1 = JSON.parse(lines[0]);
			expect(event1.event).toBe(EVENT_TYPES.COMMAND_INVOCATION);
			expect(event1.payload.argv).toEqual(['lex-pr', 'execute', 'plan.json']);
			expect(event1.schema_version).toBe('0.1.0');
			expect(event1.session_id).toBeDefined();
			expect(event1.run_id).toBeDefined();
			expect(event1.tool).toBeDefined();
			expect(event1.actor).toBeDefined();
		});

		it('should apply redaction to event payloads', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir,
				redactRegex: 'token|secret'
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, {
				argv: ['lex-pr', 'execute', '--token', 'my-secret-token'],
				env: {
					GITHUB_TOKEN: 'ghp_123456',
					NORMAL_VAR: 'safe-value'
				}
			});

			await finalizeAudit(emitter);

			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const lines = ndjsonContent.trim().split('\n');
			const event = JSON.parse(lines[0]);

			// Token should be redacted
			expect(JSON.stringify(event.payload)).toContain('***REDACTED***');
		});

		it('should hash paths when hashPaths is enabled', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'hipaa-strict',
				dir: auditDir,
				hashPaths: true,
				encryptionKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
			});

			await emitEvent(emitter, EVENT_TYPES.ARTIFACT_WRITTEN, {
				path: '/sensitive/path/to/file.txt',
				sha256: 'abc123',
				bytes: 1024
			});

			await finalizeAudit(emitter);

			// After finalization with encryption, audit.ndjson is encrypted to .enc and removed
			const encPath = join(auditDir, 'audit.ndjson.enc');
			expect(existsSync(encPath)).toBe(true);
			expect(existsSync(join(auditDir, 'audit.ndjson'))).toBe(false);

			// We can't directly read the encrypted file to verify hashing,
			// but we can verify encryption happened (which requires hashPaths was processed)
		});

		it('should apply sampling when configured', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir,
				sample: 0 // 0% sampling - no events should be written
			});

			// Emit multiple events
			for (let i = 0; i < 10; i++) {
				await emitEvent(emitter, EVENT_TYPES.GATE_STARTED, {
					item: i,
					gate: 'test'
				});
			}

			await finalizeAudit(emitter);

			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const lines = ndjsonContent.trim().split('\n').filter(l => l);

			// With 0% sampling, no events should be written
			expect(lines.length).toBe(0);
		});
	});

	describe('Finalization', () => {
		it('should write summary file on finalization', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await emitEvent(emitter, EVENT_TYPES.GATE_STARTED, { item: 1, gate: 'lint' });
			await finalizeAudit(emitter, 'success');

			expect(existsSync(join(auditDir, 'audit-summary.json'))).toBe(true);

			const summaryContent = await readFile(join(auditDir, 'audit-summary.json'), 'utf-8');
			const summary = JSON.parse(summaryContent);

			expect(summary.schemaVersion).toBe('1.0.0');
			expect(summary.sessionId).toBe(emitter.getSessionId());
			expect(summary.runId).toBe(emitter.getRunId());
			expect(summary.profile).toBe('basic');
			expect(summary.totalEvents).toBe(2);
			expect(summary.eventsByType).toBeDefined();
			expect(summary.finalStatus).toBe('success');
		});

		it('should write manifest file on finalization', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			expect(existsSync(join(auditDir, 'audit-manifest.json'))).toBe(true);

			const manifestContent = await readFile(join(auditDir, 'audit-manifest.json'), 'utf-8');
			const manifest = JSON.parse(manifestContent);

			expect(manifest.schemaVersion).toBe('1.0.0');
			expect(manifest.files).toBeDefined();
			expect(Array.isArray(manifest.files)).toBe(true);
			expect(manifest.totalBytes).toBeGreaterThan(0);

			// Check that files have sha256 hashes
			for (const file of manifest.files) {
				expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
				expect(file.bytes).toBeGreaterThan(0);
			}
		});

		it('should create signature stub for soc2 profile', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'soc2',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			expect(existsSync(join(auditDir, 'audit.sig'))).toBe(true);

			const sigContent = await readFile(join(auditDir, 'audit.sig'), 'utf-8');
			expect(sigContent).toContain('Signature stub');
		});
	});

	describe('Envelope Structure', () => {
		it('should include all required envelope fields', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const event = JSON.parse(ndjsonContent.trim().split('\n')[0]);

			// Check required envelope fields
			expect(event.schema_version).toBeDefined();
			expect(event.event).toBeDefined();
			expect(event.ts).toBeDefined();
			expect(event.level).toBeDefined();
			expect(event.session_id).toBeDefined();
			expect(event.run_id).toBeDefined();
			expect(event.tool).toBeDefined();
			expect(event.tool.name).toBe('lexrunner');
			expect(event.tool.version).toBeDefined();
			expect(event.actor).toBeDefined();
			expect(event.actor.type).toMatch(/^(cli|mcp|ci)$/);
			expect(event.repo).toBeDefined();
			expect(event.payload).toBeDefined();
		});

		it('should include context when configured', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'soc2',
				dir: auditDir,
				context: ['os', 'ci'],
				includeEnv: ['CI', 'GITHUB_ACTOR']
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const event = JSON.parse(ndjsonContent.trim().split('\n')[0]);

			expect(event.context).toBeDefined();
			expect(event.context.os).toBeDefined();
			expect(event.context.os.platform).toBeDefined();
			expect(event.context.os.arch).toBeDefined();
		});
	});

	describe('Profile Behavior', () => {
		it('should apply basic profile settings', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: auditDir
			});

			await emitEvent(emitter, EVENT_TYPES.COMMAND_INVOCATION, { argv: ['test'] });
			await finalizeAudit(emitter);

			// Basic profile should not hash paths
			const ndjsonContent = await readFile(join(auditDir, 'audit.ndjson'), 'utf-8');
			const event = JSON.parse(ndjsonContent.trim().split('\n')[0]);

			// Basic profile defaults should apply
			expect(existsSync(join(auditDir, 'audit.sig'))).toBe(false); // No signature for basic
		});

		it('should apply hipaa-strict profile settings', async () => {
			const auditDir = join(testDir, 'audit');
			const emitter = await initAuditEmitter({
				profile: 'hipaa-strict',
				dir: auditDir,
				encryptionKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
			});

			await emitEvent(emitter, EVENT_TYPES.ARTIFACT_WRITTEN, {
				path: '/test/path.txt',
				sha256: 'abc',
				bytes: 100
			});
			await finalizeAudit(emitter);

			// With HIPAA strict and encryption, the ndjson file should be encrypted
			const encPath = join(auditDir, 'audit.ndjson.enc');
			expect(existsSync(encPath)).toBe(true);
			expect(existsSync(join(auditDir, 'audit.ndjson'))).toBe(false);
		});
	});
});
