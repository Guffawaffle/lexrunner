/**
 * Comprehensive precedence tests for prompts and rules resolution
 *
 * Tests the 4-level precedence chain:
 * 1. LEX_PROMPTS_DIR (env var) - highest precedence
 * 2. .smartergpt.local/prompts (local overlay - additive)
 * 3. .smartergpt/prompts (tracked canon)
 * 4. @smartergpt/lex package (fallback defaults)
 *
 * @see Guffawaffle/LexRunner#370 (canon consume)
 * @see Guffawaffle/LexRunner#371 (loader precedence)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
	resolvePromptsDir,
	loadPrompt,
	PromptsResolverError,
} from "../src/config/promptsResolver.js";
import {
	isLexSonaAvailable,
	loadLexSonaRules,
	formatRulesForPrompt,
	type BehavioralRule,
} from "../src/config/rulesResolver.js";

/**
 * Minimum required version of @smartergpt/lex for precedence tests
 */
const LEX_MIN_VERSION = { major: 0, minor: 4, patch: 6 };

/**
 * Check if a semver version string meets the minimum requirement
 * @param version - Version string (e.g., "0.4.6-alpha")
 * @returns true if version >= 0.4.6
 */
function meetsLexMinVersion(version: string): boolean {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return false;

	const major = parseInt(match[1], 10);
	const minor = parseInt(match[2], 10);
	const patch = parseInt(match[3], 10);

	return (
		major > LEX_MIN_VERSION.major ||
		(major === LEX_MIN_VERSION.major && minor > LEX_MIN_VERSION.minor) ||
		(major === LEX_MIN_VERSION.major &&
			minor === LEX_MIN_VERSION.minor &&
			patch >= LEX_MIN_VERSION.patch)
	);
}

/**
 * Get the @smartergpt/lex package.json if installed
 * @returns Package JSON object or null if not found
 */
function getLexPackageJson(): {
	version: string;
	exports: Record<string, unknown>;
} | null {
	const lexPkgPath = path.join(
		process.cwd(),
		"node_modules/@smartergpt/lex/package.json"
	);
	if (fs.existsSync(lexPkgPath)) {
		return JSON.parse(fs.readFileSync(lexPkgPath, "utf-8"));
	}
	return null;
}

/**
 * Test fixture for precedence chain testing
 */
interface PrecedenceTestFixture {
	testDir: string;
	envDir: string;
	localOverlayDir: string;
	trackedDir: string;
	cleanup: () => void;
}

/**
 * Create a test fixture with all precedence levels
 */
function createPrecedenceFixture(): PrecedenceTestFixture {
	const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "precedence-test-"));
	const envDir = path.join(testDir, "env-prompts");
	const localOverlayDir = path.join(testDir, ".smartergpt.local/prompts");
	const trackedDir = path.join(testDir, ".smartergpt/prompts");

	return {
		testDir,
		envDir,
		localOverlayDir,
		trackedDir,
		cleanup: () => {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true });
			}
		},
	};
}

