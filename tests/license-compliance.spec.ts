import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(header: string, includeNotice = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-license-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "src"));
  fs.copyFileSync(
    path.resolve("scripts/check-license-compliance.mjs"),
    path.join(root, "scripts/check-license-compliance.mjs")
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ license: "Apache-2.0", dependencies: { "@smartergpt/lex": "4.0.3" } })
  );
  fs.writeFileSync(path.join(root, "src/example.ts"), header);
  if (includeNotice) fs.copyFileSync(path.resolve("NOTICE.md"), path.join(root, "NOTICE.md"));
  return root;
}

describe("license compliance after the Apache transition", () => {
  it("accepts Apache-licensed LexRunner source with SmarterGPT attribution", () => {
    const root = fixture(
      "/** This file is part of LexRunner. Copyright (c) Joseph Gustavson / SmarterGPT. Apache License 2.0. */"
    );
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-license-compliance.mjs"], { cwd: root })
    ).not.toThrow();
  });

  it("still rejects a Lex-specific source ownership claim", () => {
    const root = fixture("/** This file is part of Lex. */");
    const result = spawnSync(process.execPath, ["scripts/check-license-compliance.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Contains Lex license claim");
  });

  it("still requires the dependency notice", () => {
    const root = fixture("/** Apache License 2.0. */", false);
    const result = spawnSync(process.execPath, ["scripts/check-license-compliance.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NOTICE.md");
  });
});
