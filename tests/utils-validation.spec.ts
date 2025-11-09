/**
 * Tests for validation utilities
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate, loadAndValidate, isValid } from '../src/utils/validation';

describe('utils/validation', () => {
	const TestSchema = z.object({
		name: z.string(),
		age: z.number().min(0),
		email: z.string().email().optional()
	});

	describe('validate', () => {
		it('should validate valid data', () => {
			const data = { name: 'John', age: 30 };
			const result = validate(data, TestSchema);

			expect(result).toEqual(data);
		});

		it('should throw on invalid data', () => {
			const data = { name: 'John', age: -1 };

			expect(() => validate(data, TestSchema)).toThrow();
		});

		it('should throw on missing required fields', () => {
			const data = { name: 'John' };

			expect(() => validate(data, TestSchema)).toThrow();
		});

		it('should accept optional fields', () => {
			const data = { name: 'John', age: 30, email: 'john@example.com' };
			const result = validate(data, TestSchema);

			expect(result.email).toBe('john@example.com');
		});
	});

	describe('loadAndValidate', () => {
		it('should validate and return data', () => {
			const data = { name: 'Jane', age: 25 };
			const result = loadAndValidate(data, TestSchema);

			expect(result).toEqual(data);
		});

		it('should throw on invalid data', () => {
			const data = { name: 123, age: 25 };

			expect(() => loadAndValidate(data, TestSchema)).toThrow();
		});
	});

	describe('isValid', () => {
		it('should return true for valid data', () => {
			const data = { name: 'Bob', age: 40 };
			const result = isValid(data, TestSchema);

			expect(result).toBe(true);
		});

		it('should return false for invalid data', () => {
			const data = { name: 'Bob', age: -5 };
			const result = isValid(data, TestSchema);

			expect(result).toBe(false);
		});

		it('should return false for missing fields', () => {
			const data = { name: 'Bob' };
			const result = isValid(data, TestSchema);

			expect(result).toBe(false);
		});

		it('should not throw on invalid data', () => {
			const data = { invalid: 'data' };

			expect(() => isValid(data, TestSchema)).not.toThrow();
		});
	});
});