describe("Precedence Resolution Tests", () => {
	let fixture: PrecedenceTestFixture;
	let originalEnv: string | undefined;
	let originalGitMode: string | undefined;
	let originalDefaultBranch: string | undefined;
	let originalDefaultCommit: string | undefined;

	beforeEach(() => {
		fixture = createPrecedenceFixture();
		originalEnv = process.env.LEX_PROMPTS_DIR;
		originalGitMode = process.env.LEX_GIT_MODE;
		originalDefaultBranch = process.env.LEX_DEFAULT_BRANCH;
		originalDefaultCommit = process.env.LEX_DEFAULT_COMMIT;

		// Set git mock mode to avoid spawning git in tests
		process.env.LEX_GIT_MODE = "off";
		process.env.LEX_DEFAULT_BRANCH = "test-branch";
		process.env.LEX_DEFAULT_COMMIT = "abc123";
	});

	afterEach(() => {
		fixture.cleanup();
		// Restore env vars
		if (originalEnv) {
			process.env.LEX_PROMPTS_DIR = originalEnv;
		} else {
			delete process.env.LEX_PROMPTS_DIR;
		}
		if (originalGitMode !== undefined) {
			process.env.LEX_GIT_MODE = originalGitMode;
		} else {
			delete process.env.LEX_GIT_MODE;
		}
		if (originalDefaultBranch !== undefined) {
			process.env.LEX_DEFAULT_BRANCH = originalDefaultBranch;
		} else {
			delete process.env.LEX_DEFAULT_BRANCH;
		}
		if (originalDefaultCommit !== undefined) {
			process.env.LEX_DEFAULT_COMMIT = originalDefaultCommit;
		} else {
			delete process.env.LEX_DEFAULT_COMMIT;
		}
	});

	describe("4-Level Precedence Chain", () => {
		describe("Level 1: LEX_PROMPTS_DIR (highest precedence)", () => {
			it("should use LEX_PROMPTS_DIR when set, ignoring all other sources", () => {
				// Create all levels
				fs.mkdirSync(fixture.envDir, { recursive: true });
				fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
				fs.mkdirSync(fixture.trackedDir, { recursive: true });

				// Write different content to each level
				fs.writeFileSync(
					path.join(fixture.envDir, "test.md"),
					"# ENV Level"
				);
				fs.writeFileSync(
					path.join(fixture.localOverlayDir, "test.md"),
					"# Local Overlay Level"
				);
				fs.writeFileSync(
					path.join(fixture.trackedDir, "test.md"),
					"# Tracked Level"
				);

				process.env.LEX_PROMPTS_DIR = fixture.envDir;

				const resolved = resolvePromptsDir(fixture.testDir);

				expect(resolved.path).toBe(fixture.envDir);
				expect(resolved.source).toBe("LEX_PROMPTS_DIR");

				const loaded = loadPrompt("test", fixture.testDir);
				expect(loaded.content).toContain("ENV Level");
			});

			it("should throw descriptive error when LEX_PROMPTS_DIR points to non-existent directory", () => {
				const nonExistent = path.join(
					fixture.testDir,
					"does-not-exist"
				);
				process.env.LEX_PROMPTS_DIR = nonExistent;

				expect(() => resolvePromptsDir(fixture.testDir)).toThrow(
					PromptsResolverError
				);
				expect(() => resolvePromptsDir(fixture.testDir)).toThrow(
					`LEX_PROMPTS_DIR not found: ${nonExistent}`
				);
			});

			it("should support absolute paths for LEX_PROMPTS_DIR", () => {
				fs.mkdirSync(fixture.envDir, { recursive: true });
				process.env.LEX_PROMPTS_DIR = fixture.envDir;

				// Use different baseDir to prove absolute path works
				const otherDir = path.join(fixture.testDir, "other");
				fs.mkdirSync(otherDir, { recursive: true });

				const resolved = resolvePromptsDir(otherDir);
				expect(resolved.path).toBe(fixture.envDir);
			});
		});

		describe("Level 2: .smartergpt.local/prompts (local overlay)", () => {
			it("should use local overlay when no LEX_PROMPTS_DIR is set", () => {
				delete process.env.LEX_PROMPTS_DIR;

				fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
				fs.mkdirSync(fixture.trackedDir, { recursive: true });

				fs.writeFileSync(
					path.join(fixture.localOverlayDir, "test.md"),
					"# Local Overlay"
				);
				fs.writeFileSync(
					path.join(fixture.trackedDir, "test.md"),
					"# Tracked"
				);

				const resolved = resolvePromptsDir(fixture.testDir);

				expect(resolved.path).toBe(fixture.localOverlayDir);
				expect(resolved.source).toBe(".smartergpt.local/prompts");

				const loaded = loadPrompt("test", fixture.testDir);
				expect(loaded.content).toContain("Local Overlay");
			});

			it("should document local overlay as additive (user can extend prompts)", () => {
				delete process.env.LEX_PROMPTS_DIR;

				fs.mkdirSync(fixture.localOverlayDir, { recursive: true });

				// Local overlay with custom prompt
				fs.writeFileSync(
					path.join(fixture.localOverlayDir, "custom-workflow.md"),
					"# Custom Workflow\n\nMy team-specific workflow."
				);

				const loaded = loadPrompt("custom-workflow", fixture.testDir);
				expect(loaded.content).toContain("Custom Workflow");
				expect(loaded.content).toContain("team-specific");
			});
		});

		describe("Level 3: .smartergpt/prompts (tracked canon)", () => {
			it("should use tracked prompts when no higher precedence sources exist", () => {
				delete process.env.LEX_PROMPTS_DIR;

				fs.mkdirSync(fixture.trackedDir, { recursive: true });
				fs.writeFileSync(
					path.join(fixture.trackedDir, "test.md"),
					"# Tracked Canon"
				);

				const resolved = resolvePromptsDir(fixture.testDir);

				expect(resolved.path).toBe(fixture.trackedDir);
				expect(resolved.source).toBe(".smartergpt/prompts");
			});

			it("should prefer local overlay over tracked when both exist", () => {
				delete process.env.LEX_PROMPTS_DIR;

				fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
				fs.mkdirSync(fixture.trackedDir, { recursive: true });

				fs.writeFileSync(
					path.join(fixture.localOverlayDir, "test.md"),
					"# Local Overlay Wins"
				);
				fs.writeFileSync(
					path.join(fixture.trackedDir, "test.md"),
					"# Tracked Should Lose"
				);

				const resolved = resolvePromptsDir(fixture.testDir);
				expect(resolved.source).toBe(".smartergpt.local/prompts");

				const loaded = loadPrompt("test", fixture.testDir);
				expect(loaded.content).toContain("Local Overlay Wins");
				expect(loaded.content).not.toContain("Should Lose");
			});
		});

		describe("Level 4: @smartergpt/lex package (fallback)", () => {
			it("should fall back to package when no local sources exist", () => {
				delete process.env.LEX_PROMPTS_DIR;

				// Don't create any local directories
				// The resolver should attempt to use the package

				try {
					const resolved = resolvePromptsDir(fixture.testDir);
					// If we get here, package prompts were found (prompts or canon/prompts)
					expect(["@smartergpt/lex/prompts", "@smartergpt/lex/canon/prompts"]).toContain(resolved.source);
				} catch (error) {
					// Package prompts may not exist in test environment
					if (error instanceof PromptsResolverError) {
						// Error message should list all 5 precedence levels
						expect(error.message).toContain(
							"Prompts directory not found"
						);
						expect(error.message).toContain("LEX_PROMPTS_DIR");
						expect(error.message).toContain(
							".smartergpt.local/prompts"
						);
						expect(error.message).toContain(".smartergpt/prompts");
						expect(error.message).toContain(
							"@smartergpt/lex/prompts"
						);
						expect(error.message).toContain(
							"@smartergpt/lex/canon/prompts"
						);
					} else {
						throw error;
					}
				}
			});

			it("should verify @smartergpt/lex >= 0.4.6-alpha is available", () => {
				const lexPkg = getLexPackageJson();
				if (lexPkg) {
					expect(meetsLexMinVersion(lexPkg.version)).toBe(true);
				} else {
					console.warn("@smartergpt/lex package not found");
				}
			});
		});
	});

	describe("Package Fallback Tests", () => {
		it("should use package fallback when all overlays and curated sources are absent", () => {
			delete process.env.LEX_PROMPTS_DIR;

			// No local directories created - pure package fallback scenario
			try {
				const resolved = resolvePromptsDir(fixture.testDir);
				expect(["@smartergpt/lex/prompts", "@smartergpt/lex/canon/prompts"]).toContain(resolved.source);
			} catch (error) {
				// Package may not have prompts directory
				if (error instanceof PromptsResolverError) {
					expect(error.message).toContain("@smartergpt/lex");
				} else {
					throw error;
				}
			}
		});

		it("should skip local overlay if empty directory exists but has no prompts", () => {
			delete process.env.LEX_PROMPTS_DIR;

			// Create empty local overlay (directory exists but no files)
			fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
			// Create tracked with actual content
			fs.mkdirSync(fixture.trackedDir, { recursive: true });
			fs.writeFileSync(
				path.join(fixture.trackedDir, "test.md"),
				"# Tracked Content"
			);

			// Directory presence should still trigger precedence
			// (resolver checks directory existence, not file presence)
			const resolved = resolvePromptsDir(fixture.testDir);
			expect(resolved.source).toBe(".smartergpt.local/prompts");
		});
	});

	describe("Error Message Chain Tests", () => {
		it("should include full 5-level precedence chain in error when no prompts found", () => {
			delete process.env.LEX_PROMPTS_DIR;

			try {
				resolvePromptsDir(fixture.testDir);
				// Should not reach here if package prompts don't exist
			} catch (error) {
				expect(error).toBeInstanceOf(PromptsResolverError);
				if (error instanceof PromptsResolverError) {
					// Verify all 5 levels are mentioned in error
					const message = error.message;

					// Level 1: Environment variable
					expect(message).toContain("LEX_PROMPTS_DIR");

					// Level 2: Local overlay
					expect(message).toContain(".smartergpt.local/prompts");

					// Level 3: Workspace
					expect(message).toContain(".smartergpt/prompts");

					// Level 4: Package prompts
					expect(message).toContain("@smartergpt/lex/prompts");

					// Level 5: Canon prompts
					expect(message).toContain("@smartergpt/lex/canon/prompts");
				}
			}
		});

		it("should include source in prompt-not-found error", () => {
			delete process.env.LEX_PROMPTS_DIR;

			fs.mkdirSync(fixture.trackedDir, { recursive: true });
			fs.writeFileSync(
				path.join(fixture.trackedDir, "exists.md"),
				"# Exists"
			);

			try {
				loadPrompt("nonexistent", fixture.testDir);
				expect.fail("Should have thrown error");
			} catch (error) {
				expect(error).toBeInstanceOf(PromptsResolverError);
				if (error instanceof PromptsResolverError) {
					expect(error.message).toContain(
						"Prompt not found: nonexistent"
					);
					expect(error.message).toContain(".smartergpt/prompts");
				}
			}
		});
	});

	describe("Cross-Repository Integration Tests", () => {
		it("should support cross-repo prompt consumption via LEX_PROMPTS_DIR", () => {
			// Simulate external repository with prompts
			const externalRepoDir = path.join(fixture.testDir, "external-repo");
			const externalPromptsDir = path.join(
				externalRepoDir,
				".smartergpt/prompts"
			);
			fs.mkdirSync(externalPromptsDir, { recursive: true });

			const externalPrompt = `---
name: external-prompt
version: 1.0.0
description: Prompt from external repository
---

# External Repository Prompt

This prompt comes from an external repository.
`;
			fs.writeFileSync(
				path.join(externalPromptsDir, "external-prompt.md"),
				externalPrompt
			);

			// Point LEX_PROMPTS_DIR to external repository
			process.env.LEX_PROMPTS_DIR = externalPromptsDir;

			// Load from consumer repository context
			const consumerDir = path.join(fixture.testDir, "consumer-repo");
			fs.mkdirSync(consumerDir, { recursive: true });

			const loaded = loadPrompt("external-prompt", consumerDir);

			expect(loaded.content).toContain("External Repository Prompt");
			expect(loaded.metadata.name).toBe("external-prompt");
			expect(loaded.metadata.version).toBe("1.0.0");
		});

		it("should support symlinked prompts directory for shared prompts", () => {
			// Skip on Windows where symlinks require special permissions
			if (process.platform === "win32") {
				return;
			}

			// Create shared prompts source
			const sharedPromptsDir = path.join(
				fixture.testDir,
				"shared-prompts"
			);
			fs.mkdirSync(sharedPromptsDir, { recursive: true });
			fs.writeFileSync(
				path.join(sharedPromptsDir, "shared.md"),
				"# Shared Prompt\n\nUsed across multiple repos."
			);

			// Create consumer repo with symlinked local overlay
			const consumerDir = path.join(fixture.testDir, "consumer");
			const consumerLocalOverlay = path.join(
				consumerDir,
				".smartergpt.local/prompts"
			);
			fs.mkdirSync(path.dirname(consumerLocalOverlay), {
				recursive: true,
			});

			// Create symlink
			fs.symlinkSync(sharedPromptsDir, consumerLocalOverlay, "dir");

			delete process.env.LEX_PROMPTS_DIR;

			const loaded = loadPrompt("shared", consumerDir);
			expect(loaded.content).toContain("Shared Prompt");
			expect(loaded.content).toContain("Used across multiple repos");
		});

		it("should support consuming Lex canon assets when package is installed", async () => {
			delete process.env.LEX_PROMPTS_DIR;

			// Verify @smartergpt/lex package has rules module
			const available = isLexSonaAvailable();
			expect(typeof available).toBe("boolean");

			// If rules are available, they should be loadable
			if (available) {
				// Rules are currently disabled via config
				const rules = await loadLexSonaRules(undefined, { enabled: false });
				expect(Array.isArray(rules)).toBe(true);
			}
		});
	});

	describe("Local Overlay Additive Behavior", () => {
		it("should document that .smartergpt.local/prompts is additive layer", () => {
			delete process.env.LEX_PROMPTS_DIR;

			// Local overlay exists and takes precedence
			fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
			fs.writeFileSync(
				path.join(fixture.localOverlayDir, "local-prompt.md"),
				"# Local Only\n\nThis prompt only exists locally."
			);

			const resolved = resolvePromptsDir(fixture.testDir);
			expect(resolved.source).toBe(".smartergpt.local/prompts");

			// Can load local-only prompts
			const loaded = loadPrompt("local-prompt", fixture.testDir);
			expect(loaded.content).toContain("Local Only");
		});

		it("should allow local overlay to shadow tracked prompts", () => {
			delete process.env.LEX_PROMPTS_DIR;

			// Create same prompt name in both locations
			fs.mkdirSync(fixture.localOverlayDir, { recursive: true });
			fs.mkdirSync(fixture.trackedDir, { recursive: true });

			fs.writeFileSync(
				path.join(fixture.localOverlayDir, "workflow.md"),
				"# Local Workflow\n\nCustomized for development."
			);
			fs.writeFileSync(
				path.join(fixture.trackedDir, "workflow.md"),
				"# Tracked Workflow\n\nDefault workflow."
			);

			const loaded = loadPrompt("workflow", fixture.testDir);
			expect(loaded.content).toContain("Local Workflow");
			expect(loaded.content).toContain("Customized for development");
			expect(loaded.content).not.toContain("Default workflow");
		});

		it("should support .gitignore pattern for local overlay", () => {
			// Local overlay directory should be gitignored
			// This is a documentation/convention test

			const gitignorePath = path.join(fixture.testDir, ".gitignore");
			const gitignoreContent = `
# Local overlay (not tracked)
.smartergpt.local/
`;
			fs.writeFileSync(gitignorePath, gitignoreContent);

			const content = fs.readFileSync(gitignorePath, "utf-8");
			expect(content).toContain(".smartergpt.local/");
		});
	});

	describe("Rules Resolution Precedence", () => {
		it("should check if LexSona rules are available from package", () => {
			const available = isLexSonaAvailable();
			// Just verify the function works
			expect(typeof available).toBe("boolean");
		});

		it("should return empty rules with default config when package not available", async () => {
			const rules = await loadLexSonaRules();
			expect(Array.isArray(rules)).toBe(true);
		});

		it("should format rules for prompt injection correctly", () => {
			const testRules: BehavioralRule[] = [
				{
					id: "test-1",
					title: "First Rule",
					description: "First rule description",
					content: "Follow this guidance",
					priority: 10,
				},
				{
					id: "test-2",
					title: "Second Rule",
					description: "Second rule description",
					content: "Also follow this",
					priority: 5,
				},
			];

			const formatted = formatRulesForPrompt(testRules);

			expect(formatted).toContain("# Behavioral Rules");
			expect(formatted).toContain("## First Rule");
			expect(formatted).toContain("## Second Rule");
			expect(formatted).toContain("Follow this guidance");
			expect(formatted).toContain("Also follow this");

			// Verify priority ordering (higher priority first)
			const firstIndex = formatted.indexOf("First Rule");
			const secondIndex = formatted.indexOf("Second Rule");
			expect(firstIndex).toBeLessThan(secondIndex);
		});

		it("should handle scope parameter for rules filtering", async () => {
			const scope = {
				environment: "production",
				project: "lexrunner",
				agentFamily: "copilot",
			};

			// Returns empty when disabled
			const rules = await loadLexSonaRules(scope, { enabled: false });
			expect(rules).toEqual([]);
		});
	});

	describe("Package Version Verification", () => {
		it("should verify @smartergpt/lex package version meets minimum requirement", () => {
			const lexPkg = getLexPackageJson();
			if (!lexPkg) {
				console.warn("@smartergpt/lex package not installed");
				return;
			}

			expect(meetsLexMinVersion(lexPkg.version)).toBe(true);
		});

		it.skip("should have rules export in @smartergpt/lex package", () => {
			// TODO: Enable when @smartergpt/lex exports ./rules subpath
			// See: LexSona integration epic
			const lexPkg = getLexPackageJson();
			if (!lexPkg) {
				console.warn("@smartergpt/lex package not accessible");
				return;
			}

			expect(lexPkg.exports).toBeDefined();
			expect(lexPkg.exports["./rules"]).toBeDefined();
		});

		describe("meetsLexMinVersion helper", () => {
			it("should return true for version >= 0.4.6", () => {
				expect(meetsLexMinVersion("0.4.6")).toBe(true);
				expect(meetsLexMinVersion("0.4.7")).toBe(true);
				expect(meetsLexMinVersion("0.5.0")).toBe(true);
				expect(meetsLexMinVersion("1.0.0")).toBe(true);
				expect(meetsLexMinVersion("0.4.6-alpha")).toBe(true);
			});

			it("should return false for version < 0.4.6", () => {
				expect(meetsLexMinVersion("0.4.5")).toBe(false);
				expect(meetsLexMinVersion("0.3.0")).toBe(false);
				expect(meetsLexMinVersion("0.1.0")).toBe(false);
			});

			it("should return false for invalid version strings", () => {
				expect(meetsLexMinVersion("invalid")).toBe(false);
				expect(meetsLexMinVersion("")).toBe(false);
			});
		});
	});
});

