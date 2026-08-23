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

import type { Gate, GateResult } from "../schema.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import { sha256 } from "../util/hash.js";

export const GATE_EXECUTION_RECEIPT_SCHEMA_VERSION = "lexrunner-gate-execution-receipt/v1" as const;
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

export interface LocalGateExecutionReceipt {
  schemaVersion: typeof GATE_EXECUTION_RECEIPT_SCHEMA_VERSION;
  attempt: number;
  declaredGate: {
    name: string;
    run: string;
    cwd: string | null;
    runtime: Gate["runtime"];
    artifacts: string[];
  };
  execution: {
    cwd: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    shell: SpawnedShellEvidence;
  };
  outcome: {
    status: GateResult["status"];
    exitCode: number | null;
    failureKind: GateResult["failureKind"] | null;
    timeoutCleanup: GateResult["timeoutCleanup"] | null;
    evidenceComplete: boolean;
  };
  output: {
    stdout: GateOutputEvidence;
    stderr: GateOutputEvidence;
  };
  artifacts: CollectedGateArtifactIdentity[];
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
