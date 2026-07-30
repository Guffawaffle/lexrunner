import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "./task-contract.js";

export const NATIVE_WSL_PROJECTION_CONTRACT_VERSION = "1.0.0" as const;
export const NATIVE_WSL_PROJECTION_HASH_PROFILE = "canonical-json-domain-separated-v1" as const;

const MAX_IDENTIFIER_LENGTH = 4_096;
const MAX_PATH_LENGTH = 16_384;
const MAX_RUNTIME_LENGTH = 512;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_DECIMAL_IDENTITY_LENGTH = 32;

const BoundedIdentifier = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .refine((value) => !value.includes("\0"), { message: "must not contain NUL bytes" });
const BoundedRuntime = z
  .string()
  .min(1)
  .max(MAX_RUNTIME_LENGTH)
  .refine((value) => !value.includes("\0"), { message: "must not contain NUL bytes" });
const Timestamp = z.string().max(MAX_TIMESTAMP_LENGTH).datetime({ offset: true });
const CanonicalGitObjectId = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Must be a lowercase full Git object ID");
const WindowsAbsolutePath = z
  .string()
  .min(3)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.includes("\0"), { message: "must not contain NUL bytes" })
  .refine(
    (value) =>
      /^[a-z]:[\\/]/iu.test(value) || /^\\\\[^\\/\0]+[\\/][^\\/\0]+(?:[\\/]|$)/u.test(value),
    { message: "must be an absolute Windows drive or UNC path" }
  );
const LinuxAbsolutePath = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.includes("\0"), { message: "must not contain NUL bytes" })
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "must be an absolute native Linux path",
  })
  .refine((value) => !value.includes("\\"), {
    message: "must use native Linux path separators",
  })
  .refine((value) => !value.includes("//"), {
    message: "must not contain repeated path separators",
  })
  .refine((value) => !value.split("/").some((segment) => segment === "." || segment === ".."), {
    message: "must not contain dot path segments",
  })
  .refine((value) => value === "/" || !value.endsWith("/"), {
    message: "must not contain a trailing path separator",
  });
const DecimalIdentity = z
  .string()
  .max(MAX_DECIMAL_IDENTITY_LENGTH)
  .regex(/^(?:0|[1-9][0-9]*)$/, "must be a decimal integer");

function boundedStrictObject<const Shape extends z.ZodRawShape>(shape: Shape) {
  const allowedKeys = new Set(Object.keys(shape));
  return z.preprocess((input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return input;
    }
    try {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        return null;
      }
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !allowedKeys.has(key)) {
          return null;
        }
      }
    } catch {
      return null;
    }
    return input;
  }, z.object(shape));
}

export const NativeDirectoryIdentityClaim_v1 = boundedStrictObject({
  device: DecimalIdentity,
  inode: DecimalIdentity,
});
export type NativeDirectoryIdentityClaim_v1 = z.infer<typeof NativeDirectoryIdentityClaim_v1>;

const ProjectionRequestShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  request_id: BoundedIdentifier,
  repository: boundedStrictObject({
    id: BoundedIdentifier,
    expected_remote_hash: SHA256Hash,
  }),
  source: boundedStrictObject({
    windows_runtime: BoundedRuntime,
    windows_repository_path: WindowsAbsolutePath,
    wsl_distribution: BoundedRuntime,
    wsl_git_runtime: BoundedRuntime,
    wsl_repository_path: LinuxAbsolutePath,
    head_policy: z.enum(["observe", "require_base"]),
    dirty_policy: z.enum(["require_clean", "committed_base_only"]),
  }),
  native: boundedStrictObject({
    host_id: BoundedIdentifier,
    git_runtime: BoundedRuntime,
    projection_root: LinuxAbsolutePath,
    worktree_root: LinuxAbsolutePath,
  }),
  base_sha: CanonicalGitObjectId,
} as const;

const ProjectionRequestBody = boundedStrictObject(ProjectionRequestShape).superRefine(
  requireSeparateRequestRoots
);

