import { link, lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PlanArtifactService,
  PlanArtifactServiceError,
} from "../../src/application/plan-artifact-service.js";
import { MAX_PLAN_ARTIFACT_BYTES } from "../../src/application/execution-plan-artifact.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PlanArtifactService hostile file acquisition", () => {
  it("rejects a final symlink or junction ancestor", async () => {
    const root = await fixtureRoot();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writePlan(join(outside, "plan.json"), plan("outside"));
    const linkedFile = join(root, "linked-plan.json");
    const linkedDirectory = join(root, "linked-directory");

    try {
      await symlink(join(outside, "plan.json"), linkedFile, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");

    if (await pathExists(linkedFile)) expectUnsafe(() => resolve(root, "linked-plan.json"));
    expectUnsafe(() => resolve(root, join("linked-directory", "plan.json")));
  });

  it("rejects hard-link ambiguity before or during acquisition", async () => {
    const root = await fixtureRoot();
    const file = join(root, "plan.json");
    await writePlan(file, plan("linked"));
    await link(file, join(root, "alias.json"));
    expectUnsafe(() => resolve(root, "plan.json"));

    await rm(join(root, "alias.json"));
    const service = new PlanArtifactService({
      importHooks: {
        afterOpen: () => {
          requireLink(file, join(root, "during-read.json"));
        },
      },
    });
    expectUnsafe(() => service.resolve({ planFile: file, workingDir: root }));
  });

  it("rejects pathname replacement before open or before final verification", async () => {
    const root = await fixtureRoot();
    const file = join(root, "plan.json");
    const moved = join(root, "moved.json");
    await writePlan(file, plan("first"));
    const replacement = `${JSON.stringify(plan("replacement"))}\n`;
    const replace = () => {
      requireRename(file, moved);
      requireWrite(file, replacement);
    };

    expectUnsafe(() =>
      new PlanArtifactService({ importHooks: { afterInitialPathSnapshot: replace } }).resolve({
        planFile: file,
        workingDir: root,
      })
    );

    await rm(file, { force: true });
    await rename(moved, file);
    expectUnsafe(() =>
      new PlanArtifactService({ importHooks: { beforeFinalPathSnapshot: replace } }).resolve({
        planFile: file,
        workingDir: root,
      })
    );
  });

  it("rejects same-path mutation, truncation, or link creation during read", async () => {
    const root = await fixtureRoot();
    const file = join(root, "plan.json");
    await writePlan(file, plan("first"));
    const original = fs.readFileSync(file, "utf8");
    const sameLength = original.replace("first", "other");
    expect(sameLength.length).toBe(original.length);

    expectUnsafe(() =>
      new PlanArtifactService({
        importHooks: { afterRead: () => requireWrite(file, sameLength) },
      }).resolve({ planFile: file, workingDir: root })
    );

    await writeFile(file, original, "utf8");
    expectUnsafe(() =>
      new PlanArtifactService({
        importHooks: { afterOpen: () => requireWrite(file, original.slice(0, -1)) },
      }).resolve({ planFile: file, workingDir: root })
    );
  });

  it("enforces bounded bytes during read and fatal UTF-8 decoding", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "oversize.json"), Buffer.alloc(MAX_PLAN_ARTIFACT_BYTES + 1, 0x20));
    await writeFile(join(root, "invalid-utf8.json"), Buffer.from([0x7b, 0xff, 0x7d]));

    expect(() => resolve(root, "oversize.json")).toThrowError(
      expect.objectContaining<Partial<PlanArtifactServiceError>>({
        code: "PLAN_ARTIFACT_LIMIT_EXCEEDED",
      })
    );
    expect(() => resolve(root, "invalid-utf8.json")).toThrowError(
      expect.objectContaining<Partial<PlanArtifactServiceError>>({ code: "PLAN_UNREADABLE" })
    );
  });

  it("does not fall through from an unsafe repository plan to a valid profile plan", async () => {
    const root = await fixtureRoot();
    const profile = join(root, "profile");
    await mkdir(join(profile, "runner"), { recursive: true });
    await writeFile(join(profile, "profile.yml"), "role: local\n", "utf8");
    await writePlan(join(profile, "runner", "plan.json"), plan("profile-must-not-load"));
    await writePlan(join(root, "plan.json"), plan("unsafe-root"));
    await link(join(root, "plan.json"), join(root, "root-alias.json"));

    expectUnsafe(() =>
      new PlanArtifactService().resolve({ workingDir: root, profileDir: profile })
    );
  });
});

function resolve(root: string, planFile: string) {
  return new PlanArtifactService().resolve({ planFile, workingDir: root });
}

function expectUnsafe(operation: () => unknown): void {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<PlanArtifactServiceError>>({
      code: "PLAN_FILESYSTEM_UNSAFE",
    })
  );
}

function plan(itemName: string) {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [{ name: itemName, deps: [], gates: [] }],
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-plan-hostile-"));
  roots.push(root);
  return root;
}

async function writePlan(filePath: string, value: object): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

function requireLink(existingPath: string, newPath: string): void {
  fs.linkSync(existingPath, newPath);
}

function requireRename(oldPath: string, newPath: string): void {
  fs.renameSync(oldPath, newPath);
}

function requireWrite(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}
