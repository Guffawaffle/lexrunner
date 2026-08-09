import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
  IndependentlyReadEvidenceFrame,
  IndependentlyVerifiedEvidenceCapture,
  ProtectedEvidenceIndependentReader,
} from "../runs/governed-attempt-verification.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  STAGE1_SYNTHETIC_EVIDENCE_PROFILE,
  ProtectedEvidenceFrameClass,
  ProtectedEvidenceReference_v1,
  ProtectedEvidenceReservationRequest_v1,
  type ProtectedEvidenceReference_v1 as ProtectedEvidenceReference,
  type ProtectedEvidenceReservationRequest_v1 as ProtectedEvidenceReservationRequest,
} from "./protected-evidence-store.js";

const FRAME_DOMAIN = Buffer.from("lexrunner.protected-evidence.frame@1\0", "utf8");
const MAX_RECORD_BYTES = 128 * 1_024;
const MAX_HEADER_BYTES = 64 * 1_024;

interface StoredCaptureRecord {
  version: 1;
  request: ProtectedEvidenceReservationRequest;
  requestHash: string;
  reference: ProtectedEvidenceReference;
  reservationToken: string;
  chainHead: string;
}

interface StoredFrameHeader {
  version: 1;
  capture_id: string;
  sequence: number;
  frame_class: ReturnType<typeof ProtectedEvidenceFrameClass.parse>;
  observed_at: string;
  payload_length: number;
  payload_hash: string;
  previous_frame_hash: string;
}

export type LocalProtectedEvidenceVerificationFailureCode =
  | "root_untrusted"
  | "capture_not_found"
  | "capture_incomplete"
  | "record_invalid"
  | "container_invalid"
  | "frame_invalid"
  | "seal_invalid"
  | "root_mismatch"
  | "verification_mismatch";

export class LocalProtectedEvidenceVerificationError extends Error {
  constructor(readonly code: LocalProtectedEvidenceVerificationFailureCode) {
    super(`Independent protected-evidence verification failed: ${code}`);
    this.name = "LocalProtectedEvidenceVerificationError";
  }
}

export interface LocalProtectedEvidenceVerifierDependencies {
  /** Re-attests the protected Windows root immediately before every read. */
  attestRoot: (root: string) => Promise<boolean>;
}

/**
 * Read authority reserved for the independent host verifier. Unlike the
 * executor-facing store, this component can read raw bytes, but it returns them
 * only through the verifier-only port and never exports a physical path.
 */
export class LocalProtectedEvidenceVerifier implements ProtectedEvidenceIndependentReader {
  constructor(
    private readonly root: string,
    private readonly dependencies: LocalProtectedEvidenceVerifierDependencies
  ) {}