export const NativeWslProjectionRequest_v1 = boundedStrictObject({
  ...ProjectionRequestShape,
  request_digest: SHA256Hash,
})
  .superRefine(requireSeparateRequestRoots)
  .superRefine((request, context) => {
    const { request_digest: _requestDigest, ...hashable } = request;
    requireDigest(
      request.request_digest,
      projectionHash("request", hashable),
      "request_digest",
      context
    );
  });
export type NativeWslProjectionRequest_v1 = z.infer<typeof NativeWslProjectionRequest_v1>;
export const NativeWslProjectionRequestJsonSchema = closeJsonSchemaObjects(
  z.toJSONSchema(NativeWslProjectionRequest_v1, {
    target: "draft-7",
  })
);

export function createNativeWslProjectionRequest(
  input: z.input<z.ZodObject<typeof ProjectionRequestShape>>
): NativeWslProjectionRequest_v1 {
  const body = ProjectionRequestBody.parse(input);
  return NativeWslProjectionRequest_v1.parse({
    ...body,
    request_digest: projectionHash("request", body),
  });
}

const SourceObservationShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  repository_id: BoundedIdentifier,
  request_digest: SHA256Hash,
  observed_remote_hash: SHA256Hash,
  source_head_sha: CanonicalGitObjectId,
  requested_object_sha: CanonicalGitObjectId,
  requested_object_type: z.enum(["commit", "missing", "other"]),
  cleanliness: z.enum(["clean", "dirty", "unknown"]),
  observed_at: Timestamp,
} as const;
const SourceObservationBody = boundedStrictObject(SourceObservationShape);

export const NativeWslSourceObservation_v1 = boundedStrictObject({
  ...SourceObservationShape,
  observation_digest: SHA256Hash,
}).superRefine((observation, context) => {
  const { observation_digest: _observationDigest, ...hashable } = observation;
  requireDigest(
    observation.observation_digest,
    projectionHash("source-observation", hashable),
    "observation_digest",
    context
  );
});
export type NativeWslSourceObservation_v1 = z.infer<typeof NativeWslSourceObservation_v1>;

export function createNativeWslSourceObservation(
  input: z.input<z.ZodObject<typeof SourceObservationShape>>
): NativeWslSourceObservation_v1 {
  const hashable = SourceObservationBody.parse(input);
  return NativeWslSourceObservation_v1.parse({
    ...hashable,
    observation_digest: projectionHash("source-observation", hashable),
  });
}

const DeclaredWindowsRoot = boundedStrictObject({
  runtime_id: BoundedRuntime,
  path: WindowsAbsolutePath,
  verification: z.literal("declared"),
});
const ObservedWslRoot = boundedStrictObject({
  runtime_id: BoundedRuntime,
  path: LinuxAbsolutePath,
  verification: z.literal("git_observed"),
  observation_digest: SHA256Hash,
});
const VerifiedNativeRoot = boundedStrictObject({
  runtime_id: BoundedRuntime,
  path: LinuxAbsolutePath,
  verification: z.literal("directory_identity"),
  directory_identity: NativeDirectoryIdentityClaim_v1,
});

const ProjectionPathMappingShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  projection_id: BoundedIdentifier,
  repository_id: BoundedIdentifier,
  base_sha: CanonicalGitObjectId,
  request_digest: SHA256Hash,
  roots: boundedStrictObject({
    windows_source: DeclaredWindowsRoot,
    wsl_source: ObservedWslRoot,
    native_repository: VerifiedNativeRoot,
    native_worktree_root: VerifiedNativeRoot,
  }),
} as const;
const ProjectionPathMappingBody = boundedStrictObject(ProjectionPathMappingShape).superRefine(
  requireValidProjectionPathMapping
);

export const NativeWslProjectionPathMapping_v1 = boundedStrictObject({
  ...ProjectionPathMappingShape,
  mapping_digest: SHA256Hash,
})
  .superRefine(requireValidProjectionPathMapping)
  .superRefine((mapping, context) => {
    const { mapping_digest: _mappingDigest, ...hashable } = mapping;
    requireDigest(
      mapping.mapping_digest,
      projectionHash("projection-path-mapping", hashable),
      "mapping_digest",
      context
    );
  });
export type NativeWslProjectionPathMapping_v1 = z.infer<typeof NativeWslProjectionPathMapping_v1>;

