import { describe, expect, it } from "vitest";

import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { DelegatedAuthorityGrant_v1 } from "../../src/runs/governed-attempt-protocol.js";
import {
  GovernedTaskCapability_v1,
  GovernedTaskSpec_v1,
  createGovernedTaskAdapterQualification,
  createGovernedTaskSpec,
  evaluateGovernedTaskGrant,
  evaluateGovernedTaskGrantForAdapter,
} from "../../src/runs/governed-task.js";
import {
  HOST_ASSISTED_ADAPTER_MANIFEST,
  WorkerAdapterManifest_v1,
} from "../../src/runs/agent-work-worker-runtime.js";

const hash = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

describe("generic governed task capabilities", () => {
  it("allows an attenuated grant to carry an owned, recoverable write capability", () => {
    const task = taskSpec();
    expect(task.capability_ceiling.map(({ capability_id: id }) => id)).toEqual([
      "read-input",
      "write-owned-workspace",
    ]);

    const grant = DelegatedAuthorityGrant_v1.parse({
      schema_version: "1.0.0",
      grant_id: "grant-1",
      attempt_id: task.attempt_id,
      delegation_id: task.delegation_id,
      issuer: { kind: "operator", principal_id: "operator-1" },
      capabilities: [
        {
          dimension: "filesystem_write",
          capability_id: "write-owned-workspace",
          scope_hash: hash("2"),
        },
      ],
      issued_at: "2026-08-10T06:00:00.000Z",
      not_before: "2026-08-10T06:00:00.000Z",
      expires_at: "2026-08-10T07:00:00.000Z",
    });

    expect(evaluateGovernedTaskGrant(task, grant, activeAt())).toMatchObject({
      permitted: true,
      taskSpecHash: task.task_spec_hash,
      capabilities: [
        {
          capability_id: "write-owned-workspace",
          effect: {
            class: "workspace_mutation",
            rollback: { strategy: "discard_workspace" },
          },
        },
      ],
    });
  });

  it("rejects capability scope expansion while allowing capability attenuation", () => {
    const task = taskSpec();
    const expanded = grant(task, {
      dimension: "filesystem_write",
      capability_id: "write-owned-workspace",
      scope_hash: hash("f"),
    });
    expect(evaluateGovernedTaskGrant(task, expanded, activeAt())).toEqual({
      permitted: false,
      reason: "capability_expansion",
    });

    const empty = grant(task);
    expect(evaluateGovernedTaskGrant(task, empty, activeAt())).toMatchObject({
      permitted: true,
      capabilities: [],
    });
    expect(evaluateGovernedTaskGrant(task, empty, "2026-08-10T07:00:00.000Z")).toEqual({
      permitted: false,
      reason: "grant_not_active",
    });
  });

  it("releases writes only through a trusted active adapter qualification", async () => {
    const task = taskSpec();
    const writeGrant = grant(task, {
      dimension: "filesystem_write",
      capability_id: "write-owned-workspace",
      scope_hash: hash("2"),
    });
    expect(
      await evaluateGovernedTaskGrantForAdapter(
        task,
        writeGrant,
        adapterSelection(HOST_ASSISTED_ADAPTER_MANIFEST),
        qualificationAuthority(HOST_ASSISTED_ADAPTER_MANIFEST),
        activeAt()
      )
    ).toEqual({
      permitted: false,
      reason: "enforcement_unavailable",
      blockedCapabilityIds: ["write-owned-workspace"],
    });

    const qualified = WorkerAdapterManifest_v1.parse({
      ...HOST_ASSISTED_ADAPTER_MANIFEST,
      adapter: {
        ...HOST_ASSISTED_ADAPTER_MANIFEST.adapter,
        id: "lexrunner.contained-writer",
      },
      authority: {
        ...HOST_ASSISTED_ADAPTER_MANIFEST.authority,
        filesystem_read: "enforced",
        filesystem_write: "enforced",
      },
    });
    expect(
      await evaluateGovernedTaskGrantForAdapter(
        task,
        writeGrant,
        adapterSelection(qualified),
        qualificationAuthority(qualified),
        activeAt()
      )
    ).toMatchObject({
      permitted: true,
      capabilities: [{ capability_id: "write-owned-workspace" }],
    });
  });

  it("rejects caller-supplied enforcement claims and mismatched qualifications", async () => {
    const task = taskSpec();
    const writeGrant = grant(task, {
      dimension: "filesystem_write",
      capability_id: "write-owned-workspace",
      scope_hash: hash("2"),
    });
    const forged = WorkerAdapterManifest_v1.parse({
      ...HOST_ASSISTED_ADAPTER_MANIFEST,
      authority: {
        ...HOST_ASSISTED_ADAPTER_MANIFEST.authority,
        filesystem_write: "enforced",
      },
    });
    expect(
      await evaluateGovernedTaskGrantForAdapter(
        task,
        writeGrant,
        {
          ...adapterSelection(HOST_ASSISTED_ADAPTER_MANIFEST),
          manifest: forged,
        },
        qualificationAuthority(HOST_ASSISTED_ADAPTER_MANIFEST),
        activeAt()
      )
    ).toEqual({ permitted: false, reason: "invalid_adapter" });

    expect(
      await evaluateGovernedTaskGrantForAdapter(
        task,
        writeGrant,
        adapterSelection(HOST_ASSISTED_ADAPTER_MANIFEST),
        qualificationAuthority(HOST_ASSISTED_ADAPTER_MANIFEST, {
          manifestHash: hash("f"),
        }),
        activeAt()
      )
    ).toEqual({ permitted: false, reason: "adapter_unqualified" });
  });

  it("will not disguise filesystem writes as observation", () => {
    expect(() =>
      GovernedTaskCapability_v1.parse({
        dimension: "filesystem_write",
        capability_id: "unrecoverable-write",
        scope_hash: hash("1"),
        minimum_enforcement: "enforced",
        effect: { class: "observation" },
      })
    ).toThrow(/workspace_mutation/u);
  });

  it("applies an exhaustive effect policy to reads, network, and secrets", () => {
    expect(() =>
      GovernedTaskCapability_v1.parse({
        dimension: "filesystem_read",
        capability_id: "read-input",
        scope_hash: hash("1"),
        minimum_enforcement: "enforced",
        effect: {
          class: "runtime_execution",
          containment_profile_hash: hash("2"),
        },
      })
    ).toThrow(/filesystem_read must declare one of: observation/u);

    expect(() =>
      GovernedTaskCapability_v1.parse({
        dimension: "network",
        capability_id: "call-api",
        scope_hash: hash("1"),
        minimum_enforcement: "brokered",
        effect: { class: "observation" },
      })
    ).toThrow(/network must declare one of: external_effect/u);

    expect(() =>
      GovernedTaskCapability_v1.parse({
        dimension: "secrets",
        capability_id: "read-token",
        scope_hash: hash("1"),
        minimum_enforcement: "brokered",
        effect: { class: "observation" },
      })
    ).toThrow(/secrets must declare one of: sensitive_data_access/u);

    expect(
      GovernedTaskCapability_v1.parse({
        dimension: "secrets",
        capability_id: "read-token",
        scope_hash: hash("1"),
        minimum_enforcement: "brokered",
        effect: {
          class: "sensitive_data_access",
          secret_scope_hash: hash("2"),
          handling_policy_hash: hash("3"),
        },
      }).effect
    ).toMatchObject({ class: "sensitive_data_access" });
  });

  it("permits irreversible external effects only with bound consequence acceptance", () => {
    expect(() =>
      GovernedTaskCapability_v1.parse({
        dimension: "github_write",
        capability_id: "merge-pull-request",
        scope_hash: hash("1"),
        minimum_enforcement: "brokered",
        effect: {
          class: "external_effect",
          consequence_scope_hash: hash("2"),
          recovery: { mode: "irreversible" },
        },
      })
    ).toThrow();

    expect(
      GovernedTaskCapability_v1.parse({
        dimension: "github_write",
        capability_id: "merge-pull-request",
        scope_hash: hash("1"),
        minimum_enforcement: "brokered",
        effect: {
          class: "external_effect",
          consequence_scope_hash: hash("2"),
          recovery: {
            mode: "irreversible",
            consequence_acceptance_hash: hash("3"),
          },
        },
      }).effect
    ).toMatchObject({ class: "external_effect", recovery: { mode: "irreversible" } });
  });

  it("keeps task semantics and refusal coercion outside the generic contract", () => {
    const task = taskSpec();
    expect(task.profile.profile_id).toBe("document-synthesis");
    expect(task).not.toHaveProperty("repository_id");
    expect(task).not.toHaveProperty("verdict");
    expect(() =>
      GovernedTaskSpec_v1.parse({
        ...task,
        refusal_reason_required: true,
      })
    ).toThrow();
  });
});

