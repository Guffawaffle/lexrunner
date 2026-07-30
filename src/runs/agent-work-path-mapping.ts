import {
  NativeWslProjectionManifest_v1,
  NativeWslProjectionReceipt_v1,
  createNativeExecutionPathMapping,
  createNativeWslExecutionPathMapping,
  validateAgentExecutionPathBinding,
  type AgentExecutionPathBindingContext,
  type AgentExecutionPathBindingValidation,
  type AgentExecutionPathMapping_v1,
  type NativeDirectoryIdentityClaim_v1,
  type NativeWslProjectionManifest_v1 as NativeWslProjectionManifest,
  type NativeWslProjectionReceipt_v1 as NativeWslProjectionReceipt,
} from "../schemas/agent-work-projection.js";
import {
  captureDirectoryIdentity,
  type DirectoryIdentity,
} from "../workspaces/linux-directory-identity.js";

export interface NativeWslProjectionLaunchSelection {
  manifest: NativeWslProjectionManifest;
  receipt: NativeWslProjectionReceipt;
}

export interface CreateAttemptExecutionPathMappingInput extends AgentExecutionPathBindingContext {
  projection?: NativeWslProjectionLaunchSelection;
}

/** Construct one identity-bound mapping from verified broker/projection evidence. */
export function createAttemptExecutionPathMapping(
  input: CreateAttemptExecutionPathMappingInput
): AgentExecutionPathMapping_v1 {
  const identities = captureBoundIdentities(input);
  if (!input.projection) {
    return createNativeExecutionPathMapping({
      schema_version: "1.0.0",
      mapping_kind: "native_linux",
      repository_id: input.repositoryId,
      base_sha: input.baseSha.toLowerCase(),
      native_host_id: input.hostId,
      git_runtime: input.gitRuntime,
      roots: {
        native_repository: verifiedRoot(
          input.gitRuntime,
          input.repositoryRoot,
          identities.repository
        ),
        native_allocation_root: verifiedRoot(
          input.gitRuntime,
          input.allocationRoot,
          identities.allocation
        ),
        native_worktree: verifiedRoot(input.gitRuntime, input.worktreePath, identities.worktree),
      },
    });
  }

  const manifest = NativeWslProjectionManifest_v1.parse(input.projection.manifest);
  const receipt = NativeWslProjectionReceipt_v1.parse(input.projection.receipt);
  assertSelectedProjection(manifest, receipt, input, identities);
  return createNativeWslExecutionPathMapping({
    schema_version: "1.0.0",
    projection_id: manifest.projection_id,
    repository_id: manifest.repository_id,
    base_sha: manifest.base_sha,
    native_host_id: manifest.native_host_id,
    request_digest: manifest.request_digest,
    projection_digest: manifest.manifest_digest,
    projection_mapping_digest: manifest.path_mapping.mapping_digest,
    roots: {
      windows_source: manifest.path_mapping.roots.windows_source,
      wsl_source: manifest.path_mapping.roots.wsl_source,
      native_repository: manifest.path_mapping.roots.native_repository,
      native_allocation_root: manifest.path_mapping.roots.native_worktree_root,
      native_worktree: verifiedRoot(input.gitRuntime, input.worktreePath, identities.worktree),
    },
  });
}

/** Revalidate claims and live native directory identities at each authority boundary. */
export function verifyAttemptExecutionPathMapping(
  mappings: readonly AgentExecutionPathMapping_v1[],
  context: AgentExecutionPathBindingContext
): AgentExecutionPathBindingValidation {
  const binding = validateAgentExecutionPathBinding(mappings, context);
  if (!binding.valid) return binding;
  const mapping = mappings[0]!;
  try {
    const identities = captureBoundIdentities(context);
    if (
      !matchesClaim(identities.repository, mapping.roots.native_repository.directory_identity) ||
      !matchesClaim(
        identities.allocation,
        mapping.roots.native_allocation_root.directory_identity
      ) ||
      !matchesClaim(identities.worktree, mapping.roots.native_worktree.directory_identity)
    ) {
      return { valid: false, reason: "directory_identity" };
    }
    return binding;
  } catch {
    return { valid: false, reason: "directory_identity" };
  }
}

function assertSelectedProjection(
  manifest: NativeWslProjectionManifest,
  receipt: NativeWslProjectionReceipt,
  input: AgentExecutionPathBindingContext,
  identities: BoundDirectoryIdentities
): void {
  if (
    (receipt.outcome !== "prepared" && receipt.outcome !== "reused") ||
    receipt.request_digest !== manifest.request_digest ||
    (receipt.outcome === "prepared" &&
      receipt.source_observation_digest !== manifest.source_observation.observation_digest) ||
    receipt.projection_digest !== manifest.manifest_digest ||
    receipt.mapping_digest !== manifest.path_mapping.mapping_digest
  ) {
    throw new Error("Projection selection evidence does not identify a prepared mapping");
  }
  if (
    manifest.repository_id !== input.repositoryId ||
    manifest.base_sha !== input.baseSha.toLowerCase() ||
    manifest.native_host_id !== input.hostId ||
    manifest.path_mapping.roots.native_repository.runtime_id !== input.gitRuntime ||
    manifest.path_mapping.roots.native_worktree_root.runtime_id !== input.gitRuntime ||
    manifest.native_repository.path !== input.repositoryRoot ||
    manifest.native_worktree_root.path !== input.allocationRoot
  ) {
    throw new Error("Projection selection does not match the launch runtime");
  }
  if (
    !matchesClaim(identities.repository, manifest.native_repository.directory_identity) ||
    !matchesClaim(identities.allocation, manifest.native_worktree_root.directory_identity)
  ) {
    throw new Error("Projection selection directory identity changed before launch");
  }
}

interface BoundDirectoryIdentities {
  repository: DirectoryIdentity;
  allocation: DirectoryIdentity;
  worktree: DirectoryIdentity;
}

function captureBoundIdentities(
  input: Pick<
    AgentExecutionPathBindingContext,
    "repositoryRoot" | "allocationRoot" | "worktreePath"
  >
): BoundDirectoryIdentities {
  return {
    repository: captureDirectoryIdentity(input.repositoryRoot, "execution mapping repository"),
    allocation: captureDirectoryIdentity(input.allocationRoot, "execution mapping allocation root"),
    worktree: captureDirectoryIdentity(input.worktreePath, "execution mapping worktree"),
  };
}

function verifiedRoot(runtimeId: string, path: string, identity: DirectoryIdentity) {
  return {
    runtime_id: runtimeId,
    path,
    verification: "directory_identity" as const,
    directory_identity: identityClaim(identity),
  };
}

function identityClaim(identity: DirectoryIdentity): NativeDirectoryIdentityClaim_v1 {
  return {
    device: identity.device.toString(10),
    inode: identity.inode.toString(10),
  };
}

function matchesClaim(
  identity: DirectoryIdentity,
  claim: NativeDirectoryIdentityClaim_v1
): boolean {
  return (
    identity.device.toString(10) === claim.device && identity.inode.toString(10) === claim.inode
  );
}