  async readVerifiedCapture(captureId: string): Promise<IndependentlyVerifiedEvidenceCapture> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(captureId)) {
      throw new LocalProtectedEvidenceVerificationError("capture_not_found");
    }
    const root = await this.attestDirectory(this.root, "root_untrusted");
    const recordsRoot = await this.attestDirectory(path.join(root, "records"), "root_untrusted");
    const capturesRoot = await this.attestDirectory(path.join(root, "captures"), "root_untrusted");
    if (!(await this.dependencies.attestRoot(root))) {
      throw new LocalProtectedEvidenceVerificationError("root_untrusted");
    }

    const recordPath = path.join(recordsRoot, `${sha256Hex(captureId)}.json`);
    let record: StoredCaptureRecord;
    try {
      await this.attestFile(recordPath, recordsRoot, MAX_RECORD_BYTES);
      record = parseRecord(await readFile(recordPath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new LocalProtectedEvidenceVerificationError("capture_not_found");
      }
      if (error instanceof LocalProtectedEvidenceVerificationError) throw error;
      throw new LocalProtectedEvidenceVerificationError("record_invalid");
    }
    if (record.reference.capture_id !== captureId) {
      throw new LocalProtectedEvidenceVerificationError("record_invalid");
    }
    if (
      record.reference.status !== "complete" ||
      !record.reference.capture_root ||
      !record.reference.verification_hash ||
      !record.reference.indexed_at
    ) {
      throw new LocalProtectedEvidenceVerificationError("capture_incomplete");
    }

    const container = await this.attestDirectory(
      path.join(capturesRoot, physicalKey(record.reference.store_key)),
      "container_invalid"
    );
    const expectedNames = new Set<string>(["capture.open", "capture.seal"]);
    for (let sequence = 1; sequence <= record.reference.frame_count; sequence += 1) {
      expectedNames.add(frameName(sequence));
    }
    const actualNames = await readdir(container);
    if (
      actualNames.length !== expectedNames.size ||
      actualNames.some((name) => !expectedNames.has(name))
    ) {
      throw new LocalProtectedEvidenceVerificationError("container_invalid");
    }

    try {
      const markerPath = path.join(container, "capture.open");
      await this.attestFile(markerPath, container, MAX_RECORD_BYTES);
      const marker = parseObject(await readFile(markerPath));
      if (
        marker.version !== 1 ||
        marker.capture_id !== captureId ||
        marker.request_hash !== record.requestHash ||
        marker.opened_at !== record.reference.opened_at ||
        canonicalJSONStringify(marker.bindings) !==
          canonicalJSONStringify(bindingProjection(record.reference))
      ) {
        throw new Error("capture marker mismatch");
      }
    } catch {
      throw new LocalProtectedEvidenceVerificationError("container_invalid");
    }

    const frames: IndependentlyReadEvidenceFrame[] = [];
    let chainHead = zeroHash();
    const counters = {
      frame_count: 0,
      event_count: 0,
      total_bytes: 0,
      stdout_bytes: 0,
      stderr_bytes: 0,
      provider_control_bytes: 0,
    };
    for (let sequence = 1; sequence <= record.reference.frame_count; sequence += 1) {
      const file = path.join(container, frameName(sequence));
      try {
        await this.attestFile(
          file,
          container,
          STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrameBytes + MAX_HEADER_BYTES + 4
        );
        const parsed = parseFrame(await readFile(file));
        const header = parsed.header;
        if (
          header.capture_id !== captureId ||
          header.sequence !== sequence ||
          header.previous_frame_hash !== chainHead ||
          header.payload_hash !== sha256(parsed.payload) ||
          header.payload_length !== parsed.payload.byteLength
        ) {
          throw new Error("frame binding mismatch");
        }
        chainHead = hashFrame(parsed.encodedHeader, parsed.payload);
        counters.frame_count += 1;
        counters.event_count += header.frame_class === "executor_event" ? 1 : 0;
        counters.total_bytes += parsed.containerBytes;
        counters.stdout_bytes +=
          header.frame_class === "executor_stdout" ? parsed.payload.byteLength : 0;
        counters.stderr_bytes +=
          header.frame_class === "executor_stderr" ? parsed.payload.byteLength : 0;
        counters.provider_control_bytes += [
          "provider_receipt",
          "control_evidence",
          "verifier_evidence",
        ].includes(header.frame_class)
          ? parsed.payload.byteLength
          : 0;
        frames.push({
          sequence,
          frameClass: header.frame_class,
          observedAt: header.observed_at,
          evidenceRef: chainHead,
          bytes: Uint8Array.from(parsed.payload),
        });
      } catch (error) {
        if (error instanceof LocalProtectedEvidenceVerificationError) throw error;
        throw new LocalProtectedEvidenceVerificationError("frame_invalid");
      }
    }
    if (
      canonicalJSONStringify(counters) !==
      canonicalJSONStringify(counterProjection(record.reference))
    ) {
      throw new LocalProtectedEvidenceVerificationError("frame_invalid");
    }
    if (chainHead !== record.chainHead) {
      throw new LocalProtectedEvidenceVerificationError("frame_invalid");
    }

    const sealPath = path.join(container, "capture.seal");
    let seal: Record<string, unknown>;
    try {
      await this.attestFile(sealPath, container, MAX_RECORD_BYTES);
      seal = parseObject(await readFile(sealPath));
    } catch (error) {
      if (error instanceof LocalProtectedEvidenceVerificationError) throw error;
      throw new LocalProtectedEvidenceVerificationError("seal_invalid");
    }
    const captureRoot = computeCanonicalHash({
      kind: "protected_evidence_capture_root_v1",
      capture_id: record.reference.capture_id,
      request_hash: record.requestHash,
      bindings: bindingProjection(record.reference),
      chain_head: chainHead,
      counts: counters,
    });
    if (
      seal.version !== 1 ||
      seal.capture_id !== captureId ||
      seal.request_hash !== record.requestHash ||
      seal.chain_head !== chainHead ||
      seal.capture_root !== captureRoot ||
      canonicalJSONStringify(seal.counts) !== canonicalJSONStringify(counters) ||
      seal.sealed_at !== record.reference.sealed_at
    ) {
      throw new LocalProtectedEvidenceVerificationError("seal_invalid");
    }
    if (captureRoot !== record.reference.capture_root) {
      throw new LocalProtectedEvidenceVerificationError("root_mismatch");
    }
    const verificationHash = computeCanonicalHash({
      kind: "protected_evidence_fresh_verification",
      capture_root: captureRoot,
      frame_count: frames.length,
      verified_at: record.reference.indexed_at,
    });
    if (verificationHash !== record.reference.verification_hash) {
      throw new LocalProtectedEvidenceVerificationError("verification_mismatch");
    }
    return { reference: structuredClone(record.reference), frames };
  }

  private async attestDirectory(
    candidate: string,
    code: LocalProtectedEvidenceVerificationFailureCode
  ): Promise<string> {
    if (!path.isAbsolute(candidate)) throw new LocalProtectedEvidenceVerificationError(code);
    try {
      const info = await lstat(candidate);
      const resolved = await realpath(candidate);
      if (!info.isDirectory() || info.isSymbolicLink() || resolved !== path.resolve(candidate)) {
        throw new LocalProtectedEvidenceVerificationError(code);
      }
      return resolved;
    } catch (error) {
      if (error instanceof LocalProtectedEvidenceVerificationError) throw error;
      throw new LocalProtectedEvidenceVerificationError(code);
    }
  }

  private async attestFile(file: string, parent: string, maximumBytes: number): Promise<void> {
    assertDescendant(parent, file);
    const info = await lstat(file);
    const resolved = await realpath(file);
    const resolvedParent = `${path.resolve(parent)}${path.sep}`;
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size <= 0 ||
      info.size > maximumBytes ||
      !resolved.startsWith(resolvedParent)
    ) {
      throw new LocalProtectedEvidenceVerificationError("container_invalid");
    }
  }
}

