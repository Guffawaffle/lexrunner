/**
 * Strict Mode and Error Handling E2E Tests
 *
 * Validates the --strict mode and comprehensive error handling
 *
 * Tests cover:
 * - Strict mode requiring explicit adapter
 * - Auto-detect warnings in CI
 * - Invalid format errors
 * - Missing adapter errors
 * - Empty input errors
 * - File not found errors
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/vitest");
const CLI_PATH = path.join(__dirname, "../../../dist/cli.js");

/**
 * Helper to run CLI command
 */
function runCLI(
  args: string[],
  stdin?: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_PATH, "gate", "test", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
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

describe("Strict Mode E2E", () => {
  describe("--strict Enforcement", () => {
    it("should require explicit --adapter in strict mode", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--strict"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--adapter required");
      expect(result.stderr).toContain("strict mode");
    });

    it("should work with explicit adapter in strict mode", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--strict", "--adapter", "vitest-json"], input);

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.adapter.name).toBe("vitest-json");
    });
  });

  describe("CI Environment Detection", () => {
    it("should warn when auto-detecting in CI environment", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI([], input, { CI: "true" });

      expect(result.exitCode).toBe(0); // Still succeeds
      expect(result.stderr).toContain("Warning");
      expect(result.stderr).toContain("Auto-detecting");
    });

    it("should not warn with explicit adapter in CI", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json"], input, { CI: "true" });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("Warning");
    });
  });

  describe("Invalid Format Errors", () => {
    it("should error on invalid --format value", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json", "--format", "xml"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Invalid format");
      expect(result.stderr).toContain("Next Actions");
    });

    it("should suggest valid formats in error message", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "vitest-json", "--format", "html"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("json");
      expect(result.stderr).toContain("markdown");
    });
  });

  describe("Missing Adapter Errors", () => {
    it("should error on non-existent adapter", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "nonexistent-adapter"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Error");
      expect(result.stderr).toContain("Next Actions");
    });

    it("should list available adapters in error", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");

      const result = await runCLI(["--adapter", "fake"], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("vitest");
      expect(result.stderr).toContain("jest");
      expect(result.stderr).toContain("junit");
    });
  });

  describe("Empty Input Errors", () => {
    it("should error on empty stdin", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("empty");
      expect(result.stderr).toContain("Next Actions");
    });

    it("should error on whitespace-only input", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "   \n\n  ");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("empty");
    });
  });

  describe("File Not Found Errors", () => {
    it("should error when input file doesn't exist", async () => {
      const result = await runCLI([
        "--adapter",
        "vitest-json",
        "--input",
        "/nonexistent/file.json",
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("not found");
      expect(result.stderr).toContain("Next Actions");
    });
  });

  describe("Parse Errors", () => {
    it("should error on malformed JSON", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "{broken json");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Parse failed");
    });

    it("should suggest trying different adapter", async () => {
      const result = await runCLI(["--adapter", "vitest-json"], "<xml>not json</xml>");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("different adapter");
    });
  });

  describe("Output File Errors", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-strict-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it("should error when output directory doesn't exist", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");
      const outputPath = path.join(tempDir, "nonexistent", "output.json");

      const result = await runCLI(["--adapter", "vitest-json", "--output", outputPath], input);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("write output");
    });

    it("should successfully write to valid output path", async () => {
      const input = fs.readFileSync(path.join(FIXTURES_DIR, "all-passing.json"), "utf-8");
      const outputPath = path.join(tempDir, "output.json");

      const result = await runCLI(["--adapter", "vitest-json", "--output", outputPath], input);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(outputPath)).toBe(true);

      const output = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      expect(output.schemaVersion).toBe("1.0.0");
    });
  });

  describe("Next Actions in Errors", () => {
    it("should include actionable next steps in all errors", async () => {
      const testCases = [
        { args: ["--strict"], stdin: "test", expectedError: "--adapter required" },
        {
          args: ["--adapter", "vitest-json", "--format", "invalid"],
          stdin: "test",
          expectedError: "Invalid format",
        },
        { args: ["--adapter", "fake"], stdin: "test", expectedError: "not found" },
      ];

      for (const testCase of testCases) {
        const result = await runCLI(testCase.args, testCase.stdin);

        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("Next Actions");
        expect(result.stderr).toContain(testCase.expectedError);
      }
    });
  });

  describe("Adapter Auto-Detection Failures", () => {
    it("should fail gracefully when no adapter can detect format", async () => {
      const result = await runCLI([], "completely random text that matches no format");

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Error");
    });
  });
});