export function createNativeWslProjectionPathMapping(
  input: z.input<z.ZodObject<typeof ProjectionPathMappingShape>>
): NativeWslProjectionPathMapping_v1 {
  const body = ProjectionPathMappingBody.parse(input);
  return NativeWslProjectionPathMapping_v1.parse({
    ...body,
    mapping_digest: projectionHash("projection-path-mapping", body),
  });
}

const ProjectionManifestShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  projection_id: BoundedIdentifier,
  repository_id: BoundedIdentifier,
  base_sha: CanonicalGitObjectId,
  request_digest: SHA256Hash,
  source_observation: NativeWslSourceObservation_v1,
  native_host_id: BoundedIdentifier,
  native_repository: boundedStrictObject({
    path: LinuxAbsolutePath,
    directory_identity: NativeDirectoryIdentityClaim_v1,
    git_directory_identity: NativeDirectoryIdentityClaim_v1,
    head_sha: CanonicalGitObjectId,
  }),
  native_worktree_root: boundedStrictObject({
    path: LinuxAbsolutePath,
    directory_identity: NativeDirectoryIdentityClaim_v1,
  }),
  path_mapping: NativeWslProjectionPathMapping_v1,
  created_at: Timestamp,
} as const;

const ProjectionManifestBody = boundedStrictObject(ProjectionManifestShape).superRefine(
  requireValidProjectionManifest
);

export const NativeWslProjectionManifest_v1 = boundedStrictObject({
  ...ProjectionManifestShape,
  manifest_digest: SHA256Hash,
})
  .superRefine(requireValidProjectionManifest)
  .superRefine((manifest, context) => {
    const { manifest_digest: _manifestDigest, ...hashable } = manifest;
    requireDigest(
      manifest.manifest_digest,
      projectionHash("manifest", hashable),
      "manifest_digest",
      context
    );
  });
export type NativeWslProjectionManifest_v1 = z.infer<typeof NativeWslProjectionManifest_v1>;

export function createNativeWslProjectionManifest(
  input: z.input<z.ZodObject<typeof ProjectionManifestShape>>
): NativeWslProjectionManifest_v1 {
  const body = ProjectionManifestBody.parse(input);
  return NativeWslProjectionManifest_v1.parse({
    ...body,
    manifest_digest: projectionHash("manifest", body),
  });
}

function requireValidProjectionManifest(
  manifest: z.output<z.ZodObject<typeof ProjectionManifestShape>>,
  context: z.RefinementCtx
): void {
  requireEqual(
    manifest.projection_id,
    nativeWslProjectionId(manifest.request_digest),
    ["projection_id"],
    context
  );
  requireEqual(
    manifest.repository_id,
    manifest.path_mapping.repository_id,
    ["path_mapping", "repository_id"],
    context
  );
  requireEqual(
    manifest.repository_id,
    manifest.source_observation.repository_id,
    ["source_observation", "repository_id"],
    context
  );
  requireEqual(
    manifest.base_sha,
    manifest.native_repository.head_sha,
    ["native_repository", "head_sha"],
    context
  );
  requireEqual(
    manifest.base_sha,
    manifest.path_mapping.base_sha,
    ["path_mapping", "base_sha"],
    context
  );
  requireEqual(
    manifest.base_sha,
    manifest.source_observation.requested_object_sha,
    ["source_observation", "requested_object_sha"],
    context
  );
  if (manifest.source_observation.requested_object_type !== "commit") {
    context.addIssue({
      code: "custom",
      path: ["source_observation", "requested_object_type"],
      message: "projected source object must be a commit",
    });
  }
  requireEqual(
    manifest.request_digest,
    manifest.source_observation.request_digest,
    ["source_observation", "request_digest"],
    context
  );
  requireEqual(
    manifest.request_digest,
    manifest.path_mapping.request_digest,
    ["path_mapping", "request_digest"],
    context
  );
  requireEqual(
    manifest.source_observation.observation_digest,
    manifest.path_mapping.roots.wsl_source.observation_digest,
    ["path_mapping", "roots", "wsl_source", "observation_digest"],
    context
  );
  requireEqual(
    manifest.native_repository.path,
    manifest.path_mapping.roots.native_repository.path,
    ["path_mapping", "roots", "native_repository", "path"],
    context
  );
  requireEqual(
    manifest.native_worktree_root.path,
    manifest.path_mapping.roots.native_worktree_root.path,
    ["path_mapping", "roots", "native_worktree_root", "path"],
    context
  );
  requireIdentity(
    manifest.native_repository.directory_identity,
    manifest.path_mapping.roots.native_repository.directory_identity,
    ["path_mapping", "roots", "native_repository", "directory_identity"],
    context
  );
  requireIdentity(
    manifest.native_worktree_root.directory_identity,
    manifest.path_mapping.roots.native_worktree_root.directory_identity,
    ["path_mapping", "roots", "native_worktree_root", "directory_identity"],
    context
  );
}

const ExecutionPathMappingShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  projection_id: BoundedIdentifier,
  repository_id: BoundedIdentifier,
  base_sha: CanonicalGitObjectId,
  native_host_id: BoundedIdentifier,
  request_digest: SHA256Hash,
  projection_digest: SHA256Hash,
  projection_mapping_digest: SHA256Hash,
  roots: boundedStrictObject({
    windows_source: DeclaredWindowsRoot,
    wsl_source: ObservedWslRoot,
    native_repository: VerifiedNativeRoot,
    native_allocation_root: VerifiedNativeRoot,
    native_worktree: VerifiedNativeRoot,
  }),
} as const;
const ExecutionPathMappingBody = boundedStrictObject(ExecutionPathMappingShape).superRefine(
  requireValidExecutionPathMapping
);

export const NativeWslExecutionPathMapping_v1 = boundedStrictObject({
  ...ExecutionPathMappingShape,
  mapping_digest: SHA256Hash,
})
  .superRefine(requireValidExecutionPathMapping)
  .superRefine((mapping, context) => {
    const { mapping_digest: _MappingDigest, ...hashable } = mapping;
    requireDigest(
      mapping.mapping_digest,
      projectionHash("execution-path-mapping", hashable),
      "mapping_digest",
      context
    );
  });
export type NativeWslExecutionPathMapping_v1 = z.infer<typeof NativeWslExecutionPathMapping_v1>;

export function createNativeWslExecutionPathMapping(
  input: z.input<z.ZodObject<typeof ExecutionPathMappingShape>>
): NativeWslExecutionPathMapping_v1 {
  const body = ExecutionPathMappingBody.parse(input);
  return NativeWslExecutionPathMapping_v1.parse({
    ...body,
    mapping_digest: projectionHash("execution-path-mapping", body),
  });
}

const NativeExecutionPathMappingShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  mapping_kind: z.literal("native_linux"),
  repository_id: BoundedIdentifier,
  base_sha: CanonicalGitObjectId,
  native_host_id: BoundedIdentifier,
  git_runtime: BoundedRuntime,
  roots: boundedStrictObject({
    native_repository: VerifiedNativeRoot,
    native_allocation_root: VerifiedNativeRoot,
    native_worktree: VerifiedNativeRoot,
  }),
} as const;
const NativeExecutionPathMappingBody = boundedStrictObject(
  NativeExecutionPathMappingShape
).superRefine(requireValidNativeExecutionPathMapping);

export const NativeExecutionPathMapping_v1 = boundedStrictObject({
  ...NativeExecutionPathMappingShape,
  mapping_digest: SHA256Hash,
})
  .superRefine(requireValidNativeExecutionPathMapping)
  .superRefine((mapping, context) => {
    const { mapping_digest: _mappingDigest, ...hashable } = mapping;
    requireDigest(
      mapping.mapping_digest,
      projectionHash("native-execution-path-mapping", hashable),
      "mapping_digest",
      context
    );
  });
export type NativeExecutionPathMapping_v1 = z.infer<typeof NativeExecutionPathMapping_v1>;

export function createNativeExecutionPathMapping(
  input: z.input<z.ZodObject<typeof NativeExecutionPathMappingShape>>
): NativeExecutionPathMapping_v1 {
  const body = NativeExecutionPathMappingBody.parse(input);
  return NativeExecutionPathMapping_v1.parse({
    ...body,
    mapping_digest: projectionHash("native-execution-path-mapping", body),
  });
}

