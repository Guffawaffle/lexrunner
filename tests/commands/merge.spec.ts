import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerMergeCommand } from "../../src/commands/merge.js";

describe("merge compatibility command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
  });

  it("keeps only the options that project onto canonical weave apply", () => {
    registerMergeCommand(
      program,
      () => false,
      () => ({})
    );
    const command = program.commands.find((candidate) => candidate.name() === "merge");

    expect(command?.description()).toBe("Compatibility alias for weave apply");
    expect(command?.options.map(({ long }) => long)).toEqual([
      "--plan",
      "--dry-run",
      "--execute",
      "--no-constraints",
      "--skip-gates",
      "--json",
    ]);
  });

  it("routes the default preview through the canonical apply handler", async () => {
    const runApply = vi.fn(async () => undefined);
    registerMergeCommand(
      program,
      () => false,
      () => ({}),
      { runApply }
    );

    await program.parseAsync(["node", "lex-pr", "merge", "--plan", "custom-plan.json"]);

    expect(runApply).toHaveBeenCalledOnce();
    expect(runApply.mock.calls[0]?.[0]).toMatchObject({
      plan: "custom-plan.json",
      dryRun: true,
    });
  });

  it("routes authorized execution through the canonical apply handler", async () => {
    const runApply = vi.fn(async () => undefined);
    registerMergeCommand(
      program,
      () => true,
      () => ({}),
      { runApply }
    );

    await program.parseAsync([
      "node",
      "lex-pr",
      "merge",
      "--plan",
      "custom-plan.json",
      "--execute",
      "--skip-gates",
      "--json",
    ]);

    expect(runApply).toHaveBeenCalledOnce();
    expect(runApply.mock.calls[0]?.[0]).toMatchObject({
      plan: "custom-plan.json",
      dryRun: false,
      execute: true,
      skipGates: true,
      json: true,
    });
  });
});
