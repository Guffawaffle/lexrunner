import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAttemptExecutionPathMapping,
  verifyAttemptExecutionPathMapping,
} from "../../src/runs/agent-work-path-mapping.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("attempt execution path mappings", () => {
  it("detects directory replacement even when every path string remains unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-path-mapping-"));
    roots.push(root);
    const repositoryRoot = join(root, "repository");
    const allocationRoot = join(root, "worktrees");
    const worktreePath = join(allocationRoot, "attempt-1");
    await Promise.all([
      mkdir(repositoryRoot, { recursive: true }),
      mkdir(worktreePath, { recursive: true }),
    ]);
    const context = {
      repositoryId: "owner/repo",
      baseSha: "a".repeat(40),
      hostId: "native-host",
      gitRuntime: "native-git",
      repositoryRoot,
      allocationRoot,
      worktreePath,
    };
    const mapping = createAttemptExecutionPathMapping(context);

    expect(verifyAttemptExecutionPathMapping([mapping], context)).toMatchObject({
      valid: true,
      kind: "native_linux",
      mappingDigest: mapping.mapping_digest,
    });

    await rename(worktreePath, join(allocationRoot, "retired-attempt-1"));
    await mkdir(worktreePath);

    expect(verifyAttemptExecutionPathMapping([mapping], context)).toEqual({
      valid: false,
      reason: "directory_identity",
    });
  });
});
