import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";

import { configureProgressiveHelp } from "../src/cli/progressive-help.js";
import { collectRegisteredCliSurface } from "../src/cli/registered-surface.js";

function fixture() {
  let output = "";
  const action = vi.fn();
  const root = new Command("lexrunner").exitOverride().configureOutput({
    writeOut: (text) => {
      output += text;
    },
    writeErr: (text) => {
      output += text;
    },
  });
  configureProgressiveHelp(root);
  root.command("weave").command("recover").action(action);
  root.command("idea").action(action);
  root.command("advanced").command("repair").action(action);
  root.command("legacy").action(action);
  return { root, action, output: () => output };
}

describe("progressive root help", () => {
  it("filters presentation without deleting registrations or nested recovery help", () => {
    const { root } = fixture();
    const before = collectRegisteredCliSurface(root);
    const visible = root
      .createHelp()
      .visibleCommands(root)
      .map((command) => command.name());
    expect(visible).toEqual(["weave", "idea", "help"]);
    expect(
      root.commands.find((command) => command.name() === "advanced")!.helpInformation()
    ).toContain("repair");
    expect(
      root.commands.find((command) => command.name() === "weave")!.helpInformation()
    ).toContain("recover");
    expect(collectRegisteredCliSurface(root)).toEqual(before);
  });

  it.each([["--help-all"], ["advanced", "repair", "--help-all"], ["--help-all", "legacy"]])(
    "shows all registered families without executing a selected operation: %j",
    (...argv) => {
      const { root, action, output } = fixture();
      try {
        root.parse(argv, { from: "user" });
        throw new Error("expected help exit");
      } catch (error) {
        expect(error).toBeInstanceOf(CommanderError);
        expect((error as CommanderError).exitCode).toBe(0);
      }
      expect(output()).toContain("advanced");
      expect(output()).toContain("legacy");
      expect(action).not.toHaveBeenCalled();
    }
  );

  it("retains direct access to operations omitted from the first view", () => {
    const { root, action } = fixture();
    root.parse(["legacy"], { from: "user" });
    expect(action).toHaveBeenCalledOnce();
  });

  it("shows the real plan output contract and separates preview from authority", () => {
    const { root, output, action } = fixture();
    expect(() => root.parse(["--help"], { from: "user" })).toThrow(CommanderError);
    expect(output()).toContain("--output plan.json --json");
    expect(output()).not.toContain("--json > plan.json");
    expect(output()).toContain("Preview may write local diagnostics");
    expect(output()).toContain("separate review and explicit authority");
    expect(output()).toContain("--help-all");
    expect(action).not.toHaveBeenCalled();
  });
});
