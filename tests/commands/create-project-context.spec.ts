import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerCreateProjectCommand } from "../../src/commands/create-project.js";
import { FeatureSpecV0Schema } from "../../src/schemas/feature-spec-v0.js";

const github = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    issues = { create: github.create };
  },
}));

describe("authored context through project intake", () => {
  let root: string;
  const spec = {
    schemaVersion: "0.1.0",
    title: "Preserve authored limits",
    description: "Improve planning",
    acceptanceCriteria: ["Every work item retains the limits"],
    technicalContext: "Existing Node runtime\nKeep the current API",
    constraints: "Do not change the database schema\nNo deployment",
    repo: "example/repo",
    createdAt: "2026-09-09T06:39:20Z",
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lexrunner-project-context-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GITHUB_TOKEN", "test-only");
    github.create.mockReset();
    github.create.mockImplementation(async () => ({
      data: { number: github.create.mock.calls.length, html_url: "https://example.test/issue" },
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function run(input: unknown, dryRun = true) {
    const inputPath = path.join(root, "idea.json");
    const outputPath = path.join(root, "plan.json");
    await writeFile(inputPath, JSON.stringify(input));
    const program = new Command();
    registerCreateProjectCommand(program);
    await program.parseAsync([
      "node",
      "lexrunner",
      "create-project",
      "--spec",
      inputPath,
      "--output",
      outputPath,
      "--no-link",
      ...(dryRun ? ["--dry-run"] : []),
    ]);
    return JSON.parse(await readFile(outputPath, "utf8"));
  }

  it("preserves captured context in the plan and all rendered issue requests", async () => {
    const plan = await run(FeatureSpecV0Schema.parse(spec), false);
    expect(plan.sourceSpec.technicalContext).toBe(spec.technicalContext);
    expect(plan.sourceSpec.constraints).toBe(spec.constraints);
    for (const item of [plan.epic, ...plan.subIssues]) {
      expect(item.description).toContain(spec.technicalContext);
      expect(item.description).toContain(spec.constraints);
    }
    expect(github.create).toHaveBeenCalledTimes(4);
    for (const [request] of github.create.mock.calls) {
      expect(request.body).toContain(spec.technicalContext);
      expect(request.body).toContain(spec.constraints);
      expect(request.body).toContain("Supplied constraints");
    }
  });

  it("keeps legacy inputs compatible and dry-run free of issue requests", async () => {
    const { technicalContext, constraints, ...legacy } = spec;
    const plan = await run(legacy);
    expect(plan.sourceSpec).not.toHaveProperty("constraints");
    expect(plan.sourceSpec).not.toHaveProperty("technicalContext");
    expect(plan.epic.description).toBe(spec.description);
    expect(plan.subIssues[0].description).toBe(
      `Core implementation of feature: ${spec.description}`
    );
    expect(github.create).not.toHaveBeenCalled();
  });

  it("asks for success criteria before writing a plan or creating issues", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    await expect(
      run(FeatureSpecV0Schema.parse({ ...spec, acceptanceCriteria: [] }), false)
    ).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Define success before planning")
    );
    await expect(access(path.join(root, "plan.json"))).rejects.toThrow();
    expect(github.create).not.toHaveBeenCalled();
  });
});
