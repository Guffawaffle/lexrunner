/**
 * Tests for config validate command
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerConfigValidateCommand } from "../../src/commands/config/validate.js";
import { skipIfCliNotBuilt } from "../helpers/cli.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("config validate command", () => {
  const testDir = path.join(os.tmpdir(), "lexrunner-config-validate-test");
  const cliPath = path.resolve(__dirname, "../..", "dist", "cli.js");
  const originalCwd = process.cwd();
  let testProfileDir: string;

  beforeEach(() => {
    // Clean test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Create test profile directory
    testProfileDir = path.join(testDir, "test-profile");
    fs.mkdirSync(testProfileDir, { recursive: true });

    process.chdir(testDir);
  });

  afterEach(() => {
    // Cleanup
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("command registration", () => {
    it("should register config validate command", () => {
      const program = new Command();
      registerConfigValidateCommand(program, () => false);

      const configCommand = program.commands.find((cmd) => cmd.name() === "config");
      expect(configCommand).toBeDefined();
      expect(configCommand?.description()).toBe("Configuration management commands");

      const validateCommand = configCommand?.commands.find((cmd) => cmd.name() === "validate");
      expect(validateCommand).toBeDefined();
      expect(validateCommand?.description()).toBe("Validate profile configuration files");
    });

    it("should have correct options", () => {
      const program = new Command();
      registerConfigValidateCommand(program, () => false);

      const configCommand = program.commands.find((cmd) => cmd.name() === "config");
      const validateCommand = configCommand?.commands.find((cmd) => cmd.name() === "validate");

      const options = validateCommand?.options || [];
      const optionNames = options.map((opt) => opt.long);
      expect(optionNames).toContain("--profile-dir");
      expect(optionNames).toContain("--strict");
      expect(optionNames).toContain("--json");
    });
  });

  describe("CLI integration", () => {
    describe("valid configuration", () => {
      it("should pass validation for valid gates.yml", (ctx) => {
        if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

        // Create valid gates.yml
        fs.writeFileSync(
          path.join(testProfileDir, "gates.yml"),
          `version: 1
levels:
  default:
    - name: lint
      run: npm run lint
    - name: test
      run: npm test
`
        );

        // Create minimal required files
        fs.writeFileSync(
          path.join(testProfileDir, "scope.yml"),
          `version: 1
target: main
sources:
  - query: "is:open"
selectors:
  include_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`
        );

        const output = execSync(
          `node ${cliPath} config validate --profile-dir ${testProfileDir} --json`,
          {
            encoding: "utf8",
          }
        );

        const result = JSON.parse(output);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("YAML syntax errors", () => {
      it("should detect invalid YAML syntax", (ctx) => {
        if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

        // Create invalid YAML
        fs.writeFileSync(
          path.join(testProfileDir, "gates.yml"),
          `version: 1
levels:
  default:
    - name: "lint
      run: npm run lint
`
        );

        try {
          execSync(`node ${cliPath} config validate --profile-dir ${testProfileDir} --json`, {
            encoding: "utf8",
            stdio: "pipe",
          });
          throw new Error("Should have failed");
        } catch (error: any) {
          const output = error.stdout || "";
          const result = JSON.parse(output);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.some((e: any) => e.message.includes("YAML syntax error"))).toBe(
            true
          );
        }
      });
    });

    describe("schema validation", () => {
      it("should detect missing required fields", (ctx) => {
        if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

        // Create gates.yml missing required 'name' field
        fs.writeFileSync(
          path.join(testProfileDir, "gates.yml"),
          `version: 1
levels:
  default:
    - run: npm run lint
`
        );

        try {
          execSync(`node ${cliPath} config validate --profile-dir ${testProfileDir} --json`, {
            encoding: "utf8",
            stdio: "pipe",
          });
          throw new Error("Should have failed");
        } catch (error: any) {
          const output = error.stdout || "";
          const result = JSON.parse(output);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      });
    });

    describe("cross-reference validation", () => {
      it("should warn about undefined gate references", (ctx) => {
        if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

        // Create gates.yml with defined gates
        fs.writeFileSync(
          path.join(testProfileDir, "gates.yml"),
          `version: 1
levels:
  default:
    - name: lint
      run: npm run lint
`
        );

        // Create stack.yml referencing undefined gate
        fs.writeFileSync(
          path.join(testProfileDir, "stack.yml"),
          `version: 1
target: main
items:
  - branch: feature-1
    deps: []
    gates:
      - name: e2e
        run: npm run e2e
`
        );

        fs.writeFileSync(
          path.join(testProfileDir, "scope.yml"),
          `version: 1
target: main
sources:
  - query: "is:open"
selectors:
  include_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`
        );

        const output = execSync(
          `node ${cliPath} config validate --profile-dir ${testProfileDir} --json`,
          {
            encoding: "utf8",
          }
        );

        const result = JSON.parse(output);
        expect(result.valid).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.some((w: any) => w.message.includes("Referenced gate 'e2e'"))).toBe(
          true
        );
      });
    });

    describe("--strict mode", () => {
      it("should fail on warnings in strict mode", (ctx) => {
        if (skipIfCliNotBuilt({ skip: ctx.skip })) return;

        // Create configuration with warnings
        fs.writeFileSync(
          path.join(testProfileDir, "gates.yml"),
          `version: 1
levels:
  default:
    - name: lint
      run: npm run lint
`
        );

        fs.writeFileSync(
          path.join(testProfileDir, "stack.yml"),
          `version: 1
target: main
items:
  - branch: feature-1
    deps: []
    gates:
      - name: e2e
        run: npm run e2e
`
        );

        fs.writeFileSync(
          path.join(testProfileDir, "scope.yml"),
          `version: 1
target: main
sources:
  - query: "is:open"
selectors:
  include_labels: []
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
`
        );

        try {
          execSync(
            `node ${cliPath} config validate --profile-dir ${testProfileDir} --strict --json`,
            {
              encoding: "utf8",
              stdio: "pipe",
            }
          );
          throw new Error("Should have failed");
        } catch (error: any) {
          const output = error.stdout || "";
          const result = JSON.parse(output);
          expect(result.valid).toBe(false);
          expect(result.warnings.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
