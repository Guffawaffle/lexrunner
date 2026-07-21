import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("gate run plan path", () => {
  it("gives positional and --plan forms identical precedence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-gate-plan-path-"));
    roots.push(root);
    const planPath = path.join(root, "custom-plan.json");
    fs.writeFileSync(
      planPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        target: "main",
        items: [{ name: "custom", deps: [], gates: [] }],
      })
    );

    const positional = await run(root, ["gate", "run", planPath, "--dry-run", "--json"]);
    const flagged = await run(root, ["gate", "run", "--plan", planPath, "--dry-run", "--json"]);

    expect(JSON.parse(positional.stdout)).toEqual(JSON.parse(flagged.stdout));
    expect(JSON.parse(positional.stdout)).toMatchObject({
      plan: { itemCount: 1, target: "main" },
    });
  });
});

function run(cwd: string, args: string[]) {
  return execa("node", [path.join(repositoryRoot, "dist", "cli.js"), ...args], { cwd });
}
