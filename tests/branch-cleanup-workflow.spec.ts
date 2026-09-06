import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(
  fs.readFileSync(".github/workflows/auto-delete-merged-branches.yml", "utf8")
);
const job = workflow.jobs["delete-merged-branch"];
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function checkEligibility(head: string, labels: string[] = [], headRepo = "owner/repo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-branch-cleanup-"));
  temporaryRoots.push(root);
  const output = path.join(root, "outputs.txt");
  const result = spawnSync(bash, ["--noprofile", "--norc", "-e", "-c", job.steps[0].run], {
    encoding: "utf8",
    env: {
      ...process.env,
      HEAD_REF: head,
      DEFAULT_BRANCH: "main",
      HEAD_REPO: headRepo,
      BASE_REPO: "owner/repo",
      PR_LABELS: JSON.stringify(labels),
      GITHUB_OUTPUT: output.replaceAll("\\", "/"),
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return fs.readFileSync(output, "utf8");
}

describe("merged branch cleanup input boundary", () => {
  it("passes event data through environment variables and guards the whole job", () => {
    expect(job.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(job.env.HEAD_REF).toBe("${{ github.event.pull_request.head.ref }}");
    for (const step of job.steps) expect(step.run ?? "").not.toContain("${{");
  });

  it("treats command substitutions in branch names as literal data", () => {
    // Execution would exit the eligibility shell with code 73.
    expect(checkEligibility("feature/$(exit${IFS}73)")).toContain("eligible=true");
  });

  it("treats quotes and shell syntax in labels as literal data", () => {
    expect(checkEligibility("feature/example", ["'; exit 73; #"])).toContain("eligible=true");
  });

  it("preserves default-branch, opt-out and fork rejection", () => {
    expect(checkEligibility("main")).toContain("reason=default-branch");
    expect(checkEligibility("feature/example", ["keep-branch"])).toContain(
      "reason=keep-branch-label"
    );
    expect(checkEligibility("feature/example", [], "fork/repo")).toContain("reason=fork");
  });
});
