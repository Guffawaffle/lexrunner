import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import {
  aliasWarning,
  CLI_ALIAS_POLICY,
  commandPath,
  emitAliasWarning,
} from "../../src/cli/alias-policy.js";

describe("CLI alias policy", () => {
  it("matches every compatibility and deprecated matrix registration", async () => {
    const matrix = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "../../docs/architecture/cli-mcp-surface.json"),
        "utf8"
      )
    ) as {
      cli: {
        compatibility: Array<{ path: string; replacement: string }>;
        deprecated: Array<{ path: string; replacement: string }>;
      };
    };
    const expected = [
      ...matrix.cli.compatibility.map((entry) => ({ ...entry, disposition: "compatibility" })),
      ...matrix.cli.deprecated.map((entry) => ({ ...entry, disposition: "deprecated" })),
    ].sort((left, right) => left.path.localeCompare(right.path));
    expect(
      CLI_ALIAS_POLICY.map(({ path, disposition, replacement }) => ({
        path,
        disposition,
        replacement,
      })).sort((left, right) => left.path.localeCompare(right.path))
    ).toEqual(expected);
    expect(
      CLI_ALIAS_POLICY.filter(({ disposition }) => disposition === "deprecated").every(
        ({ removeIn }) => removeIn === "3.0.0"
      )
    ).toBe(true);
  });

  it("derives nested registration paths and writes warnings only to the supplied stderr sink", () => {
    const root = new Command("lex-pr");
    const execute = root.command("gate").command("execute");
    const write = vi.fn();
    expect(commandPath(execute)).toBe("gate execute");
    emitAliasWarning(execute, write);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toContain('use "gate run"');
  });

  it("gives deprecated aliases stable replacement and removal guidance", () => {
    expect(aliasWarning("status")).toBe(
      '[lexrunner] deprecated alias "status"; use "weave status"; removal: 3.0.0.'
    );
    expect(aliasWarning("weave status")).toBeNull();
  });

  it("keeps merge as a tested compatibility alias for weave apply", () => {
    expect(aliasWarning("merge")).toBe(
      '[lexrunner] compatibility alias "merge"; use "weave apply"; supported through 2.x and reviewed at 3.0.0.'
    );
  });
});
