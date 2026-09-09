import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { Plan, loadPlan } from "../src/schema.js";
import { repositoryIdentity } from "../src/git/input-schema.js";
import { MergeApplicationService } from "../src/application/merge-application-service.js";
import {
  IntegrationStatusQueryService,
  PlanCreationService,
} from "../src/application/integration-query-services.js";
import type { GitHubClient } from "../src/github/client.js";

const base = "a".repeat(40),
  head = "b".repeat(40);
function client(dependencies: string[] = [], baseRef = "main") {
  const pr = {
    number: 123,
    head: { ref: "feature/one", sha: head },
    base: { ref: baseRef, sha: "c".repeat(40) },
    dependencies,
    requiredGates: ["test"],
  };
  return {
    validateRepository: vi.fn().mockResolvedValue({
      owner: "example",
      repo: "repo",
      defaultBranch: "main",
      url: "https://github.com/example/repo",
    }),
    getBranchHead: vi.fn().mockResolvedValue(base),
    listOpenPRs: vi.fn().mockResolvedValue([pr]),
    getPRDetails: vi.fn().mockResolvedValue(pr),
  };
}
async function generated(mock = client()) {
  return new PlanCreationService().fromGitHub(mock as unknown as GitHubClient, {});
}

describe("frozen Git input contract", () => {
  it("exports a nonempty JSON schema that rejects malformed frozen inputs", async () => {
    const schema = JSON.parse(
      readFileSync(new URL("../schemas/plan.schema.json", import.meta.url), "utf8")
    );
    const validate = new Ajv({ strict: false }).compile(schema);
    const plan = await generated();
    expect(validate(plan), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({
        ...plan,
        gitInputs: {
          ...plan.gitInputs,
          target: { ref: "refs/heads/main", commit: "not-a-commit" },
        },
      })
    ).toBe(false);
    expect(validate({ schemaVersion: "1.0.0", items: [] })).toBe(true);
    expect(validate({ schemaVersion: "2.0.0", items: [] })).toBe(false);
  });
  it("captures the target independently of PR base metadata and uses the target repository PR ref", async () => {
    const mock = client();
    const plan = await generated(mock);
    expect(plan.gitInputs).toEqual({
      schemaVersion: "1.0.0",
      repository: "https://github.com/example/repo.git",
      checkoutRemote: "origin",
      acquisition: "fetch",
      target: { ref: "refs/heads/main", commit: base },
      sources: [{ item: "PR-123", ref: "refs/pull/123/head", commit: head }],
    });
    expect(mock.getBranchHead).toHaveBeenCalledWith("main");
    expect(mock.listOpenPRs).toHaveBeenCalledWith(expect.objectContaining({ base: "main" }));
    expect(loadPlan(JSON.stringify(plan))).toEqual(plan);
  });
  it("rejects cross-repository dependency qualifiers rather than assigning a same-number local PR", async () => {
    await expect(generated(client(["another/repo#123"]))).rejects.toThrow(
      "outside this single-repository plan"
    );
  });
  it("rejects discovery results targeting another branch", async () => {
    await expect(generated(client([], "develop"))).rejects.toThrow("different branch");
  });
  it("rejects incomplete, duplicated, and mismatched bindings", async () => {
    const plan = await generated();
    for (const sources of [
      [],
      [...plan.gitInputs!.sources, ...plan.gitInputs!.sources],
      [{ ...plan.gitInputs!.sources[0], item: "other" }],
    ]) {
      expect(Plan.safeParse({ ...plan, gitInputs: { ...plan.gitInputs, sources } }).success).toBe(
        false
      );
    }
    expect(Plan.safeParse({ ...plan, target: "other" }).success).toBe(false);
    for (const ref of [
      "feature/one",
      "refs/heads/-x..y",
      "refs/heads/a.lock",
      "refs/heads/a~1",
      "refs/heads/a:b",
    ]) {
      expect(
        Plan.safeParse({
          ...plan,
          gitInputs: { ...plan.gitInputs, sources: [{ item: "PR-123", ref, commit: head }] },
        }).success
      ).toBe(false);
    }
  });
  it("identifies frozen and legacy inputs without granting execution or contacting Git", async () => {
    const plan = await generated();
    const legacy = loadPlan(JSON.stringify({ schemaVersion: "1.0.0", target: "main", items: [] }));
    for (const [input, binding] of [
      [plan, "frozen"],
      [legacy, "legacy-unbound"],
    ] as const) {
      expect(new IntegrationStatusQueryService().run(input).plan.gitInputBinding).toBe(binding);
      const result = await new MergeApplicationService().run({
        plan: input,
        workingDir: "not-a-repository",
        dryRun: true,
        mutationAuthorized: false,
      });
      expect(result.summary).toMatchObject({
        status: "preview",
        gitInputBinding: binding,
        artifactRefs: [],
      });
    }
    expect(legacy).not.toHaveProperty("gitInputs");
  });
  it("compares HTTPS and SSH identities without accepting credential-bearing or ambiguous URLs", () => {
    expect(repositoryIdentity("https://github.com/Example/Repo.git")).toBe(
      repositoryIdentity("git@github.com:example/repo.git")
    );
    for (const url of [
      "https://user:password@github.com/example/repo",
      "https://github.com/example/repo?token=x",
      "https://github.com/extra/example/repo",
      "ext::command",
      "../repo",
    ]) {
      expect(() => repositoryIdentity(url)).toThrow();
    }
  });
});