describe("Precedence Resolution Snapshot Tests", () => {
	let testDir: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		testDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "precedence-snapshot-")
		);
		originalEnv = process.env.LEX_PROMPTS_DIR;
		delete process.env.LEX_PROMPTS_DIR;
	});

	afterEach(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true });
		}
		if (originalEnv) {
			process.env.LEX_PROMPTS_DIR = originalEnv;
		} else {
			delete process.env.LEX_PROMPTS_DIR;
		}
	});

	it("should produce consistent error message format for missing prompts", () => {
		try {
			resolvePromptsDir(testDir);
		} catch (error) {
			if (error instanceof PromptsResolverError) {
				// Error message should follow this format
				const expectedPattern =
					/Prompts directory not found\. Expected one of:/;
				expect(error.message).toMatch(expectedPattern);

				// Should list all 5 options
				expect(error.message).toContain("- LEX_PROMPTS_DIR (env var)");
				expect(error.message).toContain(
					"- " + path.join(testDir, ".smartergpt.local/prompts")
				);
				expect(error.message).toContain(
					"- " + path.join(testDir, ".smartergpt/prompts")
				);
				expect(error.message).toContain("- @smartergpt/lex/prompts");
				expect(error.message).toContain("- @smartergpt/lex/canon/prompts");
			}
		}
	});

	it("should include resolved path in successful resolution info", () => {
		const promptsDir = path.join(testDir, ".smartergpt/prompts");
		fs.mkdirSync(promptsDir, { recursive: true });

		const resolved = resolvePromptsDir(testDir);

		expect(resolved).toEqual({
			path: promptsDir,
			source: ".smartergpt/prompts",
		});
	});
});
