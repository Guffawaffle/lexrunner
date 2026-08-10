import { describe, expect, it } from "vitest";

import {
  GOVERNED_CODE_REVIEW_INPUT_CONTRACT_HASH,
  GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskExecutionBinding,
  createGovernedCodeReviewTaskSpec,
  governedCodeReviewTaskMatches,
  interpretGovernedCodeReviewOutcome,
} from "../../src/runs/governed-review-task-profile.js";

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

describe("governed code-review task profile", () => {
  it("expresses review as one read-only generic governed task", () => {
    const input = taskInput();
    const task = createGovernedCodeReviewTaskSpec(input);

    expect(task.profile).toMatchObject({
      profile_id: "code-review",
      profile_version: "1.0.0",
      input_contract_hash: GOVERNED_CODE_REVIEW_INPUT_CONTRACT_HASH,
      output_contract_hash: GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH,
      verifier_id: "lexrunner.windows-host-verifier",
    });
    expect(task.capability_ceiling).toEqual([
      {
        dimension: "filesystem_read",
        capability_id: "read-sealed-review-corpus",
        scope_hash: input.corpusScopeHash,
        minimum_enforcement: "enforced",
        effect: { class: "observation" },
      },
    ]);
    expect(task).not.toHaveProperty("verdict");
    expect(task).not.toHaveProperty("refusal_reason_required");
  });

  it("binds task identity to the exact prompt, corpus, provider, and budgets", () => {
    const input = taskInput();
    const task = createGovernedCodeReviewTaskSpec(input);

    expect(governedCodeReviewTaskMatches(task, input)).toBe(true);
    expect(governedCodeReviewTaskMatches(task, { ...input, promptHash: hash("f") })).toBe(false);
    expect(
      governedCodeReviewTaskMatches(task, { ...input, authorizedModelProvider: "other-provider" })
    ).toBe(false);
    expect(
      governedCodeReviewTaskMatches(task, { ...input, maxDurationMs: input.maxDurationMs + 1 })
    ).toBe(false);
  });

  it("changes the read scope when any sealed corpus identity changes", () => {
    const identity = corpusIdentity();
    const scope = computeGovernedCodeReviewCorpusScopeHash(identity);

    expect(computeGovernedCodeReviewCorpusScopeHash(identity)).toBe(scope);
    expect(
      computeGovernedCodeReviewCorpusScopeHash({ ...identity, candidateObjectId: "3".repeat(40) })
    ).not.toBe(scope);
    expect(
      computeGovernedCodeReviewCorpusScopeHash({ ...identity, selectionHash: hash("f") })
    ).not.toBe(scope);
  });

  it("binds the exact read grant to a qualified adapter and keeps outcome semantics in-profile", () => {
    const task = createGovernedCodeReviewTaskSpec(taskInput());
    const execution = createGovernedCodeReviewTaskExecutionBinding({
      task,
      authorizedAt: "2026-08-10T06:00:00.000Z",
      expiresAt: "2026-08-10T07:00:00.000Z",
      executorAttestationHash: hash("4"),
      environmentAttestationHash: hash("5"),
      workspaceAttestationHash: hash("6"),
    });

    expect(execution).toMatchObject({
      task_spec_hash: task.task_spec_hash,
      authority_grant: {
        capabilities: [{ capability_id: "read-sealed-review-corpus" }],
      },
      adapter_resolution: {
        manifest: {
          authority: {
            filesystem_read: "enforced",
            filesystem_write: "unsupported",
          },
        },
      },
    });
    expect(
      interpretGovernedCodeReviewOutcome({
        task,
        verifierId: task.profile.verifier_id,
        output: { verdict: "PASS", findings: [] },
        terminalTaskOutcome: "pass",
      })
    ).toEqual({ matched: true, outputOutcome: "pass", terminalOutcome: "pass" });
    expect(
      interpretGovernedCodeReviewOutcome({
        task,
        verifierId: "another-verifier",
        output: { verdict: "PASS", findings: [] },
        terminalTaskOutcome: "pass",
      })
    ).toEqual({ matched: false });
  });
});

function taskInput() {
  return {
    attemptId: "attempt-1",
    delegationId: "delegation-1",
    objectiveHash: hash("0"),
    authorizedModelProvider: "openai",
    promptHash: hash("1"),
    corpusScopeHash: computeGovernedCodeReviewCorpusScopeHash(corpusIdentity()),
    maxDurationMs: 180_000,
    maxOutputBytes: 2 * 1_024 * 1_024,
  };
}

function corpusIdentity() {
  return {
    repositoryId: "Guffawaffle/lexrunner",
    baseObjectId: "1".repeat(40),
    candidateObjectId: "2".repeat(40),
    corpusHash: hash("2"),
    selectionHash: hash("3"),
  };
}
