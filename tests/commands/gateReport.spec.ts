/**
 * Tests for the gate-report command module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerGateReportCommand } from "../../src/commands/gateReport.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Gate Report Command", () => {
  let program: Command;
  let tempDir: string;

  beforeEach(() => {
    // Create fresh Command instance for each test
    program = new Command();

    // Create temp directory for test fixtures
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-report-cmd-test-"));
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("Command Registration", () => {
    it("should register gate-report parent command with correct configuration", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      expect(gateReportCommand).toBeDefined();
      expect(gateReportCommand?.name()).toBe("gate-report");
      expect(gateReportCommand?.description()).toBe("Gate report operations");
    });

    it("should register validate subcommand with correct configuration", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      expect(gateReportCommand).toBeDefined();

      const validateCommand = gateReportCommand?.commands.find((cmd) => cmd.name() === "validate");
      expect(validateCommand).toBeDefined();
      expect(validateCommand?.name()).toBe("validate");
      expect(validateCommand?.description()).toBe("Validate gate report file(s)");

      // Check required argument
      const args = (validateCommand as any)._args;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe("file");
      expect(args[0].required).toBe(true);

      // Check options
      const opts = validateCommand?.options;
      const jsonOption = opts?.find((opt) => opt.long === "--json");
      expect(jsonOption).toBeDefined();
      expect(jsonOption?.description).toContain("JSON");

      const migrateOption = opts?.find((opt) => opt.long === "--migrate");
      expect(migrateOption).toBeDefined();
      expect(migrateOption?.description).toContain("migrate");
    });
  });

  describe("Validation Behavior", () => {
    it("should have validate subcommand accessible", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      const validateCommand = gateReportCommand?.commands.find((cmd) => cmd.name() === "validate");

      expect(validateCommand).toBeDefined();
      expect(typeof (validateCommand as any)._actionHandler).toBe("function");
    });

    it("should accept file argument in validate subcommand", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      const validateCommand = gateReportCommand?.commands.find((cmd) => cmd.name() === "validate");

      const args = (validateCommand as any)._args;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe("file");
    });
  });

  describe("Command Options", () => {
    it("should support --json flag for machine-readable output", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      const validateCommand = gateReportCommand?.commands.find((cmd) => cmd.name() === "validate");

      const jsonOption = validateCommand?.options.find((opt) => opt.long === "--json");
      expect(jsonOption).toBeDefined();
    });

    it("should support --migrate flag for legacy format migration", () => {
      registerGateReportCommand(program);

      const gateReportCommand = program.commands.find((cmd) => cmd.name() === "gate-report");
      const validateCommand = gateReportCommand?.commands.find((cmd) => cmd.name() === "validate");

      const migrateOption = validateCommand?.options.find((opt) => opt.long === "--migrate");
      expect(migrateOption).toBeDefined();
    });
  });

  describe("Module Export", () => {
    it("should export registerGateReportCommand function", () => {
      expect(typeof registerGateReportCommand).toBe("function");
    });

    it("should accept a Commander program instance", () => {
      expect(() => registerGateReportCommand(program)).not.toThrow();
    });

    it("should modify the program by adding commands", () => {
      const initialCommandCount = program.commands.length;
      registerGateReportCommand(program);
      expect(program.commands.length).toBeGreaterThan(initialCommandCount);
    });
  });
});
