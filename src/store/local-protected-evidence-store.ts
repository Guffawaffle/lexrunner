import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { computeCanonicalHash } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import {
  PROTECTED_EVIDENCE_CONTRACT_VERSION,
  STAGE1_SYNTHETIC_EVIDENCE_PROFILE,
  STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID,
  ProtectedEvidenceReference_v1,
  ProtectedEvidenceReservationRequest_v1,
  canTransitionProtectedEvidenceReference,
  evaluateProtectedEvidenceAdmission,
  type ProtectedEvidenceFrameClass,
  type ProtectedEvidenceFrameInput,
  type ProtectedEvidenceMutationResult,
  type ProtectedEvidenceReasonCode,
  type ProtectedEvidenceReference_v1 as ProtectedEvidenceReference,
  type ProtectedEvidenceReservationRequest_v1 as ProtectedEvidenceReservationRequest,
  type ProtectedEvidenceReservationResult,
  type ProtectedEvidenceStore,
  type ProtectedEvidenceWriterCheckpointResult,
} from "./protected-evidence-store.js";

const RECORD_VERSION = 1 as const;
const FRAME_VERSION = 1 as const;
const MAX_RECORD_BYTES = 128 * 1_024;
const FRAME_DOMAIN = Buffer.from("lexrunner.protected-evidence.frame@1\0", "utf8");

export interface ProtectedEvidenceFrameDigestInput {
  captureId: string;
  sequence: number;
  frameClass: ProtectedEvidenceFrameClass;
  observedAt: string;
  bytes: Uint8Array;
  previousFrameHash: string;
}

/** The portable accumulator seed used by a trusted evidence producer. */
export function initialProtectedEvidenceChainHead(): string {
  return zeroHash();
}

/**
 * Computes the exact chained frame digest without exposing any stored evidence.
 * The producer uses this value when it seals the capture; the sink recomputes it
 * independently during fresh verification.
 */
export function computeProtectedEvidenceFrameHash(
  input: ProtectedEvidenceFrameDigestInput
): string {
  const payload = Buffer.from(input.bytes);
  const header = frameHeader({
    captureId: input.captureId,
    sequence: input.sequence,
    frameClass: input.frameClass,
    observedAt: normalizeInstant(input.observedAt),
    payload,
    previousFrameHash: input.previousFrameHash,
  });
  return hashFrame(Buffer.from(canonicalJSONStringify(header), "utf8"), payload);
}

interface CaptureRecord {
  version: typeof RECORD_VERSION;
  request: ProtectedEvidenceReservationRequest;
  requestHash: string;
  reference: ProtectedEvidenceReference;
  reservationToken: string;
  chainHead: string;
}

interface FrameHeader {
  version: typeof FRAME_VERSION;
  capture_id: string;
  sequence: number;
  frame_class: ProtectedEvidenceFrameClass;
  observed_at: string;
  payload_length: number;
  payload_hash: string;
  previous_frame_hash: string;
}

interface CaptureSeal {
  version: typeof RECORD_VERSION;
  capture_id: string;
  request_hash: string;
  chain_head: string;
  capture_root: string;
  counts: ReturnType<typeof counterProjection>;
  sealed_at: string;
}

export interface LocalProtectedEvidenceStoreDependencies {
  /** Must attest an already-created, non-inherited operator-only root. */
  attestRoot?: (root: string) => Promise<boolean>;
  /** Must durably flush directory metadata or reject the operation. */
  syncDirectory?: (directory: string) => Promise<void>;
  now?: () => string;
  random?: (bytes: number) => Buffer;
  prohibitedSentinels?: readonly Uint8Array[];
}

/**
 * File-backed protected evidence sink. It deliberately has no raw read/export API.
 * Production dispatch remains fail-closed until an OS-specific root attestor and
 * directory durability primitive are supplied.
 */
export class LocalProtectedEvidenceStore implements ProtectedEvidenceStore {
  private initialized = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly attestRoot: (root: string) => Promise<boolean>;
  private readonly syncDirectory: (directory: string) => Promise<void>;
  private readonly now: () => string;
  private readonly random: (bytes: number) => Buffer;
  private readonly prohibitedSentinels: Buffer[];

