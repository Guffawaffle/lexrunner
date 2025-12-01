/**
 * Tests for LexSona rules resolution
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	isLexSonaAvailable,
	loadLexSonaRules,
	formatRulesForPrompt,
	getRuleInjectionConfig,
	injectRulesIntoPrompt,
	type BehavioralRule,
	type RuleInjectionConfig
} from "../src/config/rulesResolver.js";

describe("LexSona Rules Resolver", () => {
	describe("isLexSonaAvailable", () => {
		it("should check if Lex package rules are available", () => {
			const available = isLexSonaAvailable();
			// Returns boolean based on whether @smartergpt/lex/rules is resolvable
			expect(typeof available).toBe("boolean");
		});
	});

	describe("loadLexSonaRules", () => {
		it("should return empty array with default config (enabled but package not available)", async () => {
			const rules = await loadLexSonaRules();
			expect(Array.isArray(rules)).toBe(true);
		});

		it("should return empty array when explicitly disabled", async () => {
			const rules = await loadLexSonaRules(undefined, { enabled: false });
			expect(rules).toEqual([]);
		});

		it("should attempt to load rules when enabled", async () => {
			// This will try to load from the package
			// May return empty if rules module doesn't export expected functions
			const rules = await loadLexSonaRules(undefined, { enabled: true });
			expect(Array.isArray(rules)).toBe(true);
		});

		it("should handle scope parameter", async () => {
			const scope = {
				environment: "development",
				project: "lex-pr-runner",
				agentFamily: "copilot"
			};
			const rules = await loadLexSonaRules(scope, { enabled: false });
			expect(rules).toEqual([]);
		});
	});

	describe("getRuleInjectionConfig", () => {
		let originalEnv: NodeJS.ProcessEnv;

		beforeEach(() => {
			originalEnv = { ...process.env };
			delete process.env.LEX_RULES_ENABLED;
			delete process.env.LEX_RULES_SOURCE;
			delete process.env.LEX_RULES_PATH;
		});

		afterEach(() => {
			process.env = originalEnv;
		});

		it("should return default config when no env vars set", () => {
			const config = getRuleInjectionConfig();
			expect(config.enabled).toBe(true);
			expect(config.source).toBe("package");
			expect(config.localRulesPath).toBeUndefined();
		});

		it("should respect LEX_RULES_ENABLED=false", () => {
			process.env.LEX_RULES_ENABLED = "false";
			const config = getRuleInjectionConfig();
			expect(config.enabled).toBe(false);
		});

		it("should respect LEX_RULES_SOURCE=local", () => {
			process.env.LEX_RULES_SOURCE = "local";
			const config = getRuleInjectionConfig();
			expect(config.source).toBe("local");
		});

		it("should include LEX_RULES_PATH when set", () => {
			process.env.LEX_RULES_PATH = "/custom/rules/path";
			const config = getRuleInjectionConfig();
			expect(config.localRulesPath).toBe("/custom/rules/path");
		});
	});

	describe("injectRulesIntoPrompt", () => {
		it("should return base prompt when no rules available", async () => {
			const basePrompt = "You are a helpful assistant.";
			const result = await injectRulesIntoPrompt(basePrompt, undefined, { enabled: false });
			expect(result).toBe(basePrompt);
		});

		it("should return base prompt when injection is disabled", async () => {
			const basePrompt = "System prompt here.";
			const result = await injectRulesIntoPrompt(basePrompt, undefined, { enabled: false });
			expect(result).toBe(basePrompt);
		});
	});

	describe("formatRulesForPrompt", () => {
		it("should return empty string for empty rules array", () => {
			const formatted = formatRulesForPrompt([]);
			expect(formatted).toBe("");
		});

		it("should format single rule correctly", () => {
			const rules: BehavioralRule[] = [
				{
					id: "test-rule",
					title: "Test Rule",
					description: "A test rule",
					content: "Always test your code"
				}
			];

			const formatted = formatRulesForPrompt(rules);
			
			expect(formatted).toContain("# Behavioral Rules");
			expect(formatted).toContain("## Test Rule");
			expect(formatted).toContain("A test rule");
			expect(formatted).toContain("Always test your code");
		});

		it("should format multiple rules correctly", () => {
			const rules: BehavioralRule[] = [
				{
					id: "rule-1",
					title: "Rule One",
					description: "First rule",
					content: "Content one"
				},
				{
					id: "rule-2",
					title: "Rule Two",
					description: "Second rule",
					content: "Content two"
				}
			];

			const formatted = formatRulesForPrompt(rules);
			
			expect(formatted).toContain("## Rule One");
			expect(formatted).toContain("## Rule Two");
			expect(formatted).toContain("Content one");
			expect(formatted).toContain("Content two");
		});

		it("should sort rules by priority (highest first)", () => {
			const rules: BehavioralRule[] = [
				{
					id: "low",
					title: "Low Priority",
					description: "",
					content: "Low",
					priority: 1
				},
				{
					id: "high",
					title: "High Priority",
					description: "",
					content: "High",
					priority: 10
				},
				{
					id: "medium",
					title: "Medium Priority",
					description: "",
					content: "Medium",
					priority: 5
				}
			];

			const formatted = formatRulesForPrompt(rules);
			
			// High priority should come first
			const highIndex = formatted.indexOf("High Priority");
			const mediumIndex = formatted.indexOf("Medium Priority");
			const lowIndex = formatted.indexOf("Low Priority");
			
			expect(highIndex).toBeLessThan(mediumIndex);
			expect(mediumIndex).toBeLessThan(lowIndex);
		});

		it("should handle rules without description", () => {
			const rules: BehavioralRule[] = [
				{
					id: "no-desc",
					title: "No Description",
					description: "",
					content: "Just content"
				}
			];

			const formatted = formatRulesForPrompt(rules);
			
			expect(formatted).toContain("## No Description");
			expect(formatted).toContain("Just content");
			// Should not have extra empty lines
			expect(formatted).not.toContain("\n\n\n\n");
		});

		it("should handle rules with scope metadata", () => {
			const rules: BehavioralRule[] = [
				{
					id: "scoped",
					title: "Scoped Rule",
					description: "Has scope",
					content: "Scoped content",
					scope: {
						environment: "production",
						project: "lex",
						agentFamily: "claude"
					}
				}
			];

			const formatted = formatRulesForPrompt(rules);
			
			// Scope is metadata, not displayed in prompt
			expect(formatted).toContain("## Scoped Rule");
			expect(formatted).toContain("Scoped content");
		});
	});
});
