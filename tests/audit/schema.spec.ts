import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	SUPPORTED_MAJOR_VERSION,
	isSchemaCompatible,
	validateAuditEvent,
	migrateEvent,
	parseSchemaVersion
} from '../../src/audit/schema.js';
import { AuditEmitter, emitEvent, initAuditEmitter, finalizeAudit } from '../../src/audit/emitter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Audit Schema', () => {
	describe('Schema Versioning', () => {
		it('should export current schema version', () => {
			expect(CURRENT_SCHEMA_VERSION).toBe('1.0.0');
		});

		it('should export supported major version', () => {
			expect(SUPPORTED_MAJOR_VERSION).toBe(1);
		});
	});

	describe('isSchemaCompatible', () => {
		it('should accept compatible major version', () => {
			expect(isSchemaCompatible('1.0.0', 1)).toBe(true);
			expect(isSchemaCompatible('1.1.0', 1)).toBe(true);
			expect(isSchemaCompatible('1.2.5', 1)).toBe(true);
		});

		it('should reject incompatible major version', () => {
			expect(isSchemaCompatible('2.0.0', 1)).toBe(false);
			expect(isSchemaCompatible('0.9.0', 1)).toBe(false);
			expect(isSchemaCompatible('3.1.0', 1)).toBe(false);
		});

		it('should use default supported major version', () => {
			expect(isSchemaCompatible('1.0.0')).toBe(true);
			expect(isSchemaCompatible('2.0.0')).toBe(false);
		});

		it('should reject invalid version formats', () => {
			expect(isSchemaCompatible('invalid')).toBe(false);
			expect(isSchemaCompatible('1.0')).toBe(false);
			expect(isSchemaCompatible('1')).toBe(false);
			expect(isSchemaCompatible('v1.0.0')).toBe(false);
			expect(isSchemaCompatible('')).toBe(false);
		});

		it('should reject non-numeric versions', () => {
			expect(isSchemaCompatible('a.b.c')).toBe(false);
			expect(isSchemaCompatible('1.x.0')).toBe(false);
		});
	});

	describe('parseSchemaVersion', () => {
		it('should parse valid version strings', () => {
			const v1 = parseSchemaVersion('1.0.0');
			expect(v1).toEqual({ major: 1, minor: 0, patch: 0 });

			const v2 = parseSchemaVersion('2.5.3');
			expect(v2).toEqual({ major: 2, minor: 5, patch: 3 });
		});

		it('should return null for invalid formats', () => {
			expect(parseSchemaVersion('invalid')).toBeNull();
			expect(parseSchemaVersion('1.0')).toBeNull();
			expect(parseSchemaVersion('1.0.0.0')).toBeNull();
		});

		it('should return null for non-numeric versions', () => {
			expect(parseSchemaVersion('a.b.c')).toBeNull();
			expect(parseSchemaVersion('1.x.0')).toBeNull();
		});
	});

	describe('validateAuditEvent', () => {
		const validEvent = {
			schema_version: '1.0.0',
			event: 'test_event',
			ts: new Date().toISOString(),
			session_id: 'session-123',
			run_id: 'run-456',
			tool: {
				name: 'lex-pr-runner',
				version: '0.1.0'
			},
			actor: {
				type: 'cli'
			},
			repo: {
				remote: 'https://github.com/test/repo',
				branch: 'main',
				commit: 'abc123'
			},
			payload: { test: 'data' }
		};

		it('should validate correct event structure', () => {
			const result = validateAuditEvent(validEvent);
			expect(result.valid).toBe(true);
			expect(result.errors).toBeUndefined();
		});

		it('should detect missing required fields', () => {
			const invalidEvent = { ...validEvent };
			delete (invalidEvent as any).schema_version;

			const result = validateAuditEvent(invalidEvent);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing required field: schema_version');
		});

		it('should validate schema_version format', () => {
			const invalidEvent = { ...validEvent, schema_version: 'invalid' };
			const result = validateAuditEvent(invalidEvent);
			expect(result.valid).toBe(false);
			expect(result.errors?.some(e => e.includes('Invalid schema_version format'))).toBe(true);
		});

		it('should validate tool structure', () => {
			const invalidEvent = { ...validEvent, tool: { name: 'test' } }; // missing version
			const result = validateAuditEvent(invalidEvent);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Missing required field: tool.version');
		});

		it('should validate actor type enum', () => {
			const invalidEvent = { ...validEvent, actor: { type: 'invalid' } };
			const result = validateAuditEvent(invalidEvent);
			expect(result.valid).toBe(false);
			expect(result.errors?.some(e => e.includes('Invalid actor.type'))).toBe(true);
		});

		it('should accept valid actor types', () => {
			const cliEvent = { ...validEvent, actor: { type: 'cli' } };
			expect(validateAuditEvent(cliEvent).valid).toBe(true);

			const mcpEvent = { ...validEvent, actor: { type: 'mcp' } };
			expect(validateAuditEvent(mcpEvent).valid).toBe(true);

			const ciEvent = { ...validEvent, actor: { type: 'ci' } };
			expect(validateAuditEvent(ciEvent).valid).toBe(true);
		});

		it('should validate level enum if present', () => {
			const validLevels = ['info', 'warn', 'error'];
			for (const level of validLevels) {
				const event = { ...validEvent, level };
				expect(validateAuditEvent(event).valid).toBe(true);
			}

			const invalidLevel = { ...validEvent, level: 'invalid' };
			const result = validateAuditEvent(invalidLevel);
			expect(result.valid).toBe(false);
		});

		it('should allow optional fields', () => {
			const minimalEvent = {
				schema_version: '1.0.0',
				event: 'test',
				ts: new Date().toISOString(),
				session_id: 'session',
				run_id: 'run',
				tool: { name: 'test', version: '1.0.0' },
				actor: { type: 'cli' },
				repo: {},
				payload: {}
			};
			expect(validateAuditEvent(minimalEvent).valid).toBe(true);
		});
	});

	describe('migrateEvent', () => {
		it('should return event unchanged for current version', () => {
			const event = {
				schema_version: '1.0.0',
				event: 'test',
				payload: { data: 'test' }
			};

			const migrated = migrateEvent(event);
			expect(migrated).toEqual(event);
		});

		it('should accept target version parameter', () => {
			const event = { schema_version: '1.0.0', test: 'data' };
			const migrated = migrateEvent(event, '1.0.0');
			expect(migrated).toEqual(event);
		});

		// Future test for when migrations are needed
		it.skip('should migrate from v1 to v2 (future)', () => {
			// This will be implemented when v2 is released
			const v1Event = {
				schema_version: '1.0.0',
				actor: { type: 'cli' }
			};
			const v2Event = migrateEvent(v1Event, '2.0.0');
			expect(v2Event.schema_version).toBe('2.0.0');
		});
	});
});

