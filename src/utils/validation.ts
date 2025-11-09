/**
 * Validation utilities for schemas
 */

import * as fs from "fs/promises";
import { z } from "zod";

/**
 * Load and validate a JSON file against a Zod schema
 * 
 * @param filePath - Path to the JSON file
 * @param schema - Zod schema to validate against
 * @returns Validated data
 * @throws Error if file doesn't exist or validation fails
 */
export async function loadAndValidate<T>(
	filePath: string,
	schema: z.ZodSchema<T>
): Promise<T> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const data = JSON.parse(content);
		return validate(data, schema);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new ValidationError(`Invalid JSON in file: ${filePath}`);
		}
		throw error;
	}
}

/**
 * Validate data against a Zod schema
 * 
 * @param data - Data to validate
 * @param schema - Zod schema to validate against
 * @returns Validated data
 * @throws ValidationError if validation fails
 */
export function validate<T>(data: unknown, schema: z.ZodSchema<T>): T {
	const result = schema.safeParse(data);
	
	if (!result.success) {
		const errors = result.error.errors
			.map(err => `  - ${err.path.join('.')}: ${err.message}`)
			.join('\n');
		throw new ValidationError(`Schema validation failed:\n${errors}`);
	}
	
	return result.data;
}

/**
 * Validation error
 */
export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}