export const AgentExecutionPathMapping_v1 = z.union([
  NativeWslExecutionPathMapping_v1,
  NativeExecutionPathMapping_v1,
]);
export type AgentExecutionPathMapping_v1 = z.infer<typeof AgentExecutionPathMapping_v1>;

export interface AgentExecutionPathBindingContext {
  repositoryId: string;
  baseSha: string;
  hostId: string;
  gitRuntime: string;
  repositoryRoot: string;
  allocationRoot: string;
  worktreePath: string;
}

export type AgentExecutionPathBindingValidation =
  | {
      valid: true;
      kind: "native_wsl_projection" | "native_linux";
      mappingDigest: string;
    }
  | {
      valid: false;
      reason:
        | "mapping_count"
        | "repository_identity"
        | "base_identity"
        | "host_identity"
        | "runtime_identity"
        | "repository_path"
        | "allocation_path"
        | "worktree_path"
        | "directory_identity";
    };

/** Pure identity validation shared by durable lifecycle consumers. */
export function validateAgentExecutionPathBinding(
  mappings: readonly AgentExecutionPathMapping_v1[],
  context: AgentExecutionPathBindingContext
): AgentExecutionPathBindingValidation {
  if (mappings.length !== 1) return { valid: false, reason: "mapping_count" };
  const mapping = mappings[0]!;
  if (mapping.repository_id !== context.repositoryId) {
    return { valid: false, reason: "repository_identity" };
  }
  if (mapping.base_sha !== context.baseSha.toLowerCase()) {
    return { valid: false, reason: "base_identity" };
  }
  if (mapping.native_host_id !== context.hostId) {
    return { valid: false, reason: "host_identity" };
  }
  const runtime =
    "git_runtime" in mapping ? mapping.git_runtime : mapping.roots.native_repository.runtime_id;
  if (
    runtime !== context.gitRuntime ||
    mapping.roots.native_repository.runtime_id !== context.gitRuntime ||
    mapping.roots.native_allocation_root.runtime_id !== context.gitRuntime ||
    mapping.roots.native_worktree.runtime_id !== context.gitRuntime
  ) {
    return { valid: false, reason: "runtime_identity" };
  }
  if (mapping.roots.native_repository.path !== context.repositoryRoot) {
    return { valid: false, reason: "repository_path" };
  }
  if (mapping.roots.native_allocation_root.path !== context.allocationRoot) {
    return { valid: false, reason: "allocation_path" };
  }
  if (mapping.roots.native_worktree.path !== context.worktreePath) {
    return { valid: false, reason: "worktree_path" };
  }
  return {
    valid: true,
    kind: "projection_id" in mapping ? "native_wsl_projection" : "native_linux",
    mappingDigest: mapping.mapping_digest,
  };
}

export const NativeWslProjectionOutcome = z.enum(["prepared", "reused", "rejected", "quarantined"]);
export type NativeWslProjectionOutcome = z.infer<typeof NativeWslProjectionOutcome>;

export const NativeWslProjectionReasonCode = z.enum([
  "projection_prepared",
  "projection_reused",
  "source_dirty",
  "source_head_mismatch",
  "source_object_missing",
  "source_object_not_commit",
  "repository_identity_mismatch",
  "source_replaced",
  "native_state_stale",
  "native_state_conflict",
  "staging_interrupted",
  "concurrent_request",
  "cleanup_failed_quarantined",
  "unsupported_filesystem",
  "containment_unavailable",
  "operation_failed",
]);
export type NativeWslProjectionReasonCode = z.infer<typeof NativeWslProjectionReasonCode>;

const ProjectionReceiptShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  request_id: BoundedIdentifier,
  request_digest: SHA256Hash,
  outcome: NativeWslProjectionOutcome,
  reason_code: NativeWslProjectionReasonCode,
  source_observation_digest: SHA256Hash.optional(),
  projection_digest: SHA256Hash.optional(),
  mapping_digest: SHA256Hash.optional(),
  completed_at: Timestamp,
} as const;
const ProjectionReceiptBody = boundedStrictObject(ProjectionReceiptShape).superRefine(
  requireValidProjectionReceipt
);

