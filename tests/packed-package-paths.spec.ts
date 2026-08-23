import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveContainedPackageTarget } from "../scripts/packed-package-paths.mjs";

describe("packed package path containment", () => {
  const packageRoot = path.join(os.tmpdir(), "lexrunner-packed-paths", "package");

  it("allows targets contained by the package root", () => {
    expect(resolveContainedPackageTarget(packageRoot, "dist/cli.js")).toBe(
      path.join(packageRoot, "dist", "cli.js")
    );
  });

  it("rejects the exact parent path", () => {
    expect(() => resolveContainedPackageTarget(packageRoot, "..")).toThrow(
      "escaped the package root"
    );
  });

  it("rejects parent descendants and absolute outside targets", () => {
    expect(() => resolveContainedPackageTarget(packageRoot, "../outside.js")).toThrow(
      "escaped the package root"
    );
    expect(() =>
      resolveContainedPackageTarget(packageRoot, path.join(os.tmpdir(), "outside.js"))
    ).toThrow("escaped the package root");
  });
});
