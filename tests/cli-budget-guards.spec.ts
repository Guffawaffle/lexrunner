import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("CLI Budget Guards Integration", () => {
  const CLI_PATH = path.resolve("./dist/cli.js");

  /**
   * Helper to create a minimal test plan
   */
  function createTestPlan(tmpDir: string): string {
    const planPath = path.join(tmpDir, "plan.json");
    const plan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        {
          name: "test-pr-1",
          deps: [],
          gates: [],
        },
      ],
    };
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    return planPath;
  }

  it("should show budget summary in human-readable output", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Run execute with dry-run to avoid needing actual gates
      const result = execSync(`node ${CLI_PATH} execute ${planPath} --dry-run`, {
        encoding: "utf-8",
        env: { ...process.env, NO_COLOR: "1" },
        cwd: tmpDir,
      });

      // Check that budget summary is present
      expect(result).toContain("Budget Summary");
      expect(result).toContain("Prompts:");
      expect(result).toContain("Tokens (estimated):");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should include budget in JSON output", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Run execute with --json flag
      const result = execSync(`node ${CLI_PATH} execute ${planPath} --dry-run --json`, {
        encoding: "utf-8",
        env: { ...process.env },
        cwd: tmpDir,
      });

      const output = JSON.parse(result);

      // Check that budget is in the output
      expect(output).toHaveProperty("budget");
      expect(output.budget).toHaveProperty("prompts");
      expect(output.budget).toHaveProperty("tokens_estimated");

      // Should have at least one prompt (the plan itself)
      expect(output.budget.prompts).toBeGreaterThanOrEqual(1);
      expect(output.budget.tokens_estimated).toBeGreaterThan(0);
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should accept --token-budget flag", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Run with custom token budget
      const result = execSync(
        `node ${CLI_PATH} execute ${planPath} --dry-run --json --token-budget 10000`,
        {
          encoding: "utf-8",
          env: { ...process.env },
          cwd: tmpDir,
        }
      );

      // Should complete successfully
      const output = JSON.parse(result);
      expect(output).toHaveProperty("budget");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should accept --max-prompts flag", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Run with custom max prompts
      const result = execSync(
        `node ${CLI_PATH} execute ${planPath} --dry-run --json --max-prompts 10`,
        {
          encoding: "utf-8",
          env: { ...process.env },
          cwd: tmpDir,
        }
      );

      // Should complete successfully
      const output = JSON.parse(result);
      expect(output).toHaveProperty("budget");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should hard-stop when token budget is exceeded", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Set very low token budget that will be exceeded by plan
      try {
        execSync(`node ${CLI_PATH} execute ${planPath} --dry-run --token-budget 1`, {
          encoding: "utf-8",
          env: { ...process.env },
          cwd: tmpDir,
        });
        expect.fail("Should have thrown due to budget exceeded");
      } catch (error: any) {
        // Should exit with non-zero code
        expect(error.status).toBe(1);

        // Should contain budget exceeded error
        const stderr = error.stderr?.toString() || "";
        const stdout = error.stdout?.toString() || "";
        const output = stderr + stdout;

        expect(output).toContain("Budget exceeded");
      }
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should show budget in help text", () => {
    const result = execSync(`node ${CLI_PATH} --help`, {
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    // Should show both budget flags in help
    expect(result).toContain("--token-budget");
    expect(result).toContain("--max-prompts");
  });

  it("should respect LEX_PR_TOKEN_BUDGET environment variable", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Set via environment variable
      const result = execSync(`node ${CLI_PATH} execute ${planPath} --dry-run --json`, {
        encoding: "utf-8",
        env: { ...process.env, LEX_PR_TOKEN_BUDGET: "20000" },
        cwd: tmpDir,
      });

      // Should complete successfully with env var budget
      const output = JSON.parse(result);
      expect(output).toHaveProperty("budget");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should respect LEX_PR_MAX_PROMPTS environment variable", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pr-test-"));
    try {
      const planPath = createTestPlan(tmpDir);

      // Set via environment variable
      const result = execSync(`node ${CLI_PATH} execute ${planPath} --dry-run --json`, {
        encoding: "utf-8",
        env: { ...process.env, LEX_PR_MAX_PROMPTS: "10" },
        cwd: tmpDir,
      });

      // Should complete successfully with env var budget
      const output = JSON.parse(result);
      expect(output).toHaveProperty("budget");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
