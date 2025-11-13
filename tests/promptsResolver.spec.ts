/**
 * Tests for prompts directory resolution and loading
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	resolvePromptsDir,
	loadPrompt,
	expandPromptTokens,
	PromptsResolverError
} from "../src/config/promptsResolver.js";

describe("Prompts Resolver", () => {
	let testDir: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		// Create temp directory for tests
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompts-test-"));
		originalEnv = process.env.LEX_PROMPTS_DIR;
	});

	afterEach(() => {
		// Clean up
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		// Restore env var
		if (originalEnv) {
			process.env.LEX_PROMPTS_DIR = originalEnv;
		} else {
			delete process.env.LEX_PROMPTS_DIR;
		}
	});

	describe("resolvePromptsDir", () => {
		it("should resolve LEX_PROMPTS_DIR when set (highest precedence)", () => {
			const envDir = path.join(testDir, "env-prompts");
			fs.mkdirSync(envDir);
			process.env.LEX_PROMPTS_DIR = envDir;

			// Create other directories to test precedence
			fs.mkdirSync(path.join(testDir, ".smartergpt.local/prompts"), { recursive: true });
			fs.mkdirSync(path.join(testDir, ".smartergpt/prompts"), { recursive: true });

			const resolved = resolvePromptsDir(testDir);

			expect(resolved.path).toBe(envDir);
			expect(resolved.source).toBe("LEX_PROMPTS_DIR");
		});

		it("should throw error if LEX_PROMPTS_DIR is set but doesn't exist", () => {
			const nonExistentDir = path.join(testDir, "non-existent");
			process.env.LEX_PROMPTS_DIR = nonExistentDir;

			expect(() => resolvePromptsDir(testDir)).toThrow(PromptsResolverError);
			expect(() => resolvePromptsDir(testDir)).toThrow(/LEX_PROMPTS_DIR not found/);
		});

		it("should resolve .smartergpt.local/prompts when no env var (second precedence)", () => {
			delete process.env.LEX_PROMPTS_DIR;

			const localDir = path.join(testDir, ".smartergpt.local/prompts");
			fs.mkdirSync(localDir, { recursive: true });

			// Create tracked canon as well
			fs.mkdirSync(path.join(testDir, ".smartergpt/prompts"), { recursive: true });

			const resolved = resolvePromptsDir(testDir);

			expect(resolved.path).toBe(localDir);
			expect(resolved.source).toBe(".smartergpt.local/prompts");
		});

		it("should resolve .smartergpt/prompts when no env var or local (third precedence)", () => {
			delete process.env.LEX_PROMPTS_DIR;

			const trackedDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(trackedDir, { recursive: true });

			const resolved = resolvePromptsDir(testDir);

			expect(resolved.path).toBe(trackedDir);
			expect(resolved.source).toBe(".smartergpt/prompts");
		});

		it("should throw error with helpful message when no prompts directory found", () => {
			delete process.env.LEX_PROMPTS_DIR;

			expect(() => resolvePromptsDir(testDir)).toThrow(PromptsResolverError);
			expect(() => resolvePromptsDir(testDir)).toThrow(/Prompts directory not found/);
			expect(() => resolvePromptsDir(testDir)).toThrow(/LEX_PROMPTS_DIR/);
			expect(() => resolvePromptsDir(testDir)).toThrow(/\.smartergpt\.local\/prompts/);
			expect(() => resolvePromptsDir(testDir)).toThrow(/\.smartergpt\/prompts/);
		});

		it("should resolve absolute paths correctly", () => {
			const absDir = path.join(testDir, "absolute-prompts");
			fs.mkdirSync(absDir);
			process.env.LEX_PROMPTS_DIR = absDir;

			const resolved = resolvePromptsDir("/some/other/path");

			expect(resolved.path).toBe(absDir);
		});
	});

	describe("loadPrompt", () => {
		it("should load prompt from resolved directory", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			const promptContent = "# Test Prompt\n\nThis is a test prompt.";
			fs.writeFileSync(path.join(promptsDir, "test.md"), promptContent);

			const loaded = loadPrompt("test", testDir);

			expect(loaded.content).toContain("Test Prompt");
			expect(loaded.metadata.name).toBe("test");
			expect(loaded.path).toBe(path.join(promptsDir, "test.md"));
		});

		it("should throw error if prompt file not found", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			expect(() => loadPrompt("nonexistent", testDir)).toThrow(PromptsResolverError);
			expect(() => loadPrompt("nonexistent", testDir)).toThrow(/Prompt not found: nonexistent/);
		});

		it("should extract metadata from frontmatter", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			const promptContent = `---
name: custom-name
version: 1.2.3
schemaVersion: 2.0.0
description: A test prompt
---

# Prompt Content

This is the actual content.`;

			fs.writeFileSync(path.join(promptsDir, "test.md"), promptContent);

			const loaded = loadPrompt("test", testDir);

			expect(loaded.metadata.name).toBe("custom-name");
			expect(loaded.metadata.version).toBe("1.2.3");
			expect(loaded.metadata.schemaVersion).toBe("2.0.0");
			expect(loaded.metadata.description).toBe("A test prompt");
		});

		it("should use default name when no frontmatter", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			const promptContent = "# No Frontmatter\n\nJust content.";
			fs.writeFileSync(path.join(promptsDir, "simple.md"), promptContent);

			const loaded = loadPrompt("simple", testDir);

			expect(loaded.metadata.name).toBe("simple");
			expect(loaded.metadata.version).toBeUndefined();
		});

		it("should expand tokens in prompt content", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			const promptContent = `# Prompt with Tokens

Today: {{today}}
Workspace: {{workspace_root}}`;

			fs.writeFileSync(path.join(promptsDir, "tokens.md"), promptContent);

			const loaded = loadPrompt("tokens", testDir);

			// Check that tokens were expanded
			expect(loaded.content).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
			expect(loaded.content).toContain(`Workspace: ${testDir}`);
		});
	});

	describe("expandPromptTokens", () => {
		it("should expand {{today}} to YYYY-MM-DD format", () => {
			const content = "Date: {{today}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
		});

		it("should expand {{now}} to ISO timestamp without colons", () => {
			const content = "Timestamp: {{now}}";
			const expanded = expandPromptTokens(content, testDir);

			// Should be in format YYYY-MM-DDTHH-MM-SS-mmm (no colons, no dots, no Z)
			expect(expanded).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/);
			// Should not contain the original token
			expect(expanded).not.toContain("{{now}}");
		});

		it("should expand {{workspace_root}} to absolute path", () => {
			const content = "Workspace: {{workspace_root}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toBe(`Workspace: ${testDir}`);
		});

		it("should expand {{repo_root}} to git repository root", () => {
			// Initialize a git repo
			const { execSync } = require("child_process");
			execSync("git init", { cwd: testDir });

			const content = "Repo: {{repo_root}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toBe(`Repo: ${testDir}`);
		});

		it("should expand {{branch}} to current git branch", () => {
			// Initialize a git repo with a branch
			const { execSync } = require("child_process");
			
			try {
				execSync("git init -b main", { cwd: testDir, stdio: "pipe" });
			} catch {
				// Fallback for older git versions
				execSync("git init", { cwd: testDir, stdio: "pipe" });
			}
			
			execSync("git config user.email 'test@test.com'", { cwd: testDir, stdio: "pipe" });
			execSync("git config user.name 'Test'", { cwd: testDir, stdio: "pipe" });
			
			// Create initial commit so branch is established
			fs.writeFileSync(path.join(testDir, "test.txt"), "test");
			execSync("git add .", { cwd: testDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: testDir, stdio: "pipe" });

			const content = "Branch: {{branch}}";
			const expanded = expandPromptTokens(content, testDir);

			// Should have some branch name (main, master, or other)
			expect(expanded).toMatch(/^Branch: \w+$/);
			expect(expanded).not.toBe("Branch: ");
		});

		it("should expand {{commit}} to current git commit SHA", () => {
			// Initialize git repo with a commit
			const { execSync } = require("child_process");
			execSync("git init -b main", { cwd: testDir });
			execSync("git config user.email 'test@test.com'", { cwd: testDir });
			execSync("git config user.name 'Test'", { cwd: testDir });
			fs.writeFileSync(path.join(testDir, "test.txt"), "test");
			execSync("git add .", { cwd: testDir });
			execSync("git commit -m 'test'", { cwd: testDir });

			const content = "Commit: {{commit}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toMatch(/Commit: [0-9a-f]{40}/);
		});

		it("should handle missing git context gracefully", () => {
			// No git repo
			const content = "Branch: {{branch}}, Commit: {{commit}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toBe("Branch: , Commit: ");
		});

		it("should expand multiple tokens in same content", () => {
			const content = `Today: {{today}}
Workspace: {{workspace_root}}
Time: {{now}}`;

			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
			expect(expanded).toContain(`Workspace: ${testDir}`);
			expect(expanded).toMatch(/Time: \d{4}-\d{2}-\d{2}T/);
		});

		it("should not expand non-existent tokens", () => {
			const content = "{{unknown_token}}";
			const expanded = expandPromptTokens(content, testDir);

			expect(expanded).toBe("{{unknown_token}}");
		});
	});

	describe("Cross-repository prompt usage scenarios", () => {
		it("should support using prompts from another repo via LEX_PROMPTS_DIR", () => {
			// Simulate Lex repo with prompts
			const lexRepoDir = path.join(testDir, "lex-repo");
			const lexPromptsDir = path.join(lexRepoDir, ".smartergpt/prompts");
			fs.mkdirSync(lexPromptsDir, { recursive: true });

			const lexPrompt = "# Lex Prompt\n\nFrom Lex repository";
			fs.writeFileSync(path.join(lexPromptsDir, "lex-prompt.md"), lexPrompt);

			// Simulate LexRunner repo
			const runnerRepoDir = path.join(testDir, "runner-repo");
			fs.mkdirSync(runnerRepoDir, { recursive: true });

			// Point LEX_PROMPTS_DIR to Lex prompts
			process.env.LEX_PROMPTS_DIR = lexPromptsDir;

			// Load prompt from LexRunner context, should get Lex prompt
			const loaded = loadPrompt("lex-prompt", runnerRepoDir);

			expect(loaded.content).toContain("From Lex repository");
			expect(loaded.path).toBe(path.join(lexPromptsDir, "lex-prompt.md"));
		});

		it("should support using prompts via symlink in local overlay", () => {
			// Simulate Lex repo with prompts
			const lexRepoDir = path.join(testDir, "lex-repo");
			const lexPromptsDir = path.join(lexRepoDir, ".smartergpt/prompts");
			fs.mkdirSync(lexPromptsDir, { recursive: true });

			const lexPrompt = "# Shared Prompt\n\nVia symlink";
			fs.writeFileSync(path.join(lexPromptsDir, "shared.md"), lexPrompt);

			// Simulate LexRunner repo with symlink
			const runnerRepoDir = path.join(testDir, "runner-repo");
			const runnerLocalPromptsDir = path.join(runnerRepoDir, ".smartergpt.local/prompts");
			fs.mkdirSync(path.dirname(runnerLocalPromptsDir), { recursive: true });

			// Create symlink
			fs.symlinkSync(lexPromptsDir, runnerLocalPromptsDir, "dir");

			// Load prompt from runner, should get Lex prompt
			const loaded = loadPrompt("shared", runnerRepoDir);

			expect(loaded.content).toContain("Via symlink");
		});

		it("should support copying prompts to local overlay", () => {
			// Simulate Lex repo with prompts
			const lexRepoDir = path.join(testDir, "lex-repo");
			const lexPromptsDir = path.join(lexRepoDir, ".smartergpt/prompts");
			fs.mkdirSync(lexPromptsDir, { recursive: true });

			const lexPrompt = "# Copied Prompt\n\nFrom Lex";
			fs.writeFileSync(path.join(lexPromptsDir, "copied.md"), lexPrompt);

			// Simulate LexRunner repo
			const runnerRepoDir = path.join(testDir, "runner-repo");
			const runnerLocalPromptsDir = path.join(runnerRepoDir, ".smartergpt.local/prompts");
			fs.mkdirSync(runnerLocalPromptsDir, { recursive: true });

			// Copy prompt
			fs.copyFileSync(
				path.join(lexPromptsDir, "copied.md"),
				path.join(runnerLocalPromptsDir, "copied.md")
			);

			// Load prompt from runner
			const loaded = loadPrompt("copied", runnerRepoDir);

			expect(loaded.content).toContain("From Lex");
			expect(loaded.path).toBe(path.join(runnerLocalPromptsDir, "copied.md"));
		});
	});

	describe("Error handling", () => {
		it("should list all checked paths in error when no prompts found", () => {
			delete process.env.LEX_PROMPTS_DIR;

			try {
				resolvePromptsDir(testDir);
				expect.fail("Should have thrown error");
			} catch (error) {
				if (error instanceof PromptsResolverError) {
					expect(error.message).toContain("LEX_PROMPTS_DIR");
					expect(error.message).toContain(".smartergpt.local/prompts");
					expect(error.message).toContain(".smartergpt/prompts");
				} else {
					throw error;
				}
			}
		});

		it("should include source in error when prompt not found", () => {
			const promptsDir = path.join(testDir, ".smartergpt/prompts");
			fs.mkdirSync(promptsDir, { recursive: true });

			try {
				loadPrompt("missing", testDir);
				expect.fail("Should have thrown error");
			} catch (error) {
				if (error instanceof PromptsResolverError) {
					expect(error.message).toContain("Prompt not found: missing");
					expect(error.message).toContain(".smartergpt/prompts");
				} else {
					throw error;
				}
			}
		});
	});
});
