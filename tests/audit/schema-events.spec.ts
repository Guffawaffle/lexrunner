/**
 * Tests for audit event schema validation (Phase 3A)
 */

import { describe, it, expect } from 'vitest';
import {
	AUDIT_SCHEMA_VERSION,
	EventType,
	EventLevel,
	ActorType,
	GateStatus,
	MergeStatus,
	parseAuditEvent,
	validateAuditEvent,
	EventEnvelopeSchema,
	CommandInvocationPayload,
	GateFinishedPayload,
	type AuditEvent,
	type CommandInvocationEvent,
	type GateFinishedEvent
} from '../../src/audit/schema/events.js';

describe('Audit Event Schema (Phase 3A)', () => {
	describe('Schema Constants', () => {
		it('should export correct schema version', () => {
			expect(AUDIT_SCHEMA_VERSION).toBe('1.0.0');
		});

		it('should define all 14 event types', () => {
			const eventTypes = EventType.options;
			expect(eventTypes).toHaveLength(14);
			expect(eventTypes).toContain('command_invocation');
			expect(eventTypes).toContain('plan_discovered');
			expect(eventTypes).toContain('plan_validated');
			expect(eventTypes).toContain('merge_order_computed');
			expect(eventTypes).toContain('gate_started');
			expect(eventTypes).toContain('gate_finished');
			expect(eventTypes).toContain('merge_dry_run_started');
			expect(eventTypes).toContain('merge_dry_run_finished');
			expect(eventTypes).toContain('merge_execute_started');
			expect(eventTypes).toContain('merge_conflict_detected');
			expect(eventTypes).toContain('merge_finished');
			expect(eventTypes).toContain('artifact_written');
			expect(eventTypes).toContain('error');
			expect(eventTypes).toContain('run_summary');
		});

		it('should define event levels', () => {
			const levels = EventLevel.options;
			expect(levels).toEqual(['info', 'warn', 'error']);
		});

		it('should define actor types', () => {
			const actorTypes = ActorType.options;
			expect(actorTypes).toEqual(['cli', 'mcp', 'ci']);
		});

		it('should define gate statuses', () => {
			const statuses = GateStatus.options;
			expect(statuses).toEqual(['pass', 'fail', 'skip', 'error']);
		});

		it('should define merge statuses', () => {
			const statuses = MergeStatus.options;
			expect(statuses).toEqual(['success', 'conflict', 'error']);
		});
	});

	describe('Event Envelope Validation', () => {
		const validEnvelope = {
			schema_version: '1.0.0',
			event: 'gate_finished',
			ts: '2024-11-02T12:00:00.000Z',
			level: 'info',
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

		it('should validate correct event envelope', () => {
			const result = validateAuditEvent(validEnvelope);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.schema_version).toBe('1.0.0');
			}
		});

		it('should reject missing required fields', () => {
			const invalid = { ...validEnvelope };
			delete (invalid as any).schema_version;
			const result = validateAuditEvent(invalid);
			expect(result.success).toBe(false);
		});

		it('should validate schema_version format', () => {
			const invalid = { ...validEnvelope, schema_version: 'invalid' };
			const result = validateAuditEvent(invalid);
			expect(result.success).toBe(false);
		});

		it('should accept valid semver versions', () => {
			const versions = ['1.0.0', '1.2.3', '2.0.0', '10.20.30'];
			for (const version of versions) {
				const event = { ...validEnvelope, schema_version: version };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should reject invalid semver versions', () => {
			const invalidVersions = ['1.0', 'v1.0.0', '1.0.0-beta', '1.x.0'];
			for (const version of invalidVersions) {
				const event = { ...validEnvelope, schema_version: version };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(false);
			}
		});

		it('should validate timestamp format', () => {
			const validTimestamps = [
				'2024-11-02T12:00:00Z',
				'2024-11-02T12:00:00.123Z',
				'2024-11-02T12:00:00.000Z'
			];
			for (const ts of validTimestamps) {
				const event = { ...validEnvelope, ts };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should accept all valid event types', () => {
			const eventTypes = EventType.options;
			for (const eventType of eventTypes) {
				const event = { ...validEnvelope, event: eventType };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should reject invalid event types', () => {
			const event = { ...validEnvelope, event: 'invalid_event' };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(false);
		});

		it('should accept all valid levels', () => {
			const levels = ['info', 'warn', 'error'];
			for (const level of levels) {
				const event = { ...validEnvelope, level };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should default level to info if not provided', () => {
			const event = { ...validEnvelope };
			delete (event as any).level;
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.level).toBe('info');
			}
		});

		it('should validate tool structure', () => {
			const invalidTool = { ...validEnvelope, tool: { name: 'test' } };
			const result = validateAuditEvent(invalidTool);
			expect(result.success).toBe(false);
		});

		it('should validate actor structure', () => {
			const validActors = [
				{ type: 'cli' },
				{ type: 'mcp' },
				{ type: 'ci' },
				{ type: 'cli', user: 'alice' }
			];
			for (const actor of validActors) {
				const event = { ...validEnvelope, actor };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should reject invalid actor type', () => {
			const event = { ...validEnvelope, actor: { type: 'invalid' } };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(false);
		});

		it('should allow optional repo fields', () => {
			const repos = [
				{},
				{ remote: 'https://github.com/test/repo' },
				{ branch: 'main' },
				{ commit: 'abc123' }
			];
			for (const repo of repos) {
				const event = { ...validEnvelope, repo };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should allow optional context', () => {
			const contexts = [
				undefined,
				{},
				{ git: { author: 'alice' } },
				{ ci: { provider: 'github-actions' } },
				{ os: { platform: 'linux' } }
			];
			for (const context of contexts) {
				const event = { ...validEnvelope, context };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});
	});

	describe('Payload Validation', () => {
		const baseEvent = {
			schema_version: '1.0.0',
			ts: '2024-11-02T12:00:00.000Z',
			level: 'info',
			session_id: 'session-123',
			run_id: 'run-456',
			tool: { name: 'lex-pr-runner', version: '0.1.0' },
			actor: { type: 'cli' },
			repo: {}
		};

		it('should validate command_invocation payload', () => {
			const payload = {
				argv: ['lex-pr', 'run', 'plan.json'],
				cwd: '/home/user/project'
			};
			const event = { ...baseEvent, event: 'command_invocation', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});

		it('should validate plan_discovered payload', () => {
			const payload = {
				pr_ids: [123, 456, 789],
				base: 'main',
				head: 'integration',
				plan_hash: 'abc123def456'
			};
			const event = { ...baseEvent, event: 'plan_discovered', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});

		it('should validate gate_finished payload', () => {
			const payload: GateFinishedPayload = {
				item: 123,
				gate: 'lint',
				duration_ms: 1234,
				status: 'pass'
			};
			const event = { ...baseEvent, event: 'gate_finished', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});

		it('should accept all gate statuses', () => {
			const statuses: GateStatus[] = ['pass', 'fail', 'skip', 'error'];
			for (const status of statuses) {
				const payload = {
					item: 123,
					gate: 'test',
					duration_ms: 1000,
					status
				};
				const event = { ...baseEvent, event: 'gate_finished', payload };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should validate merge_finished payload', () => {
			const payload = {
				item: 123,
				status: 'success',
				commit: 'def789'
			};
			const event = { ...baseEvent, event: 'merge_finished', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});

		it('should accept all merge statuses', () => {
			const statuses: MergeStatus[] = ['success', 'conflict', 'error'];
			for (const status of statuses) {
				const payload = {
					item: 123,
					status
				};
				const event = { ...baseEvent, event: 'merge_finished', payload };
				const result = validateAuditEvent(event);
				expect(result.success).toBe(true);
			}
		});

		it('should validate artifact_written payload', () => {
			const payload = {
				path: '/path/to/artifact.json',
				sha256: 'a'.repeat(64),
				bytes: 1024
			};
			const event = { ...baseEvent, event: 'artifact_written', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});

		it('should validate error payload', () => {
			const payload = {
				code: 'ERR_GATE_FAILED',
				message: 'Gate execution failed',
				where: 'gate:lint'
			};
			const event = { ...baseEvent, event: 'error', payload };
			const result = validateAuditEvent(event);
			expect(result.success).toBe(true);
		});
	});

	describe('parseAuditEvent', () => {
		const validEvent = {
			schema_version: '1.0.0',
			event: 'gate_finished',
			ts: '2024-11-02T12:00:00.000Z',
			level: 'info',
			session_id: 'session-123',
			run_id: 'run-456',
			tool: { name: 'lex-pr-runner', version: '0.1.0' },
			actor: { type: 'cli' },
			repo: {},
			payload: { item: 123, gate: 'test', duration_ms: 1000, status: 'pass' }
		};

		it('should parse valid event without throwing', () => {
			expect(() => parseAuditEvent(validEvent)).not.toThrow();
		});

		it('should return typed event', () => {
			const event = parseAuditEvent(validEvent);
			expect(event.event).toBe('gate_finished');
			expect(event.schema_version).toBe('1.0.0');
		});

		it('should throw on invalid event', () => {
			const invalid = { ...validEvent, schema_version: 'invalid' };
			expect(() => parseAuditEvent(invalid)).toThrow();
		});

		it('should throw on missing required fields', () => {
			const invalid = { ...validEvent };
			delete (invalid as any).event;
			expect(() => parseAuditEvent(invalid)).toThrow();
		});
	});

	describe('Type Safety', () => {
		it('should enforce typed payloads', () => {
			const validCommand: CommandInvocationEvent = {
				schema_version: '1.0.0',
				event: 'command_invocation',
				ts: '2024-11-02T12:00:00.000Z',
				level: 'info',
				session_id: 'session-123',
				run_id: 'run-456',
				tool: { name: 'lex-pr-runner', version: '0.1.0' },
				actor: { type: 'cli' },
				repo: {},
				payload: {
					argv: ['lex-pr', 'run'],
					cwd: '/home/user'
				}
			};

			expect(validCommand.payload.argv).toEqual(['lex-pr', 'run']);
			expect(validCommand.payload.cwd).toBe('/home/user');
		});

		it('should enforce gate_finished payload structure', () => {
			const validGate: GateFinishedEvent = {
				schema_version: '1.0.0',
				event: 'gate_finished',
				ts: '2024-11-02T12:00:00.000Z',
				level: 'info',
				session_id: 'session-123',
				run_id: 'run-456',
				tool: { name: 'lex-pr-runner', version: '0.1.0' },
				actor: { type: 'cli' },
				repo: {},
				payload: {
					item: 123,
					gate: 'lint',
					duration_ms: 1234,
					status: 'pass'
				}
			};

			expect(validGate.payload.status).toBe('pass');
			expect(validGate.payload.duration_ms).toBe(1234);
		});
	});
});
