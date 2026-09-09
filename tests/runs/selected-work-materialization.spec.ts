import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentTaskPacket_v1, createAgentTaskPacket } from "../../src/schemas/agent-work.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import {
  materializeSelectedWork,
  MAX_SELECTED_WORK_BYTES,
} from "../../src/runs/selected-work-materialization.js";

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
function fixture() {
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
function changeSource(request: ReturnType<typeof fixture>, change: (source: any) => void) {
  const source = JSON.parse(request.artifact.text);
  change(source);
  request.artifact.text = JSON.stringify(source);
  request.artifact.digest = hash(request.artifact.text);
}
function success(request = fixture()) {
  const result = materializeSelectedWork(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

describe("selected-work materialization", () => {
  it("binds actual source and packet schemas while preserving context and explicit policy", () => {
    const request = fixture();
    const result = success(request);
    expect(result.outcome).toBe("materialized_input");
    expect(result.workItem.constraints).toEqual(["No deployment\nKeep stored data"]);
    expect(result.workItem.description).toContain("Existing runtime\nRetain interfaces");
    expect(result.packet.instructions[0]).toBe(request.packet.instructions[0]);
    expect(result.packet.instructions.join("\n")).toContain("No deployment\nKeep stored data");
    expect(result.packet.acceptance_criteria).toEqual([
      { id: "behavior", text: "Test the behavior" },
      { id: "data", text: "Preserve the data" },
    ]);
    for (const key of ["scope", "authority", "verification", "budget"] as const)
      expect(result.packet[key]).toEqual(request.packet[key]);
    expect(result.workItem.source).toMatchObject({
      kind: "manual",
      revision: request.artifact.digest,
    });
    expect(result.correspondence.reference_content_verified).toBe(false);
    expect(result.correspondence.packet_hash).toBe(result.packet.packet_hash);
    expect(result.correspondence.work_item.digest).toBe(computeCanonicalHash(result.workItem));
    expect(AgentTaskPacket_v1.parse(result.packet)).toEqual(result.packet);
    const { digest, ...mapping } = result.correspondence;
    expect(digest).toBe(computeCanonicalHash(mapping));
  });

  it("is deterministic without mutating input and preserves legacy packet hashing", () => {
    const request = fixture();
    const before = JSON.stringify(request);
    const first = success(request);
    expect(success(request)).toEqual(first);
    expect(JSON.stringify(request)).toBe(before);
    const { packet_hash, ...input } = first.packet;
    expect(createAgentTaskPacket(input).packet_hash).toBe(packet_hash);
    changeSource(request, (source) => {
      source.sourceSpec.constraints = "Keep all records";
    });
    const changed = success(request);
    expect(changed.packet.packet_hash).not.toBe(first.packet.packet_hash);
    expect(changed.correspondence.digest).not.toBe(first.correspondence.digest);
  });

  it("keeps byte identity distinct from semantic packet identity", () => {
    const request = fixture();
    const first = success(request);
    request.artifact.text += "\n";
    expect(materializeSelectedWork(request)).toMatchObject({
      ok: false,
      error: { code: "source_digest_mismatch" },
    });
    request.artifact.digest = hash(request.artifact.text);
    const second = success(request);
    expect(second.packet.packet_hash).toBe(first.packet.packet_hash);
    expect(second.correspondence.digest).not.toBe(first.correspondence.digest);
  });

  it("supports old source artifacts without optional context", () => {
    const request = fixture();
    changeSource(request, (source) => {
      delete source.sourceSpec.constraints;
      delete source.sourceSpec.technicalContext;
    });
    const result = success(request);
    expect(result.workItem.constraints).toEqual([]);
    expect(result.workItem.description).toBe("Make the bounded change");
  });

  it.each([
    [
      "missing selection",
      (r: ReturnType<typeof fixture>) => {
        r.selectedItemId = "missing";
      },
      "ambiguous_item",
    ],
    [
      "duplicate item IDs",
      (r: ReturnType<typeof fixture>) => changeSource(r, (s) => s.subIssues.push(s.subIssues[0])),
      "ambiguous_item",
    ],
    [
      "dependencies",
      (r: ReturnType<typeof fixture>) =>
        changeSource(r, (s) => {
          s.subIssues[0].dependsOn = ["another"];
        }),
      "unsupported_dependencies",
    ],
    [
      "repository mismatch",
      (r: ReturnType<typeof fixture>) => {
        r.repository.id = "other/repo";
      },
      "repository_mismatch",
    ],
    [
      "duplicate criterion IDs",
      (r: ReturnType<typeof fixture>) => {
        r.workItem.criterionIds = ["same", "same"];
      },
      "invalid_criteria",
    ],
    [
      "missing criterion ID",
      (r: ReturnType<typeof fixture>) => {
        r.workItem.criterionIds = ["one"];
      },
      "invalid_criteria",
    ],
    [
      "blank criterion",
      (r: ReturnType<typeof fixture>) =>
        changeSource(r, (s) => {
          s.subIssues[0].acceptanceCriteria[0] = " ";
        }),
      "invalid_criteria",
    ],
    [
      "unknown source version",
      (r: ReturnType<typeof fixture>) =>
        changeSource(r, (s) => {
          s.schemaVersion = "2.0.0";
        }),
      "unsupported_source_version",
    ],
    [
      "nonportable context",
      (r: ReturnType<typeof fixture>) =>
        changeSource(r, (s) => {
          s.sourceSpec.constraints = "Read C:\\private\\secret.txt";
        }),
      "invalid_packet",
    ],
  ] as const)("rejects %s without exposing source text", (_name, mutate, code) => {
    const request = fixture();
    mutate(request);
    expect(materializeSelectedWork(request)).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(materializeSelectedWork(request))).not.toContain(request.artifact.text);
  });

  it("rejects oversized, malformed and extra input without a runtime callback", () => {
    const request = fixture();
    request.artifact.text = "x".repeat(MAX_SELECTED_WORK_BYTES);
    expect(materializeSelectedWork(request)).toMatchObject({
      ok: false,
      error: { code: "input_too_large" },
    });
    expect(materializeSelectedWork({ ...fixture(), launch: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    const malformed = fixture();
    malformed.artifact.text = "{";
    malformed.artifact.digest = hash("{");
    expect(materializeSelectedWork(malformed)).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});
