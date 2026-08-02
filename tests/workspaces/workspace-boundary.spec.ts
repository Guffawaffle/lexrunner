import { describe, expect, it } from "vitest";

import {
  WORKSPACE_BOUNDARY_CONTRACT_VERSION,
  WorkspaceBoundaryCapabilityDecision_v1,
  WorkspaceBoundaryDirectoryIdentity_v1,
  WorkspaceBoundaryOperationReceipt_v1,
  WorkspaceBoundarySelectionRequest_v1,
  createWorkspaceBoundaryCapabilityDecision,
  createWorkspaceBoundaryDirectoryIdentity,
  createWorkspaceBoundaryLeaseReceipt,
  createWorkspaceBoundaryOperationReceipt,
  type WorkspaceBoundaryError_v1,
} from "../../src/workspaces/workspace-boundary.js";

const NOW = "2026-08-01T16:00:00.000Z";
const LATER = "2026-08-01T16:00:01.000Z";

describe("WorkspaceBoundary v1 contract", () => {
  it("binds a ready native Linux decision to enforced held-object claims", () => {
    const first = linuxDecision();
    const second = linuxDecision();

    expect(first).toEqual(second);
    expect(first.decision_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(WorkspaceBoundaryCapabilityDecision_v1.parse(first)).toEqual(first);
    expect(
      WorkspaceBoundaryCapabilityDecision_v1.safeParse({
        ...first,
        decision_id: "forged-decision",
      }).success
    ).toBe(false);
    expect(() =>
      linuxDecision({ claims: { ...baselineClaims(), held_ancestor_chain: false } })
    ).toThrow(/ready backends must enforce this claim/u);
  });

  it("permits projection only through an explicit profile and exposes no platform override", () => {
    expect(WorkspaceBoundarySelectionRequest_v1.parse({ mode: "native" })).toEqual({
      mode: "native",
    });
    expect(
      WorkspaceBoundarySelectionRequest_v1.safeParse({
        mode: "native",
        platform: "linux",
      }).success
    ).toBe(false);
    expect(
      WorkspaceBoundarySelectionRequest_v1.safeParse({
        mode: "native",
        backend_kind: "windows-native",
      }).success
    ).toBe(false);

    const projection = createWorkspaceBoundaryCapabilityDecision({
      ...linuxDecisionInput(),
      decision_id: "decision-projection",
      selection: { mode: "explicit_projection", profile_id: "wsl-ubuntu" },
      backend_kind: "native-wsl-projection",
      reason_code: "explicit_projection_ready",
    });
    expect(projection.state).toBe("ready");
    expect(() =>
      createWorkspaceBoundaryCapabilityDecision({
        ...linuxDecisionInput(),
        decision_id: "decision-implicit-projection",
        backend_kind: "native-wsl-projection",
      })
    ).toThrow(/projection selection must be explicit/u);
  });

  it("requires verified signing before a native helper can advertise ready", () => {
    const windowsInput = {
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      decision_id: "decision-windows",
      selection: { mode: "native" as const },
      backend_kind: "windows-native" as const,
      state: "ready" as const,
      reason_code: "native_backend_ready" as const,
      host: {
        platform: "windows" as const,
        architecture: "x64",
        path_comparison: "case-insensitive" as const,
      },
      backend: {
        transport: "native_helper" as const,
        implementation: "lexrunner-workspace-boundary",
        implementation_version: "1.0.0",
        protocol_version: "1.0.0",
        artifact_digest: `sha256:${"a".repeat(64)}`,
        signature: { status: "verified" as const, signer_identity: "release-certificate" },
      },
      claims: { ...baselineClaims(), rename_delete_exclusion: true },
      observed_at: NOW,
    };

    expect(createWorkspaceBoundaryCapabilityDecision(windowsInput).state).toBe("ready");
    const unavailable = createWorkspaceBoundaryCapabilityDecision({
      ...windowsInput,
      state: "unavailable",
      reason_code: "helper_missing",
      backend: {
        transport: "native_helper",
        implementation: "lexrunner-workspace-boundary",
        implementation_version: "1.0.0",
        protocol_version: "1.0.0",
        signature: { status: "not_available" },
      },
      claims: {
        held_directory_identity: false,
        no_follow_open: false,
        final_path_from_handle: false,
        held_ancestor_chain: false,
        replacement_resistant_process_binding: false,
        rename_delete_exclusion: false,
        durable_directory_mutation: false,
      },
    });
    expect(unavailable).toMatchObject({ state: "unavailable", reason_code: "helper_missing" });
    expect(() =>
      createWorkspaceBoundaryCapabilityDecision({
        ...windowsInput,
        backend: {
          ...windowsInput.backend,
          signature: { status: "development_unverified" as const },
        },
      })
    ).toThrow(/ready native helper must have a verified signature/u);
    expect(() =>
      createWorkspaceBoundaryCapabilityDecision({
        ...windowsInput,
        host: { ...windowsInput.host, platform: "linux" as const },
      })
    ).toThrow(/Windows native requires a Windows host probe/u);
  });

  it("keeps Linux and Windows directory identities distinct and digest-bound", () => {
    const linux = createWorkspaceBoundaryDirectoryIdentity({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      backend_kind: "linux-native",
      identity_kind: "linux-device-inode",
      canonical_path: "/srv/lexrunner/worktrees",
      path_comparison: "case-sensitive",
      device: "2049",
      inode: "4815162342",
    });
    const windows = createWorkspaceBoundaryDirectoryIdentity({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      backend_kind: "windows-native",
      identity_kind: "windows-volume-file-id",
      canonical_path: "\\\\?\\D:\\dev\\lexrunner-worktrees",
      path_comparison: "case-insensitive",
      volume_serial_number: "a1b2c3d4",
      file_id: "00112233445566778899aabbccddeeff",
    });

    expect(linux.identity_kind).toBe("linux-device-inode");
    expect(windows.identity_kind).toBe("windows-volume-file-id");
    expect(
      WorkspaceBoundaryDirectoryIdentity_v1.safeParse({
        ...windows,
        backend_kind: "linux-native",
      }).success
    ).toBe(false);
    expect(
      WorkspaceBoundaryDirectoryIdentity_v1.safeParse({
        ...linux,
        inode: "4815162343",
      }).success
    ).toBe(false);
  });

  it("binds lease lineage without serializing a reusable capability token", () => {
    const identity = createWorkspaceBoundaryDirectoryIdentity({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      backend_kind: "linux-native",
      identity_kind: "linux-device-inode",
      canonical_path: "/srv/lexrunner/worktrees",
      path_comparison: "case-sensitive",
      device: "1",
      inode: "2",
    });
    const receipt = createWorkspaceBoundaryLeaseReceipt({
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      lease_id: "boundary-lease-1",
      orchestration_lease_id: "workspace-lease-1",
      orchestration_lease_revision: 4,
      owner_id: "attempt-1",
      backend_kind: "linux-native",
      capability_decision_digest: linuxDecision().decision_digest,
      root_identity_digests: [identity.identity_digest],
      phase: "acquired",
      observed_at: NOW,
    });

    expect(receipt.receipt_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(receipt).not.toHaveProperty("token");
    expect(receipt).not.toHaveProperty("handle");
  });

  it("canonicalizes receipt identity sets before hashing", () => {
    const firstDigest = `sha256:${"a".repeat(64)}`;
    const secondDigest = `sha256:${"b".repeat(64)}`;
    const leaseInput = {
      schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
      lease_id: "boundary-lease-1",
      orchestration_lease_id: "workspace-lease-1",
      orchestration_lease_revision: 4,
      owner_id: "attempt-1",
      backend_kind: "linux-native" as const,
      capability_decision_digest: linuxDecision().decision_digest,
      phase: "acquired" as const,
      observed_at: NOW,
    };

    const firstLease = createWorkspaceBoundaryLeaseReceipt({
      ...leaseInput,
      root_identity_digests: [secondDigest, firstDigest, secondDigest],
    });
    const secondLease = createWorkspaceBoundaryLeaseReceipt({
      ...leaseInput,
      root_identity_digests: [firstDigest, secondDigest],
    });
    expect(firstLease).toEqual(secondLease);
    expect(firstLease.root_identity_digests).toEqual([firstDigest, secondDigest]);

    const firstOperation = operationReceipt({
      identity_digests: [secondDigest, firstDigest, secondDigest],
    });
    const secondOperation = operationReceipt({ identity_digests: [firstDigest, secondDigest] });
    expect(firstOperation).toEqual(secondOperation);
    expect(firstOperation.identity_digests).toEqual([firstDigest, secondDigest]);
  });

  it("classifies completed, rejected, and indeterminate operation effects", () => {
    const completed = operationReceipt();
    const rejected = operationReceipt({
      operation_id: "operation-rejected",
      outcome: "rejected",
      durability: "not_applicable",
      error: boundaryError({
        effect_state: "no_effect",
        operation_id: "operation-rejected",
      }),
    });
    const indeterminate = operationReceipt({
      operation_id: "operation-indeterminate",
      operation: "rename-owned",
      mutation: true,
      outcome: "indeterminate",
      durability: "indeterminate",
      error: boundaryError({
        code: "durability_indeterminate",
        effect_state: "effect_unknown",
        operation_id: "operation-indeterminate",
      }),
    });

    expect(completed.outcome).toBe("completed");
    expect(rejected.error?.effect_state).toBe("no_effect");
    expect(indeterminate.error?.effect_state).toBe("effect_unknown");
    expect(() =>
      operationReceipt({
        operation_id: "operation-invalid",
        outcome: "indeterminate",
        durability: "not_applicable",
        error: boundaryError({
          effect_state: "effect_unknown",
          operation_id: "operation-invalid",
        }),
      })
    ).toThrow(/indeterminate operations require indeterminate durability/u);
    expect(() =>
      operationReceipt({
        operation_id: "operation-mismatch",
        outcome: "rejected",
        error: boundaryError({ operation_id: "another-operation" }),
      })
    ).toThrow(/error operation_id must match receipt operation_id/u);
    expect(
      WorkspaceBoundaryOperationReceipt_v1.safeParse({
        ...completed,
        completed_at: "2026-08-01T16:00:02.000Z",
      }).success
    ).toBe(false);
  });
});

function baselineClaims() {
  return {
    held_directory_identity: true,
    no_follow_open: true,
    final_path_from_handle: true,
    held_ancestor_chain: true,
    replacement_resistant_process_binding: true,
    rename_delete_exclusion: false,
    durable_directory_mutation: false,
  };
}

function linuxDecisionInput() {
  return {
    schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
    decision_id: "decision-linux",
    selection: { mode: "native" as const },
    backend_kind: "linux-native" as const,
    state: "ready" as const,
    reason_code: "native_backend_ready" as const,
    host: {
      platform: "linux" as const,
      architecture: "x64",
      path_comparison: "case-sensitive" as const,
    },
    backend: {
      transport: "in_process" as const,
      implementation: "linux-directory-identity",
      implementation_version: "1.0.0",
    },
    claims: baselineClaims(),
    observed_at: NOW,
  };
}

function linuxDecision(overrides: Partial<ReturnType<typeof linuxDecisionInput>> = {}) {
  return createWorkspaceBoundaryCapabilityDecision({ ...linuxDecisionInput(), ...overrides });
}

function boundaryError(
  overrides: Partial<WorkspaceBoundaryError_v1> = {}
): WorkspaceBoundaryError_v1 {
  return {
    schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
    code: "operation_failed",
    message: "operation rejected",
    retryable: false,
    effect_state: "no_effect",
    operation_id: "operation-1",
    ...overrides,
  };
}

function operationReceipt(
  overrides: Partial<Parameters<typeof createWorkspaceBoundaryOperationReceipt>[0]> = {}
) {
  return createWorkspaceBoundaryOperationReceipt({
    schema_version: WORKSPACE_BOUNDARY_CONTRACT_VERSION,
    operation_id: "operation-1",
    lease_id: "boundary-lease-1",
    backend_kind: "linux-native",
    operation: "assert-current",
    mutation: false,
    outcome: "completed",
    durability: "not_applicable",
    identity_digests: [`sha256:${"b".repeat(64)}`],
    started_at: NOW,
    completed_at: LATER,
    ...overrides,
  });
}
