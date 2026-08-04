import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

describe("CLI package version", () => {
  it("reports the version from package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8")
    ) as { version: string };
    const result = await execa("node", [resolve(repositoryRoot, "dist/cli.js"), "--version"], {
      cwd: repositoryRoot,
    });

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`LexRunner ${packageJson.version} (lexrunner)`);
  });
});
