/**
 * Fanout Templates Loader
 *
 * Loads and validates fanout-templates.yml from the workspace.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as yaml from "yaml";
import {
	FanoutTemplates,
	parseFanoutTemplates,
	safeParseFanoutTemplates,
	validateTemplateIds,
} from "./schema.js";

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULT_FANOUT_TEMPLATES_FILENAME = "fanout-templates.yml";
export const DEFAULT_FANOUT_TEMPLATES_PATHS = [
	".smartergpt/fanout-templates.yml",
	"fanout-templates.yml",
];

// =============================================================================
// ERROR TYPES
// =============================================================================

export class FanoutTemplatesLoadError extends Error {
	constructor(
		message: string,
		public readonly path: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = "FanoutTemplatesLoadError";
	}
}

// =============================================================================
// LOADER FUNCTIONS
// =============================================================================

/**
 * Load fanout templates from a specific path
 * @throws FanoutTemplatesLoadError if file not found or invalid
 */
export async function loadFanoutTemplates(
	filePath: string
): Promise<FanoutTemplates> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const parsed = yaml.parse(content);
		const templates = parseFanoutTemplates(parsed);
		validateTemplateIds(templates);
		return templates;
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			throw new FanoutTemplatesLoadError(
				`Fanout templates file not found: ${filePath}`,
				filePath,
				error
			);
		}
		if (error instanceof FanoutTemplatesLoadError) {
			throw error;
		}
		throw new FanoutTemplatesLoadError(
			`Failed to load fanout templates: ${
				error instanceof Error ? error.message : String(error)
			}`,
			filePath,
			error
		);
	}
}

/**
 * Load fanout templates, returning null if not found
 */
export async function loadFanoutTemplatesOrNull(
	filePath: string
): Promise<FanoutTemplates | null> {
	try {
		return await loadFanoutTemplates(filePath);
	} catch (error) {
		if (error instanceof FanoutTemplatesLoadError) {
			return null;
		}
		throw error;
	}
}

/**
 * Find and load fanout templates from default locations
 * Checks workspace paths in order, returns first found
 */
export async function discoverFanoutTemplates(
	workspaceRoot: string
): Promise<{ templates: FanoutTemplates; path: string } | null> {
	for (const relativePath of DEFAULT_FANOUT_TEMPLATES_PATHS) {
		const fullPath = path.join(workspaceRoot, relativePath);
		const templates = await loadFanoutTemplatesOrNull(fullPath);
		if (templates) {
			return { templates, path: fullPath };
		}
	}
	return null;
}

/**
 * Validate templates content without loading from file
 */
export function validateFanoutTemplatesContent(content: string): {
	valid: boolean;
	templates?: FanoutTemplates;
	errors?: string[];
} {
	try {
		const parsed = yaml.parse(content);
		const result = safeParseFanoutTemplates(parsed);
		if (!result.success) {
			return {
				valid: false,
				errors: result.error.issues.map(
					(i) => `${i.path.join(".")}: ${i.message}`
				),
			};
		}
		validateTemplateIds(result.data);
		return { valid: true, templates: result.data };
	} catch (error) {
		return {
			valid: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}