export const NativeWslProjectionReceipt_v1 = boundedStrictObject({
  ...ProjectionReceiptShape,
  receipt_digest: SHA256Hash,
})
  .superRefine(requireValidProjectionReceipt)
  .superRefine((receipt, context) => {
    const { receipt_digest: _receiptDigest, ...hashable } = receipt;
    requireDigest(
      receipt.receipt_digest,
      projectionHash("receipt", hashable),
      "receipt_digest",
      context
    );
  });
export type NativeWslProjectionReceipt_v1 = z.infer<typeof NativeWslProjectionReceipt_v1>;

export function createNativeWslProjectionReceipt(
  input: z.input<z.ZodObject<typeof ProjectionReceiptShape>>
): NativeWslProjectionReceipt_v1 {
  const body = ProjectionReceiptBody.parse(input);
  return NativeWslProjectionReceipt_v1.parse({
    ...body,
    receipt_digest: projectionHash("receipt", body),
  });
}

const ProjectionSelectionShape = {
  schema_version: z.literal(NATIVE_WSL_PROJECTION_CONTRACT_VERSION),
  manifest_digest: SHA256Hash,
  receipt: NativeWslProjectionReceipt_v1,
  source_observation: NativeWslSourceObservation_v1,
} as const;
const ProjectionSelectionBody = boundedStrictObject(ProjectionSelectionShape).superRefine(
  requireValidProjectionSelection
);

/**
 * Engine-authored current selection authority. Its public digest is only an
 * integrity identifier; provenance comes from the identity-anchored engine
 * record that launch preparation resolves.
 */
export const NativeWslProjectionSelection_v1 = boundedStrictObject({
  ...ProjectionSelectionShape,
  selection_digest: SHA256Hash,
})
  .superRefine(requireValidProjectionSelection)
  .superRefine((selection, context) => {
    const { selection_digest: _selectionDigest, ...hashable } = selection;
    requireDigest(
      selection.selection_digest,
      projectionHash("selection-authority", hashable),
      "selection_digest",
      context
    );
  });
export type NativeWslProjectionSelection_v1 = z.infer<typeof NativeWslProjectionSelection_v1>;

export function createNativeWslProjectionSelection(
  input: z.input<z.ZodObject<typeof ProjectionSelectionShape>>
): NativeWslProjectionSelection_v1 {
  const body = ProjectionSelectionBody.parse(input);
  return NativeWslProjectionSelection_v1.parse({
    ...body,
    selection_digest: projectionHash("selection-authority", body),
  });
}

function requireValidProjectionReceipt(
  receipt: z.output<z.ZodObject<typeof ProjectionReceiptShape>>,
  context: z.RefinementCtx
): void {
  const selected = receipt.outcome === "prepared" || receipt.outcome === "reused";
  const selectionFields = [receipt.projection_digest, receipt.mapping_digest];
  const hasAllSelectionFields = selectionFields.every((value) => value !== undefined);
  const hasAnySelectionField = selectionFields.some((value) => value !== undefined);
  if ((selected && !hasAllSelectionFields) || (!selected && hasAnySelectionField)) {
    context.addIssue({
      code: "custom",
      path: ["projection_digest"],
      message: "only selected outcomes may include both projection and mapping digests",
    });
  }
  if (selected && receipt.source_observation_digest === undefined) {
    context.addIssue({
      code: "custom",
      path: ["source_observation_digest"],
      message: "selected outcomes require a source observation digest",
    });
  }
  if ((receipt.outcome === "prepared") !== (receipt.reason_code === "projection_prepared")) {
    context.addIssue({
      code: "custom",
      path: ["reason_code"],
      message: "prepared outcome requires projection_prepared reason",
    });
  }
  if ((receipt.outcome === "reused") !== (receipt.reason_code === "projection_reused")) {
    context.addIssue({
      code: "custom",
      path: ["reason_code"],
      message: "reused outcome requires projection_reused reason",
    });
  }
}