  constructor(
    private readonly root: string,
    dependencies: LocalProtectedEvidenceStoreDependencies = {}
  ) {
    this.attestRoot = dependencies.attestRoot ?? (async () => false);
    this.syncDirectory =
      dependencies.syncDirectory ??
      (async () => {
        throw new Error("protected evidence directory durability is unavailable");
      });
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.random = dependencies.random ?? randomBytes;
    this.prohibitedSentinels = (dependencies.prohibitedSentinels ?? []).map((value) => {
      const sentinel = Buffer.from(value);
      if (sentinel.length === 0 || sentinel.length > 4_096) {
        throw new TypeError("prohibited evidence sentinels must contain 1-4096 bytes");
      }
      return sentinel;
    });
  }

  async reserveCapture(
    candidate: ProtectedEvidenceReservationRequest
  ): Promise<ProtectedEvidenceReservationResult> {
    return this.exclusive(async () => {
      const request = ProtectedEvidenceReservationRequest_v1.safeParse(candidate);
      if (!request.success) return { admitted: false, reason: "invalid_request" } as const;
      try {
        await this.initialize();
        const existing = await this.readRecord(request.data.capture_id);
        const requestHash = computeCanonicalHash(request.data);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return { admitted: false, reason: "invalid_request" } as const;
          }
          return {
            admitted: true,
            reference: existing.reference,
            reservationToken: existing.reservationToken,
            idempotentReplay: true,
          } as const;
        }
        const usage = await this.usage();
        const admission = evaluateProtectedEvidenceAdmission(usage, request.data);
        if (!admission.admitted) return { admitted: false, reason: admission.reason } as const;
        const declaredAt = normalizeInstant(this.now());
        const storeKey = `pe:${this.random(16).toString("hex")}`;
        const reference = ProtectedEvidenceReference_v1.parse({
          schema_version: PROTECTED_EVIDENCE_CONTRACT_VERSION,
          profile_id: STAGE1_SYNTHETIC_EVIDENCE_PROFILE_ID,
          store_key: storeKey,
          capture_id: request.data.capture_id,
          attempt_id: request.data.attempt_id,
          delegation_id: request.data.delegation_id,
          authorization_binding_digest: request.data.authorization_binding_digest,
          executor_binding_digest: request.data.executor_binding_digest,
          environment_binding_digest: request.data.environment_binding_digest,
          workspace_binding_digest: request.data.workspace_binding_digest,
          status: "declared",
          retention_class: "synthetic_complete",
          frame_count: 0,
          event_count: 0,
          total_bytes: 0,
          stdout_bytes: 0,
          stderr_bytes: 0,
          provider_control_bytes: 0,
          declared_at: declaredAt,
          retention_expires_at: addMs(
            declaredAt,
            STAGE1_SYNTHETIC_EVIDENCE_PROFILE.completeRetentionMs
          ),
        });
        const record: CaptureRecord = {
          version: RECORD_VERSION,
          request: request.data,
          requestHash,
          reference,
          reservationToken: this.random(32).toString("hex"),
          chainHead: zeroHash(),
        };
        await this.createRecord(record);
        return {
          admitted: true,
          reference,
          reservationToken: record.reservationToken,
          idempotentReplay: false,
        } as const;
      } catch {
        return { admitted: false, reason: "sink_unavailable" } as const;
      }
    });
  }

  async openCapture(input: {
    captureId: string;
    reservationToken: string;
    openedAt: string;
  }): Promise<ProtectedEvidenceMutationResult> {
    return this.mutate(input.captureId, input.reservationToken, async (record) => {
      if (record.reference.status === "open") return success(record.reference, true);
      if (!canTransitionProtectedEvidenceReference(record.reference.status, "open")) {
        return failure("invalid_transition");
      }
      let openedAt = normalizeInstant(input.openedAt);
      const partial = this.partialDirectory(record.reference.store_key);
      try {
        await mkdir(partial, { mode: 0o700 });
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      }
      const markerPath = path.join(partial, "capture.open");
      const marker = {
        version: RECORD_VERSION,
        capture_id: record.reference.capture_id,
        request_hash: record.requestHash,
        bindings: bindingProjection(record.reference),
        opened_at: openedAt,
      };
      try {
        await this.writeSynced(
          markerPath,
          Buffer.from(`${canonicalJSONStringify(marker)}\n`, "utf8"),
          true
        );
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const existing = JSON.parse(await readFile(markerPath, "utf8")) as typeof marker;
        if (
          existing.version !== marker.version ||
          existing.capture_id !== marker.capture_id ||
          existing.request_hash !== marker.request_hash ||
          canonicalJSONStringify(existing.bindings) !== canonicalJSONStringify(marker.bindings)
        ) {
          return this.incomplete(record, "integrity_failure", openedAt);
        }
        openedAt = normalizeInstant(existing.opened_at);
      }
      await this.syncDirectory(this.dataRoot());
      record.reference = ProtectedEvidenceReference_v1.parse({
        ...record.reference,
        status: "open",
        opened_at: openedAt,
      });
      await this.updateRecord(record);
      return success(record.reference, false);
    });
  }

  async appendFrame(input: ProtectedEvidenceFrameInput): Promise<ProtectedEvidenceMutationResult> {
    return this.mutate(input.captureId, input.reservationToken, async (record) => {
      if (record.reference.status !== "open") return failure("invalid_transition");
      const payload = Buffer.from(input.bytes);
      const observedAt = normalizeInstant(input.observedAt);
      if (input.sequence <= record.reference.frame_count) {
        const existing = await readFrame(
          path.join(
            this.partialDirectory(record.reference.store_key),
            `${String(input.sequence).padStart(8, "0")}.frame`
          )
        );
        return frameMatchesInput(existing, input, payload, observedAt)
          ? success(record.reference, true)
          : this.incomplete(record, "integrity_failure", observedAt);
      }
      if (input.sequence !== record.reference.frame_count + 1) {
        return failure("sequence_mismatch");
      }
      if (input.sequence > record.request.reserved_frames) {
        return this.incomplete(record, "frame_limit_exceeded", observedAt);
      }
      if (
        record.reference.opened_at &&
        Date.parse(observedAt) - Date.parse(record.reference.opened_at) >
          record.request.max_duration_ms
      ) {
        return this.incomplete(record, "duration_limit_exceeded", observedAt);
      }
      if (payload.length > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrameBytes) {
        return this.incomplete(record, "frame_limit_exceeded", observedAt);
      }
      if (await this.containsProhibitedContent(record, payload)) {
        await this.removeCaptureBytes(record).catch(() => undefined);
        return this.incomplete(record, "prohibited_content", observedAt);
      }
      const header = frameHeader({
        captureId: record.reference.capture_id,
        sequence: input.sequence,
        frameClass: input.frameClass,
        observedAt,
        payload,
        previousFrameHash: record.chainHead,
      });
      const encodedHeader = Buffer.from(canonicalJSONStringify(header), "utf8");
      const prefix = Buffer.allocUnsafe(4);
      prefix.writeUInt32BE(encodedHeader.length);
      const frameBytes = Buffer.concat([prefix, encodedHeader, payload]);
      const next = counters(record.reference, input.frameClass, payload.length, frameBytes.length);
      const limitReason = limitExceeded(record, next);
      if (limitReason) return this.incomplete(record, limitReason, observedAt);
      const frameHash = hashFrame(encodedHeader, payload);
      const framePath = path.join(
        this.partialDirectory(record.reference.store_key),
        `${String(input.sequence).padStart(8, "0")}.frame`
      );
      try {
        await this.writeSynced(framePath, frameBytes, true);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const existing = await readFrame(framePath);
        if (!frameMatchesExact(existing, header, payload)) {
          return this.incomplete(record, "integrity_failure", observedAt);
        }
      }
      record.chainHead = frameHash;
      record.reference = ProtectedEvidenceReference_v1.parse({
        ...record.reference,
        ...next,
      });
      await this.updateRecord(record);
      return success(record.reference, false);
    });
  }

  async getWriterCheckpoint(input: {
    captureId: string;
    reservationToken: string;
  }): Promise<ProtectedEvidenceWriterCheckpointResult> {
    return this.exclusive(async () => {
      try {
        await this.initialize();
        const record = await this.readRecord(input.captureId);
        if (!record) return { available: false, reason: "not_found" } as const;
        if (!sameToken(record.reservationToken, input.reservationToken)) {
          return { available: false, reason: "stale_reservation" } as const;
        }
        if (
          !["declared", "open", "sealed_unindexed", "complete"].includes(record.reference.status)
        ) {
          return { available: false, reason: "invalid_transition" } as const;
        }
        return {
          available: true,
          reference: record.reference,
          frameCount: record.reference.frame_count,
          chainHead: record.chainHead,
        } as const;
      } catch {
        return { available: false, reason: "sink_unavailable" } as const;
      }
    });
  }

  async sealCapture(input: {
    captureId: string;
    reservationToken: string;
    expectedFrameCount: number;
    expectedChainHead: string;
    sealedAt: string;
  }): Promise<ProtectedEvidenceMutationResult> {
    return this.mutate(input.captureId, input.reservationToken, async (record) => {
      if (record.reference.status === "sealed_unindexed") return success(record.reference, true);
      if (record.reference.status !== "open") return failure("invalid_transition");
      if (
        input.expectedFrameCount !== record.reference.frame_count ||
        input.expectedChainHead !== record.chainHead
      ) {
        return this.incomplete(record, "integrity_failure", input.sealedAt);
      }
      let sealedAt = normalizeInstant(input.sealedAt);
      const captureRoot = computeCaptureRoot(record);
      const partial = this.partialDirectory(record.reference.store_key);
      const sealed = this.sealedDirectory(record.reference.store_key);
      const expectedSeal = {
        version: RECORD_VERSION,
        capture_id: record.reference.capture_id,
        request_hash: record.requestHash,
        chain_head: record.chainHead,
        capture_root: captureRoot,
        counts: counterProjection(record.reference),
        sealed_at: sealedAt,
      };
      const existingSealed = await readCaptureSealIfPresent(sealed);
      if (existingSealed) {
        if (!captureSealMatches(existingSealed, expectedSeal)) {
          return this.incomplete(record, "integrity_failure", sealedAt);
        }
        sealedAt = normalizeInstant(existingSealed.sealed_at);
      } else {
        const sealPath = path.join(partial, "capture.seal");
        try {
          await this.writeSynced(
            sealPath,
            Buffer.from(`${canonicalJSONStringify(expectedSeal)}\n`, "utf8"),
            true
          );
        } catch (error) {
          if (!isNodeError(error) || error.code !== "EEXIST") throw error;
          const existingPartial = JSON.parse(
            await readFile(sealPath, "utf8")
          ) as typeof expectedSeal;
          if (!captureSealMatches(existingPartial, expectedSeal)) {
            return this.incomplete(record, "integrity_failure", sealedAt);
          }
          sealedAt = normalizeInstant(existingPartial.sealed_at);
        }
        await this.syncDirectory(partial);
        await rename(partial, sealed);
      }
      await this.syncDirectory(this.dataRoot());
      record.reference = ProtectedEvidenceReference_v1.parse({
        ...record.reference,
        status: "sealed_unindexed",
        sealed_at: sealedAt,
        capture_root: captureRoot,
      });
      await this.updateRecord(record);
      return success(record.reference, false);
    });
  }

  async verifyAndIndexCapture(input: {
    captureId: string;
    reservationToken: string;
    expectedCaptureRoot: string;
    indexedAt: string;
  }): Promise<ProtectedEvidenceMutationResult> {
    return this.mutate(input.captureId, input.reservationToken, async (record) => {
      if (record.reference.status === "complete") return success(record.reference, true);
      if (record.reference.status !== "sealed_unindexed") return failure("invalid_transition");
      let verification: Awaited<ReturnType<LocalProtectedEvidenceStore["verifySealed"]>>;
      try {
        verification = await this.verifySealed(record);
      } catch {
        return this.incomplete(record, "integrity_failure", input.indexedAt);
      }
      if (
        !verification.valid ||
        verification.captureRoot !== input.expectedCaptureRoot ||
        verification.captureRoot !== record.reference.capture_root
      ) {
        return this.incomplete(record, "integrity_failure", input.indexedAt);
      }
      const indexedAt = normalizeInstant(input.indexedAt);
      record.reference = ProtectedEvidenceReference_v1.parse({
        ...record.reference,
        status: "complete",
        indexed_at: indexedAt,
        verification_hash: computeCanonicalHash({
          kind: "protected_evidence_fresh_verification",
          capture_root: verification.captureRoot,
          frame_count: verification.frameCount,
          verified_at: indexedAt,
        }),
      });
      await this.updateRecord(record);
      return success(record.reference, false);
    });
  }

  async markIncomplete(input: {
    captureId: string;
    reservationToken: string;
    reasonCode: ProtectedEvidenceReasonCode;
    terminalAt: string;
  }): Promise<ProtectedEvidenceMutationResult> {
    return this.mutate(input.captureId, input.reservationToken, (record) =>
      this.incomplete(record, input.reasonCode, input.terminalAt)
    );
  }

  async destroyCapture(input: {
    captureId: string;
    requestedAt: string;
  }): Promise<ProtectedEvidenceMutationResult> {
    return this.exclusive(async () => {
      try {
        await this.initialize();
        const record = await this.readRecord(input.captureId);
        if (!record) return failure("not_found");
        if (record.reference.status === "destroyed") return success(record.reference, true);
        if (!["complete", "incomplete", "destruction_failed"].includes(record.reference.status)) {
          return failure("invalid_transition");
        }
        const requestedAt = normalizeInstant(input.requestedAt);
        try {
          await this.removeCaptureBytes(record);
          record.reference = ProtectedEvidenceReference_v1.parse({
            ...record.reference,
            status: "destroyed",
            terminal_at: requestedAt,
            reason_code: record.reference.reason_code,
            retry_after: undefined,
          });
        } catch {
          record.reference = ProtectedEvidenceReference_v1.parse({
            ...record.reference,
            status: "destruction_failed",
            terminal_at: requestedAt,
            reason_code: "deletion_failure",
            retry_after: addMs(requestedAt, 5 * 60 * 1_000),
          });
        }
        await this.updateRecord(record);
        return success(record.reference, false);
      } catch {
        return failure("sink_unavailable");
      }
    });
  }

  async sweep(now: string): Promise<ProtectedEvidenceReference[]> {
    const instant = normalizeInstant(now);
    const expired: string[] = await this.exclusive(async () => {
      await this.initialize();
      const records = await this.allRecords();
      return records
        .filter(
          (record) =>
            !["destroyed", "declared", "open", "sealed_unindexed"].includes(
              record.reference.status
            ) && Date.parse(record.reference.retention_expires_at) <= Date.parse(instant)
        )
        .map((record) => record.reference.capture_id);
    });
    const results: ProtectedEvidenceReference[] = [];
    for (const captureId of expired) {
      const result = await this.destroyCapture({ captureId, requestedAt: instant });
      if (result.applied) results.push(result.reference);
    }
    return results;
  }

  async getReference(captureId: string): Promise<ProtectedEvidenceReference | null> {
    return this.exclusive(async () => {
      try {
        await this.initialize();
        return (await this.readRecord(captureId))?.reference ?? null;
      } catch {
        return null;
      }
    });
  }

  private async mutate(
    captureId: string,
    token: string,
    operation: (record: CaptureRecord) => Promise<ProtectedEvidenceMutationResult>
  ): Promise<ProtectedEvidenceMutationResult> {
    return this.exclusive(async () => {
      try {
        await this.initialize();
        const record = await this.readRecord(captureId);
        if (!record) return failure("not_found");
        if (!sameToken(record.reservationToken, token)) return failure("stale_reservation");
        return await operation(record);
      } catch {
        return failure("sink_unavailable");
      }
    });
  }

  private async incomplete(
    record: CaptureRecord,
    reasonCode: ProtectedEvidenceReasonCode,
    terminalAtCandidate: string
  ): Promise<ProtectedEvidenceMutationResult> {
    if (record.reference.status === "incomplete") return success(record.reference, true);
    if (!canTransitionProtectedEvidenceReference(record.reference.status, "incomplete")) {
      return failure("invalid_transition");
    }
    const terminalAt = normalizeInstant(terminalAtCandidate);
    const prohibited = reasonCode === "prohibited_content";
    record.reference = ProtectedEvidenceReference_v1.parse({
      ...record.reference,
      status: "incomplete",
      retention_class: prohibited ? "prohibited_content" : "incomplete",
      terminal_at: terminalAt,
      reason_code: reasonCode,
      indexed_at: undefined,
      verification_hash: undefined,
      retention_expires_at: addMs(
        terminalAt,
        prohibited
          ? STAGE1_SYNTHETIC_EVIDENCE_PROFILE.prohibitedQuarantineMs
          : STAGE1_SYNTHETIC_EVIDENCE_PROFILE.incompleteRetentionMs
      ),
    });
    await this.updateRecord(record);
    return success(record.reference, false);
  }

  private async initialize(): Promise<void> {
    if (!path.isAbsolute(this.root)) throw new Error("protected evidence root must be absolute");
    const rootStats = await lstat(this.root);
    const resolved = await realpath(this.root);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      resolved !== path.resolve(this.root)
    ) {
      throw new Error("protected evidence root identity is invalid");
    }
    if (!(await this.attestRoot(resolved))) {
      throw new Error("protected evidence root ACL/ownership attestation failed");
    }
    if (this.initialized) return;
    await this.ensureDataDirectory(this.recordsRoot());
    await this.ensureDataDirectory(this.dataRoot());
    await this.syncDirectory(this.root);
    this.initialized = true;
  }

  private async ensureDataDirectory(directory: string): Promise<void> {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    const info = await lstat(directory);
    const resolved = await realpath(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || resolved !== path.resolve(directory)) {
      throw new Error("protected evidence data directory identity is invalid");
    }
  }

  private async usage(): Promise<{ live_captures: number; reserved_bytes: number }> {
    const records = await this.allRecords();
    const live = records.filter((record) =>
      ["declared", "open", "sealed_unindexed"].includes(record.reference.status)
    );
    return {
      live_captures: live.length,
      reserved_bytes: live.reduce((sum, record) => sum + record.request.reserved_bytes, 0),
    };
  }

  private async allRecords(): Promise<CaptureRecord[]> {
    const entries = (await readdir(this.recordsRoot())).filter((entry) => entry.endsWith(".json"));
    if (entries.length > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxLiveCaptures * 4) {
      throw new Error("protected evidence record inventory is unbounded");
    }
    const records: CaptureRecord[] = [];
    for (const entry of entries)
      records.push(await this.readRecordFile(path.join(this.recordsRoot(), entry)));
    return records;
  }

  private async createRecord(record: CaptureRecord): Promise<void> {
    const target = this.recordPath(record.reference.capture_id);
    const bytes = encodeRecord(record);
    await this.writeSynced(target, bytes, true);
    await this.syncDirectory(this.recordsRoot());
  }

  private async updateRecord(record: CaptureRecord): Promise<void> {
    const target = this.recordPath(record.reference.capture_id);
    const temporary = `${target}.${this.random(8).toString("hex")}.tmp`;
    await this.writeSynced(temporary, encodeRecord(record), true);
    await rename(temporary, target);
    await this.syncDirectory(this.recordsRoot());
  }

  private async readRecord(captureId: string): Promise<CaptureRecord | null> {
    try {
      return await this.readRecordFile(this.recordPath(captureId));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async readRecordFile(file: string): Promise<CaptureRecord> {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) throw new Error("invalid evidence record");
    const parsed = JSON.parse(await readFile(file, "utf8")) as CaptureRecord;
    if (
      parsed.version !== RECORD_VERSION ||
      ProtectedEvidenceReservationRequest_v1.safeParse(parsed.request).success === false ||
      ProtectedEvidenceReference_v1.safeParse(parsed.reference).success === false ||
      !/^[0-9a-f]{64}$/u.test(parsed.reservationToken) ||
      !/^sha256:[0-9a-f]{64}$/u.test(parsed.chainHead) ||
      parsed.requestHash !== computeCanonicalHash(parsed.request)
    ) {
      throw new Error("invalid evidence record");
    }
    return parsed;
  }

  private async containsProhibitedContent(
    record: CaptureRecord,
    payload: Buffer
  ): Promise<boolean> {
    if (this.prohibitedSentinels.length === 0) return false;
    let previous: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    if (record.reference.frame_count > 0) {
      const frame = await readFrame(
        path.join(
          this.partialDirectory(record.reference.store_key),
          `${String(record.reference.frame_count).padStart(8, "0")}.frame`
        )
      );
      const tailSize = Math.max(...this.prohibitedSentinels.map((value) => value.length)) - 1;
      previous = frame.payload.subarray(Math.max(0, frame.payload.length - tailSize));
    }
    const window = Buffer.concat([previous, payload]);
    return this.prohibitedSentinels.some((sentinel) => window.includes(sentinel));
  }

  private async verifySealed(record: CaptureRecord): Promise<{
    valid: boolean;
    captureRoot: string;
    frameCount: number;
  }> {
    const directory = this.sealedDirectory(record.reference.store_key);
    let previous = zeroHash();
    for (let sequence = 1; sequence <= record.reference.frame_count; sequence += 1) {
      const frame = await readFrame(
        path.join(directory, `${String(sequence).padStart(8, "0")}.frame`)
      );
      if (
        frame.header.capture_id !== record.reference.capture_id ||
        frame.header.sequence !== sequence ||
        frame.header.previous_frame_hash !== previous ||
        frame.header.payload_hash !== sha256(frame.payload) ||
        frame.header.payload_length !== frame.payload.length
      ) {
        return { valid: false, captureRoot: zeroHash(), frameCount: sequence - 1 };
      }
      previous = hashFrame(frame.encodedHeader, frame.payload);
    }
    const seal = JSON.parse(await readFile(path.join(directory, "capture.seal"), "utf8")) as {
      capture_root?: string;
      chain_head?: string;
    };
    const captureRoot = computeCaptureRoot({ ...record, chainHead: previous });
    return {
      valid: seal.chain_head === previous && seal.capture_root === captureRoot,
      captureRoot,
      frameCount: record.reference.frame_count,
    };
  }

  private async removeCaptureBytes(record: CaptureRecord): Promise<void> {
    for (const target of [
      this.partialDirectory(record.reference.store_key),
      this.sealedDirectory(record.reference.store_key),
    ]) {
      assertDescendant(this.dataRoot(), target);
      await rm(target, { recursive: true, force: true });
    }
    await this.syncDirectory(this.dataRoot());
  }

  private async writeSynced(file: string, bytes: Buffer, exclusive: boolean): Promise<void> {
    const handle = await open(file, exclusive ? "wx" : "w", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(operation).finally(release);
  }

  private recordsRoot(): string {
    return path.join(this.root, "records");
  }

  private dataRoot(): string {
    return path.join(this.root, "captures");
  }

  private recordPath(captureId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(captureId)) {
      throw new Error("invalid capture identity");
    }
    return path.join(
      this.recordsRoot(),
      `${createHash("sha256").update(captureId, "utf8").digest("hex")}.json`
    );
  }

  private partialDirectory(storeKey: string): string {
    return path.join(this.dataRoot(), `.partial-${physicalKey(storeKey)}`);
  }

  private sealedDirectory(storeKey: string): string {
    return path.join(this.dataRoot(), physicalKey(storeKey));
  }
}

