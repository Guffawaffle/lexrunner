/**
 * LexSona Rules Resolution (Preparation for v0.5.0)
 * 
 * This module provides infrastructure for loading LexSona behavioral rules
 * from the @smartergpt/lex package. Rules provide behavioral guidance and
 * policy enforcement for AI agents.
 * 
 * @module config/rulesResolver
 */

/**
 * Check if LexSona rules are available from the Lex package
 * 
 * @returns true if rules can be loaded, false otherwise
 */
export function isLexSonaAvailable(): boolean {
	try {
		// Try to resolve the @smartergpt/lex/rules module
		// Using require.resolve for compatibility with current Node.js version
		require.resolve("@smartergpt/lex/rules");
		return true;
	} catch (error) {
		// Package not installed or rules module not available
		return false;
	}
}

/**
 * Rule scope metadata for context filtering
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
 * Load LexSona behavioral rules (when enabled)
 * 
 * This is a preparation for v0.5.0 when LexSona rules will be fully integrated.
 * For now, this returns an empty array as the feature is not yet enabled.
 * 
 * @param scope - Optional scope for filtering rules
 * @param enabled - Whether LexSona is enabled (default: false)
 * @returns Array of behavioral rules
 */
export async function loadLexSonaRules(
	scope?: RuleScope,
	enabled: boolean = false
): Promise<BehavioralRule[]> {
	// Feature flag: LexSona not enabled yet
	if (!enabled) {
		return [];
	}

	// Check if Lex package is available
	if (!isLexSonaAvailable()) {
		return [];
	}

	try {
		// Dynamic import of rules module
		// This will be used in v0.5.0 when the feature is fully enabled
		const rulesModule = await import("@smartergpt/lex/rules");
		
		// List available rules
		const ruleNames = rulesModule.listRules ? rulesModule.listRules() : [];
		
		// Load rules
		const rules: BehavioralRule[] = [];
		for (const ruleName of ruleNames) {
			const rule = rulesModule.getRule ? rulesModule.getRule(ruleName) : null;
			if (rule) {
				rules.push({
					id: rule.id || ruleName,
					title: rule.title || ruleName,
					description: rule.description || "",
					content: rule.content || rule.guidance || "",
					scope: rule.scope,
					priority: rule.priority
				});
			}
		}
		
		return rules;
	} catch (error) {
		// Handle specific error cases for better debugging
		if (error instanceof Error) {
			if (error.message.includes("Cannot find module")) {
				// Module not found - package not installed or rules not exported
				console.error("LexSona rules module not found:", error.message);
			} else if (error.message.includes("listRules") || error.message.includes("getRule")) {
				// Expected functions not exported
				console.error("LexSona rules API mismatch:", error.message);
			} else {
				// Other errors (parsing, etc.)
				console.error("Failed to load LexSona rules:", error.message);
			}
		}
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
		.map(rule => {
			let section = `## ${rule.title}\n\n`;
			if (rule.description) {
				section += `${rule.description}\n\n`;
			}
			section += `${rule.content}\n`;
			return section;
		});

	return `# Behavioral Rules\n\n${sections.join("\n")}`;
}