function requireValidProjectionSelection(
  selection: z.output<z.ZodObject<typeof ProjectionSelectionShape>>,
  context: z.RefinementCtx
): void {
  const receipt = selection.receipt;
  if (receipt.outcome !== "prepared" && receipt.outcome !== "reused") {
    context.addIssue({
      code: "custom",
      path: ["receipt", "outcome"],
      message: "selection authority requires a successful projection receipt",
    });
  }
  if (receipt.source_observation_digest === undefined) {
    context.addIssue({
      code: "custom",
      path: ["receipt", "source_observation_digest"],
      message: "selection authority requires the source observation digest",
    });
  } else {
    requireEqual(
      receipt.source_observation_digest,
      selection.source_observation.observation_digest,
      ["receipt", "source_observation_digest"],
      context
    );
  }
  requireEqual(
    receipt.request_digest,
    selection.source_observation.request_digest,
    ["source_observation", "request_digest"],
    context
  );
  if (receipt.projection_digest === undefined) {
    context.addIssue({
      code: "custom",
      path: ["receipt", "projection_digest"],
      message: "selection authority requires the projection digest",
    });
  } else {
    requireEqual(
      receipt.projection_digest,
      selection.manifest_digest,
      ["receipt", "projection_digest"],
      context
    );
  }
}

export const NativeWslProjectionInventoryState = z.enum([
  "absent",
  "ready",
  "staging",
  "quarantined",
  "invalid",
  "interrupted",
  "conflicting",
]);
export type NativeWslProjectionInventoryState = z.infer<typeof NativeWslProjectionInventoryState>;

export const NativeWslProjectionPlanAction = z.enum([
  "prepare_staging",
  "reuse_ready",
  "wait_for_same_request",
  "quarantine_then_prepare",
  "cleanup_quarantine_then_prepare",
  "refuse_conflict",
]);
export type NativeWslProjectionPlanAction = z.infer<typeof NativeWslProjectionPlanAction>;

export const NativeWslProjectionPlanReason = z.enum([
  "projection_absent",
  "projection_exact_match",
  "projection_staging_same_request",
  "projection_staging_conflict",
  "projection_stale",
  "projection_quarantined",
  "projection_invalid",
  "projection_interrupted",
  "projection_conflicting",
]);
export type NativeWslProjectionPlanReason = z.infer<typeof NativeWslProjectionPlanReason>;

export function nativeWslProjectionId(requestDigest: string): string {
  const parsed = SHA256Hash.parse(requestDigest);
  return `native-wsl:${parsed.slice("sha256:".length)}`;
}

function projectionHash(domain: string, value: unknown): string {
  return computeCanonicalHash({
    contract: "lexrunner.native-wsl-projection",
    hash_profile: NATIVE_WSL_PROJECTION_HASH_PROFILE,
    schema_version: NATIVE_WSL_PROJECTION_CONTRACT_VERSION,
    domain,
    value,
  });
}

function closeJsonSchemaObjects<T>(schema: T): T {
  closeJsonSchemaNode(schema);
  return schema;
}

function closeJsonSchemaNode(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(closeJsonSchemaNode);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (node.type === "object" && node.properties !== undefined) {
    node.additionalProperties = false;
  }
  Object.values(node).forEach(closeJsonSchemaNode);
}

function requireSeparateRequestRoots(
  request: z.output<z.ZodObject<typeof ProjectionRequestShape>>,
  context: z.RefinementCtx
): void {
  if (linuxPathsOverlap(request.native.projection_root, request.native.worktree_root)) {
    context.addIssue({
      code: "custom",
      path: ["native", "worktree_root"],
      message: "native projection and worktree roots must not overlap",
    });
  }
  if (linuxPathsOverlap(request.source.wsl_repository_path, request.native.projection_root)) {
    context.addIssue({
      code: "custom",
      path: ["native", "projection_root"],
      message: "native projection root must not overlap the mapped source repository",
    });
  }
  if (linuxPathsOverlap(request.source.wsl_repository_path, request.native.worktree_root)) {
    context.addIssue({
      code: "custom",
      path: ["native", "worktree_root"],
      message: "native worktree root must not overlap the mapped source repository",
    });
  }
}

