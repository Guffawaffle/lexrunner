import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
  NativeWslExecutionPathMapping_v1,
  NativeWslProjectionManifest_v1,
  NativeWslProjectionPathMapping_v1,
  NativeWslProjectionReceipt_v1,
  NativeWslProjectionRequestJsonSchema,
  NativeWslProjectionRequest_v1,
  NativeWslSourceObservation_v1,
  createNativeWslExecutionPathMapping,
  createNativeExecutionPathMapping,
  createNativeWslProjectionManifest,
  createNativeWslProjectionPathMapping,
  createNativeWslProjectionReceipt,
  createNativeWslProjectionRequest,
  createNativeWslSourceObservation,
  nativeWslProjectionId,
  type NativeWslProjectionManifest_v1 as NativeWslProjectionManifest,
  type NativeWslProjectionRequest_v1 as NativeWslProjectionRequest,
  type NativeWslSourceObservation_v1 as NativeWslSourceObservation,
} from "../../../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../../../src/schemas/task-contract.js";
import {
  NativeWslProjectionInventoryObservation_v1,
  NativeWslProjectionPlan_v1,
  planNativeWslProjection,
} from "../../../src/runs/agent-work-projection-planner.js";

const BASE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const OBSERVED_AT = "2026-07-29T20:00:00.000Z";
const COMPLETED_AT = "2026-07-29T20:01:00.000Z";
const REPOSITORY_ID = "Guffawaffle/stfc-mod";
const REMOTE_HASH = computeCanonicalHash("https://github.com/Guffawaffle/stfc-mod.git");

