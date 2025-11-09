/**
 * Schema validation utilities using Zod
 */

import { z, ZodSchema } from 'zod';

/**
 * Validate data against a Zod schema
 * @throws {z.ZodError} if validation fails
 */
export function validate<T>(data: unknown, schema: ZodSchema<T>): T {
	return schema.parse(data);
}

/**
 * Load and validate data from an object
 */
export function loadAndValidate<T>(data: unknown, schema: ZodSchema<T>): T {
	return validate(data, schema);
}

/**
 * Check if data is valid according to schema (doesn't throw)
 */
export function isValid<T>(data: unknown, schema: ZodSchema<T>): boolean {
	const result = schema.safeParse(data);
	return result.success;
}
