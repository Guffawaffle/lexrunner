import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("merge compatibility alias", () => {
  let testDir: string;
  const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-merge-alias-"));
    fs.writeFileSync(
      path.join(testDir, "plan.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "test-item", deps: [], gates: [] }],
      })
    );
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("projects the canonical bounded dry-run contract without legacy lock state", () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, "merge", "--plan", "plan.json", "--no-constraints", "--json"],
      { cwd: testDir, encoding: "utf8" }
    );

    expect(JSON.parse(output)).toMatchObject({
      contract: "bounded-ax-v1",
      mode: "dry-run",
      dryRun: true,
      ok: true,
      totalItems: 1,
      levels: [["test-item"]],
      artifactRefs: [],
    });
    expect(fs.existsSync(path.join(testDir, "weave-lock.json"))).toBe(false);
  });

  it("does not advertise retired standalone merge flags", () => {
    const help = execFileSync(process.execPath, [cliPath, "merge", "--help"], {
      encoding: "utf8",
    });

    expect(help).toContain("Compatibility alias for weave apply");
    expect(help).not.toContain("--force");
    expect(help).not.toContain("--cleanup");
    expect(help).not.toContain("--batch");
  });
});
