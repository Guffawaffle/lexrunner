import { spawn } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  EnvironmentAttestation_v1,
  ExecutorAttestation_v1,
  GovernedTaskOutcome_v1,
  WorkspaceAttestation_v1,
  type AttemptAuthorization_v1,
  type ExecutorAttestation_v1 as ExecutorAttestation,
} from "./governed-attempt-executor.js";
import {
  QualifiedCodexProviderEmission_v1,
  QualifiedCodexProviderStreamError,
  type QualifiedCodexProviderAttestations,
  type QualifiedCodexProviderBridge,
  type QualifiedCodexProviderClaim,
  type QualifiedCodexProviderEmission_v1 as QualifiedCodexProviderEmission,
  type QualifiedCodexProviderLaunchReceipt,
  QualifiedCodexLaunchInputBinding_v1,
  QualifiedCodexSyntheticPreparation_v1,
} from "./qualified-wsl2-codex-executor.js";
import {
  MAX_REPOSITORY_CORPUS_FRAME_BYTES,
  parseGovernedRepositoryCorpusFrame,
  type GovernedRepositoryCorpusFrame,
} from "./governed-review-repository-corpus.js";

const MAX_CONTROL_BYTES = 256 * 1_024;
const MAX_STREAM_LINE_BYTES = 1 * 1_024 * 1_024;
const CONTROL_TIMEOUT_MS = 30_000;
const disposableDistribution = z
  .string()
  .regex(/^lexrunner-attempt-[0-9a-f]{8,64}$/u, "A disposable LexRunner distribution is required");
const linuxExecutable = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u, "Provider path must be absolute");
const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export interface Wsl2CodexProviderTransport {
  request(input: {
    args: readonly string[];
    stdin?: Uint8Array;
    maxOutputBytes: number;
  }): Promise<Uint8Array>;
  stream(input: {
    args: readonly string[];
    signal?: AbortSignal;
    maxLineBytes: number;
  }): AsyncIterable<Uint8Array>;
}

export interface ExternalWsl2CodexProviderBridgeOptions {
  distribution: string;
  providerExecutable?: string;
  providerUser?: string;
  transport?: Wsl2CodexProviderTransport;
}

/**
 * Host-side protocol adapter for a trusted provider executable inside one
 * disposable WSL2 distribution. It never invokes a shell and never places a
 * prompt, output schema, authorization, or credential material in argv.
 */
export class ExternalWsl2CodexProviderBridge implements QualifiedCodexProviderBridge {
  private readonly transport: Wsl2CodexProviderTransport;

  constructor(options: ExternalWsl2CodexProviderBridgeOptions) {
    const distribution = disposableDistribution.parse(options.distribution);
    const executable = linuxExecutable.parse(
      options.providerExecutable ?? "/opt/lexrunner/bin/governed-codex-provider"
    );
    const user = opaqueId.parse(options.providerUser ?? "lexrunner-provider");
    this.transport =
      options.transport ?? new NativeWsl2CodexProviderTransport(distribution, executable, user);
  }

