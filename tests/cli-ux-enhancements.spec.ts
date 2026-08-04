import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * Test suite validating CLI UX enhancements from issue #78
 * Enhanced CLI Error Reporting and User Experience
 */
describe("CLI UX Enhancements E2E", () => {
  const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");
  const tempFiles: string[] = [];

  // Clean up temporary files after all tests
  afterEach(() => {
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    tempFiles.length = 0;
  });

  describe("Help text with examples", () => {
    it("execute command should include usage examples", () => {
      const output = execSync(`node ${cliPath} execute --help`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Examples:");
      expect(output).toContain("$ lexrunner execute plan.json");
      expect(output).toContain("$ lexrunner execute --dry-run");
      expect(output).toContain("$ lexrunner execute --json > results.json");
      expect(output).toContain("Common Issues:");
      expect(output).toContain("Gates timing out");
    });

    it("merge command should include usage examples", () => {
      const output = execSync(`node ${cliPath} merge --help`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Examples:");
      expect(output).toContain("$ lexrunner merge --plan plan.json --execute");
      expect(output).toContain("$ lexrunner weave apply --plan plan.json --execute");
      expect(output).toContain("supported through the LexRunner 1.x line");
      expect(output).not.toContain("--cleanup");
    });

    it("discover command should include usage examples", () => {
      const output = execSync(`node ${cliPath} discover --help`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Examples:");
      expect(output).toContain("$ lexrunner discover --suggest");
      expect(output).toContain("$ lexrunner discover --json > prs.json");
      expect(output).toContain("Common Issues:");
      expect(output).toContain("Could not detect repository");
    });

    it("plan command should include usage examples", () => {
      const output = execSync(`node ${cliPath} plan --help`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Examples:");
      expect(output).toContain("$ lexrunner plan --from-github --json > plan.json");
      expect(output).toContain("$ lexrunner plan --dry-run");
      expect(output).toContain("Common Issues:");
      expect(output).toContain("GitHub API errors");
    });

    it("status command should include usage examples", () => {
      const output = execSync(`node ${cliPath} status --help`, {
        encoding: "utf-8",
      });

      expect(output).toContain("Examples:");
      expect(output).toContain("$ lexrunner status plan.json");
      expect(output).toContain("$ lexrunner status --json");
      expect(output).toContain("Common Issues:");
      expect(output).toContain("Plan file not found");
    });
  });

  describe("Exit code consistency", () => {
    it("should return exit code 2 for validation errors", () => {
      let exitCode = 0;
      const tmpFile = path.join(os.tmpdir(), "invalid-schema-test.json");
      tempFiles.push(tmpFile);

      try {
        execSync(`node ${cliPath} execute --plan ${tmpFile}`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (err: any) {
        exitCode = err.status;
      }

      // File not found might be code 1, but invalid schema should be 2
      // Let's test with an actual invalid schema
      fs.writeFileSync(tmpFile, JSON.stringify({ invalid: "schema" }));

      try {
        execSync(`node ${cliPath} execute --plan ${tmpFile}`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (err: any) {
        exitCode = err.status;
      }

      expect(exitCode).toBe(2);
    });

    it("should return exit code 0 for successful operations", () => {
      const tmpFile = path.join(os.tmpdir(), "valid-plan-test.json");
      tempFiles.push(tmpFile);
      const validPlan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "test", deps: [], gates: [] }],
        policy: {
          requiredGates: [],
          optionalGates: [],
          maxWorkers: 1,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };
      fs.writeFileSync(tmpFile, JSON.stringify(validPlan));

      let exitCode = -1;
      try {
        execSync(`node ${cliPath} execute --plan ${tmpFile} --dry-run`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
        exitCode = 0;
      } catch (err: any) {
        exitCode = err.status;
      }

      expect(exitCode).toBe(0);
    });
  });

  describe("JSON mode consistency", () => {
    it("should produce clean JSON output without progress indicators", () => {
      const tmpFile = path.join(os.tmpdir(), "json-test-plan.json");
      tempFiles.push(tmpFile);
      const validPlan = {
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "test", deps: [], gates: [] }],
        policy: {
          requiredGates: [],
          optionalGates: [],
          maxWorkers: 1,
          retries: {},
          overrides: {},
          blockOn: [],
          mergeRule: { type: "strict-required" },
        },
      };
      fs.writeFileSync(tmpFile, JSON.stringify(validPlan));

      const output = execSync(`node ${cliPath} execute --plan ${tmpFile} --dry-run --json`, {
        encoding: "utf-8",
      });

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();

      // Should NOT contain progress indicators
      expect(output).not.toContain("⏳");
      expect(output).not.toContain("✅");
      expect(output).not.toContain("Starting");
      expect(output).not.toContain("Completed");
    });
  });

  describe("Error message consistency", () => {
    it("should have consistent error format for validation errors", () => {
      const tmpFile = path.join(os.tmpdir(), "invalid-error-test.json");
      tempFiles.push(tmpFile);
      fs.writeFileSync(tmpFile, JSON.stringify({ invalid: "data" }));

      let stderr = "";
      try {
        execSync(`node ${cliPath} execute --plan ${tmpFile}`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
      } catch (err: any) {
        stderr = err.stderr;
      }

      // Should contain structured AXError message
      expect(stderr).toContain("Plan validation failed");
    });
  });
});
