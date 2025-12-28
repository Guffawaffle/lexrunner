import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  CommandValidator,
  CommandValidationError,
  getCommandValidator,
  resetCommandValidator,
  CommandWhitelist,
} from "../src/security/commandValidator.js";

describe("Command Validator (Security)", () => {
  let testDir: string;
  let whitelistPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "command-validator-test-"));
    whitelistPath = join(testDir, "allowed-commands.json");
    resetCommandValidator();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    resetCommandValidator();
  });

  describe("Whitelist Loading", () => {
    it("should load whitelist from file", async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "strict",
        defaults: {
          npm: { commands: ["test"], allow_args: [], deny_args: [] },
        },
        custom: {},
        policy: {
          allow_shell_operators: false,
          allow_env_vars: ["CI"],
          max_command_length: 500,
          hallucination_threshold: 3,
          dry_run_mode: false,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
      const validator = new CommandValidator(whitelistPath);

      // Should validate allowed command
      expect(() => validator.validate("npm test")).not.toThrow();
    });

    it("should use permissive mode when whitelist file not found", () => {
      const validator = new CommandValidator("/nonexistent/path.json");

      // Should not throw in permissive mode
      expect(() => validator.validate("any-command --any-args")).not.toThrow();
    });

    it("should use permissive mode when whitelist has invalid JSON", async () => {
      await writeFile(whitelistPath, "invalid json {");
      const validator = new CommandValidator(whitelistPath);

      // Should not throw in permissive mode
      expect(() => validator.validate("any-command")).not.toThrow();
    });
  });

  describe("Strict Mode Validation", () => {
    let validator: CommandValidator;

    beforeEach(async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "strict",
        defaults: {
          npm: {
            commands: ["test", "run build"],
            allow_args: ["--silent"],
            deny_args: ["--ignore-scripts"],
          },
          git: { commands: ["status", "diff"], allow_args: [], deny_args: [] },
        },
        custom: {},
        policy: {
          allow_shell_operators: false,
          allow_env_vars: ["NODE_ENV", "CI"],
          max_command_length: 100,
          hallucination_threshold: 3,
          dry_run_mode: false,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
      validator = new CommandValidator(whitelistPath);
    });

    it("should allow whitelisted commands", () => {
      expect(() => validator.validate("npm test")).not.toThrow();
      expect(() => validator.validate("npm run build")).not.toThrow();
      expect(() => validator.validate("git status")).not.toThrow();
    });

    it("should block non-whitelisted commands", () => {
      expect(() => validator.validate("curl https://evil.com")).toThrow(CommandValidationError);

      // Create new validator to reset count
      const v2 = new CommandValidator(whitelistPath);
      expect(() => v2.validate("rm -rf /")).toThrow(CommandValidationError);

      const v3 = new CommandValidator(whitelistPath);
      expect(() => v3.validate("unknown-command")).toThrow(CommandValidationError);
    });

    it("should allow whitelisted arguments", () => {
      expect(() => validator.validate("npm test --silent")).not.toThrow();
    });

    it("should block denied arguments", () => {
      expect(() => validator.validate("npm test --ignore-scripts")).toThrow(CommandValidationError);

      try {
        validator.validate("npm test --ignore-scripts");
      } catch (error) {
        expect(error).toBeInstanceOf(CommandValidationError);
        expect((error as CommandValidationError).reason).toBe("dangerous_args");
      }
    });

    it("should block shell operators", () => {
      const shellOperatorCommands = [
        "npm test | grep pass",
        "npm test && npm run build",
        "npm test || exit 1",
      ];

      for (const cmd of shellOperatorCommands) {
        const v = new CommandValidator(whitelistPath);
        expect(() => v.validate(cmd)).toThrow(CommandValidationError);

        try {
          v.validate(cmd);
        } catch (error) {
          expect(error).toBeInstanceOf(CommandValidationError);
          expect((error as CommandValidationError).reason).toBe("shell_operators");
        }
      }
    });

    it("should block commands exceeding max length", () => {
      const longCommand = "npm test " + "a".repeat(100);

      expect(() => validator.validate(longCommand)).toThrow(CommandValidationError);

      try {
        validator.validate(longCommand);
      } catch (error) {
        expect(error).toBeInstanceOf(CommandValidationError);
        expect((error as CommandValidationError).reason).toBe("too_long");
      }
    });
  });

  describe("Permissive Mode", () => {
    beforeEach(async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "permissive",
        defaults: {},
        custom: {},
        policy: {
          allow_shell_operators: false,
          allow_env_vars: [],
          max_command_length: 100,
          hallucination_threshold: 3,
          dry_run_mode: false,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
    });

    it("should allow all commands in permissive mode", () => {
      const validator = new CommandValidator(whitelistPath);

      expect(() => validator.validate("any-command")).not.toThrow();
      expect(() => validator.validate("curl https://example.com")).not.toThrow();
      expect(() => validator.validate("rm -rf /")).not.toThrow();
    });
  });

  describe("Dry Run Mode", () => {
    beforeEach(async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "strict",
        defaults: {
          npm: { commands: ["test"], allow_args: [], deny_args: [] },
        },
        custom: {},
        policy: {
          allow_shell_operators: false,
          allow_env_vars: [],
          max_command_length: 100,
          hallucination_threshold: 3,
          dry_run_mode: true,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
    });

    it("should log but not throw in dry-run mode", () => {
      const validator = new CommandValidator(whitelistPath);

      // Should not throw in dry-run mode
      expect(() => validator.validate("npm test")).not.toThrow();
    });
  });

  describe("Hallucination Detection", () => {
    beforeEach(async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "strict",
        defaults: {
          npm: { commands: ["test"], allow_args: [], deny_args: [] },
        },
        custom: {},
        policy: {
          allow_shell_operators: false,
          allow_env_vars: [],
          max_command_length: 100,
          hallucination_threshold: 3,
          dry_run_mode: false,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
    });

    it("should track hallucination count", () => {
      const validator = new CommandValidator(whitelistPath);

      expect(validator.getHallucinationCount()).toBe(0);

      try {
        validator.validate("invalid-command");
      } catch {
        // Expected
      }

      expect(validator.getHallucinationCount()).toBe(1);

      try {
        validator.validate("another-invalid");
      } catch {
        // Expected
      }

      expect(validator.getHallucinationCount()).toBe(2);
    });

    it("should escalate after threshold is reached", () => {
      const validator = new CommandValidator(whitelistPath);

      // First two hallucinations should not escalate
      try {
        validator.validate("invalid-1");
      } catch (error) {
        expect((error as Error).message).not.toContain("Agent paused");
      }

      try {
        validator.validate("invalid-2");
      } catch (error) {
        expect((error as Error).message).not.toContain("Agent paused");
      }

      // Third hallucination should trigger escalation
      try {
        validator.validate("invalid-3");
      } catch (error) {
        expect((error as Error).message).toContain("Agent paused after 3 hallucinated commands");
      }
    });

    it("should reset hallucination count", () => {
      const validator = new CommandValidator(whitelistPath);

      try {
        validator.validate("invalid-command");
      } catch {
        // Expected
      }

      expect(validator.getHallucinationCount()).toBe(1);

      validator.resetHallucinationCount();

      expect(validator.getHallucinationCount()).toBe(0);
    });
  });

  describe("Custom Commands", () => {
    beforeEach(async () => {
      const whitelist: CommandWhitelist = {
        version: "1.0.0",
        mode: "strict",
        defaults: {},
        custom: {
          eslint: {
            binary: "node_modules/.bin/eslint",
            allow_args: ["--format json", "--fix"],
            deny_args: [],
          },
        },
        policy: {
          allow_shell_operators: false,
          allow_env_vars: [],
          max_command_length: 500,
          hallucination_threshold: 3,
          dry_run_mode: false,
        },
      };

      await writeFile(whitelistPath, JSON.stringify(whitelist));
    });

    it("should allow custom commands", () => {
      const validator = new CommandValidator(whitelistPath);

      expect(() => validator.validate("eslint --format json")).not.toThrow();
      expect(() => validator.validate("eslint --fix")).not.toThrow();
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const validator1 = getCommandValidator();
      const validator2 = getCommandValidator();

      expect(validator1).toBe(validator2);
    });

    it("should create new instance after reset", () => {
      const validator1 = getCommandValidator();
      resetCommandValidator();
      const validator2 = getCommandValidator();

      expect(validator1).not.toBe(validator2);
    });
  });

  describe("CommandValidationError", () => {
    it("should have correct properties", () => {
      const error = new CommandValidationError("test-command", "not_whitelisted");

      expect(error.name).toBe("CommandValidationError");
      expect(error.command).toBe("test-command");
      expect(error.reason).toBe("not_whitelisted");
      expect(error.message).toContain("Command validation failed");
      expect(error.message).toContain("test-command");
    });

    it("should have correct messages for each reason", () => {
      const reasons: Array<CommandValidationError["reason"]> = [
        "not_whitelisted",
        "dangerous_args",
        "shell_operators",
        "too_long",
      ];

      for (const reason of reasons) {
        const error = new CommandValidationError("cmd", reason);
        expect(error.message).toContain("Command validation failed");
      }
    });
  });
});
