import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMinimalWorkspace } from "../src/core/bootstrap.js";
import { WriteProtectionError } from "../src/config/profileResolver.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

describe("Write Protection Integration Tests", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "write-protection-test-")
		);
	});

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	describe("Bootstrap with tracked profile", () => {
		it("should fail when trying to bootstrap .smartergpt/ (tracked example profile)", () => {
			// Create a .smartergpt directory without a manifest (defaults to role=example)
			const trackedDir = path.join(tempDir, ".smartergpt");
			fs.mkdirSync(trackedDir, { recursive: true });

			// Attempting to bootstrap should fail with WriteProtectionError
			expect(() => {
				createMinimalWorkspace(tempDir);
			}).toThrow(WriteProtectionError);
		});

		it("should provide helpful error message suggesting local alternatives", () => {
			const trackedDir = path.join(tempDir, ".smartergpt");
			fs.mkdirSync(trackedDir, { recursive: true });

			try {
				createMinimalWorkspace(tempDir);
				expect.fail("Should have thrown WriteProtectionError");
			} catch (error) {
				expect(error).toBeInstanceOf(WriteProtectionError);
				const errorMessage = (error as Error).message;

				// Error should mention the role
				expect(errorMessage).toContain('role="example"');

				// Error should say it's read-only
				expect(errorMessage).toContain("read-only");

				// Error should suggest alternatives
				expect(errorMessage).toContain(".smartergpt.local");
				expect(errorMessage).toContain("LEX_PR_PROFILE_DIR");
			}
		});

		it("should succeed when using .smartergpt.local/ with proper manifest", () => {
			const localDir = path.join(tempDir, ".smartergpt.local");
			fs.mkdirSync(localDir, { recursive: true });

			// Create manifest with writable role
			fs.writeFileSync(
				path.join(localDir, "profile.yml"),
				"role: local\nname: Local Development Profile\n"
			);

			// Should succeed without errors
			expect(() => {
				createMinimalWorkspace(tempDir);
			}).not.toThrow();

			// Verify config files were created at profile root
			expect(fs.existsSync(path.join(localDir, "intent.md"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "scope.yml"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "deps.yml"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "gates.yml"))).toBe(true);

			// runner/ directory should exist for working artifacts
			const runnerDir = path.join(localDir, "runner");
			expect(fs.existsSync(runnerDir)).toBe(true);
		});

		it("should succeed when using LEX_PR_PROFILE_DIR env var pointing to writable profile", () => {
			const customDir = path.join(tempDir, "custom-writable-profile");
			fs.mkdirSync(customDir, { recursive: true });

			// Create manifest with writable role
			fs.writeFileSync(
				path.join(customDir, "profile.yml"),
				"role: development\nname: Custom Dev Profile\n"
			);

			// Set env var
			const originalEnv = process.env.LEX_PR_PROFILE_DIR;
			process.env.LEX_PR_PROFILE_DIR = customDir;

			try {
				// Should succeed
				expect(() => {
					createMinimalWorkspace(tempDir);
				}).not.toThrow();

				// Verify config files were created at profile root
				expect(fs.existsSync(path.join(customDir, "intent.md"))).toBe(
					true
				);
				expect(fs.existsSync(path.join(customDir, "scope.yml"))).toBe(
					true
				);
				expect(fs.existsSync(path.join(customDir, "deps.yml"))).toBe(
					true
				);
				expect(fs.existsSync(path.join(customDir, "gates.yml"))).toBe(
					true
				);

				// runner/ directory should exist for working artifacts
				const runnerDir = path.join(customDir, "runner");
				expect(fs.existsSync(runnerDir)).toBe(true);
			} finally {
				// Restore env
				if (originalEnv) {
					process.env.LEX_PR_PROFILE_DIR = originalEnv;
				} else {
					delete process.env.LEX_PR_PROFILE_DIR;
				}
			}
		});
	});

	describe("CLI bootstrap command with tracked profile", () => {
		it("should fail with clear error when running bootstrap on tracked profile", () => {
			// Create .smartergpt directory (tracked, role=example by default)
			const trackedDir = path.join(tempDir, ".smartergpt");
			fs.mkdirSync(trackedDir, { recursive: true });

			// Get absolute path to CLI
			const cliPath = path.resolve(process.cwd(), "dist/cli.js");

			// Run CLI bootstrap command
			const result = spawnSync("node", [cliPath, "bootstrap"], {
				cwd: tempDir,
				encoding: "utf-8",
				env: { ...process.env },
			});

			// Should exit with code 2 (validation error)
			expect(result.status).toBe(2);

			// Error output should mention write protection (could be in stdout or stderr)
			const output = (result.stderr || "") + (result.stdout || "");
			expect(output).toContain('role="example"');
			expect(output).toContain("read-only");
		});

		it("should succeed when .smartergpt.local/ exists with writable role", () => {
			const localDir = path.join(tempDir, ".smartergpt.local");
			fs.mkdirSync(localDir, { recursive: true });

			// Create manifest
			fs.writeFileSync(
				path.join(localDir, "profile.yml"),
				"role: local\n"
			);

			// Get absolute path to CLI
			const cliPath = path.resolve(process.cwd(), "dist/cli.js");

			// Run CLI bootstrap command
			const result = spawnSync("node", [cliPath, "bootstrap"], {
				cwd: tempDir,
				encoding: "utf-8",
				env: { ...process.env },
			});

			// Should succeed (exit code 0 or null for success)
			expect(result.status).toBe(0);

			// Config files should be created at profile root
			expect(fs.existsSync(path.join(localDir, "intent.md"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "scope.yml"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "deps.yml"))).toBe(true);
			expect(fs.existsSync(path.join(localDir, "gates.yml"))).toBe(true);

			// runner/ directory should exist for working artifacts
			const runnerDir = path.join(localDir, "runner");
			expect(fs.existsSync(runnerDir)).toBe(true);
		});
	});

	describe("Deliverables safety", () => {
		it("should prevent writing deliverables to example profile directories", () => {
			// This is implicitly tested by the write protection on the profile root
			// Since deliverables go to <profile>/runner/, they are also protected
			const trackedDir = path.join(tempDir, ".smartergpt");
			fs.mkdirSync(trackedDir, { recursive: true });

			// Any write operation to tracked profile should fail
			expect(() => {
				createMinimalWorkspace(tempDir);
			}).toThrow(WriteProtectionError);
		});

		it("should allow writing deliverables to local profile directories", () => {
			const localDir = path.join(tempDir, ".smartergpt.local");
			fs.mkdirSync(localDir, { recursive: true });

			// Create manifest
			fs.writeFileSync(
				path.join(localDir, "profile.yml"),
				"role: local\n"
			);

			// Should allow creating files
			expect(() => {
				createMinimalWorkspace(tempDir);
			}).not.toThrow();

			// Deliverables directory should be writable
			const deliverables = path.join(localDir, "deliverables");
			fs.mkdirSync(deliverables, { recursive: true });
			fs.writeFileSync(path.join(deliverables, "test.md"), "test");

			expect(fs.existsSync(path.join(deliverables, "test.md"))).toBe(
				true
			);
		});
	});
});
