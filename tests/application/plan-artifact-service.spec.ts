import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PlanArtifactService,
  PlanArtifactServiceError,
} from "../../src/application/plan-artifact-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PlanArtifactService", () => {
  it("resolves explicit, repository-root, and profile plans in deterministic precedence order", async () => {
    const root = await fixtureRoot();
    const profile = join(root, "profile");
    await mkdir(join(profile, "runner"), { recursive: true });
    await writeFile(join(profile, "profile.yml"), "role: local\n", "utf8");
    await writePlan(join(profile, "runner", "plan.json"), plan("profile"));
    await writePlan(join(root, "plan.json"), plan("root"));
    await writePlan(join(root, "explicit.json"), plan("explicit"));

    const service = new PlanArtifactService();
    expect(service.resolve({ workingDir: root, profileDir: profile }).source).toBe(
      "repository-root"
    );
    expect(
      service.resolve({ planFile: "explicit.json", workingDir: root, profileDir: profile }).plan
        .items[0].name
    ).toBe("explicit");

    await rm(join(root, "plan.json"));
    expect(service.resolve({ workingDir: root, profileDir: profile }).source).toBe(
      "profile-runner"
    );
  });

  it("computes a path-independent canonical identity across JSON formatting", async () => {
    const root = await fixtureRoot();
    const first = join(root, "first.json");
    const second = join(root, "second.json");
    const value = plan("same");
    await writeFile(first, JSON.stringify(value), "utf8");
    await writeFile(second, `${JSON.stringify(value, null, 2)}\n`, "utf8");

    const service = new PlanArtifactService();
    const firstArtifact = service.resolve({ planFile: first, workingDir: root });
    const secondArtifact = service.resolve({ planFile: second, workingDir: root });

    expect(firstArtifact.identity).toEqual(secondArtifact.identity);
    expect(firstArtifact.identity).toMatchObject({
      contract: "plan-artifact-identity-v1",
      kind: "execution-plan",
      schema: "lexrunner.execution-plan",
      schemaVersion: "1.0.0",
      target: "main",
      itemCount: 1,
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(firstArtifact.identity)).not.toContain(root);
  });

  it("fails closed on an invalid, missing, or unreadable explicit reference without path disclosure", async () => {
    const root = await fixtureRoot();
    await writePlan(join(root, "plan.json"), plan("fallback-must-not-load"));
    await mkdir(join(root, "not-a-file"));
    const service = new PlanArtifactService();

    for (const [planFile, code] of [
      ["", "PLAN_REFERENCE_INVALID"],
      ["private-missing-plan.json", "PLAN_NOT_FOUND"],
      ["not-a-file", "PLAN_UNREADABLE"],
    ] as const) {
      let failure: unknown;
      try {
        service.resolve({ planFile, workingDir: root });
      } catch (error) {
        failure = error;
      }
      expect(failure).toEqual(
        expect.objectContaining<Partial<PlanArtifactServiceError>>({ code, source: "explicit" })
      );
      expect((failure as Error).message).not.toContain(root);
      if (planFile) expect((failure as Error).message).not.toContain(planFile);
    }
  });

  it("preserves bounded malformed-JSON and schema-validation failures", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "malformed.json"), '{"secret":"TOPSECRET"', "utf8");
    await writeFile(
      join(root, "invalid.json"),
      JSON.stringify({ schemaVersion: "1.0.0", target: "main", items: "TOPSECRET" }),
      "utf8"
    );
    const service = new PlanArtifactService();

    expect(() => service.resolve({ planFile: "malformed.json", workingDir: root })).toThrowError(
      expect.objectContaining({ axError: expect.objectContaining({ code: "CONFIG_INVALID" }) })
    );
    expect(() => service.resolve({ planFile: "invalid.json", workingDir: root })).toThrowError(
      expect.objectContaining({ name: "SchemaValidationError" })
    );
  });

  it("rejects plans whose public identity would exceed bounded transport limits", async () => {
    const root = await fixtureRoot();
    await writePlan(join(root, "overlong.json"), {
      ...plan("item"),
      target: "x".repeat(513),
    });

    expect(() =>
      new PlanArtifactService().resolve({ planFile: "overlong.json", workingDir: root })
    ).toThrowError(
      expect.objectContaining<Partial<PlanArtifactServiceError>>({
        code: "PLAN_ARTIFACT_LIMIT_EXCEEDED",
        source: "explicit",
      })
    );
  });
});

function plan(itemName: string) {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [{ name: itemName, deps: [], gates: [] }],
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-plan-artifact-"));
  roots.push(root);
  return root;
}

async function writePlan(filePath: string, value: object): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
