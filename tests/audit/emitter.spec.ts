import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAuditEmitter, finalizeAudit, type AuditEmitterOptions } from '../../src/audit/emitter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Audit Emitter', () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'audit-emitter-test-'));
	});

	afterEach(async () => {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	describe('Initialization', () => {
		it('should initialize emitter with basic profile', async () => {
			const options: AuditEmitterOptions = {
				profile: 'basic',
				dir: tmpDir,
			};

			const emitter = await initAuditEmitter(options);

			expect(emitter).toBeDefined();
		});

		it('should create audit directory', async () => {
			const auditDir = path.join(tmpDir, 'audit');
			const options: AuditEmitterOptions = {
				profile: 'basic',
				dir: auditDir,
			};

			await initAuditEmitter(options);

			const exists = await fs.promises.access(auditDir).then(() => true).catch(() => false);
			expect(exists).toBe(true);
		});

		it('should collect context for soc2 profile', async () => {
			const options: AuditEmitterOptions = {
				profile: 'soc2',
				dir: tmpDir,
			};

			const emitter = await initAuditEmitter(options);
			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context).toBeDefined();
			expect(events[0].context.git).toBeDefined();
			expect(events[0].context.ci).toBeDefined();
		});

		it('should override profile context with explicit context types', async () => {
			const options: AuditEmitterOptions = {
				profile: 'basic', // No context by default
				contextTypes: ['os'], // Override to only OS context
				dir: tmpDir,
			};

			const emitter = await initAuditEmitter(options);
			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context.os).toBeDefined();
			expect(events[0].context.git).toBeUndefined();
			expect(events[0].context.ci).toBeUndefined();
		});
	});

	describe('Event Emission', () => {
		it('should emit events with schema version', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].schema_version).toBe('0.1.0');
		});

		it('should include timestamp in events', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].ts).toBeDefined();
			expect(new Date(events[0].ts).toISOString()).toBe(events[0].ts);
		});

		it('should include session and run IDs', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
				sessionId: 'session-123',
				runId: 'run-456',
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].session_id).toBe('session-123');
			expect(events[0].run_id).toBe('run-456');
		});

		it('should include tool information', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
				tool: { name: 'lex-pr-runner', version: '0.1.0' },
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].tool).toEqual({ name: 'lex-pr-runner', version: '0.1.0' });
		});

		it('should detect CI actor', async () => {
			const originalEnv = process.env;
			process.env = { ...originalEnv, CI: 'true', GITHUB_ACTOR: 'testuser' };

			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].actor).toEqual({ type: 'ci', name: 'testuser' });

			process.env = originalEnv;
		});

		it('should include payload', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('gate_finished', {
				item: '166',
				gate: 'lint',
				status: 'pass',
				duration_ms: 1234,
			});

			const events = emitter.getEvents();
			expect(events[0].payload).toEqual({
				item: '166',
				gate: 'lint',
				status: 'pass',
				duration_ms: 1234,
			});
		});
	});

	describe('NDJSON Output', () => {
		it('should write events to NDJSON file', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('event1', { data: 1 });
			emitter.emit('event2', { data: 2 });

			await finalizeAudit(emitter);

			// Read NDJSON file
			const content = await fs.promises.readFile(
				path.join(tmpDir, 'audit.ndjson'),
				'utf-8'
			);

			const lines = content.trim().split('\n');
			expect(lines).toHaveLength(2);

			const event1 = JSON.parse(lines[0]);
			const event2 = JSON.parse(lines[1]);

			expect(event1.event).toBe('event1');
			expect(event2.event).toBe('event2');
		});
	});

	describe('Gate Matrix Generation', () => {
		it('should generate gate matrix for soc2 profile', async () => {
			const emitter = await initAuditEmitter({
				profile: 'soc2',
				dir: tmpDir,
			});

			emitter.emit('gate_started', { item: '166', gate: 'lint' });
			emitter.emit('gate_finished', { item: '166', gate: 'lint', status: 'pass' });

			await finalizeAudit(emitter);

			// Check gate matrix file exists
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');
			const exists = await fs.promises.access(matrixPath).then(() => true).catch(() => false);
			expect(exists).toBe(true);

			// Verify content
			const content = await fs.promises.readFile(matrixPath, 'utf-8');
			const matrix = JSON.parse(content);

			expect(matrix.matrix['166']).toBeDefined();
			expect(matrix.matrix['166']['lint'].status).toBe('pass');
		});

		it('should generate gate matrix for hipaa-strict profile', async () => {
			const emitter = await initAuditEmitter({
				profile: 'hipaa-strict',
				dir: tmpDir,
			});

			emitter.emit('gate_finished', { item: '167', gate: 'typecheck', status: 'fail' });

			await finalizeAudit(emitter);

			// Check gate matrix file exists
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');
			const exists = await fs.promises.access(matrixPath).then(() => true).catch(() => false);
			expect(exists).toBe(true);
		});

		it('should not generate gate matrix for basic profile', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tmpDir,
			});

			emitter.emit('gate_finished', { item: '166', gate: 'lint', status: 'pass' });

			await finalizeAudit(emitter);

			// Check gate matrix file does not exist
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');
			const exists = await fs.promises.access(matrixPath).then(() => true).catch(() => false);
			expect(exists).toBe(false);
		});
	});

	describe('Context in Events', () => {
		it('should include git context when requested', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				contextTypes: ['git'],
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context.git).toBeDefined();
			expect(events[0].context.git?.commit).toBeDefined();
		});

		it('should include CI context when requested', async () => {
			const originalEnv = process.env;
			process.env = { ...originalEnv, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123' };

			const emitter = await initAuditEmitter({
				profile: 'basic',
				contextTypes: ['ci'],
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context.ci).toBeDefined();
			expect(events[0].context.ci?.provider).toBe('github-actions');

			process.env = originalEnv;
		});

		it('should include OS context when requested', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				contextTypes: ['os'],
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context.os).toBeDefined();
			expect(events[0].context.os?.platform).toBeDefined();
		});

		it('should include all context for soc2 profile', async () => {
			const emitter = await initAuditEmitter({
				profile: 'soc2',
				dir: tmpDir,
			});

			emitter.emit('test_event', { test: 'data' });

			const events = emitter.getEvents();
			expect(events[0].context.git).toBeDefined();
			expect(events[0].context.ci).toBeDefined();
			expect(events[0].context.os).toBeUndefined(); // soc2 doesn't include OS
		});

		it('should include same context in all events', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				contextTypes: ['git'],
				dir: tmpDir,
			});

			emitter.emit('event1', { data: 1 });
			emitter.emit('event2', { data: 2 });

			const events = emitter.getEvents();
			expect(events[0].context.git?.commit).toBe(events[1].context.git?.commit);
		});
	});
});
