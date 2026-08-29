import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

import { Gate, type GateResult } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { sha256 } from "../util/hash.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";

export const GATE_EXECUTION_RECEIPT_SCHEMA_VERSION = "lexrunner-gate-execution-receipt/v2" as const;
export const MAX_GATE_RECEIPT_OUTPUT_BYTES = 64 * 1024;

export interface GateArtifactFileIdentity {
  path: string;
  realPath: string;
  bytes: number;
  mtimeMs: number;
  sha256: string;
}

export interface DeclaredArtifactBaseline {
  declaredPath: string;
  resolvedPath: string;
  before: GateArtifactFileIdentity | null;
}

export interface CollectedGateArtifactIdentity {
  declaredPath: string;
  resolvedPath: string;
  status: "collected" | "missing" | "stale" | "unsupported" | "collection_error";
  before: GateArtifactFileIdentity | null;
  source: GateArtifactFileIdentity | null;
  retainedPath?: string;
  retained?: GateArtifactFileIdentity;
  error?: string;
}

export interface GateOutputEvidence {
  bytes: number;
  sha256: string;
  truncated: boolean;
  content: string;
}

export interface SpawnedShellEvidence {
  command: "bash" | "pwsh";
  executable: GateArtifactFileIdentity | null;
  argv: string[];
  identityAfter: GateArtifactFileIdentity | null;
  unchanged: boolean;
  spawned: boolean;
}

