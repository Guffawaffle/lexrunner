import { describe, expect, it } from "vitest";

import {
  parseGitStatusPorcelainV1Z,
  parseGitWorktreePorcelainZ,
} from "../../src/workspaces/git-worktree-porcelain.js";

describe("parseGitWorktreePorcelainZ", () => {
  it("retains normal, detached, bare, locked, prunable, and unknown states", () => {
    const output = nul(
      "worktree /repo with spaces",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "locked maintenance window",
      "future-field future value",
      "",
      "worktree /detached",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /bare.git",
      "bare",
      ""
    );

    expect(parseGitWorktreePorcelainZ(output)).toEqual([
      {
        worktree: "/repo with spaces",
        head: "a".repeat(40),
        branch: "refs/heads/main",
        bare: false,
        detached: false,
        locked: true,
        lockedReason: "maintenance window",
        prunable: false,
        unknownFields: [{ name: "future-field", value: "future value" }],
      },
      {
        worktree: "/detached",
        head: "b".repeat(40),
        bare: false,
        detached: true,
        locked: false,
        prunable: true,
        prunableReason: "gitdir file points to non-existent location",
        unknownFields: [],
      },
      {
        worktree: "/bare.git",
        bare: true,
        detached: false,
        locked: false,
        prunable: false,
        unknownFields: [],
      },
    ]);
  });

  it("accepts Uint8Array output and paths containing newlines", () => {
    const output = Buffer.from(nul("worktree /trees/line\nbreak", "locked", ""));

    expect(parseGitWorktreePorcelainZ(output)).toEqual([
      {
        worktree: "/trees/line\nbreak",
        bare: false,
        detached: false,
        locked: true,
        prunable: false,
        unknownFields: [],
      },
    ]);
  });

  it("fails closed on truncated and structurally ambiguous output", () => {
    expect(() => parseGitWorktreePorcelainZ("worktree /repo")).toThrow(/NUL terminated/);
    expect(() => parseGitWorktreePorcelainZ(nul(`HEAD ${"a".repeat(40)}`, ""))).toThrow(
      /appears before worktree/
    );
    expect(() =>
      parseGitWorktreePorcelainZ(
        nul("worktree /repo", "branch refs/heads/a", "branch refs/heads/b", "")
      )
    ).toThrow(/duplicate branch/);
  });

  it("returns no records for empty output", () => {
    expect(parseGitWorktreePorcelainZ("")).toEqual([]);
  });
});

describe("parseGitStatusPorcelainV1Z", () => {
  it("parses tracked, untracked, and ignored paths without splitting whitespace", () => {
    const output = nul(
      " M tracked file.ts",
      "A  staged\tfile.ts",
      "?? untracked directory/file with spaces.txt",
      "!! ignored\nfile.log"
    );

    expect(parseGitStatusPorcelainV1Z(output)).toEqual([
      {
        indexStatus: " ",
        worktreeStatus: "M",
        path: "tracked file.ts",
        kind: "ordinary",
      },
      {
        indexStatus: "A",
        worktreeStatus: " ",
        path: "staged\tfile.ts",
        kind: "ordinary",
      },
      {
        indexStatus: "?",
        worktreeStatus: "?",
        path: "untracked directory/file with spaces.txt",
        kind: "untracked",
      },
      {
        indexStatus: "!",
        worktreeStatus: "!",
        path: "ignored\nfile.log",
        kind: "ignored",
      },
    ]);
  });

  it("parses NUL-separated rename and copy source paths in -z field order", () => {
    const output = nul(
      "R  destination name.ts",
      "source name.ts",
      " C copied destination.ts",
      "copied source.ts"
    );

    expect(parseGitStatusPorcelainV1Z(output)).toEqual([
      {
        indexStatus: "R",
        worktreeStatus: " ",
        path: "destination name.ts",
        originalPath: "source name.ts",
        kind: "renamed",
      },
      {
        indexStatus: " ",
        worktreeStatus: "C",
        path: "copied destination.ts",
        originalPath: "copied source.ts",
        kind: "copied",
      },
    ]);
  });

  it("fails closed on truncated, malformed, or incomplete rename output", () => {
    expect(() => parseGitStatusPorcelainV1Z("?? file")).toThrow(/NUL terminated/);
    expect(() => parseGitStatusPorcelainV1Z(nul("not-a-status"))).toThrow(/expected an XY/);
    expect(() => parseGitStatusPorcelainV1Z(nul("R  destination"))).toThrow(
      /source path is missing/
    );
  });

  it("returns no records for empty output", () => {
    expect(parseGitStatusPorcelainV1Z("")).toEqual([]);
  });
});

function nul(...fields: string[]): string {
  return `${fields.join("\0")}\0`;
}
