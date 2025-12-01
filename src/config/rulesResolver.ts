/**
 * LexSona Rules Resolution (v0.5.0)
 *
 * This module provides infrastructure for loading LexSona behavioral rules
 * from the @smartergpt/lex package. Rules provide behavioral guidance and
 * policy enforcement for AI agents.
 *
 * Types in this module align with the behavior-rule.schema.ts in .smartergpt/schemas/
 * which is the canonical Zod schema for cross-repo validation.
 *
 * @module config/rulesResolver
 */

/**
 * Rule injection configuration
 */
export interface RuleInjectionConfig {
	/** Whether rule injection is enabled */
	enabled: boolean;
	/** Source of rules: 'package' for @smartergpt/lex, 'local' for project-level */
	source: "package" | "local";
	/** Optional path to local rules directory */
	localRulesPath?: string;
}

/**
 * Default rule injection configuration
 */
const DEFAULT_INJECTION_CONFIG: RuleInjectionConfig = {
	enabled: true,
	source: "package",
};

/**
 * Check if LexSona rules are available from the Lex package
 *
 * @returns true if rules can be loaded, false otherwise
 */
export function isLexSonaAvailable(): boolean {
	try {
		// Check if the @smartergpt/lex/rules export exists
		// This is a dynamic check to avoid import errors if the package is not installed
		require.resolve("@smartergpt/lex/rules");
		return true;
	} catch {
		// Package or rules export not available
		return false;
	}
}

/**
 * Rule scope metadata for context filtering
 * @see .smartergpt/schemas/behavior-rule.schema.ts for the canonical Zod schema
 */
export interface RuleScope {
	/** Environment (e.g., "development", "production") */
	environment?: string;
	/** Project identifier */
	project?: string;
	/** Agent family (e.g., "copilot", "claude") */
	agentFamily?: string;
}

/**
 * Behavioral rule structure
 * @see .smartergpt/schemas/behavior-rule.schema.ts for the canonical Zod schema
 */
export interface BehavioralRule {
	/** Unique rule identifier */
	id: string;
	/** Rule title/name */
	title: string;
	/** Rule description */
	description: string;
	/** Rule content/guidance */
	content: string;
	/** Scope metadata */
	scope?: RuleScope;
	/** Priority (higher = more important) */
	priority?: number;
}

/**
 * Rule structure from Lex package (may vary by version)
 */
interface ResolvedRule {
	id?: string;
	title?: string;
	description?: string;
	content?: string;
	guidance?: string;
	scope?: RuleScope;
	priority?: number;
}

/**
 * Load LexSona behavioral rules
 *
 * Loads rules from @smartergpt/lex package when available.
 * Falls back gracefully when the package is not installed.
 *
 * @param scope - Optional scope for filtering rules
 * @param config - Optional injection configuration (defaults to enabled with package source)
 * @returns Array of behavioral rules
 */
export async function loadLexSonaRules(
	scope?: RuleScope,
	config: Partial<RuleInjectionConfig> = {}
): Promise<BehavioralRule[]> {
	const resolvedConfig: RuleInjectionConfig = {
		...DEFAULT_INJECTION_CONFIG,
		...config,
	};

	// Early return if injection is disabled
	if (!resolvedConfig.enabled) {
		return [];
	}

	// Check if LexSona is available
	if (!isLexSonaAvailable()) {
		// Package not available - return empty array without error
		return [];
	}

	try {
		// Dynamic import of rules module using variable to avoid TypeScript static analysis
		// The @smartergpt/lex/rules module may not exist at compile time, so we use a dynamic
		// import with unknown type and validate the structure at runtime.
		const modulePath = "@smartergpt/lex/rules";
		const rulesModule: unknown = await import(modulePath);

		// Validate module structure and get rules list function
		const moduleObj = rulesModule as Record<string, unknown> | null;
		if (!moduleObj || typeof moduleObj !== "object") {
			return [];
		}

		// Try to get listRules from module or default export
		let listRules: unknown;
		if (typeof moduleObj.listRules === "function") {
			listRules = moduleObj.listRules;
		} else if (
			moduleObj.default &&
			typeof moduleObj.default === "object" &&
			typeof (moduleObj.default as Record<string, unknown>).listRules === "function"
		) {
			listRules = (moduleObj.default as Record<string, unknown>).listRules;
		}

		if (typeof listRules !== "function") {
			return [];
		}

		// Load and filter rules
		const rawRules: ResolvedRule[] = await (listRules as (scope?: RuleScope) => Promise<ResolvedRule[]>)(scope);

		// Normalize rules to BehavioralRule format
		// Use type guards to ensure values are present before mapping
		return rawRules
			.filter((rule): rule is ResolvedRule & { id: string; title: string } =>
				typeof rule.id === "string" &&
				typeof rule.title === "string" &&
				(typeof rule.content === "string" || typeof rule.guidance === "string")
			)
			.map((rule) => ({
				id: rule.id,
				title: rule.title,
				description: rule.description || "",
				content: rule.content || rule.guidance || "",
				scope: rule.scope,
				priority: rule.priority,
			}));
	} catch {
		// Failed to load rules - return empty array without breaking
		return [];
	}
}

/**
 * Format rules for system prompt injection
 *
 * This prepares behavioral rules for inclusion in AI agent system prompts.
 *
 * @param rules - Array of behavioral rules
 * @returns Formatted string for prompt injection
 */
export function formatRulesForPrompt(rules: BehavioralRule[]): string {
	if (rules.length === 0) {
		return "";
	}

	const sections = rules
		.sort((a, b) => (b.priority || 0) - (a.priority || 0))
		.map((rule) => {
			let section = `## ${rule.title}\n\n`;
			if (rule.description) {
				section += `${rule.description}\n\n`;
			}
			section += `${rule.content}\n`;
			return section;
		});

	return `# Behavioral Rules\n\n${sections.join("\n")}`;
}

/**
 * Get rule injection configuration from environment
 *
 * Environment variables:
 * - LEX_RULES_ENABLED: "true" or "false" (default: "true")
 * - LEX_RULES_SOURCE: "package" or "local" (default: "package")
 * - LEX_RULES_PATH: path to local rules directory (optional)
 *
 * @returns Rule injection configuration
 */
export function getRuleInjectionConfig(): RuleInjectionConfig {
	const enabled = process.env.LEX_RULES_ENABLED !== "false";
	const source = process.env.LEX_RULES_SOURCE === "local" ? "local" : "package";
	const localRulesPath = process.env.LEX_RULES_PATH;

	return {
		enabled,
		source,
		...(localRulesPath && { localRulesPath }),
	};
}

/**
 * Inject rules into a system prompt
 *
 * Convenience function that loads rules and formats them for injection.
 *
 * @param basePrompt - The base system prompt
 * @param scope - Optional scope for filtering rules
 * @param config - Optional injection configuration
 * @returns System prompt with injected rules
 */
export async function injectRulesIntoPrompt(
	basePrompt: string,
	scope?: RuleScope,
	config?: Partial<RuleInjectionConfig>
): Promise<string> {
	const resolvedConfig = config || getRuleInjectionConfig();
	const rules = await loadLexSonaRules(scope, resolvedConfig);
	const rulesSection = formatRulesForPrompt(rules);

	if (!rulesSection) {
		return basePrompt;
	}

	// Inject rules at the end of the base prompt
	return `${basePrompt}\n\n${rulesSection}`;
}
