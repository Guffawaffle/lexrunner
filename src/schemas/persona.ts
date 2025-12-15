/**
 * Persona Schema — Re-export from Lex foundation
 *
 * This schema is based on the Lex persona foundation (PR #505).
 * Once @smartergpt/lex publishes a public export path for PersonaSchema,
 * this should be replaced with: `export * from '@smartergpt/lex/schemas/persona'`
 *
 * Current status: Lex v2.0.2 contains the schema but doesn't export it publicly.
 * Tracking: https://github.com/Guffawaffle/lex/pull/505
 *
 * @module
 */

import { z } from "zod";

/**
 * Role definition within a persona
 */
export const PersonaRoleSchema = z.object({
	/** Job title (e.g., "Senior Implementation Engineer") */
	title: z.string(),
	/** Brief scope description */
	scope: z.string(),
	/** Primary repository path (optional) */
	repo: z.string().optional(),
});

/**
 * Duties (invariants) for a persona
 */
export const PersonaDutiesSchema = z.object({
	/** Actions the persona MUST always do */
	must_do: z.array(z.string()),
	/** Actions the persona MUST NEVER do */
	must_not_do: z.array(z.string()),
});

/**
 * Complete persona definition schema
 *
 * Personas use YAML frontmatter in Markdown files:
 * ```yaml
 * ---
 * name: Senior Dev
 * version: 1.0.0
 * triggers: ["ok senior dev", "senior dev mode"]
 * role:
 *   title: Senior Implementation Engineer
 *   scope: Write and refactor code, design small architectures
 * duties:
 *   must_do:
 *     - Read relevant issues before writing code
 *     - Align with existing patterns
 *   must_not_do:
 *     - Never force-push without approval
 *     - Never bypass CI
 * gates: ["lint", "typecheck", "test"]
 * ---
 * # Senior Dev Persona
 * [Markdown body with detailed guidance]
 * ```
 */
export const PersonaSchema = z.object({
	/** Display name for the persona */
	name: z.string(),
	/** Schema version for forwards compatibility */
	version: z.string().default("1.0.0"),
	/** Activation trigger phrases (e.g., ["ok senior dev", "senior dev mode"]) */
	triggers: z.array(z.string()).min(1),
	/** Role definition */
	role: PersonaRoleSchema,
	/** Session ritual to print when activated (e.g., "SENIOR-DEV READY") */
	ritual: z.string().optional(),
	/** Duties (must do / must not do) */
	duties: PersonaDutiesSchema,
	/** Completion gates (e.g., ["lint", "typecheck", "test"]) */
	gates: z.array(z.string()).optional(),
});

/**
 * Type for a validated persona
 */
export type Persona = z.infer<typeof PersonaSchema>;

/**
 * Type for persona role
 */
export type PersonaRole = z.infer<typeof PersonaRoleSchema>;

/**
 * Type for persona duties
 */
export type PersonaDuties = z.infer<typeof PersonaDutiesSchema>;

/**
 * Parse and validate persona data
 *
 * @param data - Raw persona data (typically from YAML frontmatter)
 * @returns Validated Persona object
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * import { parsePersona } from './persona.js';
 * import { parse as parseYaml } from 'yaml';
 *
 * const frontmatter = parseYaml(yamlString);
 * const persona = parsePersona(frontmatter);
 * console.log(persona.name); // "Senior Dev"
 * ```
 */
export function parsePersona(data: unknown): Persona {
	return PersonaSchema.parse(data);
}

/**
 * Validation error for persona parsing
 */
export interface PersonaValidationError {
	path: string;
	message: string;
	code: string;
}

/**
 * Validate persona data without throwing
 *
 * @param data - Raw persona data
 * @returns Result object with success flag and data/error
 *
 * @example
 * ```typescript
 * const result = validatePersona(data);
 * if (result.success) {
 *   console.log(result.data.name);
 * } else {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validatePersona(data: unknown): {
	success: true;
	data: Persona;
} | {
	success: false;
	errors: PersonaValidationError[];
} {
	const result = PersonaSchema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return {
		success: false,
		errors: result.error.issues.map(issue => ({
			path: issue.path.join('.') || 'root',
			message: issue.message,
			code: issue.code,
		})),
	};
}