describe("native WSL projection contracts", () => {
  it("creates a deterministic, domain-bound request for one exact committed base", () => {
    const first = request();
    const second = request();
    const changedBase = request({ baseSha: OTHER_SHA });
    const changedSourcePath = request({
      windowsRepositoryPath: "E:\\mirror\\stfc-mod",
    });
    const changedRuntime = request({ wslGitRuntime: "wsl:Ubuntu-26.04" });

    expect(first).toEqual(second);
    expect(first.request_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(changedBase.request_digest).not.toBe(first.request_digest);
    expect(changedSourcePath.request_digest).not.toBe(first.request_digest);
    expect(changedRuntime.request_digest).not.toBe(first.request_digest);
    expect(nativeWslProjectionId(first.request_digest)).toMatch(/^native-wsl:[a-f0-9]{64}$/u);
    expect(NativeWslProjectionRequest_v1.parse(first)).toEqual(first);
    expect(NativeWslProjectionRequestJsonSchema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: {
        repository: { additionalProperties: false },
        source: { additionalProperties: false },
        native: { additionalProperties: false },
      },
    });
  });

  it("rejects digest tampering, ambiguous Linux paths, and every source/native overlap", () => {
    const valid = request();

    expect(
      NativeWslProjectionRequest_v1.safeParse({
        ...valid,
        request_id: "replacement-request",
      }).success
    ).toBe(false);
    expect(() => request({ projectionRoot: "/var/lib/lexrunner/../projections" })).toThrow(
      /dot path segments/u
    );
    expect(() =>
      request({
        projectionRoot: "/var/lib/lexrunner",
        worktreeRoot: "/var/lib/lexrunner/worktrees",
      })
    ).toThrow(/must not overlap/u);
    expect(() =>
      request({
        projectionRoot: "/",
        worktreeRoot: "/var/lib/lexrunner/worktrees",
      })
    ).toThrow(/must not overlap/u);
    expect(() =>
      request({
        projectionRoot: "/mnt/d/dev/stfc-mod",
      })
    ).toThrow(/must not overlap the mapped source repository/u);
    expect(() =>
      request({
        projectionRoot: "/mnt/d/dev/stfc-mod/native",
      })
    ).toThrow(/must not overlap the mapped source repository/u);
    expect(() =>
      request({
        wslRepositoryPath: "/var/lib/lexrunner",
      })
    ).toThrow(/must not overlap the mapped source repository/u);
    expect(() =>
      request({
        worktreeRoot: "/mnt/d/dev/stfc-mod/worktrees",
      })
    ).toThrow(/must not overlap the mapped source repository/u);
  });

  it("binds source observations and path mappings to canonical content", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const mapping = pathMapping(projectionRequest, source);

    expect(NativeWslSourceObservation_v1.parse(source)).toEqual(source);
    expect(NativeWslProjectionPathMapping_v1.parse(mapping)).toEqual(mapping);
    expect(
      NativeWslSourceObservation_v1.safeParse({
        ...source,
        source_head_sha: OTHER_SHA,
      }).success
    ).toBe(false);
    expect(
      NativeWslProjectionPathMapping_v1.safeParse({
        ...mapping,
        base_sha: OTHER_SHA,
      }).success
    ).toBe(false);
    expect(() =>
      createNativeWslProjectionPathMapping({
        ...without(mapping, "mapping_digest"),
        roots: {
          ...mapping.roots,
          native_repository: {
            ...mapping.roots.native_repository,
            path: "/",
          },
        },
      })
    ).toThrow(/must not overlap/u);
  });

  it("requires manifests to preserve repository, commit, observation, path, and inode bindings", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const manifest = readyManifest(projectionRequest, source);

    expect(NativeWslProjectionManifest_v1.parse(manifest)).toEqual(manifest);
    expect(
      NativeWslProjectionManifest_v1.safeParse({
        ...manifest,
        projection_id: "native-wsl:wrong",
      }).success
    ).toBe(false);
    expect(() =>
      readyManifest(projectionRequest, source, {
        nativeRepositoryIdentity: { device: "99", inode: "100" },
      })
    ).toThrow(/identity binding/u);
    expect(() =>
      readyManifest(projectionRequest, source, {
        requestedObjectType: "other",
      })
    ).toThrow(/must be a commit/u);
  });

  it("binds execution mappings to the selected projection without conflating path roles", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const manifest = readyManifest(projectionRequest, source);
    const executionMapping = createNativeWslExecutionPathMapping({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      projection_id: nativeWslProjectionId(projectionRequest.request_digest),
      repository_id: projectionRequest.repository.id,
      base_sha: projectionRequest.base_sha,
      native_host_id: projectionRequest.native.host_id,
      request_digest: projectionRequest.request_digest,
      projection_digest: manifest.manifest_digest,
      projection_mapping_digest: manifest.path_mapping.mapping_digest,
      roots: {
        windows_source: manifest.path_mapping.roots.windows_source,
        wsl_source: manifest.path_mapping.roots.wsl_source,
        native_repository: manifest.path_mapping.roots.native_repository,
        native_allocation_root: manifest.path_mapping.roots.native_worktree_root,
        native_worktree: {
          runtime_id: "wsl:Ubuntu-24.04",
          path: `${manifest.native_worktree_root.path}/run-1/attempt-1`,
          verification: "directory_identity",
          directory_identity: { device: "2049", inode: "5001" },
        },
      },
    });

    expect(NativeWslExecutionPathMapping_v1.parse(executionMapping)).toEqual(executionMapping);
    expect(
      NativeWslExecutionPathMapping_v1.safeParse({
        ...executionMapping,
        projection_digest: computeCanonicalHash("different projection"),
      }).success
    ).toBe(false);
    expect(() =>
      createNativeWslExecutionPathMapping({
        ...without(executionMapping, "mapping_digest"),
        roots: {
          ...executionMapping.roots,
          native_worktree: {
            ...executionMapping.roots.native_worktree,
            path: `${executionMapping.roots.native_repository.path}/attempt-1`,
          },
        },
      })
    ).toThrow(/must not overlap/u);

    const nativeMapping = createNativeExecutionPathMapping({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      mapping_kind: "native_linux",
      repository_id: projectionRequest.repository.id,
      base_sha: projectionRequest.base_sha,
      native_host_id: projectionRequest.native.host_id,
      git_runtime: projectionRequest.native.git_runtime,
      roots: {
        native_repository: manifest.path_mapping.roots.native_repository,
        native_allocation_root: manifest.path_mapping.roots.native_worktree_root,
        native_worktree: {
          runtime_id: projectionRequest.native.git_runtime,
          path: `${manifest.native_worktree_root.path}/native-attempt`,
          verification: "directory_identity",
          directory_identity: { device: "2049", inode: "6001" },
        },
      },
    });
    expect(nativeMapping.mapping_kind).toBe("native_linux");
  });

  it("permits selection fields only on prepared or reused receipts", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const manifest = readyManifest(projectionRequest, source);
    const selected = createNativeWslProjectionReceipt({
      schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
      request_id: projectionRequest.request_id,
      request_digest: projectionRequest.request_digest,
      outcome: "prepared",
      reason_code: "projection_prepared",
      source_observation_digest: source.observation_digest,
      projection_digest: manifest.manifest_digest,
      mapping_digest: manifest.path_mapping.mapping_digest,
      completed_at: COMPLETED_AT,
    });

    expect(NativeWslProjectionReceipt_v1.parse(selected)).toEqual(selected);
    expect(
      NativeWslProjectionReceipt_v1.safeParse({
        ...selected,
        outcome: "rejected",
        reason_code: "source_dirty",
      }).success
    ).toBe(false);
    expect(() =>
      createNativeWslProjectionReceipt({
        schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
        request_id: projectionRequest.request_id,
        request_digest: projectionRequest.request_digest,
        outcome: "rejected",
        reason_code: "source_dirty",
        projection_digest: manifest.manifest_digest,
        completed_at: COMPLETED_AT,
      })
    ).toThrow(/only selected outcomes/u);
  });

  it("keeps validation diagnostics bounded and does not echo rejected paths", () => {
    const privatePath = `D:\\private\\${"x".repeat(17_000)}`;
    const result = NativeWslProjectionRequest_v1.safeParse({
      ...request(),
      source: {
        ...request().source,
        windows_repository_path: privatePath,
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const diagnostics = JSON.stringify(result.error.issues);
    expect(diagnostics.length).toBeLessThan(2_048);
    expect(diagnostics).not.toContain("private");
    expect(diagnostics).not.toContain("x".repeat(100));

    const privateKey = `D:\\private\\${"key".repeat(7_000)}`;
    const unknownTopLevel = NativeWslProjectionRequest_v1.safeParse({
      ...request(),
      [privateKey]: "private-value",
    });
    expect(unknownTopLevel.success).toBe(false);
    if (!unknownTopLevel.success) {
      const unknownDiagnostics = JSON.stringify(unknownTopLevel.error.issues);
      expect(unknownDiagnostics.length).toBeLessThan(1_024);
      expect(unknownDiagnostics).not.toContain("private");
      expect(unknownDiagnostics).not.toContain("key".repeat(100));
    }

    const unknownNested = NativeWslProjectionRequest_v1.safeParse({
      ...request(),
      source: {
        ...request().source,
        [privateKey]: "private-value",
      },
    });
    expect(unknownNested.success).toBe(false);
    if (!unknownNested.success) {
      const nestedDiagnostics = JSON.stringify(unknownNested.error.issues);
      expect(nestedDiagnostics.length).toBeLessThan(1_024);
      expect(nestedDiagnostics).not.toContain("private");
      expect(nestedDiagnostics).not.toContain("key".repeat(100));
    }

    const prototypeKey = NativeWslProjectionRequest_v1.safeParse(
      jsonObjectWithPrototypeKey(request())
    );
    expect(prototypeKey.success).toBe(false);
    if (!prototypeKey.success) {
      const prototypeDiagnostics = JSON.stringify(prototypeKey.error.issues);
      expect(prototypeDiagnostics.length).toBeLessThan(1_024);
      expect(prototypeDiagnostics).not.toContain("private");
      expect(prototypeDiagnostics).not.toContain("__proto__");
    }
    expect(() =>
      createNativeWslProjectionRequest(
        jsonObjectWithPrototypeKey(without(request(), "request_digest")) as Parameters<
          typeof createNativeWslProjectionRequest
        >[0]
      )
    ).toThrow();

    const nestedPrototypeKey = NativeWslProjectionRequest_v1.safeParse({
      ...request(),
      source: jsonObjectWithPrototypeKey(request().source),
    });
    expect(nestedPrototypeKey.success).toBe(false);
    if (!nestedPrototypeKey.success) {
      const nestedPrototypeDiagnostics = JSON.stringify(nestedPrototypeKey.error.issues);
      expect(nestedPrototypeDiagnostics.length).toBeLessThan(1_024);
      expect(nestedPrototypeDiagnostics).not.toContain("private");
      expect(nestedPrototypeDiagnostics).not.toContain("__proto__");
    }

    const inheritedPrivateValue = Object.assign(
      Object.create({ privatePath: "D:\\private\\repository" }),
      request()
    );
    const inheritedPrototype = NativeWslProjectionRequest_v1.safeParse(inheritedPrivateValue);
    expect(inheritedPrototype.success).toBe(false);
    if (!inheritedPrototype.success) {
      const inheritedDiagnostics = JSON.stringify(inheritedPrototype.error.issues);
      expect(inheritedDiagnostics.length).toBeLessThan(1_024);
      expect(inheritedDiagnostics).not.toContain("private");
    }
  });

  it("rejects oversized timestamps and directory identities before canonical hashing", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const mapping = pathMapping(projectionRequest, source);
    const oversizedTimestamp = `2026-07-29T20:00:00.${"1".repeat(20_000)}Z`;

    expect(() =>
      createNativeWslSourceObservation({
        ...without(source, "observation_digest"),
        observed_at: oversizedTimestamp,
      })
    ).toThrow(/Too big/u);
    expect(() =>
      createNativeWslProjectionPathMapping({
        ...without(mapping, "mapping_digest"),
        roots: {
          ...mapping.roots,
          native_repository: {
            ...mapping.roots.native_repository,
            directory_identity: {
              device: "1".repeat(20_000),
              inode: "4001",
            },
          },
        },
      })
    ).toThrow(/Too big/u);
    expect(
      NativeWslProjectionInventoryObservation_v1.safeParse({
        state: "staging",
        projection_id: nativeWslProjectionId(projectionRequest.request_digest),
        request_digest: projectionRequest.request_digest,
        started_at: oversizedTimestamp,
      }).success
    ).toBe(false);
  });
});

