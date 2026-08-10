import { describe, expect, it } from "vitest";

import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
import { ExternalWsl2RepositoryCorpusSource } from "../../src/runs/external-wsl2-repository-corpus-source.js";
import {
  computeGovernedRepositoryCorpusHashes,
  contentHash,
  parseGovernedRepositoryCorpusFrame,
  type GovernedRepositoryCorpusExportRequest_v1,
  type GovernedRepositoryCorpusHeader_v1,
} from "../../src/runs/governed-review-repository-corpus.js";
import type { Wsl2CodexProviderTransport } from "../../src/runs/external-wsl2-codex-provider-bridge.js";

const hash = (value: string) => computeCanonicalHash({ value });

describe("governed repository corpus", () => {
  it("parses and re-hashes every candidate and patch byte", () => {
    const frame = corpusFrame();
    const parsed = parseGovernedRepositoryCorpusFrame(frame);
    expect(parsed.header.candidate_object_id).toBe("2".repeat(40));
    expect(Buffer.from(parsed.files[0]!)).toEqual(Buffer.from("alpha\n"));
    expect(Buffer.from(parsed.patch)).toEqual(Buffer.from("diff --git a/a.txt b/a.txt\n"));

    const tampered = Buffer.from(frame);
    tampered[tampered.length - 1] ^= 1;
    expect(() => parseGovernedRepositoryCorpusFrame(tampered)).toThrow("patch hash mismatch");
  });

  it("rejects a valid frame when the exporter lifecycle identity differs", async () => {
    const transport = new CorpusTransport(corpusFrame());
    const source = new ExternalWsl2RepositoryCorpusSource({
      distribution: "lexrunner-attempt-deadbeef",
      transport,
    });
    await expect(
      source.export({ ...exportRequest(), attempt_id: "attempt-other" })
    ).rejects.toThrow("mismatched lifecycle binding");
    expect(transport.requestInput?.args).toEqual([]);
    expect(JSON.parse(Buffer.from(transport.requestInput!.stdin!).toString("utf8"))).toMatchObject({
      attempt_id: "attempt-other",
      worktree_root: "/srv/lexrunner/worktrees/attempt-1",
    });
  });
});

class CorpusTransport implements Wsl2CodexProviderTransport {
  requestInput?: Parameters<Wsl2CodexProviderTransport["request"]>[0];

  constructor(private readonly frame: Uint8Array) {}

  async request(input: Parameters<Wsl2CodexProviderTransport["request"]>[0]): Promise<Uint8Array> {
    this.requestInput = input;
    return Uint8Array.from(this.frame);
  }

  async *stream(): AsyncIterable<Uint8Array> {
    yield* [];
  }
}

function exportRequest(): GovernedRepositoryCorpusExportRequest_v1 {
  return {
    schema_version: "1.0.0",
    environment_id: "environment-1",
    repository_id: "repository-1",
    attempt_id: "attempt-1",
    workspace_lease_id: "lease-1",
    task_packet_hash: hash("packet"),
    launch_envelope_hash: hash("envelope"),
    path_mapping_hash: hash("mapping"),
    base_object_id: "1".repeat(40),
    host_id: "host-1",
    git_runtime: "wsl-ubuntu-git",
    branch: "agent/attempt-1",
    repository_root: "/srv/lexrunner/repository",
    allocation_root: "/srv/lexrunner/worktrees",
    worktree_root: "/srv/lexrunner/worktrees/attempt-1",
    directory_identities: {
      repository: { device: "1", inode: "2" },
      allocation: { device: "1", inode: "3" },
      worktree: { device: "1", inode: "4" },
    },
  };
}

function corpusFrame(): Buffer {
  const file = Buffer.from("alpha\n");
  const patch = Buffer.from("diff --git a/a.txt b/a.txt\n");
  const sourceBinding = {
    attempt_id: "attempt-1",
    workspace_lease_id: "lease-1",
    task_packet_hash: hash("packet"),
    launch_envelope_hash: hash("envelope"),
    path_mapping_hash: hash("mapping"),
  };
  const entries = [
    {
      path: "a.txt",
      byte_length: file.byteLength,
      content_hash: contentHash(file),
      executable: false,
    },
  ];
  const hashes = computeGovernedRepositoryCorpusHashes({
    repositoryId: "repository-1",
    baseObjectId: "1".repeat(40),
    candidateObjectId: "2".repeat(40),
    sourceBinding,
    entries,
    patchHash: contentHash(patch),
  });
  const header: GovernedRepositoryCorpusHeader_v1 = {
    schema_version: "1.0.0",
    environment_id: "environment-1",
    repository_id: "repository-1",
    base_object_id: "1".repeat(40),
    candidate_object_id: "2".repeat(40),
    source_binding: sourceBinding,
    entries,
    candidate_tree_bytes: file.byteLength,
    patch_bytes: patch.byteLength,
    patch_hash: contentHash(patch),
    ...hashes,
  };
  const encoded = Buffer.from(canonicalJSONStringify(header), "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(encoded.byteLength);
  return Buffer.concat([prefix, encoded, file, patch]);
}
