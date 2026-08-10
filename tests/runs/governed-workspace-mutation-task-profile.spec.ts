import { describe, expect, it } from "vitest";

import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import * as workspaceMutationProfile from "../../src/runs/governed-workspace-mutation-task-profile.js";
import {
  GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST,
  GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
  GovernedWorkspaceMutationQualificationControlId_v1,
  createGovernedWorkspaceMutationPreparedWorkspaceEvidence,
  createGovernedWorkspaceMutationQualificationEvidence,
  createGovernedWorkspaceMutationTaskSpec,
  interpretGovernedWorkspaceMutationOutcome,
} from "../../src/runs/governed-workspace-mutation-task-profile.js";

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

describe("governed workspace mutation task profile", () => {
  it("expresses a non-review task with an owned, discardable write scope", () => {
    const task = taskSpec();

    expect(task.profile).toMatchObject({
      profile_id: "workspace-mutation",
      verifier_id: GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
    });
    expect(task.capability_ceiling).toEqual([
      expect.objectContaining({
        capability_id: "read-owned-workspace",
        dimension: "filesystem_read",
        scope_hash: hash("3"),
        effect: { class: "observation" },
      }),
      expect.objectContaining({
        capability_id: "write-authorized-paths",
        dimension: "filesystem_write",
        scope_hash: hash("4"),
        effect: {
          class: "workspace_mutation",
          ownership_scope_hash: hash("5"),
          rollback: { strategy: "discard_workspace", binding_hash: hash("6") },
        },
      }),
    ]);
    expect(task.capability_ceiling).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "git_write" }),
        expect.objectContaining({ dimension: "network" }),
      ])
    );
  });

  it("does not expose an authority-minting or caller-clock execution binding", () => {
    expect(workspaceMutationProfile).not.toHaveProperty(
      "createGovernedWorkspaceMutationTaskExecutionBinding"
    );
    expect(workspaceMutationProfile).not.toHaveProperty(
      "GOVERNED_WORKSPACE_MUTATION_OPERATOR_PRINCIPAL_ID"
    );
  });

  it("keeps evidence records as inert claims until a protected controller consumes them", () => {
    const task = taskSpec();
    const qualification = qualificationEvidence();
    const prepared = createGovernedWorkspaceMutationPreparedWorkspaceEvidence(
      preparedEvidenceBody(task.task_spec_hash)
    );

    expect(qualification.evidence_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(prepared.evidence_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(workspaceMutationProfile).not.toHaveProperty("resolveWorkspaceMutationEvidence");

    expect(() =>
      createGovernedWorkspaceMutationPreparedWorkspaceEvidence({
        ...preparedEvidenceBody(task.task_spec_hash),
        rollback: {
          ...preparedEvidenceBody(task.task_spec_hash).rollback,
          controller_authority: "same_process",
        },
      } as never)
    ).toThrow();
  });

  it("requires every negative and recovery canary before qualification", () => {
    const controls = qualificationControls().slice(1);
    expect(() =>
      createGovernedWorkspaceMutationQualificationEvidence({
        ...qualificationEvidenceBody(),
        controls,
      })
    ).toThrow(/every workspace mutation qualification control/u);
  });

  it("keeps task claims separate from refusal and mutation admissibility", () => {
    const task = taskSpec();
    expect(
      interpretGovernedWorkspaceMutationOutcome({
        task,
        verifierId: GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
        output: { result: "CHANGED", summary: "Updated the authorized document." },
        terminalTaskOutcome: "changed",
      })
    ).toEqual({ matched: true, outputOutcome: "changed", terminalOutcome: "changed" });
    expect(
      interpretGovernedWorkspaceMutationOutcome({
        task,
        verifierId: GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
        output: "NO",
        terminalTaskOutcome: "not_produced",
      })
    ).toEqual({ matched: true, outputOutcome: "invalid" });
    for (const output of [
      { result: "CHANGED" },
      { result: "UNCHANGED", summary: "" },
      { result: "CHANGED", summary: "valid", extra: true },
      { result: "CHANGED", summary: "x".repeat(4_097) },
    ]) {
      expect(
        interpretGovernedWorkspaceMutationOutcome({
          task,
          verifierId: GOVERNED_WORKSPACE_MUTATION_VERIFIER_ID,
          output,
          terminalTaskOutcome: "invalid",
        })
      ).toEqual({ matched: true, outputOutcome: "invalid", terminalOutcome: "invalid" });
    }
    expect(task).not.toHaveProperty("refusal_reason_required");
    expect(task).not.toHaveProperty("changed_paths");
  });
});

