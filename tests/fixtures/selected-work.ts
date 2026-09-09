import { createHash } from "node:crypto";
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
export function selectedWorkFixture() {
  const source = {
    schemaVersion: "1.0.0",
    sourceSpec: {
      schemaVersion: "0.1.0",
      title: "Outcome",
      description: "Desired result",
      acceptanceCriteria: ["Accepted result"],
      repo: "example/repo",
      technicalContext: "Existing runtime\nRetain interfaces",
      constraints: "No deployment\nKeep stored data",
    },
    epic: {
      title: "Outcome",
      description: "Desired result",
      acceptanceCriteria: ["Accepted result"],
    },
    subIssues: [
      {
        id: "impl",
        title: "Implement result",
        description: "Make the bounded change",
        type: "feature",
        acceptanceCriteria: ["Test the behavior", "Preserve the data"],
        dependsOn: [] as string[],
      },
    ],
    createdAt: "2026-09-09T06:56:20Z",
  };
  const text = JSON.stringify(source);
  return {
    artifact: { id: "project-artifact", text, digest: hash(text) },
    outcome: { id: "outcome", revision: "1", digest: hash("supplied-outcome") },
    workPlan: { id: "work-plan", revision: "1", digest: hash("supplied-plan-reference") },
    selectedItemId: "impl",
    workItem: { id: "work-impl", revision: 1, criterionIds: ["behavior", "data"] },
    capturedAt: "2026-09-09T06:56:20Z",
    repository: { id: "example/repo", base_sha: "a".repeat(40) },
    packet: {
      packet_id: "packet",
      run_id: "run",
      attempt_id: "attempt",
      instructions: ["Use the explicitly selected task"],
      scope: {
        read_globs: ["src/**"],
        write_globs: ["src/**"],
        deny_globs: [".env"],
        cross_repo_allowed: false,
      },
      authority: {
        edit: true,
        git_write: false,
        github_write: false,
        external_runtime: false,
        secrets: false,
        signing: false,
        release: false,
      },
      verification: [{ id: "test", argv: ["npm", "test"], expected_exit_codes: [0] }],
      budget: { max_tool_calls: 10 },
      created_at: "2026-09-09T06:56:20Z",
    },
  };
}
