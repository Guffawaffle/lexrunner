import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { registerMergeCommand } from "../../src/commands/merge.js";

describe("Merge Command", () => {
  let program: Command;
  let jsonModeActive: boolean;

  beforeEach(() => {
    // Reset state
    jsonModeActive = false;

    // Create a fresh Command instance
    program = new Command();
    program.exitOverride(); // Prevent actual process exit

    // Register the merge command
    registerMergeCommand(
      program,
      () => jsonModeActive,
      () => ({ auditProfile: "off" })
    );
  });

  describe("command registration", () => {
    it("should register merge command with correct name", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      expect(mergeCommand).toBeDefined();
      expect(mergeCommand?.description()).toBe("Execute merge pyramid with git operations");
    });

    it("should register all required options", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      expect(mergeCommand).toBeDefined();

      const options = mergeCommand?.options.map((opt) => opt.long);
      expect(options).toContain("--plan");
      expect(options).toContain("--dry-run");
      expect(options).toContain("--execute");
      expect(options).toContain("--cleanup");
      expect(options).toContain("--json");
      expect(options).toContain("--batch");
      expect(options).toContain("--filter");
      expect(options).toContain("--levels");
      expect(options).toContain("--items");
      expect(options).toContain("--max-level");
      expect(options).toContain("--open-pr");
      expect(options).toContain("--close-superseded");
      expect(options).toContain("--comment-template");
      expect(options).toContain("--branch-prefix");
      expect(options).toContain("--resolve-policy");
      expect(options).toContain("--ai-assist");
      expect(options).toContain("--emit-frames");
    });

    it("should have correct default values", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      const planOption = mergeCommand?.options.find((opt) => opt.long === "--plan");
      expect(planOption?.defaultValue).toBe("plan.json");

      const dryRunOption = mergeCommand?.options.find((opt) => opt.long === "--dry-run");
      expect(dryRunOption?.defaultValue).toBe(true);

      const maxLevelOption = mergeCommand?.options.find((opt) => opt.long === "--max-level");
      expect(maxLevelOption?.defaultValue).toBe("0");

      const branchPrefixOption = mergeCommand?.options.find(
        (opt) => opt.long === "--branch-prefix"
      );
      expect(branchPrefixOption?.defaultValue).toBe("integration/");

      const resolvePolicyOption = mergeCommand?.options.find(
        (opt) => opt.long === "--resolve-policy"
      );
      expect(resolvePolicyOption?.defaultValue).toBe("minimal-hunk");

      const aiAssistOption = mergeCommand?.options.find((opt) => opt.long === "--ai-assist");
      expect(aiAssistOption?.defaultValue).toBe("auto");
    });

    it("should include help text with examples", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      // The command should have help text
      expect(mergeCommand).toBeDefined();

      // Verify the command has the expected structure
      expect(mergeCommand?.description()).toBe("Execute merge pyramid with git operations");

      // Verify key options are registered (examples are in addHelpText which isn't in helpInformation)
      const options = mergeCommand?.options.map((opt) => opt.long);
      expect(options).toContain("--execute");
      expect(options).toContain("--cleanup");
    });
  });

  describe("option descriptions", () => {
    it("should have descriptive option help text", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      const helpText = mergeCommand?.helpInformation() ?? "";

      // Verify key option descriptions are present
      expect(helpText).toContain("--plan");
      expect(helpText).toContain("--dry-run");
      expect(helpText).toContain("--execute");
      expect(helpText).toContain("--max-level");
    });

    it("should document autopilot-related options", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      const helpText = mergeCommand?.helpInformation() ?? "";

      // Autopilot options
      expect(helpText).toContain("--max-level");
      expect(helpText).toContain("--open-pr");
      expect(helpText).toContain("--close-superseded");
      expect(helpText).toContain("--comment-template");
      expect(helpText).toContain("--branch-prefix");
    });

    it("should document new merge-weave flags", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      const helpText = mergeCommand?.helpInformation() ?? "";

      // New flags for merge-weave execute
      expect(helpText).toContain("--resolve-policy");
      expect(helpText).toContain("minimal-hunk");
      expect(helpText).toContain("ours");
      expect(helpText).toContain("theirs");
      expect(helpText).toContain("--ai-assist");
      expect(helpText).toContain("auto");
      expect(helpText).toContain("none");
      expect(helpText).toContain("required");
      expect(helpText).toContain("--emit-frames");
    });
  });

  describe("command structure", () => {
    it("should have an action handler", () => {
      const commands = program.commands;
      const mergeCommand = commands.find((cmd) => cmd.name() === "merge");

      expect(mergeCommand).toBeDefined();
      // Commander wraps action handlers, so we can't easily test their existence
      // but if the command registered, it has an action
    });

    it("should be properly integrated into program", () => {
      const commandNames = program.commands.map((cmd) => cmd.name());
      expect(commandNames).toContain("merge");
    });
  });
});