function taskSpec() {
  return createGovernedTaskSpec({
    schema_version: "1.0.0",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    objective_hash: hash("0"),
    authorized_model_provider: "openai",
    profile: {
      profile_id: "document-synthesis",
      profile_version: "1.0.0",
      input_contract_hash: hash("a"),
      output_contract_hash: hash("b"),
      verifier_id: "document-synthesis-verifier",
      verifier_version: "1.0.0",
    },
    input_binding_hash: hash("c"),
    capability_ceiling: [
      {
        dimension: "filesystem_write",
        capability_id: "write-owned-workspace",
        scope_hash: hash("2"),
        minimum_enforcement: "enforced",
        effect: {
          class: "workspace_mutation",
          ownership_scope_hash: hash("3"),
          rollback: {
            strategy: "discard_workspace",
            binding_hash: hash("4"),
          },
        },
      },
      {
        dimension: "filesystem_read",
        capability_id: "read-input",
        scope_hash: hash("1"),
        minimum_enforcement: "enforced",
        effect: { class: "observation" },
      },
    ],
    budget: {
      max_duration_ms: 300_000,
      max_output_bytes: 1_048_576,
      max_evidence_bytes: 8_388_608,
      max_tool_calls: 100,
    },
  });
}

function grant(
  task: ReturnType<typeof taskSpec>,
  ...capabilities: Array<{
    dimension: "filesystem_write";
    capability_id: string;
    scope_hash: string;
  }>
) {
  return DelegatedAuthorityGrant_v1.parse({
    schema_version: "1.0.0",
    grant_id: "grant-1",
    attempt_id: task.attempt_id,
    delegation_id: task.delegation_id,
    issuer: { kind: "operator", principal_id: "operator-1" },
    capabilities,
    issued_at: "2026-08-10T06:00:00.000Z",
    not_before: "2026-08-10T06:00:00.000Z",
    expires_at: "2026-08-10T07:00:00.000Z",
  });
}

function activeAt(): string {
  return "2026-08-10T06:30:00.000Z";
}

function adapterSelection(candidate: unknown) {
  const manifest = WorkerAdapterManifest_v1.parse(candidate);
  return {
    adapter_id: manifest.adapter.id,
    adapter_version: manifest.adapter.version,
  };
}

function qualificationAuthority(candidate: unknown, options: { manifestHash?: string } = {}) {
  const manifest = WorkerAdapterManifest_v1.parse(candidate);
  const qualification = createGovernedTaskAdapterQualification({
    schema_version: "1.0.0",
    qualification_id: `qualification-${manifest.adapter.id}`,
    adapter_id: manifest.adapter.id,
    adapter_version: manifest.adapter.version,
    manifest_hash: options.manifestHash ?? computeCanonicalHash(manifest),
    qualification_profile_id: "worker-adapter-canary-suite",
    qualification_profile_version: "1.0.0",
    evidence_hash: hash("e"),
    decision: "qualified",
    qualified_at: "2026-08-10T06:00:00.000Z",
    expires_at: "2026-08-10T07:00:00.000Z",
  });
  return {
    async resolveQualifiedAdapter() {
      return { manifest, qualification };
    },
  };
}
