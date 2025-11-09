/**
 * Schema validation utilities using Zod
 */

import { ZodSchema } from 'zod';
import fs from 'fs/promises';

/**
 * Load and validate JSON file against schema
 * 
 * @param filePath - Path to JSON file
 * @param schema - Zod schema
 * @returns - Parsed and validated data
 */
export async function loadAndValidate<T>(
  filePath: string,
  schema: ZodSchema<T>
): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);
  
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw new Error(
      `Schema validation failed for ${filePath}:\n` +
      result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n')
    );
  }
  
  return result.data;
}

/**
 * Validate data against schema (no file I/O)
 */
export function validate<T>(data: unknown, schema: ZodSchema<T>): T {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw new Error(
      `Schema validation failed:\n` +
      result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n')
    );
  }
  
  return result.data;
}

/**
 * Check if data is valid against schema (returns boolean)
 */
export function isValid<T>(data: unknown, schema: ZodSchema<T>): boolean {
  const result = schema.safeParse(data);
  return result.success;
}
