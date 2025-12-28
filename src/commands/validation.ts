/**
 * Schema validation utilities for pre-flight checks
 *
 * Purpose: Validate data against Zod schemas with detailed error reporting
 * before creating Issues or writing artifacts
 */

import { ZodSchema, type ZodIssue } from "zod";
import chalk from "chalk";
import * as fs from "fs/promises";

/**
 * Validate data against schema with detailed error reporting
 *
 * @param data - Data to validate
 * @param schema - Zod schema to validate against
 * @param context - Context for error messages (e.g., "Feature Spec v0")
 * @returns Validated and typed data
 * @throws Error if validation fails
 */
export function validateOrThrow<T>(data: unknown, schema: ZodSchema<T>, context: string): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    console.error(chalk.red(`\nSchema validation failed (${context}):`));

    result.error.issues.forEach((err: ZodIssue, idx: number) => {
      console.error(chalk.red(`  ${idx + 1}. ${err.path.join(".")}: ${err.message}`));

      if (err.code === "invalid_type") {
        console.error(
          chalk.gray(`     Expected: ${(err as any).expected}, received: ${(err as any).received}`)
        );
      }
    });

    throw new Error(`Schema validation failed for ${context}`);
  }

  console.log(chalk.green(`✓ Schema validation passed (${context})`));
  return result.data;
}

/**
 * Pre-flight schema check before Issue creation
 *
 * Reads a JSON file, parses it, and validates against a schema.
 * Useful for validating spec files before creating Issues.
 *
 * @param specPath - Path to the spec file to validate
 * @param schema - Zod schema to validate against
 * @param schemaName - Name of the schema for logging
 * @throws Error if file cannot be read, parsed, or validation fails
 */
export async function preflightSchemaCheck(
  specPath: string,
  schema: ZodSchema,
  schemaName: string
): Promise<void> {
  console.log(chalk.blue(`\nPre-flight schema check: ${schemaName}`));

  const content = await fs.readFile(specPath, "utf-8");
  const data = JSON.parse(content);

  validateOrThrow(data, schema, schemaName);
}
