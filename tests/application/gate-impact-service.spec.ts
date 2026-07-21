import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyGateImpactSelection,
  GateImpactService,
  writeGateImpactReceipt,
} from "../../src/application/gate-impact-service.js";
import type { Plan } from "../../src/schema.js";

const roots: string[] = [];
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("GateImpactService", () => {
  it("deterministically selects direct and adjacent owners with rationale", async () => {
    const root = fixtureRoot();
    touch(root, "tests/application/gate-execution-service.spec.ts");
    touch(root, "tests/gates.test.ts");
    touch(root, "tests/weave-contract.test.ts");
    const service = serviceFor([
      "src/application/gate-execution-service.ts",
      "src/application/gate-execution-service.ts",
    ]);

    const first = await service.select({ repoRoot: root, baseSha, headSha });
    const replay = await service.select({ repoRoot: root, baseSha, headSha });

    expect(replay).toEqual(first);
    expect(first.mode).toBe("focused");
    expect(first.selectedTests.map(({ path: testPath }) => testPath)).toEqual([
      "tests/application/gate-execution-service.spec.ts",
      "tests/gates.test.ts",
      "tests/weave-contract.test.ts",
    ]);
    expect(first.selectedTests.every(({ rationale }) => rationale.length > 0)).toBe(true);
    expect(first.testCommand).toContain("npx vitest run");
  });

  it("fails closed for shared surfaces and unknown source mappings", async () => {
    const root = fixtureRoot();
    const shared = await serviceFor(["src/schema.ts"]).select({ repoRoot: root, baseSha, headSha });
    const unknown = await serviceFor(["src/unknown-owner.ts"]).select({
      repoRoot: root,
      baseSha,
      headSha,
    });

    expect(shared).toMatchObject({ mode: "full", testCommand: "npm test" });
    expect(shared.fallbackReason).toContain("high-risk surface");
    expect(unknown.fallbackReason).toContain("unknown source mapping");
    const release = await serviceFor(["CHANGELOG.md"]).select({
      repoRoot: root,
      baseSha,
      headSha,
    });
    expect(release).toMatchObject({ mode: "full", documentationCommand: expect.any(String) });
  });

  it("uses the explicit changed-doc validation path", async () => {
    const selection = await serviceFor(["docs/quickstart.md", "README.md"]).select({
      repoRoot: fixtureRoot(),
      baseSha,
      headSha,
    });

    expect(selection).toMatchObject({ mode: "docs", selectedTests: [] });
    expect(selection.testCommand).toBe(`npm run docs:check -- --base ${baseSha} --head ${headSha}`);
  });

  it("adapts only test gates explicitly and emits a bounded receipt", async () => {
    const root = fixtureRoot();
    touch(root, "tests/gates.test.ts");
    const selection = await serviceFor(["tests/gates.test.ts"]).select({
      repoRoot: root,
      baseSha,
      headSha,
    });
    const frozen = plan();
    const effective = applyGateImpactSelection(frozen, selection);
    const receipt = writeGateImpactReceipt(selection, path.join(root, "artifacts"));

    expect(frozen.items[0].gates?.find(({ name }) => name === "test")?.run).toBe("npm test");
    expect(effective.items[0].gates?.find(({ name }) => name === "test")?.run).toBe(
      selection.testCommand
    );
    expect(effective.items[0].gates?.find(({ name }) => name === "lint")?.run).toBe("npm run lint");
    expect(JSON.parse(fs.readFileSync(receipt, "utf8"))).toEqual(selection);
    expect(fs.statSync(receipt).size).toBeLessThan(256 * 1024);
  });
});

function serviceFor(files: string[]): GateImpactService {
  return new GateImpactService(async () => files);
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-gate-impact-"));
  roots.push(root);
  return root;
}

function touch(root: string, relativePath: string): void {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
}

function plan(): Plan {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      {
        name: "one",
        deps: [],
        gates: [
          { name: "lint", run: "npm run lint", runtime: "local", env: {}, artifacts: [] },
          { name: "test", run: "npm test", runtime: "local", env: {}, artifacts: [] },
        ],
      },
    ],
  };
}
