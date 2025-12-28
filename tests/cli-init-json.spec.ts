/**
 * Tests for init command with --json flag support
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";

// Path to the built CLI
const CLI_PATH = path.resolve(__dirname, "../dist/cli.js");

describe("init command with --json flag", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "lexrunner-init-json-"));
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.remove(testDir);
  });

  it("should output JSON envelope on success", async () => {
    const result = await execa(
      "node",
      [CLI_PATH, "init", "--non-interactive", "--json", "--profile-dir", ".smartergpt.local"],
      {
        cwd: testDir,
        reject: false,
      }
    );

    expect(result.exitCode).toBe(0);

    // Parse JSON output
    const output = JSON.parse(result.stdout);

    // Verify envelope structure
    expect(output).toHaveProperty("success");
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("meta");

    // Verify success
    expect(output.success).toBe(true);

    // Verify data payload
    expect(output.data).toHaveProperty("profileDir");
    expect(output.data).toHaveProperty("message");
    expect(output.data.profileDir).toContain(".smartergpt.local");

    // Verify metadata
    expect(output.meta).toHaveProperty("command");
    expect(output.meta).toHaveProperty("timestamp");
    expect(output.meta).toHaveProperty("version");
    expect(output.meta.command).toBe("lex-pr init");
  });

  it("should output JSON error envelope when configuration exists", async () => {
    // Create existing complete configuration
    const profileDir = path.join(testDir, ".smartergpt.local");
    await fs.ensureDir(profileDir);
    await fs.writeFile(path.join(profileDir, "intent.md"), "# Existing config");
    await fs.writeFile(path.join(profileDir, "scope.yml"), "target: main");
    await fs.writeFile(path.join(profileDir, "deps.yml"), "items: []");
    await fs.writeFile(path.join(profileDir, "gates.yml"), "gates: []");
    await fs.writeFile(path.join(profileDir, "profile.yml"), "role: local");

    const result = await execa(
      "node",
      [CLI_PATH, "init", "--non-interactive", "--json", "--profile-dir", ".smartergpt.local"],
      {
        cwd: testDir,
        reject: false,
      }
    );

    expect(result.exitCode).toBe(1);

    // Parse JSON output
    const output = JSON.parse(result.stdout);

    // Verify envelope structure
    expect(output).toHaveProperty("success");
    expect(output).toHaveProperty("error");
    expect(output).toHaveProperty("meta");

    // Verify error
    expect(output.success).toBe(false);
    expect(output.error).toHaveProperty("code");
    expect(output.error).toHaveProperty("message");
    expect(output.error.code).toBe("EINIT");
    expect(output.error.message).toContain("already exists");
  });

  it("should create workspace files successfully", async () => {
    const profileDir = path.join(testDir, ".smartergpt.local");

    const result = await execa(
      "node",
      [CLI_PATH, "init", "--non-interactive", "--json", "--profile-dir", ".smartergpt.local"],
      {
        cwd: testDir,
        reject: false,
      }
    );

    expect(result.exitCode).toBe(0);

    // Verify files were created
    expect(await fs.pathExists(path.join(profileDir, "intent.md"))).toBe(true);
    expect(await fs.pathExists(path.join(profileDir, "scope.yml"))).toBe(true);
    expect(await fs.pathExists(path.join(profileDir, "deps.yml"))).toBe(true);
    expect(await fs.pathExists(path.join(profileDir, "gates.yml"))).toBe(true);
    expect(await fs.pathExists(path.join(profileDir, "profile.yml"))).toBe(true);
  });

  it("should respect --force flag in JSON mode", async () => {
    // Create initial configuration
    await execa(
      "node",
      [CLI_PATH, "init", "--non-interactive", "--json", "--profile-dir", ".smartergpt.local"],
      {
        cwd: testDir,
      }
    );

    // Try to init again with --force
    const result = await execa(
      "node",
      [
        CLI_PATH,
        "init",
        "--non-interactive",
        "--json",
        "--force",
        "--profile-dir",
        ".smartergpt.local",
      ],
      {
        cwd: testDir,
        reject: false,
      }
    );

    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.success).toBe(true);
  });
});