const FileIdentitySchema = z
  .object({
    path: z.string(),
    realPath: z.string(),
    bytes: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const OutputEvidenceSchema = z
  .object({
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    truncated: z.boolean(),
    content: z.string().max(MAX_GATE_RECEIPT_OUTPUT_BYTES),
  })
  .strict();
const ArtifactIdentitySchema = z
  .object({
    declaredPath: z.string(),
    resolvedPath: z.string(),
    status: z.enum(["collected", "missing", "stale", "unsupported", "collection_error"]),
    before: FileIdentitySchema.nullable(),
    source: FileIdentitySchema.nullable(),
    retainedPath: z.string().optional(),
    retained: FileIdentitySchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export const LocalGateExecutionReceiptSchema = z
  .object({
    schemaVersion: z.literal(GATE_EXECUTION_RECEIPT_SCHEMA_VERSION),
    attempt: z.number().int().positive(),
    binding: z
      .object({
        item: z.string().min(1).nullable(),
        declaredGateDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        candidateDigest: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/u)
          .nullable(),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    declaredGate: z
      .object({
        name: z.string(),
        run: z.string(),
        cwd: z.string().nullable(),
        runtime: z.enum(["local", "container", "ci-service"]),
        artifacts: z.array(z.string()),
      })
      .strict(),
    execution: z
      .object({
        cwd: z.string(),
        startedAt: z.string(),
        finishedAt: z.string(),
        durationMs: z.number().nonnegative(),
        shell: z
          .object({
            command: z.enum(["bash", "pwsh"]),
            executable: FileIdentitySchema.nullable(),
            argv: z.array(z.string()),
            identityAfter: FileIdentitySchema.nullable(),
            unchanged: z.boolean(),
            spawned: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum(["pass", "fail", "blocked", "skipped", "retrying"]),
        exitCode: z.number().int().nullable(),
        failureKind: z
          .enum(["nonzero_exit", "spawn_error", "timeout", "evidence_error"])
          .nullable(),
        timeoutCleanup: z
          .object({
            method: z.enum(["process-group", "taskkill", "direct-child"]),
            forceKilled: z.boolean(),
            descendantsReaped: z.boolean(),
          })
          .strict()
          .nullable(),
        evidenceComplete: z.boolean(),
      })
      .strict(),
    output: z.object({ stdout: OutputEvidenceSchema, stderr: OutputEvidenceSchema }).strict(),
    artifacts: z.array(ArtifactIdentitySchema),
  })
  .strict();
export type LocalGateExecutionReceipt = z.infer<typeof LocalGateExecutionReceiptSchema>;

export function parseLocalGateExecutionReceipt(value: unknown): LocalGateExecutionReceipt {
  return LocalGateExecutionReceiptSchema.parse(value);
}

export function gateExecutionBinding(
  gate: Gate,
  item: string | undefined,
  timeoutMs: number,
  candidateDigest?: string
): LocalGateExecutionReceipt["binding"] {
  return {
    item: item ?? null,
    declaredGateDigest: computeCanonicalHash(Gate.parse(gate)),
    candidateDigest: candidateDigest ?? null,
    timeoutMs,
  };
}

export function resolveSpawnExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (isAbsolute(command) || /[\\/]/u.test(command)) {
    return requireExecutable(resolve(workingDirectory, command));
  }

  const pathValue = environmentValue(environment, "PATH", platform) ?? "";
  const extensions =
    platform === "win32"
      ? executableExtensions(command, environmentValue(environment, "PATHEXT", platform))
      : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      if (isExecutableFile(candidate)) return realpathSync(candidate);
    }
  }
  throw new Error(`Unable to resolve local gate shell executable '${command}'.`);
}

export function fileIdentity(filePath: string): GateArtifactFileIdentity | null {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return null;
    const realPath = realpathSync(filePath);
    const content = readFileSync(realPath);
    return {
      path: resolve(filePath),
      realPath,
      bytes: content.byteLength,
      mtimeMs: stats.mtimeMs,
      sha256: `sha256:${sha256(content)}`,
    };
  } catch {
    return null;
  }
}

export function captureDeclaredArtifactBaselines(
  declaredPaths: readonly string[],
  workingDirectory: string
): DeclaredArtifactBaseline[] {
  return declaredPaths.map((declaredPath) => {
    const resolvedPath = resolve(workingDirectory, declaredPath);
    return { declaredPath, resolvedPath, before: fileIdentity(resolvedPath) };
  });
}

export function collectFreshGateArtifacts(
  baselines: readonly DeclaredArtifactBaseline[],
  gateArtifactDirectory: string
): { paths: string[]; identities: CollectedGateArtifactIdentity[]; complete: boolean } {
  mkdirSync(gateArtifactDirectory, { recursive: true });
  const paths: string[] = [];
  const usedNames = new Set<string>();
  const identities = baselines.map((baseline, index): CollectedGateArtifactIdentity => {
    const source = fileIdentity(baseline.resolvedPath);
    if (!existsSync(baseline.resolvedPath)) {
      return { ...baseline, status: "missing", source: null };
    }
    if (!source) {
      return { ...baseline, status: "unsupported", source: null };
    }
    if (baseline.before?.sha256 === source.sha256) {
      return { ...baseline, status: "stale", source };
    }

    let retainedName = basename(baseline.resolvedPath);
    if (usedNames.has(retainedName)) retainedName = `${index + 1}-${retainedName}`;
    usedNames.add(retainedName);
    const retainedPath = join(gateArtifactDirectory, retainedName);
    try {
      copyFileSync(baseline.resolvedPath, retainedPath);
      const retained = fileIdentity(retainedPath);
      if (!retained || retained.sha256 !== source.sha256 || retained.bytes !== source.bytes) {
        return {
          ...baseline,
          status: "collection_error",
          source,
          retainedPath,
          error: "Retained artifact identity does not match its source.",
        };
      }
      paths.push(retainedPath);
      return { ...baseline, status: "collected", source, retainedPath, retained };
    } catch (error) {
      return {
        ...baseline,
        status: "collection_error",
        source,
        retainedPath,
        error: boundedError(error),
      };
    }
  });
  return {
    paths,
    identities,
    complete: identities.every(({ status }) => status === "collected"),
  };
}

export function gateOutputEvidence(value: string | Buffer): GateOutputEvidence {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return {
    bytes: bytes.byteLength,
    sha256: `sha256:${sha256(bytes)}`,
    truncated: bytes.byteLength > MAX_GATE_RECEIPT_OUTPUT_BYTES,
    content: utf8Prefix(bytes, MAX_GATE_RECEIPT_OUTPUT_BYTES),
  };
}

export function writeLocalGateExecutionReceipt(
  artifactDirectory: string,
  receipt: LocalGateExecutionReceipt
): string {
  mkdirSync(artifactDirectory, { recursive: true });
  const receiptPath = join(
    artifactDirectory,
    `gate-execution-receipt.attempt-${receipt.attempt}.json`
  );
  const temporaryPath = join(
    dirname(receiptPath),
    `.${basename(receiptPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  writeFileSync(temporaryPath, canonicalJSONStringify(receipt), "utf8");
  renameSync(temporaryPath, receiptPath);
  return receiptPath;
}

function requireExecutable(candidate: string): string {
  if (!isExecutableFile(candidate)) {
    throw new Error(`Local gate shell executable does not exist at '${candidate}'.`);
  }
  return realpathSync(candidate);
}

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== "win32") return environment[name];
  const match = Object.keys(environment).find((key) => key.toUpperCase() === name);
  return match ? environment[match] : undefined;
}

function executableExtensions(command: string, pathExt: string | undefined): string[] {
  if (extname(command)) return [""];
  return (pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}

function utf8Prefix(value: Buffer, maxBytes: number): string {
  if (value.byteLength <= maxBytes) return value.toString("utf8");
  return value.subarray(0, maxBytes).toString("utf8");
}

function boundedError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 1024 ? value : `${value.slice(0, 1024)}…`;
}
