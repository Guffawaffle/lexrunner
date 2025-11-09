/**
 * Unit tests for schema validation utilities
 * 
 * Validates that schema validation provides detailed error reporting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { validateOrThrow, preflightSchemaCheck } from '../../src/commands/validation.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Test schema
const TestSchema = z.object({
	name: z.string(),
	version: z.string(),
	features: z.array(z.string())
});

describe('validation: validateOrThrow', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	
	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	
	afterEach(() => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});
	
	it('should validate correct data and return typed result', () => {
		const data = {
			name: 'test-feature',
			version: '1.0.0',
			features: ['feature1', 'feature2']
		};
		
		const result = validateOrThrow(data, TestSchema, 'Test Schema');
		
		expect(result).toEqual(data);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining('Schema validation passed (Test Schema)')
		);
	});
	
	it('should throw for invalid data', () => {
		const data = {
			name: 'test-feature',
			version: 123, // should be string
			features: ['feature1']
		};
		
		expect(() => validateOrThrow(data, TestSchema, 'Test Schema'))
			.toThrow('Schema validation failed for Test Schema');
	});
	
	it('should log detailed error messages', () => {
		const data = {
			name: 'test-feature',
			version: 123, // should be string
			features: ['feature1']
		};
		
		try {
			validateOrThrow(data, TestSchema, 'Test Schema');
			expect.fail('Should have thrown');
		} catch {
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Schema validation failed (Test Schema)')
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('version')
			);
		}
	});
	
	it('should show type mismatch details', () => {
		const data = {
			name: 'test-feature',
			version: 123, // should be string
			features: ['feature1']
		};
		
		try {
			validateOrThrow(data, TestSchema, 'Test Schema');
			expect.fail('Should have thrown');
		} catch {
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Expected: string')
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('received: number')
			);
		}
	});
	
	it('should handle missing required fields', () => {
		const data = {
			name: 'test-feature'
			// missing version and features
		};
		
		expect(() => validateOrThrow(data, TestSchema, 'Test Schema'))
			.toThrow('Schema validation failed for Test Schema');
	});
	
	it('should handle multiple validation errors', () => {
		const data = {
			name: 123, // should be string
			version: null, // should be string
			features: 'not-an-array' // should be array
		};
		
		try {
			validateOrThrow(data, TestSchema, 'Test Schema');
			expect.fail('Should have thrown');
		} catch {
			// Should log multiple errors
			const errorCalls = consoleErrorSpy.mock.calls;
			expect(errorCalls.length).toBeGreaterThan(3); // At least one for header + 3 errors
		}
	});
	
	it('should include context in messages', () => {
		const data = {
			name: 'test',
			version: 123,
			features: []
		};
		
		try {
			validateOrThrow(data, TestSchema, 'Feature Spec v0');
			expect.fail('Should have thrown');
		} catch (error) {
			expect((error as Error).message).toContain('Feature Spec v0');
		}
	});
});

describe('validation: preflightSchemaCheck', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let testDir: string;
	
	beforeEach(async () => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		
		// Create temp directory for test files
		testDir = path.join(os.tmpdir(), 'lex-pr-validation-test-' + Date.now());
		await fs.mkdir(testDir, { recursive: true });
	});
	
	afterEach(async () => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		
		// Cleanup test directory
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});
	
	it('should validate a valid spec file', async () => {
		const specPath = path.join(testDir, 'valid-spec.json');
		const specData = {
			name: 'test-feature',
			version: '1.0.0',
			features: ['feature1', 'feature2']
		};
		
		await fs.writeFile(specPath, JSON.stringify(specData, null, 2));
		
		await expect(preflightSchemaCheck(specPath, TestSchema, 'Test Schema'))
			.resolves.not.toThrow();
		
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining('Pre-flight schema check: Test Schema')
		);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining('Schema validation passed')
		);
	});
	
	it('should reject an invalid spec file', async () => {
		const specPath = path.join(testDir, 'invalid-spec.json');
		const specData = {
			name: 'test-feature',
			version: 123, // should be string
			features: ['feature1']
		};
		
		await fs.writeFile(specPath, JSON.stringify(specData, null, 2));
		
		await expect(preflightSchemaCheck(specPath, TestSchema, 'Test Schema'))
			.rejects.toThrow('Schema validation failed for Test Schema');
	});
	
	it('should handle missing files', async () => {
		const specPath = path.join(testDir, 'nonexistent.json');
		
		await expect(preflightSchemaCheck(specPath, TestSchema, 'Test Schema'))
			.rejects.toThrow();
	});
	
	it('should handle malformed JSON', async () => {
		const specPath = path.join(testDir, 'malformed.json');
		await fs.writeFile(specPath, '{ invalid json }');
		
		await expect(preflightSchemaCheck(specPath, TestSchema, 'Test Schema'))
			.rejects.toThrow();
	});
	
	it('should log pre-flight check message', async () => {
		const specPath = path.join(testDir, 'spec.json');
		const specData = {
			name: 'test',
			version: '1.0.0',
			features: []
		};
		
		await fs.writeFile(specPath, JSON.stringify(specData));
		
		await preflightSchemaCheck(specPath, TestSchema, 'Feature Spec v0');
		
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining('Pre-flight schema check: Feature Spec v0')
		);
	});
});
