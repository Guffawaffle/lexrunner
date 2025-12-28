import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { skipIfCliNotBuilt } from "./helpers/cli";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("config:inspect Command Tests", () => {
  const testDir = path.join(os.tmpdir(), "lexrunner-config-inspect-test");
  const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");

  beforeEach((context) => {
    // Clean test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    // Gate tests on CLI build
    if (skipIfCliNotBuilt({ skip: context.skip })) return;
  });

  afterEach(() => {
    // Cleanup
    process.chdir("/");
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("config:inspect --json", () => {
    it("should output deterministic JSON with provenance map", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      // Create test configuration
      fs.mkdirSync(".smartergpt", { recursive: true });
      fs.writeFileSync(
        ".smartergpt/stack.yml",
        `version: 1
target: main
items:
  - id: 1
    branch: feature/test
    deps: []
    strategy: merge-weave
`
      );

      const output1 = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });
      const output2 = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });

      // Outputs should be identical (deterministic)
      expect(output1).toBe(output2);

      // Parse and validate structure
      const result = JSON.parse(output1);
      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("provenance");
      expect(result).toHaveProperty("sources");

      // Verify provenance tracking
      expect(result.provenance).toHaveProperty("version");
      expect(result.provenance).toHaveProperty("target");
      expect(result.provenance.version).toBe("stack.yml");
      expect(result.provenance.target).toBe("stack.yml");
    });

    it("should have stable key ordering in JSON output", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      fs.mkdirSync(".smartergpt", { recursive: true });
      fs.writeFileSync(
        ".smartergpt/stack.yml",
        `version: 1
target: develop
items: []
`
      );

      const output = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });
      const result = JSON.parse(output);

      // Verify top-level keys are sorted
      const topLevelKeys = Object.keys(result);
      expect(topLevelKeys).toEqual(["config", "provenance", "sources"]);

      // Verify config keys are sorted
      const configKeys = Object.keys(result.config);
      expect(configKeys).toEqual(["items", "target", "version"]);

      // Verify provenance keys are sorted
      const provenanceKeys = Object.keys(result.provenance);
      const sortedProvKeys = [...provenanceKeys].sort();
      expect(provenanceKeys).toEqual(sortedProvKeys);
    });

    it("should track layered configuration provenance", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      fs.mkdirSync(".smartergpt", { recursive: true });

      // Create scope.yml (lower precedence)
      fs.writeFileSync(
        ".smartergpt/scope.yml",
        `version: 1
target: staging
sources:
  - query: "is:open"
`
      );

      const output = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });
      const result = JSON.parse(output);

      // Should use scope.yml since stack.yml doesn't exist
      expect(result.provenance.version).toBe("scope.yml");
      expect(result.provenance.target).toBe("scope.yml");
      expect(result.config.target).toBe("staging");
    });

    it("should show stack.yml takes precedence over scope.yml", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      fs.mkdirSync(".smartergpt", { recursive: true });

      // Create scope.yml (lower precedence)
      fs.writeFileSync(
        ".smartergpt/scope.yml",
        `version: 2
target: staging
`
      );

      // Create stack.yml (higher precedence)
      fs.writeFileSync(
        ".smartergpt/stack.yml",
        `version: 1
target: main
items: []
`
      );

      const output = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });
      const result = JSON.parse(output);

      // stack.yml should override scope.yml
      expect(result.provenance.version).toBe("stack.yml");
      expect(result.provenance.target).toBe("stack.yml");
      expect(result.config.target).toBe("main");
      expect(result.config.version).toBe(1);

      // Verify sources list
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].file).toBe("stack.yml");
      expect(result.sources[0].exists).toBe(true);
    });

    it("should indicate non-existent config files", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      fs.mkdirSync(".smartergpt", { recursive: true });
      // Don't create any config files

      const output = execSync(`node ${cliPath} config:inspect --json`, { encoding: "utf8" });
      const result = JSON.parse(output);

      // Should show stack.yml doesn't exist
      const stackSource = result.sources.find((s: any) => s.file === "stack.yml");
      expect(stackSource).toBeDefined();
      expect(stackSource.exists).toBe(false);

      // Should use defaults
      expect(result.config.version).toBe(1);
      expect(result.config.target).toBe("main");
    });
  });

  describe("config:inspect human output", () => {
    it("should display human-readable configuration", (ctx) => {
      if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

      fs.mkdirSync(".smartergpt", { recursive: true });
      fs.writeFileSync(
        ".smartergpt/stack.yml",
        `version: 1
target: production
items: []
`
      );

      const output = execSync(`node ${cliPath} config:inspect`, { encoding: "utf8" });

      // Verify human-readable output contains key information
      expect(output).toContain("Configuration Inspection");
      expect(output).toContain("Version: 1");
      expect(output).toContain("Target: production");
      expect(output).toContain("Provenance Map:");
      expect(output).toContain("stack.yml");
    });
  });
});
