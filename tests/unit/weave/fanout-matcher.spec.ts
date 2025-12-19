/**
 * Fanout Matcher Tests
 */

import { describe, it, expect } from "vitest";
import {
	parseDiffLines,
	matchesFilePatterns,
	matchTemplateAgainstFile,
	matchTemplatesAgainstDiff,
	deduplicateMatches,
	type PRDiffFile,
} from "../../../src/weave/fanout/matcher.js";
import type {
	FanoutTemplate,
	FanoutTemplates,
} from "../../../src/weave/fanout/schema.js";

describe("Fanout Matcher", () => {
	describe("parseDiffLines", () => {
		it("parses added lines from unified diff", () => {
			const patch = `@@ -10,5 +10,7 @@ export function test() {
 function existing() {
+  const newLine = true;
+  const anotherLine = false;
 }
`;
			const lines = parseDiffLines(patch);

			const addedLines = lines.filter((l) => l.type === "add");
			expect(addedLines).toHaveLength(2);
			expect(addedLines[0].content).toBe("  const newLine = true;");
			expect(addedLines[0].lineNumber).toBe(11);
			expect(addedLines[1].content).toBe("  const anotherLine = false;");
			expect(addedLines[1].lineNumber).toBe(12);
		});

		it("parses removed lines", () => {
			const patch = `@@ -10,5 +10,4 @@ export function test() {
 function existing() {
-  const removedLine = true;
 }
`;
			const lines = parseDiffLines(patch);

			const removedLines = lines.filter((l) => l.type === "remove");
			expect(removedLines).toHaveLength(1);
			expect(removedLines[0].content).toBe("  const removedLine = true;");
		});

		it("handles multiple hunks", () => {
			const patch = `@@ -1,3 +1,4 @@
 line1
+new1
 line2
@@ -10,3 +11,4 @@
 line10
+new10
 line11
`;
			const lines = parseDiffLines(patch);
			const addedLines = lines.filter((l) => l.type === "add");

			expect(addedLines).toHaveLength(2);
			expect(addedLines[0].lineNumber).toBe(2);
			expect(addedLines[1].lineNumber).toBe(12);
		});
	});

	describe("matchesFilePatterns", () => {
		it("matches exact patterns", () => {
			expect(matchesFilePatterns("src/test.ts", ["src/test.ts"])).toBe(
				true
			);
		});

		it("matches glob patterns", () => {
			expect(matchesFilePatterns("src/test.ts", ["**/*.ts"])).toBe(true);
			expect(matchesFilePatterns("src/test.ts", ["src/**"])).toBe(true);
			expect(matchesFilePatterns("src/test.ts", ["*.ts"])).toBe(true);
		});

		it("rejects non-matching patterns", () => {
			expect(matchesFilePatterns("src/test.ts", ["**/*.js"])).toBe(false);
			expect(matchesFilePatterns("src/test.ts", ["other/**"])).toBe(
				false
			);
		});

		it("matches any pattern in array", () => {
			expect(
				matchesFilePatterns("src/test.ts", ["**/*.js", "**/*.ts"])
			).toBe(true);
		});
	});

	describe("matchTemplateAgainstFile", () => {
		const createTemplate = (
			overrides: Partial<FanoutTemplate> = {}
		): FanoutTemplate => ({
			id: "test",
			trigger: {
				pattern: "tools\\.push\\(\\{\\s*name:\\s*['\"]([^'\"]+)['\"]",
				files: ["**/tools.ts"],
				requires_judgment: false,
			},
			issue: {
				title: "Test {group1}",
				labels: [],
				body: "Body",
				repo: "same",
			},
			priority: 100,
			enabled: true,
			...overrides,
		});

		it("matches pattern in added lines", () => {
			const template = createTemplate();
			const file: PRDiffFile = {
				filename: "src/mcp/tools.ts",
				status: "modified",
				additions: 5,
				deletions: 0,
				patch: `@@ -10,5 +10,10 @@
+  tools.push({ name: "new_tool", description: "A new tool" });
`,
			};

			const matches = matchTemplateAgainstFile(template, file);
			expect(matches).toHaveLength(1);
			expect(matches[0].templateId).toBe("test");
			expect(matches[0].captures.group1).toBe("new_tool");
		});

		it("skips disabled templates", () => {
			const template = createTemplate({ enabled: false });
			const file: PRDiffFile = {
				filename: "src/mcp/tools.ts",
				status: "modified",
				additions: 1,
				deletions: 0,
				patch: `@@ -10,1 +10,2 @@
+  tools.push({ name: "test" });
`,
			};

			const matches = matchTemplateAgainstFile(template, file);
			expect(matches).toHaveLength(0);
		});

		it("skips files not matching pattern", () => {
			const template = createTemplate();
			const file: PRDiffFile = {
				filename: "src/other/file.ts",
				status: "modified",
				additions: 1,
				deletions: 0,
				patch: `@@ -10,1 +10,2 @@
+  tools.push({ name: "test" });
`,
			};

			const matches = matchTemplateAgainstFile(template, file);
			expect(matches).toHaveLength(0);
		});

		it("skips files without patch", () => {
			const template = createTemplate();
			const file: PRDiffFile = {
				filename: "src/mcp/tools.ts",
				status: "modified",
				additions: 1,
				deletions: 0,
			};

			const matches = matchTemplateAgainstFile(template, file);
			expect(matches).toHaveLength(0);
		});
	});

	describe("matchTemplatesAgainstDiff", () => {
		it("matches multiple templates", () => {
			const templates: FanoutTemplates = {
				version: 1,
				templates: [
					{
						id: "tool-test",
						trigger: {
							pattern: "name:\\s*['\"]([^'\"]+)['\"]",
							files: ["**/*.ts"],
							requires_judgment: false,
						},
						issue: {
							title: "Test {group1}",
							labels: [],
							body: "Body",
							repo: "same",
						},
						priority: 100,
						enabled: true,
					},
					{
						id: "command-test",
						trigger: {
							pattern: "\\.command\\(['\"]([^'\"]+)['\"]",
							files: ["**/*.ts"],
							requires_judgment: false,
						},
						issue: {
							title: "Docs {group1}",
							labels: [],
							body: "Body",
							repo: "same",
						},
						priority: 50,
						enabled: true,
					},
				],
			};

			const files: PRDiffFile[] = [
				{
					filename: "src/cli.ts",
					status: "modified",
					additions: 2,
					deletions: 0,
					patch: `@@ -1,1 +1,3 @@
+  .command("new-cmd")
+  name: "tool1"
`,
				},
			];

			const matches = matchTemplatesAgainstDiff(templates, files);
			expect(matches.length).toBeGreaterThanOrEqual(2);
		});

		it("sorts by priority (higher first)", () => {
			const templates: FanoutTemplates = {
				version: 1,
				templates: [
					{
						id: "low-priority",
						trigger: {
							pattern: "test",
							files: ["**/*"],
							requires_judgment: false,
						},
						issue: {
							title: "Low",
							labels: [],
							body: "Body",
							repo: "same",
						},
						priority: 10,
						enabled: true,
					},
					{
						id: "high-priority",
						trigger: {
							pattern: "test",
							files: ["**/*"],
							requires_judgment: false,
						},
						issue: {
							title: "High",
							labels: [],
							body: "Body",
							repo: "same",
						},
						priority: 100,
						enabled: true,
					},
				],
			};

			const files: PRDiffFile[] = [
				{
					filename: "test.txt",
					status: "added",
					additions: 1,
					deletions: 0,
					patch: `@@ -0,0 +1 @@
+test
`,
				},
			];

			const matches = matchTemplatesAgainstDiff(templates, files);
			// High priority should be matched first
			expect(matches[0].templateId).toBe("high-priority");
		});
	});

	describe("deduplicateMatches", () => {
		it("keeps first match per template", () => {
			const matches = [
				{
					templateId: "a",
					matchedFile: "file1.ts",
					lineNumber: 10,
					matchedText: "test1",
					captures: {},
					requiresJudgment: false,
				},
				{
					templateId: "a",
					matchedFile: "file2.ts",
					lineNumber: 20,
					matchedText: "test2",
					captures: {},
					requiresJudgment: false,
				},
				{
					templateId: "b",
					matchedFile: "file1.ts",
					lineNumber: 15,
					matchedText: "other",
					captures: {},
					requiresJudgment: false,
				},
			];

			const deduped = deduplicateMatches(matches);
			expect(deduped).toHaveLength(2);
			expect(deduped.map((m) => m.templateId)).toEqual(["a", "b"]);
			expect(deduped[0].matchedFile).toBe("file1.ts"); // First match kept
		});
	});
});
