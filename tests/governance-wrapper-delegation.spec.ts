/**
 * Governance Wrapper Delegation Test
 *
 * Validates that scripts/analyze-governance-logs.mjs delegates correctly
 * to the CLI governance:report command.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("governance wrapper delegation", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory for test logs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-wrapper-test-"));
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wrapper script delegates to governance:report command", () => {
    // Execute the wrapper script with --help flag
    // This should invoke: node dist/cli.js governance:report --help
    const wrapperPath = path.join(process.cwd(), "scripts", "analyze-governance-logs.mjs");

    // Capture both stdout and stderr separately using 2>&1 redirection
    let combined: string;

    try {
      combined = execSync(`node "${wrapperPath}" --help 2>&1`, {
        encoding: "utf-8",
      });
    } catch (error: unknown) {
      // execSync throws on non-zero exit, but we can still read output
      if (error && typeof error === "object" && "stdout" in error) {
        combined = String(error.stdout || "");
      } else {
        throw error;
      }
    }

    // Verify deprecation notice appears (from stderr)
    expect(combined).toContain("DEPRECATED");
    expect(combined).toContain("governance:report");

    // Verify help output shows governance:report command (from stdout)
    expect(combined).toContain("Analyze LexSona shadow governance logs");
  });

  it("wrapper passes through arguments correctly", () => {
    const wrapperPath = path.join(process.cwd(), "scripts", "analyze-governance-logs.mjs");

    // Test with --format flag (should be passed to governance:report)
    let output: string;
    try {
      output = execSync(`node "${wrapperPath}" --format json`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "stdout" in error) {
        output = String(error.stdout || "");
      } else {
        throw error;
      }
    }

    // If no logs exist, we should get valid JSON array (empty or with message)
    // The key is that --format json was recognized
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("wrapper resolves CLI path relative to script location", () => {
    // Read the wrapper script source
    const wrapperPath = path.join(process.cwd(), "scripts", "analyze-governance-logs.mjs");
    const wrapperSource = fs.readFileSync(wrapperPath, "utf-8");

    // Verify it uses __dirname-based resolution (not process.cwd())
    expect(wrapperSource).toContain("__dirname");
    expect(wrapperSource).toContain('join(__dirname, "..", "dist", "cli.js")');

    // Verify it does NOT rely on process.cwd() for CLI path
    expect(wrapperSource).not.toContain('join(process.cwd(), "dist", "cli.js")');
  });

  it("wrapper exits with same code as underlying command", () => {
    const wrapperPath = path.join(process.cwd(), "scripts", "analyze-governance-logs.mjs");

    // Test with invalid flag (should exit non-zero)
    try {
      execSync(`node "${wrapperPath}" --invalid-flag-xyz`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      // Should not reach here
      expect.fail("Expected non-zero exit code for invalid flag");
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error) {
        // Should exit non-zero (Commander exits 1 for unknown options)
        expect(error.status).toBeGreaterThan(0);
      } else {
        throw error;
      }
    }
  });

  it("wrapper sends deprecation notice to stderr, not stdout", () => {
    const wrapperPath = path.join(process.cwd(), "scripts", "analyze-governance-logs.mjs");

    // Execute with a flag that won't generate output (help goes to stdout)
    // Use a valid but quiet operation
    const result = execSync(`node "${wrapperPath}" --help 2>&1`, {
      encoding: "utf-8",
      stdio: "pipe",
    });

    // When we capture both stdout and stderr, deprecation should appear
    expect(result).toContain("DEPRECATED");

    // But when we capture only stdout, it should NOT contain deprecation
    let stdoutOnly: string;
    try {
      stdoutOnly = execSync(`node "${wrapperPath}" --help`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"], // Ignore stderr
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "stdout" in error) {
        stdoutOnly = String(error.stdout || "");
      } else {
        throw error;
      }
    }

    // Stdout alone should NOT have deprecation notice
    expect(stdoutOnly).not.toContain("DEPRECATED");
    // But should have actual command output
    expect(stdoutOnly).toContain("governance:report");
  });
});
