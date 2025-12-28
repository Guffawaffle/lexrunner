import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerAutopilotCommand } from "../../src/commands/autopilot.js";

describe("Autopilot Command", () => {
  let program: Command;
  let exitWithCalls: unknown[];
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let stdoutWriteSpy: any;
  let jsonModeActive: boolean;
  let auditProfile: string | undefined;
  let auditKey: string | undefined;
  let throwExitCalls: number[];

  beforeEach(() => {
    // Reset state
    exitWithCalls = [];
    throwExitCalls = [];
    jsonModeActive = false;
    auditProfile = undefined;
    auditKey = undefined;

    // Create a fresh Command instance
    program = new Command();
    program.exitOverride(); // Prevent actual process exit

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitWith = (error: unknown) => {
      exitWithCalls.push(error);
      throw error;
    };

    const mockThrowExit = (code: number) => {
      throwExitCalls.push(code);
      throw new Error(`exit(${code})`);
    };

    // Register the autopilot command
    registerAutopilotCommand(program, {
      jsonModeActive: () => jsonModeActive,
      exitWith,
      getAuditProfile: () => auditProfile,
      getAuditKey: () => auditKey,
      finalizeAuditGuard: vi.fn(() => Promise.resolve()),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("command registration", () => {
    it("should register autopilot command with correct name", () => {
      const commands = program.commands;
      const autopilotCommand = commands.find((cmd) => cmd.name() === "autopilot");

      expect(autopilotCommand).toBeDefined();
      expect(autopilotCommand?.description()).toBe(
        "Run autopilot analysis and artifact generation"
      );
    });

    it("should register all required options", () => {
      const commands = program.commands;
      const autopilotCommand = commands.find((cmd) => cmd.name() === "autopilot");

      expect(autopilotCommand).toBeDefined();

      const options = autopilotCommand?.options.map((opt) => opt.long);
      expect(options).toContain("--plan");
      expect(options).toContain("--level");
      expect(options).toContain("--profile-dir");
      expect(options).toContain("--deliverables-dir");
      expect(options).toContain("--json");
    });

    it("should have correct default value for level", () => {
      const commands = program.commands;
      const autopilotCommand = commands.find((cmd) => cmd.name() === "autopilot");

      const levelOption = autopilotCommand?.options.find((opt) => opt.long === "--level");
      expect(levelOption?.defaultValue).toBe("1");
    });

    it("should have correct option descriptions", () => {
      const commands = program.commands;
      const autopilotCommand = commands.find((cmd) => cmd.name() === "autopilot");

      const planOption = autopilotCommand?.options.find((opt) => opt.long === "--plan");
      expect(planOption?.description).toBe("Path to plan.json file");

      const levelOption = autopilotCommand?.options.find((opt) => opt.long === "--level");
      expect(levelOption?.description).toBe("Autopilot level (0=report-only, 1=artifacts)");

      const profileOption = autopilotCommand?.options.find((opt) => opt.long === "--profile-dir");
      expect(profileOption?.description).toBe("Profile directory (default: .smartergpt)");

      const deliverablesOption = autopilotCommand?.options.find(
        (opt) => opt.long === "--deliverables-dir"
      );
      expect(deliverablesOption?.description).toBe(
        "Custom deliverables directory (overrides default profile/deliverables)"
      );

      const jsonOption = autopilotCommand?.options.find((opt) => opt.long === "--json");
      expect(jsonOption?.description).toBe("Output JSON format");
    });
  });

  describe("error handling", () => {
    it("should error when no plan file is provided", async () => {
      await expect(program.parseAsync(["node", "test", "autopilot"])).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: plan file is required (use --plan <file> or provide as argument)"
      );
    });
  });
});
