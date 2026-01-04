/**
 * Pipe Mode End-to-End Tests
 *
 * Validates stdin → stdout pipe mode for the gate test command
 *
 * Tests cover:
 * - Reading from stdin
 * - Writing to stdout
 * - Exit code behavior (0 = pass, 1 = fail)
 * - Streaming integration
 */

import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/vitest");
const CLI_PATH = path.join(__dirname, "../../../dist/cli.js");

/**
 * Helper to run CLI command with stdin/stdout
 */
function runCLI(
  args: string[],
  stdin?: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_PATH, "gate", "test", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

describe("Pipe Mode E2E", () => {
  describe("Stdin to Stdout", () => {
    it("should read from stdin and write JSON to stdout", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(0); // All tests pass
      expect(result.stdout).toBeTruthy();

      // Should be valid JSON
      const parsed = JSON.parse(result.stdout);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.summary.failed).toBe(0);
    });

    it("should exit with code 1 when tests fail", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(1); // Some tests failed
      expect(result.stdout).toBeTruthy();

      const parsed = JSON.parse(result.stdout);
      expect(parsed.summary.failed).toBeGreaterThan(0);
    });

    it("should output markdown to stdout with --format markdown", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json", "--format", "markdown"], input);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("# Test Results");
      expect(result.stdout).toContain("Failed:");
      expect(result.stdout).toContain("## Failures");
    });
  });

  describe("Exit Codes", () => {
    it("should exit with 0 when all tests pass", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(0);
    });

    it("should exit with 1 when tests fail", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "some-failing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(1);
    });

    it("should exit with 2 on invalid input", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "invalid json");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Error");
    });

    it("should exit with 2 on empty input", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("empty");
    });
  });

  describe("Integration with Test Runners", () => {
    it("should work with piped vitest output", async () => {
      // Simulate: vitest run --reporter=json | lexrunner gate test
      const input = fs.readFileSync(
        path.join(FIXTURES_DIR, "lexrunner-schema-tests.json"),
        "utf-8"
      );

      const result = await runCLI(["--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.summary.total).toBe(31);
    });
  });

  describe("Raw Field with Pipe Mode", () => {
    it("should include raw output when --include-raw is used", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json", "--include-raw"], input);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.raw).toBe(input);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "{broken json");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Error");
    });

    it("should handle missing adapter gracefully", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "nonexistent"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Error");
    });
  });
});

describe("Meta Test: Self-Consumption", () => {
  it("should consume its own test output", async () => {
    // First run: Get test output from LexRunner tests
    const input = fs.readFileSync(path.join(FIXTURES_DIR, "lexrunner-schema-tests.json"), "utf-8");

    // Second run: Parse that output
    const result = await runCLI(["--adapter", "vitest-json"], input);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);

    // Validate the parsed result
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.adapter.name).toBe("vitest-json");
    expect(parsed.summary.total).toBe(31);
    expect(parsed.summary.passed).toBe(31);
    expect(parsed.failures).toHaveLength(0);
  });

  it("should enable dogfooding workflow: vitest → lexrunner → vitest", async () => {
    // Scenario: Run tests, parse output, validate structure
    const input = fs.readFileSync(path.join(FIXTURES_DIR, "lexrunner-schema-tests.json"), "utf-8");

    const result = await runCLI(["--adapter", "vitest-json", "--format", "json"], input);

    expect(result.exitCode).toBe(0);

    const axResult = JSON.parse(result.stdout);

    // This AXTestResult should itself be valid for further processing
    expect(axResult.summary).toBeDefined();
    expect(axResult.failures).toBeDefined();
    expect(axResult.adapter).toBeDefined();

    // Could be fed back into another tool that consumes AXTestResult
    const serialized = JSON.stringify(axResult);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.schemaVersion).toBe("1.0.0");
  });
});
