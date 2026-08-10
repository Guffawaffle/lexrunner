import { createHash } from "node:crypto";

import { z } from "zod";

import { computeCanonicalHash, SHA256Hash } from "../schemas/task-contract.js";

export const GOVERNED_REPOSITORY_CORPUS_VERSION = "1.0.0" as const;
export const MAX_REPOSITORY_CORPUS_HEADER_BYTES = 2 * 1_024 * 1_024;
export const MAX_REPOSITORY_CORPUS_FILE_BYTES = 4 * 1_024 * 1_024;
export const MAX_REPOSITORY_CORPUS_TREE_BYTES = 32 * 1_024 * 1_024;
export const MAX_REPOSITORY_CORPUS_PATCH_BYTES = 8 * 1_024 * 1_024;
export const MAX_REPOSITORY_CORPUS_FILES = 4_096;
export const MAX_REPOSITORY_CORPUS_FRAME_BYTES =
  4 +
  MAX_REPOSITORY_CORPUS_HEADER_BYTES +
  MAX_REPOSITORY_CORPUS_TREE_BYTES +
  MAX_REPOSITORY_CORPUS_PATCH_BYTES;

const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "Must be an opaque identifier");
const gitObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const boundedString = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes("\0"));
const linuxAbsolutePath = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
  .refine((value) => !value.split("/").some((segment) => segment === "." || segment === ".."));
const directoryIdentity = z
  .object({
    device: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    inode: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
  })
  .strict();
const corpusPath = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("\\") && !value.includes("\0"), {
    message: "Corpus paths must use non-NUL POSIX separators",
  })
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value
        .split("/")
        .some((segment) => segment.length === 0 || segment === "." || segment === ".."),
    { message: "Corpus paths must be canonical repository-relative paths" }
  )
  .refine((value) => !value.split("/").some((segment) => segment.toLowerCase() === ".git"), {
    message: "Corpus paths must not expose Git administrative state",
  });

export const GovernedRepositoryCorpusSourceBinding_v1 = z
  .object({
    attempt_id: opaqueId,
    workspace_lease_id: opaqueId,
    task_packet_hash: SHA256Hash,
    launch_envelope_hash: SHA256Hash,
    path_mapping_hash: SHA256Hash,
  })
  .strict();
export type GovernedRepositoryCorpusSourceBinding_v1 = z.infer<
  typeof GovernedRepositoryCorpusSourceBinding_v1
>;

export const GovernedRepositoryCorpusExportRequest_v1 = z
  .object({
    schema_version: z.literal(GOVERNED_REPOSITORY_CORPUS_VERSION),
    environment_id: opaqueId,
    repository_id: opaqueId,
    attempt_id: opaqueId,
    workspace_lease_id: opaqueId,
    task_packet_hash: SHA256Hash,
    launch_envelope_hash: SHA256Hash,
    path_mapping_hash: SHA256Hash,
    base_object_id: gitObjectId,
    host_id: boundedString,
    git_runtime: boundedString,
    branch: boundedString,
    repository_root: linuxAbsolutePath,
    allocation_root: linuxAbsolutePath,
    worktree_root: linuxAbsolutePath,
    directory_identities: z
      .object({
        repository: directoryIdentity,
        allocation: directoryIdentity,
        worktree: directoryIdentity,
      })
      .strict(),
  })
  .strict();
export type GovernedRepositoryCorpusExportRequest_v1 = z.infer<
  typeof GovernedRepositoryCorpusExportRequest_v1
>;

export const GovernedRepositoryCorpusEntry_v1 = z
  .object({
    path: corpusPath,
    byte_length: z.number().int().nonnegative().max(MAX_REPOSITORY_CORPUS_FILE_BYTES),
    content_hash: SHA256Hash,
    executable: z.boolean(),
  })
  .strict();
export type GovernedRepositoryCorpusEntry_v1 = z.infer<typeof GovernedRepositoryCorpusEntry_v1>;

const repositoryCorpusHeaderBody = z
  .object({
    schema_version: z.literal(GOVERNED_REPOSITORY_CORPUS_VERSION),
    environment_id: opaqueId,
    repository_id: opaqueId,
    base_object_id: gitObjectId,
    candidate_object_id: gitObjectId,
    source_binding: GovernedRepositoryCorpusSourceBinding_v1,
    source_binding_hash: SHA256Hash,
    entries: z.array(GovernedRepositoryCorpusEntry_v1).min(1).max(MAX_REPOSITORY_CORPUS_FILES),
    candidate_tree_bytes: z.number().int().positive().max(MAX_REPOSITORY_CORPUS_TREE_BYTES),
    candidate_tree_hash: SHA256Hash,
    patch_bytes: z.number().int().positive().max(MAX_REPOSITORY_CORPUS_PATCH_BYTES),
    patch_hash: SHA256Hash,
    selection_hash: SHA256Hash,
    corpus_hash: SHA256Hash,
  })
  .strict();