function parseRecord(bytes: Uint8Array): StoredCaptureRecord {
  const candidate = parseObject(bytes);
  const request = ProtectedEvidenceReservationRequest_v1.parse(candidate.request);
  const reference = ProtectedEvidenceReference_v1.parse(candidate.reference);
  if (
    candidate.version !== 1 ||
    typeof candidate.requestHash !== "string" ||
    candidate.requestHash !== computeCanonicalHash(request) ||
    typeof candidate.reservationToken !== "string" ||
    !/^[0-9a-f]{64}$/u.test(candidate.reservationToken) ||
    typeof candidate.chainHead !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.chainHead)
  ) {
    throw new Error("invalid record");
  }
  return {
    version: 1,
    request,
    requestHash: candidate.requestHash,
    reference,
    reservationToken: candidate.reservationToken,
    chainHead: candidate.chainHead,
  };
}

function parseFrame(bytes: Uint8Array): {
  header: StoredFrameHeader;
  encodedHeader: Buffer;
  payload: Buffer;
  containerBytes: number;
} {
  const container = Buffer.from(bytes);
  if (container.byteLength < 5) throw new Error("invalid frame");
  const headerLength = container.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES || 4 + headerLength > container.length) {
    throw new Error("invalid frame header");
  }
  const encodedHeader = container.subarray(4, 4 + headerLength);
  const payload = container.subarray(4 + headerLength);
  if (payload.byteLength > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrameBytes) {
    throw new Error("invalid frame payload");
  }
  const candidate = parseObject(encodedHeader);
  const frameClass = ProtectedEvidenceFrameClass.parse(candidate.frame_class);
  const observedAt = normalizeInstant(candidate.observed_at);
  const header: StoredFrameHeader = {
    version: 1,
    capture_id: requireString(candidate.capture_id),
    sequence: requirePositiveInteger(candidate.sequence),
    frame_class: frameClass,
    observed_at: observedAt,
    payload_length: requireNonnegativeInteger(candidate.payload_length),
    payload_hash: requireHash(candidate.payload_hash),
    previous_frame_hash: requireHash(candidate.previous_frame_hash),
  };
  if (
    candidate.version !== 1 ||
    canonicalJSONStringify(header) !== encodedHeader.toString("utf8")
  ) {
    throw new Error("non-canonical frame header");
  }
  return { header, encodedHeader, payload, containerBytes: container.byteLength };
}

function parseObject(bytes: Uint8Array): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function bindingProjection(reference: ProtectedEvidenceReference) {
  return {
    attempt_id: reference.attempt_id,
    delegation_id: reference.delegation_id,
    authorization_binding_digest: reference.authorization_binding_digest,
    executor_binding_digest: reference.executor_binding_digest,
    environment_binding_digest: reference.environment_binding_digest,
    workspace_binding_digest: reference.workspace_binding_digest,
  };
}

function counterProjection(reference: ProtectedEvidenceReference) {
  return {
    frame_count: reference.frame_count,
    event_count: reference.event_count,
    total_bytes: reference.total_bytes,
    stdout_bytes: reference.stdout_bytes,
    stderr_bytes: reference.stderr_bytes,
    provider_control_bytes: reference.provider_control_bytes,
  };
}

function frameName(sequence: number): string {
  return `${String(sequence).padStart(8, "0")}.frame`;
}

function physicalKey(storeKey: string): string {
  const match = /^pe:([0-9a-f]{32})$/u.exec(storeKey);
  if (!match) throw new LocalProtectedEvidenceVerificationError("record_invalid");
  return `pe-${match[1]}`;
}

function hashFrame(encodedHeader: Uint8Array, payload: Uint8Array): string {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encodedHeader.byteLength);
  return `sha256:${createHash("sha256")
    .update(FRAME_DOMAIN)
    .update(length)
    .update(encodedHeader)
    .update(payload)
    .digest("hex")}`;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function zeroHash(): string {
  return `sha256:${"0".repeat(64)}`;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error("invalid string");
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("invalid hash");
  }
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error("invalid integer");
  return value as number;
}

function requireNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid integer");
  return value as number;
}

function normalizeInstant(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid timestamp");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("invalid timestamp");
  return new Date(timestamp).toISOString();
}

function assertDescendant(parent: string, candidate: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LocalProtectedEvidenceVerificationError("container_invalid");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
