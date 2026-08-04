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

describe("LexRunner current release readiness", () => {
  it("keeps package, runtime, dependency, and prior export identity aligned", async () => {
    const packageJson = await readJson<{
      version: string;
      engines: { node: string };
      dependencies: Record<string, string>;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      repository: { url: string };
      scripts: Record<string, string>;
    }>("package.json");

    expect(packageJson.version).toBe("1.4.1");
    expect(packageJson.engines.node).toBe(">=24");
    expect(packageJson.dependencies["@smartergpt/lex"]).toBe("^4.0.0");
    expect(packageJson.bin["lexrunner"]).toBe("dist/cli.js");
    expect(packageJson.bin["lex-pr"]).toBe("dist/cli.js");
    expect(packageJson.bin["lexrunner-mcp"]).toBe("mcp-server.mjs");
    expect(packageJson.repository.url).toBe("git+https://github.com/Guffawaffle/lexrunner.git");
    expect(packageJson.scripts["release:publish:check"]).toBe(
      "tsx scripts/release-publish-check.ts"
    );
    expect(Object.keys(packageJson.exports).sort()).toEqual(previousPackageExportKeys.sort());
  });

  it("validates the installed Lex 4 line exposes every directly consumed public subpath", async () => {
    const lexPackage = await readJson<{
      version: string;
      exports: Record<string, unknown>;
    }>("node_modules/@smartergpt/lex/package.json");

    expect(lexPackage.version).toBe("4.0.0");
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
      expect(Object.keys(lexPackage.exports), `Lex 4 omitted ${path}`).toContain(path);
    }
  });

  it("keeps release notes, migration guidance, and current version documentation consistent", async () => {
    const [
      readme,
      changelog,
      releaseNotes,
      priorReleaseNotes,
      compatibilityDecision,
      migration,
      instructions,
      releaseWorkflow,
      releaseProcess,
      releaseDriftCheck,
    ] = await Promise.all([
      read("README.md"),
      read("CHANGELOG.md"),
      read("docs/releases/1.4.1.md"),
      read("docs/releases/1.2.1.md"),
      read("docs/releases/1.2.0.md"),
      read("docs/node-24-migration.md"),
      read("AGENTS.md"),
      read(".github/workflows/release.yml"),
      read("docs/release-process.md"),
      read("scripts/check-release-drift.mjs"),
    ]);

    expect(readme).toContain("Current repository package version: **1.4.1**");
    expect(readme).toContain("`lex-pr` executable remains an additive");
    expect(changelog).toContain("## [1.4.1] - 2026-08-04");
    expect(releaseNotes).toContain("release-owner-signed, trusted-workflow npm publication");
    expect(releaseNotes).toContain("`lexrunner`, `lex-pr`, and `lexrunner-mcp`");
    expect(priorReleaseNotes).toContain("human-only publication gate");
    expect(compatibilityDecision).toContain("public unattended/headless worker-launch");
    expect(compatibilityDecision).toContain("separate explicitly authorized action");
    expect(compatibilityDecision).toContain("not published to npm");
    expect(migration).toContain("@smartergpt/lexrunner@1.4.1");
    expect(migration).not.toContain("@smartergpt/lexrunner@3.1.0");
    expect(instructions).toContain("MUST NOT");
    expect(instructions).toContain("npm's package-scoped GitHub OIDC trusted publisher");
    expect(releaseWorkflow).toContain('"lexrunner-v*.*.*"');
    expect(releaseWorkflow).not.toContain('"v*.*.*"');
    expect(releaseWorkflow).toContain("npm publish --access restricted --tag latest --json");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("package-manager-cache: false");
    expect(releaseWorkflow).toContain("github.event_name == 'push' &&");
    expect(releaseWorkflow).toContain("API_TARGET_TYPE=$(jq -r '.object.type'");
    expect(releaseWorkflow).toContain("API_TARGET_SHA=$(jq -r '.object.sha'");
    expect(releaseWorkflow).toContain(
      "RELEASE_SIGNER_FINGERPRINT: 65C94BA03E88F53D365C36CF7145A1CE635B1902"
    );
    expect(releaseWorkflow).toContain('git verify-commit "$GITHUB_SHA"');
    expect(releaseWorkflow).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(releaseWorkflow).not.toContain("NODE_AUTH_TOKEN");
    expect(releaseWorkflow).not.toContain("secrets.NPM_TOKEN");
    expect(releaseProcess).toContain("npm trust github @smartergpt/lexrunner --file release.yml");
    expect(releaseProcess).toContain("lexrunner-vX.Y.Z");
    expect(releaseProcess).toContain("runs only for push events");
    expect(releaseDriftCheck).toContain("lexrunner-v${version}");
  });
});

async function read(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await read(path)) as T;
}
