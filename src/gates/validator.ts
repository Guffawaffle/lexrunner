import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

// Create a single shared AJV instance
const ajv = new Ajv({
	allErrors: true,
	strict: true,
	verbose: true
});

// Cache for loaded schemas
const schemaCache = new Map<string, object>();

/**
 * Custom error for gate input validation failures
 */
export class GateInputValidationError extends Error {
	public readonly gate: string;
	public readonly errors: ErrorObject[];

	constructor(gate: string, errors: ErrorObject[]) {
		const errorText = ajv.errorsText(errors, { separator: '\n  - ', dataVar: 'input' });
		super(`Invalid input for gate "${gate}":\n  - ${errorText}`);
		this.name = 'GateInputValidationError';
		this.gate = gate;
		this.errors = errors;
	}

	/**
	 * Get machine-readable error format
	 */
	toJSON(): { gate: string; errors: ErrorObject[] } {
		return {
			gate: this.gate,
			errors: this.errors
		};
	}
}

/**
 * Load and cache a gate schema
 */
function loadGateSchema(gateName: string): object | null {
	// Check cache first
	if (schemaCache.has(gateName)) {
		return schemaCache.get(gateName)!;
	}

	const schemaPath = join(__dirname, '../../schemas/gates', `${gateName}.schema.json`);

	try {
		const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
		schemaCache.set(gateName, schema);
		return schema;
	} catch (err) {
		return null;
	}
}

/**
 * Validates gate input against its JSON schema
 * @param gateName - Name of the gate
 * @param input - Input data to validate (typically gate.env or custom input object)
 * @throws {GateInputValidationError} if validation fails
 */
export function validateGateInput(gateName: string, input: unknown): void {
	const schema = loadGateSchema(gateName);
	
	if (!schema) {
		// No schema = no validation (backward compatibility)
		return;
	}

	const validate = ajv.compile(schema);
	if (!validate(input)) {
		throw new GateInputValidationError(gateName, validate.errors ?? []);
	}
}

/**
 * Checks if a gate has an input schema defined
 * @param gate - Name of the gate
 * @returns true if schema exists, false otherwise
 */
export function hasGateInputSchema(gate: string): boolean {
	return loadGateSchema(gate) !== null;
}
