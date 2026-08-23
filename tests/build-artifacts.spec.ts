import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPackageArtifactTargets,
  findMissingBuildArtifacts,
} from "../scripts/validate-build-artifacts.js";

describe("build artifact validation", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("covers every public package entry and CI-only hook output", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const targets = collectPackageArtifactTargets(manifest).map(({ target }) => target);

    expect(targets).toEqual(
      expect.arrayContaining([
        "./dist/cli.js",
        "./dist/cli.cjs",
        "./dist/cli.d.ts",
        "./dist/sdk/index.js",
        "./dist/sdk/index.d.ts",
        "./dist/frames/index.js",
        "./dist/frames/index.d.ts",
        "./dist/errors/index.js",
        "./dist/errors/index.d.ts",
        "./dist/hooks/events.js",
        "./dist/hooks/events.d.ts",
      ])
    );
  });

  it("loads the CommonJS root with bundled ESM dependency metadata intact", () => {
    const require = createRequire(import.meta.url);
    const entry = require("../dist/cli.cjs") as {
      canonicalJSONStringify?: (value: unknown) => string;
    };

    expect(JSON.parse(entry.canonicalJSONStringify?.({ ok: true }) ?? "null")).toEqual({
      ok: true,
    });
  });

  it("publishes the durable Attempt awaitable contracts and host adapters", () => {
    const require = createRequire(import.meta.url);
    const entry = require("../dist/cli.cjs") as Record<string, unknown>;

    expect(entry.ExternalAwaitableDescriptor_v1).toBeDefined();
    expect(entry.AttemptAwaitableSupervisor).toBeTypeOf("function");
    expect(entry.AxfCliAttemptAwaitableObserver).toBeTypeOf("function");
    expect(entry.InMemoryAttemptAwaitableStore).toBeTypeOf("function");
    expect(entry.SqliteAttemptAwaitableStore).toBeTypeOf("function");
  });

  it("reports the declaration that points at each missing artifact", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-build-artifacts-"));
    temporaryDirectories.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, "dist"));
    fs.writeFileSync(path.join(projectRoot, "dist", "cli.js"), "export {};\n");

    const missing = findMissingBuildArtifacts(projectRoot, {
      bin: { lexrunner: "./dist/cli.js" },
      exports: {
        "./frames": {
          import: "./dist/frames/index.js",
        },
      },
    });

    expect(missing).toEqual(
      expect.arrayContaining([
        { source: 'exports["./frames"].import', target: "./dist/frames/index.js" },
        { source: "Frame emission CI", target: "./dist/hooks/events.js" },
        { source: "Frame emission CI", target: "./dist/hooks/events.d.ts" },
      ])
    );
    expect(missing).not.toContainEqual({ source: "bin.lexrunner", target: "./dist/cli.js" });
  });
});