  async inspect(environmentId: string): Promise<ExecutorAttestation> {
    const output = await this.transport.request({
      args: ["inspect", "--environment-id", opaqueId.parse(environmentId)],
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    return ExecutorAttestation_v1.parse(parseJson(output));
  }

  async prepareSynthetic(
    input: z.input<typeof QualifiedCodexSyntheticPreparation_v1>
  ): Promise<QualifiedCodexProviderAttestations> {
    const preparation = QualifiedCodexSyntheticPreparation_v1.parse(input);
    const output = await this.transport.request({
      args: ["prepare", "--stdin-format", "canonical-json-v1"],
      stdin: encodeCanonical(preparation),
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    return parseAttestationBundle(output);
  }

  async prepareRepository(
    input: GovernedRepositoryCorpusFrame
  ): Promise<QualifiedCodexProviderAttestations> {
    const frame = parseGovernedRepositoryCorpusFrame(input.bytes);
    if (frame.bytes.byteLength > MAX_REPOSITORY_CORPUS_FRAME_BYTES) {
      throw new Error("Qualified Codex repository corpus exceeds its transport bound");
    }
    const output = await this.transport.request({
      args: ["prepare-repository", "--stdin-framing", "lexrunner-repository-corpus-v1"],
      stdin: frame.bytes,
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    const attestations = parseAttestationBundle(output);
    if (
      attestations.workspace.corpus_kind !== "repository" ||
      attestations.environment.environment_id !== frame.header.environment_id ||
      attestations.workspace.repository_id !== frame.header.repository_id ||
      attestations.workspace.base_object_id !== frame.header.base_object_id ||
      attestations.workspace.candidate_object_id !== frame.header.candidate_object_id ||
      attestations.workspace.corpus_hash !== frame.header.corpus_hash ||
      attestations.workspace.selection_hash !== frame.header.selection_hash
    ) {
      throw new Error("Qualified Codex provider returned a mismatched repository attestation");
    }
    return attestations;
  }

  async discardRepository(workspaceId: string): Promise<void> {
    await this.transport.request({
      args: ["discard-repository", "--workspace-id", opaqueId.parse(workspaceId)],
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
  }

  async attest(
    authorization: AttemptAuthorization_v1
  ): Promise<QualifiedCodexProviderAttestations> {
    const output = await this.transport.request({
      args: ["attest", "--stdin-format", "canonical-json-v1"],
      stdin: encodeCanonical(authorization),
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    return parseAttestationBundle(output);
  }

  async launch(input: {
    authorization: AttemptAuthorization_v1;
    promptStdin: Uint8Array;
    outputSchema: unknown;
    mode: "synthetic_only" | "repository_read_only";
    inputBinding?: z.input<typeof QualifiedCodexLaunchInputBinding_v1>;
  }): Promise<QualifiedCodexProviderLaunchReceipt> {
    const metadata = encodeCanonical({
      authorization: input.authorization,
      output_schema: input.outputSchema,
      mode: input.mode,
      ...(input.inputBinding
        ? { input_binding: QualifiedCodexLaunchInputBinding_v1.parse(input.inputBinding) }
        : {}),
    });
    if (metadata.byteLength > MAX_CONTROL_BYTES) {
      throw new Error("Qualified Codex launch metadata exceeds its bound");
    }
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeUInt32BE(metadata.byteLength);
    const framed = Buffer.concat([prefix, metadata, Buffer.from(input.promptStdin)]);
    const output = await this.transport.request({
      args: ["launch", "--stdin-framing", "lexrunner-provider-v1"],
      stdin: framed,
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    return z
      .object({
        operationId: opaqueId,
        providerHandle: opaqueId,
        startedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .parse(parseJson(output));
  }

  async *observe(
    providerHandle: string,
    options: { afterSequence: number; signal?: AbortSignal }
  ): AsyncIterable<QualifiedCodexProviderEmission> {
    if (!Number.isSafeInteger(options.afterSequence) || options.afterSequence < 0) {
      throw new TypeError("Provider event sequence must be a non-negative safe integer");
    }
    const stream = this.transport.stream({
      args: [
        "observe",
        "--provider-handle",
        opaqueId.parse(providerHandle),
        "--after-sequence",
        String(options.afterSequence),
      ],
      ...(options.signal ? { signal: options.signal } : {}),
      maxLineBytes: MAX_STREAM_LINE_BYTES,
    });
    try {
      for await (const line of stream) {
        try {
          const candidate = z
            .object({
              type: z.enum([
                "started",
                "accepted",
                "executor_event",
                "declined",
                "completed",
                "failed",
                "cancelled",
                "lost",
              ]),
              sequence: z.number().int().positive(),
              observed_at: z.string().datetime({ offset: true }),
              frame_class: z.enum([
                "executor_stdout",
                "executor_stderr",
                "executor_event",
                "executor_claim",
                "provider_receipt",
                "control_evidence",
                "verifier_evidence",
                "capture_lifecycle",
              ]),
              raw_base64: z.string().max(Math.ceil((MAX_STREAM_LINE_BYTES * 4) / 3) + 4),
              executor_event_type: z.string().min(1).max(128).optional(),
              reason_present: z.boolean().optional(),
            })
            .strict()
            .parse(parseJson(line));
          const rawBytes = decodeCanonicalBase64(candidate.raw_base64);
          const { raw_base64: _rawBase64, ...semantic } = candidate;
          yield QualifiedCodexProviderEmission_v1.parse({
            ...semantic,
            raw_bytes: rawBytes,
          });
        } catch (error) {
          if (error instanceof QualifiedCodexProviderStreamError) throw error;
          throw new QualifiedCodexProviderStreamError("invalid_event");
        }
      }
    } catch (error) {
      if (error instanceof QualifiedCodexProviderStreamError) throw error;
      throw new QualifiedCodexProviderStreamError("transport_failed");
    }
  }

  async cancel(providerHandle: string): Promise<void> {
    await this.transport.request({
      args: ["cancel", "--provider-handle", opaqueId.parse(providerHandle)],
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
  }

  async continueAfterAcceptance(
    providerHandle: string,
    authorization: AttemptAuthorization_v1
  ): Promise<void> {
    await this.transport.request({
      args: [
        "continue",
        "--provider-handle",
        opaqueId.parse(providerHandle),
        "--stdin-format",
        "canonical-json-v1",
      ],
      stdin: encodeCanonical(authorization),
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
  }

  async collect(providerHandle: string): Promise<QualifiedCodexProviderClaim> {
    const output = await this.transport.request({
      args: ["collect", "--provider-handle", opaqueId.parse(providerHandle)],
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
    return z.object({ taskOutcome: GovernedTaskOutcome_v1 }).strict().parse(parseJson(output));
  }

  async release(providerHandle: string): Promise<void> {
    await this.transport.request({
      args: ["release", "--provider-handle", opaqueId.parse(providerHandle)],
      maxOutputBytes: MAX_CONTROL_BYTES,
    });
  }
}

/** Native, no-shell WSL transport. The provider owns systemd/bwrap details. */
export class NativeWsl2CodexProviderTransport implements Wsl2CodexProviderTransport {
  private readonly executable: string;
  private readonly baseArgs: readonly string[];

  constructor(distribution: string, providerExecutable: string, providerUser: string) {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    this.executable = path.join(systemRoot, "System32", "wsl.exe");
    this.baseArgs = [
      "--distribution",
      disposableDistribution.parse(distribution),
      "--user",
      opaqueId.parse(providerUser),
      "--exec",
      linuxExecutable.parse(providerExecutable),
    ];
  }

  async request(input: {
    args: readonly string[];
    stdin?: Uint8Array;
    maxOutputBytes: number;
  }): Promise<Uint8Array> {
    const child = this.spawn(input.args);
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    child.stdout.on("data", (candidate: Buffer | string) => {
      const chunk = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate);
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > input.maxOutputBytes) {
        overflow = true;
        child.kill();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (candidate: Buffer | string) => {
      const chunk = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate);
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_CONTROL_BYTES) {
        overflow = true;
        child.kill();
      }
    });
    if (input.stdin) child.stdin.end(Buffer.from(input.stdin));
    else child.stdin.end();
    const exitCode = await waitForExit(child, CONTROL_TIMEOUT_MS);
    if (overflow || exitCode !== 0) throw new Error("WSL2 provider control request failed");
    return Buffer.concat(stdout);
  }

  async *stream(input: {
    args: readonly string[];
    signal?: AbortSignal;
    maxLineBytes: number;
  }): AsyncIterable<Uint8Array> {
    const child = this.spawn(input.args);
    child.stdin.end();
    const abort = () => child.kill();
    input.signal?.addEventListener("abort", abort, { once: true });
    let buffered = Buffer.alloc(0);
    try {
      for await (const candidate of child.stdout) {
        const chunk = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate);
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.byteLength > input.maxLineBytes && !buffered.includes(0x0a)) {
          child.kill();
          throw new QualifiedCodexProviderStreamError("line_limit_exceeded");
        }
        let newline = buffered.indexOf(0x0a);
        while (newline >= 0) {
          const line = buffered.subarray(0, newline);
          buffered = buffered.subarray(newline + 1);
          if (line.byteLength > input.maxLineBytes) {
            child.kill();
            throw new QualifiedCodexProviderStreamError("line_limit_exceeded");
          }
          if (line.byteLength > 0) yield line;
          newline = buffered.indexOf(0x0a);
        }
      }
      if (buffered.byteLength > 0) yield buffered;
      const exitCode = child.exitCode ?? (await waitForExit(child, CONTROL_TIMEOUT_MS));
      if (exitCode !== 0 && !input.signal?.aborted) {
        throw new QualifiedCodexProviderStreamError("transport_failed");
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill();
    }
  }

  private spawn(args: readonly string[]) {
    return spawn(this.executable, [...this.baseArgs, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedWslEnvironment(),
    });
  }
}

function encodeCanonical(value: unknown): Buffer {
  return Buffer.from(`${canonicalJSONStringify(value)}\n`, "utf8");
}

function parseJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STREAM_LINE_BYTES) {
    throw new Error("WSL2 provider JSON payload is outside its bound");
  }
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

function parseAttestationBundle(bytes: Uint8Array): QualifiedCodexProviderAttestations {
  return z
    .object({
      executor: ExecutorAttestation_v1,
      environment: EnvironmentAttestation_v1,
      workspace: WorkspaceAttestation_v1,
    })
    .strict()
    .parse(parseJson(bytes));
}

function decodeCanonicalBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64");
  if (canonical !== value) throw new Error("WSL2 provider emitted non-canonical base64");
  return decoded;
}

function sanitizedWslEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { WSLENV: "" };
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("WSL2 provider control request timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}
