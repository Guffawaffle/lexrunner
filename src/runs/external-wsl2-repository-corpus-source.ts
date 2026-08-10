import { z } from "zod";

import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { NativeWsl2CodexProviderTransport } from "./external-wsl2-codex-provider-bridge.js";
import {
  GOVERNED_REPOSITORY_CORPUS_VERSION,
  GovernedRepositoryCorpusExportRequest_v1,
  MAX_REPOSITORY_CORPUS_FRAME_BYTES,
  parseGovernedRepositoryCorpusFrame,
  type GovernedRepositoryCorpusExportRequest_v1 as GovernedRepositoryCorpusExportRequest,
  type GovernedRepositoryCorpusFrame,
} from "./governed-review-repository-corpus.js";
import type { Wsl2CodexProviderTransport } from "./external-wsl2-codex-provider-bridge.js";

const linuxExecutable = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u, "Exporter path must be absolute");

export interface GovernedRepositoryCorpusSource {
  export(request: GovernedRepositoryCorpusExportRequest): Promise<GovernedRepositoryCorpusFrame>;
}

export interface ExternalWsl2RepositoryCorpusSourceOptions {
  distribution: string;
  exporterExecutable?: string;
  exporterUser?: string;
  transport?: Wsl2CodexProviderTransport;
}

/**
 * Runs one root-owned, fixed-argv exporter in the same disposable distribution
 * as the provider. Repository paths and identities remain inside its bounded
 * canonical stdin request; only the credential-free corpus frame is returned.
 */
export class ExternalWsl2RepositoryCorpusSource implements GovernedRepositoryCorpusSource {
  private readonly transport: Wsl2CodexProviderTransport;

  constructor(options: ExternalWsl2RepositoryCorpusSourceOptions) {
    const executable = linuxExecutable.parse(
      options.exporterExecutable ?? "/opt/lexrunner/bin/governed-repository-corpus-exporter"
    );
    this.transport =
      options.transport ??
      new NativeWsl2CodexProviderTransport(
        options.distribution,
        executable,
        options.exporterUser ?? "root"
      );
  }

  async export(
    input: GovernedRepositoryCorpusExportRequest
  ): Promise<GovernedRepositoryCorpusFrame> {
    const request = GovernedRepositoryCorpusExportRequest_v1.parse(input);
    const output = await this.transport.request({
      args: [],
      stdin: Buffer.from(`${canonicalJSONStringify(request)}\n`, "utf8"),
      maxOutputBytes: MAX_REPOSITORY_CORPUS_FRAME_BYTES,
    });
    const frame = parseGovernedRepositoryCorpusFrame(output);
    const header = frame.header;
    if (
      header.schema_version !== GOVERNED_REPOSITORY_CORPUS_VERSION ||
      header.environment_id !== request.environment_id ||
      header.repository_id !== request.repository_id ||
      header.base_object_id !== request.base_object_id ||
      header.source_binding.attempt_id !== request.attempt_id ||
      header.source_binding.workspace_lease_id !== request.workspace_lease_id ||
      header.source_binding.task_packet_hash !== request.task_packet_hash ||
      header.source_binding.launch_envelope_hash !== request.launch_envelope_hash ||
      header.source_binding.path_mapping_hash !== request.path_mapping_hash
    ) {
      throw new Error("Repository corpus exporter returned a mismatched lifecycle binding");
    }
    return frame;
  }
}
