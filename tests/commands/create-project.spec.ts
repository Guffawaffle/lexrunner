/**
 * Create Project Command Tests
 * Tests for the create-project command module
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { registerCreateProjectCommand } from "../../src/commands/create-project.js";

describe("Create Project Command Module", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    vi.clearAllMocks();
  });

  describe("Command Registration", () => {
    it("should register the create-project command", () => {
      registerCreateProjectCommand(program);

      const cmd = program.commands.find((c) => c.name() === "create-project");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe(
        "Generate Execution Plan v1 from Feature Spec v0, create Epic + Sub-Issues"
      );
    });

    it("should register all expected options", () => {
      registerCreateProjectCommand(program);

      const cmd = program.commands.find((c) => c.name() === "create-project");
      expect(cmd).toBeDefined();

      const optionNames = cmd?.options.map((opt) => opt.long) ?? [];

      // Required options
      expect(optionNames).toContain("--spec");

      // Core options
      expect(optionNames).toContain("--dry-run");
      expect(optionNames).toContain("--output");
      expect(optionNames).toContain("--repo");

      // GitHub integration options
      expect(optionNames).toContain("--project");
      expect(optionNames).toContain("--epic-labels");
      expect(optionNames).toContain("--issue-labels");
      expect(optionNames).toContain("--no-link");
    });

    it("should mark --spec as required", () => {
      registerCreateProjectCommand(program);

      const cmd = program.commands.find((c) => c.name() === "create-project");
      const specOption = cmd?.options.find((opt) => opt.long === "--spec");

      expect(specOption).toBeDefined();
      expect(specOption?.required).toBe(true);
    });

    it("should have help text with options", () => {
      registerCreateProjectCommand(program);

      const cmd = program.commands.find((c) => c.name() === "create-project");
      const helpText = cmd?.helpInformation() ?? "";

      // Check for key options in help text
      expect(helpText).toContain("--spec");
      expect(helpText).toContain("--dry-run");
      expect(helpText).toContain("--output");
      expect(helpText).toContain("--repo");
    });
  });

  describe("Command Integration", () => {
    it("should be registered alongside other commands in a program", () => {
      const testProgram = new Command();

      // Register multiple commands
      registerCreateProjectCommand(testProgram);

      testProgram.command("other-command").description("Another command");

      expect(testProgram.commands).toHaveLength(2);
      expect(testProgram.commands.map((c) => c.name())).toContain("create-project");
      expect(testProgram.commands.map((c) => c.name())).toContain("other-command");
    });
  });
});
