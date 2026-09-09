import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("Advanced CLI Features E2E", () => {
  const cliPath = path.join(__dirname, "../dist/cli.js");
  const testPlanPath = "/tmp/test-advanced-cli-plan.json";

  beforeAll(() => {
    // Create test plan
    const testPlan = {
      schemaVersion: "1.0.0",
      target: "main",
      items: [
        {
          name: "foundation",
          deps: [],
          gates: [
            { name: "lint", run: "echo lint", env: {} },
            { name: "test", run: "echo test", env: {} },
          ],
        },
        {
          name: "feature-a",
          deps: ["foundation"],
          gates: [{ name: "lint", run: "echo lint", env: {} }],
        },
        {
          name: "feature-b",
          deps: ["foundation"],
          gates: [{ name: "lint", run: "echo lint", env: {} }],
        },
        {
          name: "integration",
          deps: ["feature-a", "feature-b"],
          gates: [],
        },
      ],
    };

    fs.writeFileSync(testPlanPath, JSON.stringify(testPlan, null, 2));
  });

  describe("query command", () => {
    it("should show plan statistics", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} --stats`, {
        encoding: "utf8",
      });

      expect(output).toContain("Plan Statistics:");
      expect(output).toContain("Total Items: 4");
      expect(output).toContain("Total Levels:");
      expect(output).toContain("Root Nodes: 1");
    });

    it("should filter by level", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} --level 1`, {
        encoding: "utf8",
      });

      expect(output).toContain("foundation");
      expect(output).toContain("Level 1");
    });

    it("should show root nodes", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} --roots`, {
        encoding: "utf8",
      });

      expect(output).toContain("foundation");
      expect(output).toContain("deps.length eq 0");
    });

    it("should show leaf nodes", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} --leaves`, {
        encoding: "utf8",
      });

      expect(output).toContain("integration");
    });

    it("should output JSON format", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} --stats --format json`, {
        encoding: "utf8",
      });

      const result = JSON.parse(output);
      expect(result).toHaveProperty("stats");
      expect(result.stats.totalItems).toBe(4);
    });

    it("should execute custom queries", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} "name contains feature"`, {
        encoding: "utf8",
      });

      expect(output).toContain("feature-a");
      expect(output).toContain("feature-b");
      expect(output).toContain("Results: 2");
    });

    it("should filter by gate count", () => {
      const output = execSync(`node ${cliPath} query ${testPlanPath} "gatesCount eq 0"`, {
        encoding: "utf8",
      });

      expect(output).toContain("integration");
      expect(output).toContain("Results: 1");
    });
  });

  describe("completion command", () => {
    it("should generate bash completion script", () => {
      const output = execSync(`node ${cliPath} completion bash`, {
        encoding: "utf8",
      });

      expect(output).toContain("_lexrunner_completions");
      expect(output).toContain("COMPREPLY");
      expect(output).toContain("complete -F");
    });

    it("should generate zsh completion script", () => {
      const output = execSync(`node ${cliPath} completion zsh`, {
        encoding: "utf8",
      });

      expect(output).toContain("#compdef lexrunner");
      expect(output).toContain("_arguments");
    });

    it("should show installation instructions", () => {
      const output = execSync(`node ${cliPath} completion bash --install`, {
        encoding: "utf8",
      });

      expect(output).toContain("bash completion");
      expect(output).toContain("~/.bashrc");
      expect(output).toContain('eval "$(lexrunner completion bash)"');
    });
  });

  describe("retry command", () => {
    it("should show dry-run results", () => {
      const output = execSync(`node ${cliPath} retry --dry-run`, {
        encoding: "utf8",
      });

      expect(output).toContain("Would retry");
      expect(output).toContain("gate(s)");
    });

    it("should support JSON output", () => {
      const output = execSync(`node ${cliPath} retry --dry-run --json`, {
        encoding: "utf8",
      });

      const result = JSON.parse(output);
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("processedItems");
    });
  });

  describe("view command", () => {
    it("should accept view command options", () => {
      // Note: Can't test interactive mode in CI, but can verify options are accepted
      try {
        execSync(`node ${cliPath} view --help`, { encoding: "utf8" });
      } catch (error) {
        // Expected to fail or exit with help
      }

      // Verify help includes expected options
      const helpOutput = execSync(`node ${cliPath} view --help`, {
        encoding: "utf8",
      });
      expect(helpOutput).toContain("Interactive plan viewer");
      expect(helpOutput).toContain("--filter");
      expect(helpOutput).toContain("--no-deps");
      expect(helpOutput).toContain("--no-gates");
    });
  });

  describe("merge compatibility command", () => {
    it("should expose only canonical weave apply options", () => {
      const helpOutput = execSync(`node ${cliPath} merge --help`, {
        encoding: "utf8",
      });

      expect(helpOutput).toContain("Compatibility alias for weave apply");
      expect(helpOutput).toContain("--plan");
      expect(helpOutput).toContain("--dry-run");
      expect(helpOutput).toContain("--execute");
      expect(helpOutput).not.toContain("--batch");
    });
  });

  describe("help system", () => {
    it("should guide first use and point to complete help", () => {
      const output = execSync(`node ${cliPath} --help`, { encoding: "utf8" });

      expect(output).toContain("--help-all");
      expect(output).toContain("--output plan.json --json");
      expect(output).not.toContain("--json > plan.json");
    });

    it("should list all commands including new ones", () => {
      const output = execSync(`node ${cliPath} --help-all`, { encoding: "utf8" });

      expect(output).toContain("view");
      expect(output).toContain("query");
      expect(output).toContain("retry");
      expect(output).toContain("completion");
    });
  });
});
