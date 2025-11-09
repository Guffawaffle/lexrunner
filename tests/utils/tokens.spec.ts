/**
 * Token Expansion Utilities Tests
 */

import { describe, it, expect } from "vitest";
import { expandTokens } from "../../src/utils/tokens.js";

describe("Token Expansion Utilities", () => {
	describe("expandTokens", () => {
		it("should expand timestamp token", () => {
			const timestamp = "2025-11-09T12-00-00Z";
			const result = expandTokens("output-{timestamp}.json", { timestamp });
			expect(result).toBe("output-2025-11-09T12-00-00Z.json");
		});

		it("should expand date token", () => {
			const date = "2025-11-09";
			const result = expandTokens("log-{date}.txt", { date });
			expect(result).toBe("log-2025-11-09.txt");
		});

		it("should expand repo token", () => {
			const repo = "test-repo";
			const result = expandTokens("plans/{repo}/plan.json", { repo });
			expect(result).toBe("plans/test-repo/plan.json");
		});

		it("should expand owner token", () => {
			const owner = "test-owner";
			const result = expandTokens("repos/{owner}/config.yml", { owner });
			expect(result).toBe("repos/test-owner/config.yml");
		});

		it("should expand branch token", () => {
			const branch = "feature-branch";
			const result = expandTokens("work/{branch}/output.txt", { branch });
			expect(result).toBe("work/feature-branch/output.txt");
		});

		it("should expand multiple tokens", () => {
			const context = {
				owner: "guffawaffle",
				repo: "lex-pr-runner",
				timestamp: "2025-11-09T12-00-00Z"
			};
			const result = expandTokens("{owner}/{repo}/plan-{timestamp}.json", context);
			expect(result).toBe("guffawaffle/lex-pr-runner/plan-2025-11-09T12-00-00Z.json");
		});

		it("should handle templates with no tokens", () => {
			const result = expandTokens("static/path/file.txt", {});
			expect(result).toBe("static/path/file.txt");
		});

		it("should not replace tokens without context", () => {
			const result = expandTokens("path/{repo}/file.txt", {});
			expect(result).toBe("path/{repo}/file.txt");
		});

		it("should generate timestamp if not provided", () => {
			const result = expandTokens("output-{timestamp}.json", {});
			expect(result).toMatch(/^output-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.json$/);
		});

		it("should generate date if not provided", () => {
			const result = expandTokens("log-{date}.txt", {});
			expect(result).toMatch(/^log-\d{4}-\d{2}-\d{2}\.txt$/);
		});

		it("should handle repeated tokens", () => {
			const context = { repo: "test-repo" };
			const result = expandTokens("{repo}/{repo}/config.json", context);
			expect(result).toBe("test-repo/test-repo/config.json");
		});
	});
});
