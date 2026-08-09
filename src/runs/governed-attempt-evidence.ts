import type {
  ProtectedEvidenceFrameClass,
  ProtectedEvidenceReasonCode,
  ProtectedEvidenceReference_v1,
  ProtectedEvidenceReservationRequest_v1,
  ProtectedEvidenceStore,
} from "../store/protected-evidence-store.js";
import {
  computeProtectedEvidenceFrameHash,
  initialProtectedEvidenceChainHead,
} from "../store/local-protected-evidence-store.js";

export type GovernedAttemptEvidenceFailureCode =
  | "admission_denied"
  | "open_failed"
  | "append_failed"
  | "checkpoint_mismatch"
  | "seal_failed"
  | "verification_failed"
  | "terminal_capture";

export class GovernedAttemptEvidenceError extends Error {
  constructor(
    readonly code: GovernedAttemptEvidenceFailureCode,
    readonly sinkReason?: string
  ) {
    super(`Governed Attempt evidence failure: ${code}`);
    this.name = "GovernedAttemptEvidenceError";
  }
}

export interface GovernedAttemptEvidenceFrameReference {
  captureId: string;
  sequence: number;
  evidenceRef: string;
}

/**
 * Write-only executor-facing evidence port. It exposes bounded hashes and safe
 * references, never raw captured bytes or a physical storage path.
 */
export interface GovernedAttemptEvidenceCapture {
  readonly captureId: string;
  getReference(): ProtectedEvidenceReference_v1;
  append(input: {
    frameClass: ProtectedEvidenceFrameClass;
    bytes: Uint8Array;
    observedAt: string;
  }): Promise<GovernedAttemptEvidenceFrameReference>;
  sealAndVerify(input: {
    sealedAt: string;
    indexedAt: string;
  }): Promise<ProtectedEvidenceReference_v1>;
  markIncomplete(input: {
    reasonCode: ProtectedEvidenceReasonCode;
    terminalAt: string;
  }): Promise<ProtectedEvidenceReference_v1>;
}

/** Trusted coordinator session over the protected evidence store. */
export class ProtectedEvidenceCaptureSession implements GovernedAttemptEvidenceCapture {
  private constructor(
    private readonly store: ProtectedEvidenceStore,
    private readonly token: string,
    private reference: ProtectedEvidenceReference_v1,
    private frameCount: number,
    private chainHead: string
  ) {}

  static async open(input: {
    store: ProtectedEvidenceStore;
    reservation: ProtectedEvidenceReservationRequest_v1;
    openedAt: string;
  }): Promise<ProtectedEvidenceCaptureSession> {
    const reserved = await input.store.reserveCapture(input.reservation);
    if (!reserved.admitted) {
      throw new GovernedAttemptEvidenceError("admission_denied", reserved.reason);
    }
    let reference = reserved.reference;
    if (reference.status === "declared") {
      const requestedOpen = Date.parse(input.openedAt);
      if (!Number.isFinite(requestedOpen)) {
        throw new GovernedAttemptEvidenceError("open_failed", "invalid_timestamp");
      }
      const openedAt = new Date(
        Math.max(requestedOpen, Date.parse(reference.declared_at))
      ).toISOString();
      const opened = await input.store.openCapture({
        captureId: reference.capture_id,
        reservationToken: reserved.reservationToken,
        openedAt,
      });
      if (!opened.applied) {
        throw new GovernedAttemptEvidenceError("open_failed", opened.reason);
      }
      reference = opened.reference;
    }
    if (!["open", "sealed_unindexed", "complete"].includes(reference.status)) {
      throw new GovernedAttemptEvidenceError("terminal_capture", reference.reason_code);
    }
    const checkpoint = await input.store.getWriterCheckpoint({
      captureId: reference.capture_id,
      reservationToken: reserved.reservationToken,
    });
    if (!checkpoint.available) {
      throw new GovernedAttemptEvidenceError("open_failed", checkpoint.reason);
    }
    return new ProtectedEvidenceCaptureSession(
      input.store,
      reserved.reservationToken,
      checkpoint.reference,
      checkpoint.frameCount,
      checkpoint.chainHead
    );
  }

  get captureId(): string {
    return this.reference.capture_id;
  }