export const GovernedRepositoryCorpusHeader_v1 = repositoryCorpusHeaderBody.superRefine(
  (value, context) => {
    const paths = value.entries.map((entry) => entry.path);
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path, index) => index > 0 && path <= paths[index - 1]!)
    ) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "Corpus entries must have unique strictly sorted paths",
      });
    }
    const treeBytes = value.entries.reduce((total, entry) => total + entry.byte_length, 0);
    if (treeBytes !== value.candidate_tree_bytes) {
      context.addIssue({
        code: "custom",
        path: ["candidate_tree_bytes"],
        message: "Candidate byte count does not match its entries",
      });
    }
    const expected = computeGovernedRepositoryCorpusHashes({
      repositoryId: value.repository_id,
      baseObjectId: value.base_object_id,
      candidateObjectId: value.candidate_object_id,
      sourceBinding: value.source_binding,
      entries: value.entries,
      patchHash: value.patch_hash,
    });
    for (const [field, actual] of [
      ["source_binding_hash", value.source_binding_hash],
      ["candidate_tree_hash", value.candidate_tree_hash],
      ["selection_hash", value.selection_hash],
      ["corpus_hash", value.corpus_hash],
    ] as const) {
      if (actual !== expected[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} does not match the canonical repository corpus`,
        });
      }
    }
    if (value.base_object_id === value.candidate_object_id) {
      context.addIssue({
        code: "custom",
        path: ["candidate_object_id"],
        message: "Repository review candidate must differ from its base",
      });
    }
  }
);
export type GovernedRepositoryCorpusHeader_v1 = z.infer<typeof GovernedRepositoryCorpusHeader_v1>;

export interface GovernedRepositoryCorpusFrame {
  header: GovernedRepositoryCorpusHeader_v1;
  files: readonly Uint8Array[];
  patch: Uint8Array;
  bytes: Uint8Array;
}

export function computeGovernedRepositoryCorpusHashes(input: {
  repositoryId: string;
  baseObjectId: string;
  candidateObjectId: string;
  sourceBinding: GovernedRepositoryCorpusSourceBinding_v1;
  entries: readonly GovernedRepositoryCorpusEntry_v1[];
  patchHash: string;
}): Pick<
  GovernedRepositoryCorpusHeader_v1,
  "source_binding_hash" | "candidate_tree_hash" | "selection_hash" | "corpus_hash"
> {
  const sourceBindingHash = computeCanonicalHash(input.sourceBinding);
  const candidateTreeHash = computeCanonicalHash({
    kind: "governed-repository-candidate-tree-v1",
    entries: input.entries,
  });
  const selectionHash = computeCanonicalHash({
    kind: "governed-repository-selection-v1",
    repository_id: input.repositoryId,
    base_object_id: input.baseObjectId,
    candidate_object_id: input.candidateObjectId,
    paths: input.entries.map((entry) => entry.path),
  });
  const corpusHash = computeCanonicalHash({
    kind: "governed-repository-corpus-v1",
    source_binding_hash: sourceBindingHash,
    candidate_tree_hash: candidateTreeHash,
    patch_hash: input.patchHash,
    selection_hash: selectionHash,
  });
  return {
    source_binding_hash: sourceBindingHash,
    candidate_tree_hash: candidateTreeHash,
    selection_hash: selectionHash,
    corpus_hash: corpusHash,
  };
}

/** Parse and re-hash every byte before a corpus frame may cross into the provider. */
export function parseGovernedRepositoryCorpusFrame(
  candidate: Uint8Array
): GovernedRepositoryCorpusFrame {
  const bytes = Buffer.from(candidate);
  if (bytes.byteLength < 5 || bytes.byteLength > MAX_REPOSITORY_CORPUS_FRAME_BYTES) {
    throw new Error("Repository corpus frame is outside its bound");
  }
  const headerLength = bytes.readUInt32BE(0);
  if (headerLength === 0 || headerLength > MAX_REPOSITORY_CORPUS_HEADER_BYTES) {
    throw new Error("Repository corpus header is outside its bound");
  }
  const payloadStart = 4 + headerLength;
  if (payloadStart >= bytes.byteLength) throw new Error("Repository corpus frame is truncated");
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.subarray(4, payloadStart).toString("utf8")) as unknown;
  } catch {
    throw new Error("Repository corpus header is not valid JSON");
  }
  const header = GovernedRepositoryCorpusHeader_v1.parse(decoded);
  const expectedBytes = header.candidate_tree_bytes + header.patch_bytes;
  if (bytes.byteLength - payloadStart !== expectedBytes) {
    throw new Error("Repository corpus payload length does not match its header");
  }
  const files: Uint8Array[] = [];
  let offset = payloadStart;
  for (const entry of header.entries) {
    const content = bytes.subarray(offset, offset + entry.byte_length);
    if (contentHash(content) !== entry.content_hash) {
      throw new Error(`Repository corpus content hash mismatch for ${entry.path}`);
    }
    files.push(Uint8Array.from(content));
    offset += entry.byte_length;
  }
  const patch = bytes.subarray(offset);
  if (patch.byteLength !== header.patch_bytes || contentHash(patch) !== header.patch_hash) {
    throw new Error("Repository corpus patch hash mismatch");
  }
  return {
    header,
    files,
    patch: Uint8Array.from(patch),
    bytes: Uint8Array.from(bytes),
  };
}

export function contentHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
