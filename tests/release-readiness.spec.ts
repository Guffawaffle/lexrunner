import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const previousPackageExportKeys = [
  ".",
  "./audit-sdk",
  "./errors",
  "./frames",
  "./schemas/behavior-rule",
  "./schemas/execution-plan-v1",
  "./schemas/gates",
  "./schemas/runner-scope",
  "./schemas/runner-stack",
];

describe("LexRunner 1.2 release readiness", () => {
  it("keeps package, runtime, dependency, and prior export identity aligned", async () => {
    const packageJson = await readJson<{
      version: string;
      engines: { node: string };
      dependencies: Record<string, string>;
      exports: Record<string, unknown>;
    }>("package.json");

    expect(packageJson.version).toBe("1.2.0");
    expect(packageJson.engines.node).toBe(">=24");
    expect(packageJson.dependencies["@smartergpt/lex"]).toBe("^3.0.1");
    expect(Object.keys(packageJson.exports).sort()).toEqual(previousPackageExportKeys.sort());
  });

  it("validates the installed Lex 3 line exposes every directly consumed public subpath", async () => {
    const lexPackage = await readJson<{
      version: string;
      exports: Record<string, unknown>;
    }>("node_modules/@smartergpt/lex/package.json");

    expect(lexPackage.version).toBe("3.0.1");
    for (const path of [
      ".",
      "./aliases",
      "./atlas",
      "./errors",
      "./module-ids",
      "./prompts",
      "./store",
      "./types",
    ]) {
      expect(Object.keys(lexPackage.exports), `Lex 3 omitted ${path}`).toContain(path);
    }
  });

  it("keeps release notes, migration guidance, and current version documentation consistent", async () => {
    const [readme, changelog, releaseNotes, migration] = await Promise.all([
      read("README.md"),
      read("CHANGELOG.md"),
      read("docs/releases/1.2.0.md"),
      read("docs/node-24-migration.md"),
    ]);

    expect(readme).toContain("Current repository package version: **1.2.0**");
    expect(changelog).toContain("## [1.2.0] - 2026-07-21");
    expect(releaseNotes).toContain("The next version is **1.2.0**");
    expect(releaseNotes).toContain("public unattended/headless worker-launch");
    expect(releaseNotes).toContain("separate explicitly authorized action");
    expect(migration).toContain("@smartergpt/lexrunner@1.2.0");
    expect(migration).not.toContain("@smartergpt/lexrunner@3.1.0");
  });
});

async function read(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await read(path)) as T;
}