function taskSpec() {
  return createGovernedWorkspaceMutationTaskSpec({
    attemptId: "attempt-write-1",
    delegationId: "delegation-write-1",
    objectiveHash: hash("0"),
    authorizedModelProvider: "openai",
    promptHash: hash("1"),
    sourceManifestHash: hash("2"),
    workspaceReadScopeHash: hash("3"),
    writablePathSetHash: hash("4"),
    ownershipScopeHash: hash("5"),
    rollbackBindingHash: hash("6"),
    maxDurationMs: 300_000,
    maxOutputBytes: 1_048_576,
  });
}

function qualificationEvidence() {
  return createGovernedWorkspaceMutationQualificationEvidence({
    ...qualificationEvidenceBody(),
    expires_at: "2026-08-10T13:00:00.000Z",
  });
}

function qualificationEvidenceBody() {
  return {
    schema_version: "1.0.0" as const,
    qualification_id: "qualification-writer-1",
    adapter_id: "lexrunner.qualified-wsl2-codex-writer" as const,
    adapter_version: "1.0.0" as const,
    adapter_manifest_hash: computeCanonicalHash(GOVERNED_WORKSPACE_MUTATION_ADAPTER_MANIFEST),
    environment_id: "environment-writer-1",
    provider_image_hash: hash("7"),
    execution_profile_hash: hash("8"),
    issuer: {
      controller_id: "qualification-controller",
      controller_executable_hash: hash("9"),
      protected_receipt_hash: hash("a"),
    },
    controls: qualificationControls(),
    qualified_at: "2026-08-10T11:00:00.000Z",
    expires_at: "2026-08-10T13:00:00.000Z",
  };
}

function qualificationControls() {
  return GovernedWorkspaceMutationQualificationControlId_v1.options.map((control, index) => ({
    control,
    status: "enforced" as const,
    strength: "independently_enforced_verified" as const,
    evidence_refs: [hash((index + 1).toString(16))],
    enforcement_owner: "qualification-controller",
  }));
}

function preparedEvidenceBody(taskSpecHash: string) {
  return {
    schema_version: "1.0.0" as const,
    attempt_id: "attempt-write-1",
    task_spec_hash: taskSpecHash,
    environment_id: "environment-writer-1",
    workspace_id: "workspace-write-1",
    writable_root_identity_hash: hash("9"),
    prompt_hash: hash("1"),
    source_manifest_hash: hash("2"),
    before_filesystem_manifest_hash: hash("a"),
    before_git_identity_hash: hash("b"),
    workspace_read_scope_hash: hash("3"),
    writable_path_set_hash: hash("4"),
    ownership_scope_hash: hash("5"),
    rollback: {
      strategy: "discard_workspace" as const,
      binding_hash: hash("6"),
      controller_id: "workspace-recovery-controller",
      controller_executable_hash: hash("c"),
      controller_authority: "separate_process" as const,
      state: "prepared" as const,
      evidence_refs: [hash("d")],
    },
    issuer: {
      controller_id: "workspace-preparation-controller",
      controller_executable_hash: hash("f"),
      protected_receipt_hash: hash("0"),
    },
    evidence_refs: [hash("e")],
    observed_at: "2026-08-10T11:55:00.000Z",
    expires_at: "2026-08-10T12:45:00.000Z",
  };
}
