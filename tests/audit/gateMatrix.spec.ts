import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateGateMatrix, generateGateMatrixFile, type EventEnvelope } from '../../src/audit/gateMatrix.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Gate Matrix Generation', () => {
	describe('generateGateMatrix', () => {
		it('should generate matrix from gate events', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_started',
					ts: '2025-10-13T03:30:00.000Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'lint' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:01.234Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_started',
					ts: '2025-10-13T03:30:02.000Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'typecheck' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:04.345Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'typecheck', status: 'pass' },
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.session_id).toBe('01JB123');
			expect(matrix.matrix['166']).toBeDefined();
			expect(matrix.matrix['166']['lint']).toEqual({
				status: 'pass',
				duration_ms: 1234,
				error: undefined,
				reason: undefined,
			});
			expect(matrix.matrix['166']['typecheck']).toEqual({
				status: 'pass',
				duration_ms: 2345,
				error: undefined,
				reason: undefined,
			});
		});

		it('should track multiple PRs', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '167', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '168', gate: 'lint', status: 'fail', error: 'Linting failed' },
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.summary.total_prs).toBe(3);
			expect(matrix.summary.total_gates).toBe(3);
			expect(matrix.summary.passed).toBe(2);
			expect(matrix.summary.failed).toBe(1);
		});

		it('should handle different gate statuses', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'typecheck', status: 'fail', error: 'Type error' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'e2e', status: 'skip', reason: 'Not configured' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'unit', status: 'blocked', reason: 'typecheck failed' },
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.summary.passed).toBe(1);
			expect(matrix.summary.failed).toBe(1);
			expect(matrix.summary.skipped).toBe(1);
			expect(matrix.summary.blocked).toBe(1);
		});

		it('should include error and reason fields', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: {
						item: '167',
						gate: 'typecheck',
						status: 'fail',
						error: 'Type mismatch in cli.ts:125',
					},
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: {
						item: '167',
						gate: 'e2e',
						status: 'skip',
						reason: 'Not configured',
					},
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.matrix['167']['typecheck']).toEqual({
				status: 'fail',
				duration_ms: undefined,
				error: 'Type mismatch in cli.ts:125',
				reason: undefined,
			});
			expect(matrix.matrix['167']['e2e']).toEqual({
				status: 'skip',
				duration_ms: undefined,
				error: undefined,
				reason: 'Not configured',
			});
		});

		it('should handle gates without start events', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.matrix['166']['lint']).toEqual({
				status: 'pass',
				duration_ms: undefined,
				error: undefined,
				reason: undefined,
			});
		});

		it('should handle empty events', () => {
			const matrix = generateGateMatrix([]);

			expect(matrix.matrix).toEqual({});
			expect(matrix.summary).toEqual({
				total_prs: 0,
				total_gates: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				blocked: 0,
			});
		});

		it('should calculate summary correctly', () => {
			const events: EventEnvelope[] = [
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'typecheck', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '166', gate: 'unit', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '167', gate: 'lint', status: 'pass' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '167', gate: 'typecheck', status: 'fail' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '167', gate: 'unit', status: 'blocked' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:00Z',
					payload: { item: '168', gate: 'lint', status: 'pass' },
				},
			];

			const matrix = generateGateMatrix(events);

			expect(matrix.summary).toEqual({
				total_prs: 3,
				total_gates: 7,
				passed: 5,
				failed: 1,
				skipped: 0,
				blocked: 1,
			});
		});
	});

	describe('generateGateMatrixFile', () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gate-matrix-test-'));
		});

		afterEach(async () => {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		});

		it('should generate matrix file from NDJSON', async () => {
			const auditPath = path.join(tmpDir, 'audit.ndjson');
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');

			// Create NDJSON file
			const events = [
				{
					event: 'gate_started',
					ts: '2025-10-13T03:30:00.000Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'lint' },
				},
				{
					event: 'gate_finished',
					ts: '2025-10-13T03:30:01.234Z',
					session_id: '01JB123',
					payload: { item: '166', gate: 'lint', status: 'pass' },
				},
			];
			await fs.promises.writeFile(
				auditPath,
				events.map(e => JSON.stringify(e)).join('\n'),
				'utf-8'
			);

			// Generate matrix
			await generateGateMatrixFile(auditPath, matrixPath);

			// Verify output
			const content = await fs.promises.readFile(matrixPath, 'utf-8');
			const matrix = JSON.parse(content);

			expect(matrix.session_id).toBe('01JB123');
			expect(matrix.matrix['166']['lint']).toEqual({
				status: 'pass',
				duration_ms: 1234,
				error: undefined,
				reason: undefined,
			});
		});

		it('should handle empty NDJSON file', async () => {
			const auditPath = path.join(tmpDir, 'audit.ndjson');
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');

			// Create empty file
			await fs.promises.writeFile(auditPath, '', 'utf-8');

			// Generate matrix
			await generateGateMatrixFile(auditPath, matrixPath);

			// Verify output
			const content = await fs.promises.readFile(matrixPath, 'utf-8');
			const matrix = JSON.parse(content);

			expect(matrix.matrix).toEqual({});
			expect(matrix.summary.total_prs).toBe(0);
		});

		it('should handle NDJSON with blank lines', async () => {
			const auditPath = path.join(tmpDir, 'audit.ndjson');
			const matrixPath = path.join(tmpDir, 'audit-gate-matrix.json');

			// Create NDJSON with blank lines
			const content = `
{"event":"gate_finished","ts":"2025-10-13T03:30:00Z","payload":{"item":"166","gate":"lint","status":"pass"}}

{"event":"gate_finished","ts":"2025-10-13T03:30:00Z","payload":{"item":"167","gate":"lint","status":"pass"}}
`;
			await fs.promises.writeFile(auditPath, content, 'utf-8');

			// Generate matrix
			await generateGateMatrixFile(auditPath, matrixPath);

			// Verify output
			const matrixContent = await fs.promises.readFile(matrixPath, 'utf-8');
			const matrix = JSON.parse(matrixContent);

			expect(matrix.summary.total_prs).toBe(2);
		});
	});
});