function requireValidProjectionPathMapping(
  mapping: z.output<z.ZodObject<typeof ProjectionPathMappingShape>>,
  context: z.RefinementCtx
): void {
  requireEqual(
    mapping.projection_id,
    nativeWslProjectionId(mapping.request_digest),
    ["projection_id"],
    context
  );
  if (
    linuxPathsOverlap(mapping.roots.native_repository.path, mapping.roots.native_worktree_root.path)
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_worktree_root", "path"],
      message: "native repository and worktree roots must not overlap",
    });
  }
}

function requireValidExecutionPathMapping(
  mapping: z.output<z.ZodObject<typeof ExecutionPathMappingShape>>,
  context: z.RefinementCtx
): void {
  requireEqual(
    mapping.projection_id,
    nativeWslProjectionId(mapping.request_digest),
    ["projection_id"],
    context
  );
  if (linuxPathsOverlap(mapping.roots.native_repository.path, mapping.roots.native_worktree.path)) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_worktree", "path"],
      message: "native worktree must not overlap the projected repository",
    });
  }
  if (
    linuxPathsOverlap(
      mapping.roots.native_repository.path,
      mapping.roots.native_allocation_root.path
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_allocation_root", "path"],
      message: "native allocation root must not overlap the projected repository",
    });
  }
  requireEqual(
    mapping.roots.native_repository.runtime_id,
    mapping.roots.native_allocation_root.runtime_id,
    ["roots", "native_allocation_root", "runtime_id"],
    context
  );
  requireEqual(
    mapping.roots.native_repository.runtime_id,
    mapping.roots.native_worktree.runtime_id,
    ["roots", "native_worktree", "runtime_id"],
    context
  );
  if (
    !linuxPathIsStrictDescendant(
      mapping.roots.native_worktree.path,
      mapping.roots.native_allocation_root.path
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_worktree", "path"],
      message: "native worktree must be strictly contained by its allocation root",
    });
  }
}

function requireValidNativeExecutionPathMapping(
  mapping: z.output<z.ZodObject<typeof NativeExecutionPathMappingShape>>,
  context: z.RefinementCtx
): void {
  for (const field of ["native_repository", "native_allocation_root", "native_worktree"] as const) {
    requireEqual(
      mapping.git_runtime,
      mapping.roots[field].runtime_id,
      ["roots", field, "runtime_id"],
      context
    );
  }
  if (linuxPathsOverlap(mapping.roots.native_repository.path, mapping.roots.native_worktree.path)) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_worktree", "path"],
      message: "native worktree must not overlap the native repository",
    });
  }
  if (
    linuxPathsOverlap(
      mapping.roots.native_repository.path,
      mapping.roots.native_allocation_root.path
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_allocation_root", "path"],
      message: "native allocation root must not overlap the native repository",
    });
  }
  if (
    !linuxPathIsStrictDescendant(
      mapping.roots.native_worktree.path,
      mapping.roots.native_allocation_root.path
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["roots", "native_worktree", "path"],
      message: "native worktree must be strictly contained by its allocation root",
    });
  }
}

function requireDigest(
  actual: string,
  expected: string,
  field: string,
  context: z.RefinementCtx
): void {
  if (actual === expected) return;
  context.addIssue({
    code: "custom",
    path: [field],
    message: `${field} does not match canonical projection content`,
  });
}

function requireEqual(
  left: string,
  right: string,
  issuePath: PropertyKey[],
  context: z.RefinementCtx
): void {
  if (left === right) return;
  context.addIssue({
    code: "custom",
    path: issuePath,
    message: "projection identity binding does not match",
  });
}

function requireIdentity(
  left: NativeDirectoryIdentityClaim_v1,
  right: NativeDirectoryIdentityClaim_v1,
  issuePath: PropertyKey[],
  context: z.RefinementCtx
): void {
  if (left.device === right.device && left.inode === right.inode) return;
  context.addIssue({
    code: "custom",
    path: issuePath,
    message: "directory identity binding does not match",
  });
}

function linuxPathsOverlap(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const segments = value.split("/").filter(Boolean);
    return `/${segments.join("/")}`;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft === "/" || normalizedRight === "/") {
    return true;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function linuxPathIsStrictDescendant(candidate: string, root: string): boolean {
  if (candidate === root || root === "/") return root === "/" && candidate !== "/";
  return candidate.startsWith(`${root}/`);
}