  getReference(): ProtectedEvidenceReference_v1 {
    return structuredClone(this.reference);
  }

  async append(input: {
    frameClass: ProtectedEvidenceFrameClass;
    bytes: Uint8Array;
    observedAt: string;
  }): Promise<GovernedAttemptEvidenceFrameReference> {
    if (this.reference.status !== "open") {
      throw new GovernedAttemptEvidenceError("terminal_capture", this.reference.status);
    }
    const sequence = this.frameCount + 1;
    const evidenceRef = computeProtectedEvidenceFrameHash({
      captureId: this.captureId,
      sequence,
      frameClass: input.frameClass,
      observedAt: input.observedAt,
      bytes: input.bytes,
      previousFrameHash: this.chainHead,
    });
    const appended = await this.store.appendFrame({
      captureId: this.captureId,
      reservationToken: this.token,
      sequence,
      frameClass: input.frameClass,
      bytes: input.bytes,
      observedAt: input.observedAt,
    });
    if (!appended.applied) {
      throw new GovernedAttemptEvidenceError("append_failed", appended.reason);
    }
    this.reference = appended.reference;
    if (this.reference.status !== "open") {
      throw new GovernedAttemptEvidenceError(
        "append_failed",
        this.reference.reason_code ?? this.reference.status
      );
    }
    const checkpoint = await this.store.getWriterCheckpoint({
      captureId: this.captureId,
      reservationToken: this.token,
    });
    if (
      !checkpoint.available ||
      checkpoint.frameCount !== sequence ||
      checkpoint.chainHead !== evidenceRef
    ) {
      await this.markIncomplete({
        reasonCode: "integrity_failure",
        terminalAt: input.observedAt,
      }).catch(() => undefined);
      throw new GovernedAttemptEvidenceError(
        "checkpoint_mismatch",
        checkpoint.available ? "integrity_failure" : checkpoint.reason
      );
    }
    this.reference = checkpoint.reference;
    this.frameCount = checkpoint.frameCount;
    this.chainHead = checkpoint.chainHead;
    return { captureId: this.captureId, sequence, evidenceRef };
  }

  async sealAndVerify(input: {
    sealedAt: string;
    indexedAt: string;
  }): Promise<ProtectedEvidenceReference_v1> {
    if (this.reference.status === "complete") return this.getReference();
    if (this.reference.status === "open") {
      const sealed = await this.store.sealCapture({
        captureId: this.captureId,
        reservationToken: this.token,
        expectedFrameCount: this.frameCount,
        expectedChainHead: this.chainHead,
        sealedAt: input.sealedAt,
      });
      if (!sealed.applied || sealed.reference.status !== "sealed_unindexed") {
        throw new GovernedAttemptEvidenceError(
          "seal_failed",
          sealed.applied ? sealed.reference.reason_code : sealed.reason
        );
      }
      this.reference = sealed.reference;
    }
    if (this.reference.status !== "sealed_unindexed" || !this.reference.capture_root) {
      throw new GovernedAttemptEvidenceError("terminal_capture", this.reference.status);
    }
    const verified = await this.store.verifyAndIndexCapture({
      captureId: this.captureId,
      reservationToken: this.token,
      expectedCaptureRoot: this.reference.capture_root,
      indexedAt: input.indexedAt,
    });
    if (!verified.applied || verified.reference.status !== "complete") {
      throw new GovernedAttemptEvidenceError(
        "verification_failed",
        verified.applied ? verified.reference.reason_code : verified.reason
      );
    }
    this.reference = verified.reference;
    return this.getReference();
  }

  async markIncomplete(input: {
    reasonCode: ProtectedEvidenceReasonCode;
    terminalAt: string;
  }): Promise<ProtectedEvidenceReference_v1> {
    if (this.reference.status === "incomplete") return this.getReference();
    const incomplete = await this.store.markIncomplete({
      captureId: this.captureId,
      reservationToken: this.token,
      reasonCode: input.reasonCode,
      terminalAt: input.terminalAt,
    });
    if (!incomplete.applied) {
      throw new GovernedAttemptEvidenceError("verification_failed", incomplete.reason);
    }
    this.reference = incomplete.reference;
    return this.getReference();
  }
}

export function emptyEvidenceChainHead(): string {
  return initialProtectedEvidenceChainHead();
}
