/**
 * Procedure loader for loading and validating procedure definitions
 *
 * Loads procedure YAML files from the procedures/ directory and
 * validates them against the procedure schema.
 */

import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import type {
	Procedure,
	ProcedureDefinition,
	ProcedureSummary,
	ProcedureValidationResult
} from "./types.js";
import {
	validateProcedureSchema,
	validateProcedureSemantics,
	type ProcedureDefinitionParsed
} from "./schema.js";
import { ProcedureStateMachine } from "./stateMachine.js";

/**
 * Error thrown when a procedure fails to load
 */
export class ProcedureLoadError extends Error {
	constructor(
		message: string,
		public readonly procedureId?: string,
		public readonly filePath?: string
	) {
		super(message);
		this.name = "ProcedureLoadError";
	}
}

/**
 * Procedure loader options
 */
export interface ProcedureLoaderOptions {
	/** Base directory for procedure files (defaults to "procedures") */
	proceduresDir?: string;
}

/**
 * Procedure loader class for loading and managing procedure definitions
 */
export class ProcedureLoader {
	private readonly proceduresDir: string;
	private readonly cache: Map<string, Procedure>;

	constructor(options: ProcedureLoaderOptions = {}) {
		this.proceduresDir = options.proceduresDir || "procedures";
		this.cache = new Map();
	}

	/**
	 * Load a procedure by ID
	 * @param id - Procedure identifier (matches filename without .yaml extension)
	 * @returns The loaded procedure
	 * @throws ProcedureLoadError if procedure cannot be loaded
	 */
	async loadProcedure(id: string): Promise<Procedure> {
		// Check cache first
		const cached = this.cache.get(id);
		if (cached) {
			return cached;
		}

		// Try to find the procedure file
		const filePath = this.resolveProcedurePath(id);

		if (!fs.existsSync(filePath)) {
			throw new ProcedureLoadError(
				`Procedure "${id}" not found at ${filePath}`,
				id,
				filePath
			);
		}

		// Load and parse the YAML file
		const definition = await this.loadProcedureFile(filePath);

		// Validate that the ID matches
		if (definition.id !== id) {
			throw new ProcedureLoadError(
				`Procedure ID mismatch: expected "${id}", got "${definition.id}"`,
				id,
				filePath
			);
		}

		// Create the procedure state machine
		const procedure = new ProcedureStateMachine(definition);

		// Cache the procedure
		this.cache.set(id, procedure);

		return procedure;
	}

	/**
	 * List all available procedures
	 * @returns Array of procedure summaries
	 */
	async listProcedures(): Promise<ProcedureSummary[]> {
		const summaries: ProcedureSummary[] = [];

		if (!fs.existsSync(this.proceduresDir)) {
			return summaries;
		}

		const files = fs.readdirSync(this.proceduresDir);

		for (const file of files) {
			if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
				continue;
			}

			const filePath = path.join(this.proceduresDir, file);

			try {
				const definition = await this.loadProcedureFile(filePath);
				summaries.push({
					id: definition.id,
					name: definition.name,
					description: definition.description,
					filePath
				});
			} catch (error) {
				// Skip invalid procedure files when listing
				continue;
			}
		}

		// Sort by ID for deterministic ordering
		summaries.sort((a, b) => a.id.localeCompare(b.id));

		return summaries;
	}

	/**
	 * Validate a procedure definition
	 * @param definition - Raw procedure definition data
	 * @returns Validation result with errors if any
	 */
	validateProcedure(definition: unknown): ProcedureValidationResult {
		// First validate against schema
		const schemaResult = validateProcedureSchema(definition);

		if (!schemaResult.valid || !schemaResult.data) {
			return {
				valid: false,
				errors: (schemaResult.errors || []).map(e => ({
					path: e.path,
					message: e.message,
					code: e.code
				}))
			};
		}

		// Then perform semantic validation
		const semanticErrors = validateProcedureSemantics(schemaResult.data);

		if (semanticErrors.length > 0) {
			return {
				valid: false,
				errors: semanticErrors.map(e => ({
					path: e.path,
					message: e.message,
					code: e.code
				}))
			};
		}

		return { valid: true, errors: [] };
	}

	/**
	 * Clear the procedure cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Resolve the file path for a procedure ID
	 */
	private resolveProcedurePath(id: string): string {
		// Try .yaml first, then .yml
		const yamlPath = path.join(this.proceduresDir, `${id}.yaml`);
		if (fs.existsSync(yamlPath)) {
			return yamlPath;
		}

		const ymlPath = path.join(this.proceduresDir, `${id}.yml`);
		if (fs.existsSync(ymlPath)) {
			return ymlPath;
		}

		// Default to .yaml for error messages
		return yamlPath;
	}

	/**
	 * Load and validate a procedure file
	 */
	private async loadProcedureFile(filePath: string): Promise<ProcedureDefinition> {
		let content: string;

		try {
			content = fs.readFileSync(filePath, "utf8");
		} catch (error) {
			throw new ProcedureLoadError(
				`Failed to read procedure file: ${(error as Error).message}`,
				undefined,
				filePath
			);
		}

		let parsed: unknown;
		try {
			parsed = YAML.parse(content);
		} catch (error) {
			throw new ProcedureLoadError(
				`Failed to parse YAML: ${(error as Error).message}`,
				undefined,
				filePath
			);
		}

		// Validate the procedure
		const validationResult = this.validateProcedure(parsed);

		if (!validationResult.valid) {
			const errorMessages = validationResult.errors
				.map(e => `${e.path}: ${e.message}`)
				.join("; ");
			throw new ProcedureLoadError(
				`Invalid procedure definition: ${errorMessages}`,
				undefined,
				filePath
			);
		}

		return parsed as ProcedureDefinition;
	}
}

/**
 * Create a procedure loader with default options
 */
export function createProcedureLoader(
	options?: ProcedureLoaderOptions
): ProcedureLoader {
	return new ProcedureLoader(options);
}
