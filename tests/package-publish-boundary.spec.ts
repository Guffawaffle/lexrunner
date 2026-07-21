import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type PackageManifest,
  validatePackageManifestForPublish,
} from "../scripts/validate-package-boundary.js";
import {
  humanPublishCommand,
  releaseTagForVersion,
  validateReleaseManifest,
} from "../scripts/release-publish-check.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("npm publication boundary", () => {
  it("accepts the canonical package manifest", () => {
    const manifest = readManifest();
    expect(() => validatePackageManifestForPublish(manifest, repositoryRoot)).not.toThrow();
    expect(() => validateReleaseManifest(manifest)).not.toThrow();
  });

  it("rejects bin targets that npm publish would normalize away", () => {
    const manifest = readManifest();
    manifest.bin = { lexrunner: "./mcp-server.mjs" };
    expect(() => validatePackageManifestForPublish(manifest, repositoryRoot)).toThrow(
      "must omit the leading './'"
    );
  });

  it("rejects repository metadata that npm publish would normalize", () => {
    const manifest = readManifest();
    manifest.repository = { url: "https://github.com/Guffawaffle/lexrunner.git" };
    expect(() => validatePackageManifestForPublish(manifest, repositoryRoot)).toThrow(
      "must use npm's canonical form"
    );
  });

  it("rejects bin targets without executable shebangs", () => {
    const manifest = readManifest();
    manifest.bin = { lexrunner: "package.json" };
    expect(() => validatePackageManifestForPublish(manifest, repositoryRoot)).toThrow(
      "must begin with a shebang"
    );
  });

  it("prints a stable, explicit command without executing publication", () => {
    expect(humanPublishCommand()).toBe("npm publish --access restricted --tag latest");
    expect(humanPublishCommand("canary")).toBe("npm publish --access restricted --tag canary");
    expect(() => humanPublishCommand("not a tag")).toThrow("Invalid npm dist-tag");
  });

  it("uses the repository-scoped release tag prefix", () => {
    expect(releaseTagForVersion("1.2.1")).toBe("lexrunner-v1.2.1");
  });
});

function readManifest(): PackageManifest & {
  publishConfig?: { access?: string; registry?: string };
  version?: string;
} {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
}