function counters(
  reference: ProtectedEvidenceReference,
  frameClass: ProtectedEvidenceFrameClass,
  payloadBytes: number,
  totalBytes: number
) {
  return {
    frame_count: reference.frame_count + 1,
    event_count: reference.event_count + (frameClass === "executor_event" ? 1 : 0),
    total_bytes: reference.total_bytes + totalBytes,
    stdout_bytes: reference.stdout_bytes + (frameClass === "executor_stdout" ? payloadBytes : 0),
    stderr_bytes: reference.stderr_bytes + (frameClass === "executor_stderr" ? payloadBytes : 0),
    provider_control_bytes:
      reference.provider_control_bytes +
      (["provider_receipt", "control_evidence", "verifier_evidence"].includes(frameClass)
        ? payloadBytes
        : 0),
  };
}

function limitExceeded(
  record: CaptureRecord,
  next: ReturnType<typeof counters>
): ProtectedEvidenceReasonCode | null {
  if (
    next.frame_count > record.request.reserved_frames ||
    next.frame_count > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxFrames
  ) {
    return "frame_limit_exceeded";
  }
  if (
    next.event_count > record.request.reserved_events ||
    next.event_count > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxJsonlEvents
  ) {
    return "event_limit_exceeded";
  }
  if (
    next.total_bytes > record.request.reserved_bytes ||
    next.total_bytes > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxContainerBytes ||
    next.stdout_bytes > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStdoutBytes ||
    next.stderr_bytes > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxStderrBytes ||
    next.provider_control_bytes > STAGE1_SYNTHETIC_EVIDENCE_PROFILE.maxProviderControlBytes
  ) {
    return "byte_limit_exceeded";
  }
  return null;
}

