import { describe, expect, it } from "vitest";

import {
  GOVERNED_CODE_REVIEW_INPUT_CONTRACT_HASH,
  GOVERNED_CODE_REVIEW_OUTPUT_CONTRACT_HASH,
  computeGovernedCodeReviewCorpusScopeHash,
  createGovernedCodeReviewTaskSpec,
  governedCodeReviewTaskMatches,
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
