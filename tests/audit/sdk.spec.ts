import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAuditSDK } from '../../src/audit/sdk/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Audit SDK', () => {
	let tmpDir: string;
	let originalDropDir: string | undefined;
	let originalSessionId: string | undefined;

	beforeEach(() => {
		// Create temp directory for tests
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-sdk-test-'));
		
		// Save original env vars
		originalDropDir = process.env.LEX_AUDIT_DROP_DIR;
		originalSessionId = process.env.LEX_AUDIT_SESSION_ID;
	});

	afterEach(() => {
		// Restore env vars
		if (originalDropDir !== undefined) {
			process.env.LEX_AUDIT_DROP_DIR = originalDropDir;
		} else {
			delete process.env.LEX_AUDIT_DROP_DIR;
		}
		
		if (originalSessionId !== undefined) {
			process.env.LEX_AUDIT_SESSION_ID = originalSessionId;
		} else {
			delete process.env.LEX_AUDIT_SESSION_ID;
		}

		// Clean up temp directory
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	describe('Active Mode (with env vars)', () => {
		beforeEach(() => {
			process.env.LEX_AUDIT_DROP_DIR = tmpDir;
			process.env.LEX_AUDIT_SESSION_ID = '01JB-TEST-SESSION';
		});

		it('should write NDJSON to sidecar file', async () => {
			const audit = initAuditSDK('test-gate');
			await audit.emit('test_event', { foo: 'bar' });
			await audit.close();

			const sidecarPath = path.join(tmpDir, `test-gate.${process.pid}.ndjson`);
			expect(fs.existsSync(sidecarPath)).toBe(true);

			const content = fs.readFileSync(sidecarPath, 'utf-8');
			const lines = content.trim().split('\n');
			expect(lines).toHaveLength(1);

			const event = JSON.parse(lines[0]);
			expect(event.event).toBe('test_event');
			expect(event.gate).toBe('test-gate');
			expect(event.payload.foo).toBe('bar');
			expect(event.level).toBe('info');
			expect(event.ts).toBeDefined();
			expect(() => new Date(event.ts)).not.toThrow();
		});

		it('should emit multiple events to same file', async () => {
			const audit = initAuditSDK('multi-gate');
			await audit.emit('event_1', { data: 'first' });
			await audit.emit('event_2', { data: 'second' });
			await audit.emit('event_3', { data: 'third' });
			await audit.close();

			const sidecarPath = path.join(tmpDir, `multi-gate.${process.pid}.ndjson`);
			const content = fs.readFileSync(sidecarPath, 'utf-8');
			const lines = content.trim().split('\n');
			
			expect(lines).toHaveLength(3);
			
			const events = lines.map(line => JSON.parse(line));
			expect(events[0].event).toBe('event_1');
			expect(events[1].event).toBe('event_2');
			expect(events[2].event).toBe('event_3');
		});

		it('should support custom log levels', async () => {
			const audit = initAuditSDK('level-gate');
			await audit.emit('info_event', { level: 'info' }, 'info');
			await audit.emit('warn_event', { level: 'warn' }, 'warn');
			await audit.emit('error_event', { level: 'error' }, 'error');
			await audit.close();

			const sidecarPath = path.join(tmpDir, `level-gate.${process.pid}.ndjson`);
			const content = fs.readFileSync(sidecarPath, 'utf-8');
			const events = content.trim().split('\n').map(line => JSON.parse(line));

			expect(events[0].level).toBe('info');
			expect(events[1].level).toBe('warn');
			expect(events[2].level).toBe('error');
		});

		it('should emit vulnerability findings with emitVuln', async () => {
			const audit = initAuditSDK('vuln-gate');
			
			await audit.emitVuln('CVE-2024-1234', 'high', {
				package: 'lodash',
				version: '4.17.20',
				fixedIn: '4.17.21'
			});

			await audit.close();

			const sidecarPath = path.join(tmpDir, `vuln-gate.${process.pid}.ndjson`);
			const content = fs.readFileSync(sidecarPath, 'utf-8');
			const event = JSON.parse(content.trim());

			expect(event.event).toBe('vuln_found');
			expect(event.level).toBe('warn');
			expect(event.payload.cve).toBe('CVE-2024-1234');
			expect(event.payload.severity).toBe('high');
			expect(event.payload.package).toBe('lodash');
			expect(event.payload.version).toBe('4.17.20');
			expect(event.payload.fixedIn).toBe('4.17.21');
		});

		it('should emit test results with emitTestResult', async () => {
			const audit = initAuditSDK('test-gate');
			
			await audit.emitTestResult('unit-test-1', 'pass', 123);
			await audit.emitTestResult('unit-test-2', 'fail', 456);
			await audit.emitTestResult('unit-test-3', 'skip');

			await audit.close();

			const sidecarPath = path.join(tmpDir, `test-gate.${process.pid}.ndjson`);
			const content = fs.readFileSync(sidecarPath, 'utf-8');
			const events = content.trim().split('\n').map(line => JSON.parse(line));

			expect(events).toHaveLength(3);

			expect(events[0].event).toBe('test_result');
			expect(events[0].payload.name).toBe('unit-test-1');
			expect(events[0].payload.status).toBe('pass');
			expect(events[0].payload.duration_ms).toBe(123);

			expect(events[1].payload.name).toBe('unit-test-2');
			expect(events[1].payload.status).toBe('fail');
			expect(events[1].payload.duration_ms).toBe(456);

			expect(events[2].payload.name).toBe('unit-test-3');
			expect(events[2].payload.status).toBe('skip');
			expect(events[2].payload.duration_ms).toBeUndefined();
		});

		it('should use correct file naming with PID', async () => {
			const audit = initAuditSDK('pid-test');
			await audit.emit('test', { pid: process.pid });
			await audit.close();

			const expectedPath = path.join(tmpDir, `pid-test.${process.pid}.ndjson`);
			expect(fs.existsSync(expectedPath)).toBe(true);
		});

		it('should handle different gate names', async () => {
			const audit1 = initAuditSDK('gate-one');
			const audit2 = initAuditSDK('gate-two');

			await audit1.emit('event', { gate: 'one' });
			await audit2.emit('event', { gate: 'two' });

			await audit1.close();
			await audit2.close();

			const path1 = path.join(tmpDir, `gate-one.${process.pid}.ndjson`);
			const path2 = path.join(tmpDir, `gate-two.${process.pid}.ndjson`);

			expect(fs.existsSync(path1)).toBe(true);
			expect(fs.existsSync(path2)).toBe(true);

			const event1 = JSON.parse(fs.readFileSync(path1, 'utf-8').trim());
			const event2 = JSON.parse(fs.readFileSync(path2, 'utf-8').trim());

			expect(event1.gate).toBe('gate-one');
			expect(event2.gate).toBe('gate-two');
		});
	});

	describe('No-op Mode (without env vars)', () => {
		beforeEach(() => {
			delete process.env.LEX_AUDIT_DROP_DIR;
			delete process.env.LEX_AUDIT_SESSION_ID;
		});

		it('should be no-op when env vars not set', async () => {
			const audit = initAuditSDK('noop-gate');
			await audit.emit('test_event', { foo: 'bar' });
			await audit.close();

			// Should not create any files
			const files = fs.readdirSync(tmpDir);
			expect(files).toHaveLength(0);
		});

		it('should be no-op when only DROP_DIR is set', async () => {
			process.env.LEX_AUDIT_DROP_DIR = tmpDir;
			// LEX_AUDIT_SESSION_ID is not set

			const audit = initAuditSDK('partial-gate');
			await audit.emit('test', {});
			await audit.close();

			const files = fs.readdirSync(tmpDir);
			expect(files).toHaveLength(0);
		});

		it('should be no-op when only SESSION_ID is set', async () => {
			process.env.LEX_AUDIT_SESSION_ID = '01JB-TEST';
			// LEX_AUDIT_DROP_DIR is not set

			const audit = initAuditSDK('partial-gate');
			await audit.emit('test', {});
			await audit.close();

			const files = fs.readdirSync(tmpDir);
			expect(files).toHaveLength(0);
		});

		it('should not throw when calling methods in no-op mode', async () => {
			const audit = initAuditSDK('noop-gate');
			
			// All these should succeed without errors
			await expect(audit.emit('event', {})).resolves.toBeUndefined();
			await expect(audit.emitVuln('CVE-2024-1234', 'high')).resolves.toBeUndefined();
			await expect(audit.emitTestResult('test', 'pass', 100)).resolves.toBeUndefined();
			await expect(audit.close()).resolves.toBeUndefined();
		});
	});

	describe('Real-world Usage Patterns', () => {
		beforeEach(() => {
			process.env.LEX_AUDIT_DROP_DIR = tmpDir;
			process.env.LEX_AUDIT_SESSION_ID = '01JB-REAL-TEST';
		});

		it('should handle vulnerability scanner pattern', async () => {
			const audit = initAuditSDK('vuln');

			// Scan start
			await audit.emit('scan_start', { target: 'package.json' });

			// Findings
			await audit.emitVuln('CVE-2024-1234', 'high', {
				package: 'lodash',
				version: '4.17.20',
				fixedIn: '4.17.21'
			});

			await audit.emitVuln('CVE-2024-5678', 'medium', {
				package: 'express',
				version: '4.17.1',
				fixedIn: '4.18.0'
			});

			// Scan complete
			await audit.emit('scan_complete', {
				total: 120,
				vulnerable: 2,
				severity_breakdown: { critical: 0, high: 1, medium: 1, low: 0 }
			});

			await audit.close();

			const sidecarPath = path.join(tmpDir, `vuln.${process.pid}.ndjson`);
			const events = fs.readFileSync(sidecarPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));

			expect(events).toHaveLength(4);
			expect(events[0].event).toBe('scan_start');
			expect(events[1].event).toBe('vuln_found');
			expect(events[2].event).toBe('vuln_found');
			expect(events[3].event).toBe('scan_complete');
		});

		it('should handle test runner pattern', async () => {
			const audit = initAuditSDK('test');

			await audit.emit('test_run_start', { suite: 'unit-tests' });
			await audit.emitTestResult('test-1', 'pass', 50);
			await audit.emitTestResult('test-2', 'pass', 75);
			await audit.emitTestResult('test-3', 'fail', 100);
			await audit.emit('test_run_complete', { passed: 2, failed: 1 });

			await audit.close();

			const sidecarPath = path.join(tmpDir, `test.${process.pid}.ndjson`);
			const events = fs.readFileSync(sidecarPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));

			expect(events).toHaveLength(5);
			expect(events[0].event).toBe('test_run_start');
			expect(events[1].event).toBe('test_result');
			expect(events[4].event).toBe('test_run_complete');
		});
	});
});