function computeCaptureRoot(record: CaptureRecord): string {
  return computeCanonicalHash({
    kind: "protected_evidence_capture_root_v1",
    capture_id: record.reference.capture_id,
    request_hash: record.requestHash,
    bindings: bindingProjection(record.reference),
    chain_head: record.chainHead,
    counts: counterProjection(record.reference),
  });
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

async function readFrame(file: string): Promise<{
  header: FrameHeader;
  encodedHeader: Buffer;
  payload: Buffer;
}> {
  const bytes = await readFile(file);
  if (bytes.length < 5) throw new Error("invalid evidence frame");
  const headerLength = bytes.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > 64 * 1_024 || 4 + headerLength > bytes.length) {
    throw new Error("invalid evidence frame header");
  }
  const encodedHeader = bytes.subarray(4, 4 + headerLength);
  const payload = bytes.subarray(4 + headerLength);
  const header = JSON.parse(encodedHeader.toString("utf8")) as FrameHeader;
  if (header.version !== FRAME_VERSION) throw new Error("invalid evidence frame version");
  return { header, encodedHeader, payload };
}

async function readCaptureSealIfPresent(directory: string): Promise<CaptureSeal | null> {
  try {
    return JSON.parse(await readFile(path.join(directory, "capture.seal"), "utf8")) as CaptureSeal;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function captureSealMatches(actual: CaptureSeal, expected: CaptureSeal): boolean {
  return (
    actual.version === expected.version &&
    actual.capture_id === expected.capture_id &&
    actual.request_hash === expected.request_hash &&
    actual.chain_head === expected.chain_head &&
    actual.capture_root === expected.capture_root &&
    canonicalJSONStringify(actual.counts) === canonicalJSONStringify(expected.counts) &&
    Number.isFinite(Date.parse(actual.sealed_at))
  );
}

function frameHeader(input: {
  captureId: string;
  sequence: number;
  frameClass: ProtectedEvidenceFrameClass;
  observedAt: string;
  payload: Buffer;
  previousFrameHash: string;
}): FrameHeader {
  return {
    version: FRAME_VERSION,
    capture_id: input.captureId,
    sequence: input.sequence,
    frame_class: input.frameClass,
    observed_at: input.observedAt,
    payload_length: input.payload.length,
    payload_hash: sha256(input.payload),
    previous_frame_hash: input.previousFrameHash,
  };
}

function frameMatchesInput(
  existing: Awaited<ReturnType<typeof readFrame>>,
  input: ProtectedEvidenceFrameInput,
  payload: Buffer,
  observedAt: string
): boolean {
  return (
    existing.header.capture_id === input.captureId &&
    existing.header.sequence === input.sequence &&
    existing.header.frame_class === input.frameClass &&
    existing.header.observed_at === observedAt &&
    existing.header.payload_length === payload.length &&
    existing.header.payload_hash === sha256(payload) &&
    existing.payload.equals(payload)
  );
}

function frameMatchesExact(
  existing: Awaited<ReturnType<typeof readFrame>>,
  header: FrameHeader,
  payload: Buffer
): boolean {
  return (
    existing.encodedHeader.equals(Buffer.from(canonicalJSONStringify(header), "utf8")) &&
    existing.payload.equals(payload)
  );
}

function hashFrame(encodedHeader: Buffer, payload: Buffer): string {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encodedHeader.length);
  const digest = createHash("sha256")
    .update(FRAME_DOMAIN)
    .update(length)
    .update(encodedHeader)
    .update(payload)
    .digest("hex");
  return `sha256:${digest}`;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function zeroHash(): string {
  return `sha256:${"0".repeat(64)}`;
}

function encodeRecord(record: CaptureRecord): Buffer {
  const bytes = Buffer.from(`${canonicalJSONStringify(record)}\n`, "utf8");
  if (bytes.length > MAX_RECORD_BYTES) throw new Error("protected evidence record is too large");
  return bytes;
}

function success(
  reference: ProtectedEvidenceReference,
  idempotentReplay: boolean
): ProtectedEvidenceMutationResult {
  return { applied: true, reference, idempotentReplay };
}

function failure(
  reason: Extract<ProtectedEvidenceMutationResult, { applied: false }>["reason"]
): ProtectedEvidenceMutationResult {
  return { applied: false, reason };
}

function normalizeInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("invalid protected evidence timestamp");
  return new Date(timestamp).toISOString();
}

function addMs(value: string, duration: number): string {
  return new Date(Date.parse(value) + duration).toISOString();
}

function physicalKey(storeKey: string): string {
  const match = /^pe:([0-9a-f]{32})$/u.exec(storeKey);
  if (!match) throw new Error("invalid protected evidence store key");
  return `pe-${match[1]}`;
}

function sameToken(expected: string, candidate: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(candidate, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertDescendant(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("protected evidence deletion target escaped its root");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