describe("native WSL projection planner", () => {
  it("plans absent, exact, and stale ready states deterministically", () => {
    const projectionRequest = request();
    const source = observation(projectionRequest);
    const manifest = readyManifest(projectionRequest, source);

    expect(planNativeWslProjection(projectionRequest, { state: "absent" })).toMatchObject({
      inventory_state: "absent",
      action: "prepare_staging",
      reason: "projection_absent",
      selection_allowed: false,
      mutation_required: true,
    });
    const absentPlan = planNativeWslProjection(projectionRequest, {
      state: "absent",
    });
    expect(
      NativeWslProjectionPlan_v1.safeParse({
        ...absentPlan,
        next_actions: ["stop_and_report_conflict"],
      }).success
    ).toBe(false);
    expect(
      NativeWslProjectionPlan_v1.safeParse({
        ...absentPlan,
        projection_id: "native-wsl:forged",
      }).success
    ).toBe(false);
    const prototypePlan = NativeWslProjectionPlan_v1.safeParse(
      jsonObjectWithPrototypeKey(absentPlan)
    );
    expect(prototypePlan.success).toBe(false);
    if (!prototypePlan.success) {
      const diagnostics = JSON.stringify(prototypePlan.error.issues);
      expect(diagnostics.length).toBeLessThan(1_024);
      expect(diagnostics).not.toContain("private");
      expect(diagnostics).not.toContain("__proto__");
    }
    expect(planNativeWslProjection(projectionRequest, { state: "ready", manifest })).toMatchObject({
      inventory_state: "ready",
      action: "reuse_ready",
      reason: "projection_exact_match",
      selection_allowed: true,
      mutation_required: false,
      selected_manifest_digest: manifest.manifest_digest,
    });

    const replacementRequest = request({
      requestId: "request-2",
      baseSha: OTHER_SHA,
    });
    expect(planNativeWslProjection(replacementRequest, { state: "ready", manifest })).toMatchObject(
      {
        action: "quarantine_then_prepare",
        reason: "projection_stale",
        selection_allowed: false,
        mutation_required: true,
      }
    );

    const strictRequest = request({
      requestId: "request-clean",
      dirtyPolicy: "require_clean",
    });
    const dirtyManifest = readyManifest(strictRequest, observation(strictRequest));
    expect(
      planNativeWslProjection(strictRequest, {
        state: "ready",
        manifest: dirtyManifest,
      })
    ).toMatchObject({
      action: "refuse_conflict",
      reason: "projection_conflicting",
      selection_allowed: false,
    });

    const wrongHostManifest = readyManifest(projectionRequest, source, {
      nativeHostId: "wsl-host:unexpected",
    });
    expect(
      planNativeWslProjection(projectionRequest, {
        state: "ready",
        manifest: wrongHostManifest,
      })
    ).toMatchObject({
      action: "refuse_conflict",
      reason: "projection_conflicting",
      selection_allowed: false,
    });
  });

  it("waits for matching staging and refuses concurrent or explicit conflicts", () => {
    const projectionRequest = request();
    const projectionId = nativeWslProjectionId(projectionRequest.request_digest);

    expect(
      planNativeWslProjection(projectionRequest, {
        state: "staging",
        projection_id: projectionId,
        request_digest: projectionRequest.request_digest,
        started_at: OBSERVED_AT,
      })
    ).toMatchObject({
      action: "wait_for_same_request",
      reason: "projection_staging_same_request",
      mutation_required: false,
    });
    expect(
      planNativeWslProjection(projectionRequest, {
        state: "staging",
        projection_id: "native-wsl:another",
        request_digest: computeCanonicalHash("another request"),
        started_at: OBSERVED_AT,
      })
    ).toMatchObject({
      action: "refuse_conflict",
      reason: "projection_staging_conflict",
      mutation_required: false,
    });
    expect(
      planNativeWslProjection(projectionRequest, {
        state: "conflicting",
        projection_id: projectionId,
        observed_at: OBSERVED_AT,
      })
    ).toMatchObject({
      action: "refuse_conflict",
      reason: "projection_conflicting",
      mutation_required: false,
    });
  });

  it("makes cleanup and repair actions explicit for quarantined, invalid, and interrupted state", () => {
    const projectionRequest = request();

    expect(
      planNativeWslProjection(projectionRequest, {
        state: "quarantined",
        quarantined_at: OBSERVED_AT,
      })
    ).toMatchObject({
      action: "cleanup_quarantine_then_prepare",
      reason: "projection_quarantined",
      mutation_required: true,
      next_actions: ["cleanup_quarantined_projection", "prepare_projection_staging"],
    });
    const invalid = planNativeWslProjection(projectionRequest, {
      state: "invalid",
    });
    expect(invalid).toMatchObject({
      action: "quarantine_then_prepare",
      reason: "projection_invalid",
      mutation_required: true,
      next_actions: ["quarantine_observed_projection", "prepare_projection_staging"],
    });
    expect(NativeWslProjectionPlan_v1.parse(invalid)).toEqual(invalid);
    expect(
      planNativeWslProjection(projectionRequest, {
        state: "interrupted",
        projection_id: nativeWslProjectionId(projectionRequest.request_digest),
        request_digest: projectionRequest.request_digest,
        started_at: OBSERVED_AT,
      })
    ).toMatchObject({
      action: "quarantine_then_prepare",
      reason: "projection_interrupted",
      mutation_required: true,
    });
    expect(
      NativeWslProjectionInventoryObservation_v1.safeParse({
        state: "invalid",
        diagnostic: "D:\\private\\repository",
      }).success
    ).toBe(false);
    const privateKey = `D:\\private\\${"key".repeat(7_000)}`;
    const privateInventory = NativeWslProjectionInventoryObservation_v1.safeParse({
      state: "absent",
      [privateKey]: "private-value",
    });
    expect(privateInventory.success).toBe(false);
    if (!privateInventory.success) {
      const diagnostics = JSON.stringify(privateInventory.error.issues);
      expect(diagnostics.length).toBeLessThan(4_096);
      expect(diagnostics).not.toContain("private");
      expect(diagnostics).not.toContain("key".repeat(100));
    }

    const prototypeInventory = NativeWslProjectionInventoryObservation_v1.safeParse(
      jsonObjectWithPrototypeKey({ state: "absent" })
    );
    expect(prototypeInventory.success).toBe(false);
    if (!prototypeInventory.success) {
      const diagnostics = JSON.stringify(prototypeInventory.error.issues);
      expect(diagnostics.length).toBeLessThan(4_096);
      expect(diagnostics).not.toContain("private");
      expect(diagnostics).not.toContain("__proto__");
    }
  });

  it("does not import filesystem mutation, Git execution, SQLite, or worker services", () => {
    for (const relativePath of [
      "../../../src/schemas/agent-work-projection.ts",
      "../../../src/runs/agent-work-projection-planner.ts",
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /from\s+["'](?:node:fs|node:fs\/promises|simple-git|better-sqlite3|.*sqlite|.*worker|.*workspaces\/)/u
      );
    }
  });
});

interface RequestOverrides {
  requestId?: string;
  baseSha?: string;
  projectionRoot?: string;
  worktreeRoot?: string;
  windowsRepositoryPath?: string;
  wslRepositoryPath?: string;
  wslGitRuntime?: string;
  dirtyPolicy?: "require_clean" | "committed_base_only";
}

function request(overrides: RequestOverrides = {}): NativeWslProjectionRequest {
  return createNativeWslProjectionRequest({
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    request_id: overrides.requestId ?? "request-1",
    repository: {
      id: REPOSITORY_ID,
      expected_remote_hash: REMOTE_HASH,
    },
    source: {
      windows_runtime: "windows:host",
      windows_repository_path: overrides.windowsRepositoryPath ?? "D:\\dev\\stfc-mod",
      wsl_distribution: "Ubuntu-24.04",
      wsl_git_runtime: overrides.wslGitRuntime ?? "wsl:Ubuntu-24.04",
      wsl_repository_path: overrides.wslRepositoryPath ?? "/mnt/d/dev/stfc-mod",
      head_policy: "observe",
      dirty_policy: overrides.dirtyPolicy ?? "committed_base_only",
    },
    native: {
      host_id: "wsl-host:primary",
      git_runtime: "wsl:Ubuntu-24.04",
      projection_root: overrides.projectionRoot ?? "/var/lib/lexrunner/projections",
      worktree_root: overrides.worktreeRoot ?? "/var/lib/lexrunner/worktrees",
    },
    base_sha: overrides.baseSha ?? BASE_SHA,
  });
}

function observation(
  projectionRequest: NativeWslProjectionRequest,
  overrides: {
    repositoryId?: string;
    requestedObjectType?: "commit" | "missing" | "other";
  } = {}
): NativeWslSourceObservation {
  return createNativeWslSourceObservation({
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    repository_id: overrides.repositoryId ?? projectionRequest.repository.id,
    request_digest: projectionRequest.request_digest,
    observed_remote_hash: projectionRequest.repository.expected_remote_hash,
    source_head_sha: projectionRequest.base_sha,
    requested_object_sha: projectionRequest.base_sha,
    requested_object_type: overrides.requestedObjectType ?? "commit",
    cleanliness: "dirty",
    observed_at: OBSERVED_AT,
  });
}

function pathMapping(
  projectionRequest: NativeWslProjectionRequest,
  source: NativeWslSourceObservation,
  repositoryId = projectionRequest.repository.id
) {
  const projectionId = nativeWslProjectionId(projectionRequest.request_digest);
  return createNativeWslProjectionPathMapping({
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    projection_id: projectionId,
    repository_id: repositoryId,
    base_sha: projectionRequest.base_sha,
    request_digest: projectionRequest.request_digest,
    roots: {
      windows_source: {
        runtime_id: projectionRequest.source.windows_runtime,
        path: projectionRequest.source.windows_repository_path,
        verification: "declared",
      },
      wsl_source: {
        runtime_id: projectionRequest.source.wsl_git_runtime,
        path: projectionRequest.source.wsl_repository_path,
        verification: "git_observed",
        observation_digest: source.observation_digest,
      },
      native_repository: {
        runtime_id: projectionRequest.native.git_runtime,
        path: `${projectionRequest.native.projection_root}/${projectionId}`,
        verification: "directory_identity",
        directory_identity: { device: "2049", inode: "4001" },
      },
      native_worktree_root: {
        runtime_id: projectionRequest.native.git_runtime,
        path: `${projectionRequest.native.worktree_root}/${projectionId}`,
        verification: "directory_identity",
        directory_identity: { device: "2049", inode: "5000" },
      },
    },
  });
}

interface ManifestOverrides {
  repositoryId?: string;
  nativeHostId?: string;
  nativeRepositoryIdentity?: { device: string; inode: string };
  requestedObjectType?: "commit" | "missing" | "other";
}

function readyManifest(
  projectionRequest: NativeWslProjectionRequest,
  initialSource: NativeWslSourceObservation,
  overrides: ManifestOverrides = {}
): NativeWslProjectionManifest {
  const repositoryId = overrides.repositoryId ?? projectionRequest.repository.id;
  const source =
    overrides.repositoryId === undefined && overrides.requestedObjectType === undefined
      ? initialSource
      : observation(projectionRequest, {
          repositoryId,
          requestedObjectType: overrides.requestedObjectType,
        });
  const mapping = pathMapping(projectionRequest, source, repositoryId);
  return createNativeWslProjectionManifest({
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    projection_id: nativeWslProjectionId(projectionRequest.request_digest),
    repository_id: repositoryId,
    base_sha: projectionRequest.base_sha,
    request_digest: projectionRequest.request_digest,
    source_observation: source,
    native_host_id: overrides.nativeHostId ?? projectionRequest.native.host_id,
    native_repository: {
      path: mapping.roots.native_repository.path,
      directory_identity:
        overrides.nativeRepositoryIdentity ?? mapping.roots.native_repository.directory_identity,
      git_directory_identity: { device: "2049", inode: "4002" },
      head_sha: projectionRequest.base_sha,
    },
    native_worktree_root: {
      path: mapping.roots.native_worktree_root.path,
      directory_identity: mapping.roots.native_worktree_root.directory_identity,
    },
    path_mapping: mapping,
    created_at: OBSERVED_AT,
  });
}

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

function jsonObjectWithPrototypeKey(value: object): unknown {
  return JSON.parse(`{"__proto__":"D:\\\\private\\\\repository",${JSON.stringify(value).slice(1)}`);
}
