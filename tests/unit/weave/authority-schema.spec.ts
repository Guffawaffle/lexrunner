/**
 * Admin Authority Schema Tests
 */

import { describe, it, expect } from "vitest";
import {
	parseEnhancedAdminAuthority,
	safeParseEnhancedAdminAuthority,
	createDefaultAdminAuthorityConfig,
	type EnhancedAdminAuthorityConfig,
} from "../../../src/weave/authority/schema.js";

describe("AdminAuthority Schema", () => {
	describe("parseEnhancedAdminAuthority", () => {
		it("parses minimal config", () => {
			const input = {
				enabled: true,
				conditions: [],
			};

			const result = parseEnhancedAdminAuthority(input);
			expect(result.enabled).toBe(true);
			expect(result.conditions).toEqual([]);
		});

		it("parses command condition", () => {
			const input = {
				enabled: true,
				conditions: [
					{
						type: "command",
						command: "npm run local-ci",
						success_exit_code: 0,
						timeout_seconds: 300,
					},
				],
			};

			const result = parseEnhancedAdminAuthority(input);
			expect(result.conditions).toHaveLength(1);
			expect(result.conditions[0].type).toBe("command");
		});

		it("parses label condition", () => {
			const input = {
				enabled: true,
				conditions: [
					{
						type: "label",
						labels_absent: ["do-not-merge", "wip"],
						labels_present: ["ready-to-merge"],
					},
				],
			};

			const result = parseEnhancedAdminAuthority(input);
			expect(result.conditions).toHaveLength(1);
			const cond = result.conditions[0];
			expect(cond.type).toBe("label");
			if (cond.type === "label") {
				expect(cond.labels_absent).toEqual(["do-not-merge", "wip"]);
				expect(cond.labels_present).toEqual(["ready-to-merge"]);
			}
		});

		it("parses mergeable condition with defaults", () => {
			const input = {
				enabled: true,
				conditions: [
					{
						type: "mergeable",
					},
				],
			};

			const result = parseEnhancedAdminAuthority(input);
			const cond = result.conditions[0];
			expect(cond.type).toBe("mergeable");
			if (cond.type === "mergeable") {
				expect(cond.require_mergeable).toBe(true);
				expect(cond.blocked_states).toEqual(["dirty", "blocked"]);
				expect(cond.retry_on_unknown).toBe(true);
			}
		});

		it("parses review condition", () => {
			const input = {
				enabled: true,
				conditions: [
					{
						type: "review",
						no_pending_requests: true,
						min_approvals: 1,
						block_on_changes_requested: true,
					},
				],
			};

			const result = parseEnhancedAdminAuthority(input);
			const cond = result.conditions[0];
			expect(cond.type).toBe("review");
			if (cond.type === "review") {
				expect(cond.no_pending_requests).toBe(true);
				expect(cond.min_approvals).toBe(1);
				expect(cond.block_on_changes_requested).toBe(true);
			}
		});

		it("parses escalation triggers", () => {
			const input = {
				enabled: true,
				conditions: [],
				escalate_if: [
					{
						label_present: "needs-human-review",
						reason: "Human review required",
					},
					{
						files_touched_pattern: ["**/security/**"],
					},
				],
			};

			const result = parseEnhancedAdminAuthority(input);
			expect(result.escalate_if).toHaveLength(2);
		});

		it("parses retry configuration", () => {
			const input = {
				enabled: true,
				conditions: [],
				retry: {
					max_attempts: 3,
					backoff_seconds: 10,
				},
			};

			const result = parseEnhancedAdminAuthority(input);
			expect(result.retry?.max_attempts).toBe(3);
			expect(result.retry?.backoff_seconds).toBe(10);
		});
	});

	describe("safeParseEnhancedAdminAuthority", () => {
		it("returns success for valid input", () => {
			const input = { enabled: true, conditions: [] };
			const result = safeParseEnhancedAdminAuthority(input);

			expect(result.success).toBe(true);
		});

		it("returns error for invalid condition type", () => {
			const input = {
				enabled: true,
				conditions: [{ type: "invalid_type" }],
			};
			const result = safeParseEnhancedAdminAuthority(input);

			expect(result.success).toBe(false);
		});
	});

	describe("createDefaultAdminAuthorityConfig", () => {
		it("creates a valid default config", () => {
			const config = createDefaultAdminAuthorityConfig();

			expect(config.enabled).toBe(true);
			expect(config.conditions.length).toBeGreaterThan(0);

			// Verify it parses successfully
			const parsed = parseEnhancedAdminAuthority(config);
			expect(parsed.enabled).toBe(true);
		});

		it("includes mergeable condition", () => {
			const config = createDefaultAdminAuthorityConfig();
			const mergeable = config.conditions.find(
				(c) => c.type === "mergeable"
			);

			expect(mergeable).toBeDefined();
		});

		it("includes label condition", () => {
			const config = createDefaultAdminAuthorityConfig();
			const label = config.conditions.find((c) => c.type === "label");

			expect(label).toBeDefined();
			if (label?.type === "label") {
				expect(label.labels_absent).toContain("do-not-merge");
			}
		});

		it("includes escalation triggers", () => {
			const config = createDefaultAdminAuthorityConfig();

			expect(config.escalate_if).toBeDefined();
			expect(config.escalate_if?.length).toBeGreaterThan(0);
		});
	});
});
