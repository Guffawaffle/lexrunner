import { describe, it, expect } from 'vitest';
import { loadPlan, validatePlan, SchemaValidationError, Plan } from '../src/schema.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Schema Validation', () => {
	it('validates a simple plan', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.tiny.json'), 'utf-8');
		const plan = loadPlan(planContent);

		expect(plan.target).toBe('main');
		expect(plan.items).toHaveLength(3);
		expect(plan.items[0].name).toBe('feat-a');
		expect(plan.items[0].deps).toEqual([]);
		expect(plan.items[1].deps).toEqual(['feat-a']);
	});

	it('validates a parallel plan', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.parallel.json'), 'utf-8');
		const plan = loadPlan(planContent);

		expect(plan.items).toHaveLength(6);
		expect(plan.items.find(item => item.name === 'feat-e')?.deps).toEqual(['feat-c', 'feat-d']);
	});

	it('validates a plan with gates', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.gates.json'), 'utf-8');
		const plan = loadPlan(planContent);

		expect(plan.items[0].gates).toHaveLength(2);
		expect(plan.items[0].gates![0].name).toBe('test-pass');
		expect(plan.items[0].gates![0].run).toContain('exit 0');
	});

	it('rejects invalid schema', () => {
		const planContent = fs.readFileSync(path.join(__dirname, 'fixtures/plan.bad-schema.json'), 'utf-8');

		expect(() => loadPlan(planContent)).toThrow(SchemaValidationError);
	});

	it('rejects invalid JSON', () => {
		expect(() => loadPlan('{ invalid json')).toThrow('Invalid JSON');
	});

	it('provides detailed validation errors', () => {
		const invalidPlan = { schemaVersion: "1.0.0", target: "main", items: "not-an-array" };

		try {
			validatePlan(invalidPlan);
			expect.fail('Should have thrown validation error');
		} catch (error) {
			expect(error).toBeInstanceOf(SchemaValidationError);
			const validationError = error as SchemaValidationError;
			expect(validationError.issues).toHaveLength(1);
			expect(validationError.issues[0].path).toEqual(['items']);
			// Zod v4 uses different error message format
			expect(validationError.issues[0].message).toMatch(/array/i);
		}
	});

	it('rejects unsupported schema versions', () => {
		const planWithBadVersion = { schemaVersion: "2.0.0", target: "main", items: [] };

		// Updated expectation for AXError format - now wrapped in SchemaValidationError
		expect(() => validatePlan(planWithBadVersion)).toThrow();
	});	it('rejects malformed schema versions', () => {
		const planWithMalformedVersion = { schemaVersion: "invalid", target: "main", items: [] };

		// Updated expectation for AXError format - now wrapped in SchemaValidationError
		expect(() => validatePlan(planWithMalformedVersion)).toThrow();
	});

	it('accepts valid 1.x.y schema versions', () => {
		const validVersions = ["1.0.0", "1.2.3", "1.10.0"];

		for (const version of validVersions) {
			const plan = { schemaVersion: version, target: "main", items: [] };
			expect(() => validatePlan(plan)).not.toThrow();
		}
	});
});