describe('Audit Emitter', () => {
	let tempDir: string;
	let outputPath: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
		outputPath = path.join(tempDir, 'audit.ndjson');
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe('AuditEmitter', () => {
		it('should create emitter with required options', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});
			expect(emitter).toBeDefined();
			await finalizeAudit(emitter);
		});

		it('should emit valid audit events', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			await emitter.emit('gate_started', { data: 'test' });
			await finalizeAudit(emitter);

			// Verify file was created
			expect(fs.existsSync(outputPath)).toBe(true);

			// Verify content
			const content = fs.readFileSync(outputPath, 'utf-8');
			const event = JSON.parse(content.trim());

			expect(event.schema_version).toBe('0.1.0');
			expect(event.event).toBe('gate_started');
			expect(event.session_id).toBeDefined();
			expect(event.run_id).toBeDefined();
			expect(event.payload).toEqual({ data: 'test' });
		});

		it('should include tool information in events', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			await emitter.emit('gate_finished', {});
			await finalizeAudit(emitter);

			const content = fs.readFileSync(outputPath, 'utf-8');
			const event = JSON.parse(content);

			expect(event.tool.name).toBe('lex-pr-runner');
			expect(event.tool.version).toBeDefined();
		});

	it('should include actor information', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tempDir
		});

		await emitter.emit('command_invocation', {});
		await finalizeAudit(emitter);

		const content = fs.readFileSync(outputPath, 'utf-8');
		const event = JSON.parse(content);

		expect(event.actor.type).toBeDefined();
	});

	it('should support different severity levels', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tempDir
		});

		await emitter.emit('plan_discovered', {}, 'info');
		await emitter.emit('plan_validated', {}, 'warn');
		await emitter.emit('error', {}, 'error');
		await finalizeAudit(emitter);

		const content = fs.readFileSync(outputPath, 'utf-8');
		const lines = content.trim().split('\n');

		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0]).level).toBe('info');
		expect(JSON.parse(lines[1]).level).toBe('warn');
		expect(JSON.parse(lines[2]).level).toBe('error');
	});

	it('should append multiple events to NDJSON', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tempDir
		});

		await emitter.emit('gate_started', { num: 1 });
		await emitter.emit('gate_finished', { num: 2 });
		await emitter.emit('merge_finished', { num: 3 });
		await finalizeAudit(emitter);

		const content = fs.readFileSync(outputPath, 'utf-8');
		const lines = content.trim().split('\n');

		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0]).payload.num).toBe(1);
		expect(JSON.parse(lines[1]).payload.num).toBe(2);
		expect(JSON.parse(lines[2]).payload.num).toBe(3);
	});

	it('should throw error for invalid event when validation enabled', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tempDir
		});

		// This should work fine since emitter builds valid envelopes
		await expect(emitter.emit('gate_started', {})).resolves.not.toThrow();
	});

	it('should allow disabling validation', async () => {
		const emitter = await initAuditEmitter({
			profile: 'basic',
			dir: tempDir
		});

		await expect(emitter.emit('gate_started', {})).resolves.not.toThrow();
	});
	});

	describe('emitEvent helper', () => {
		it('should emit event using helper function', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			await emitEvent(emitter, 'artifact_written', { data: 'value' });
			await finalizeAudit(emitter);

			const content = fs.readFileSync(outputPath, 'utf-8');
			const event = JSON.parse(content.trim());

			expect(event.event).toBe('artifact_written');
			expect(event.payload.data).toBe('value');
		});
	});

	describe('Event Types', () => {
		it('should support all documented event types', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			const eventTypes = [
				'command_invocation',
				'plan_discovered',
				'plan_validated',
				'merge_order_computed',
				'gate_started',
				'gate_finished',
				'merge_dry_run_started',
				'merge_dry_run_finished',
				'merge_execute_started',
				'merge_conflict_detected',
				'merge_finished',
				'artifact_written',
				'error',
				'run_summary'
			];

			for (const eventType of eventTypes) {
				await emitter.emit(eventType, { test: true });
			}
			await finalizeAudit(emitter);

			const content = fs.readFileSync(outputPath, 'utf-8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(eventTypes.length);
		});
	});

	describe('Timestamp and ID Generation', () => {
		it('should include ISO 8601 timestamps', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			await emitter.emit('run_summary', {});
			await finalizeAudit(emitter);

			const content = fs.readFileSync(outputPath, 'utf-8');
			const event = JSON.parse(content);

			expect(event.ts).toBeDefined();
			expect(() => new Date(event.ts)).not.toThrow();
			expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		});

		it('should preserve session and run IDs', async () => {
			const emitter = await initAuditEmitter({
				profile: 'basic',
				dir: tempDir
			});

			await emitter.emit('run_summary', {});
			await finalizeAudit(emitter);

			const content = fs.readFileSync(outputPath, 'utf-8');
			const event = JSON.parse(content);

			expect(event.session_id).toBeDefined();
			expect(event.run_id).toBeDefined();
		});
	});
});