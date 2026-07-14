import { AgentTaskReceipt_v2 } from "../schemas/agent-work.js";
import type {
  AgentTaskReceiptOutcome,
  AttemptReceiptDisposition,
  AttemptReceiptStore,
  AttemptReceiptSubmissionResult,
  WorkerSessionStore,
  WorkspaceLifecycleStore,
} from "../store/workspace-lifecycle-store.js";

const MAX_OUTPUT_BYTES = 4_096;

export interface AttemptReceiptStatusResult {
  receipt: AttemptReceiptStatusProjection | null;
}

/** Prompt-safe metadata for a durable worker claim; receipt JSON stays in the store. */
export interface AttemptReceiptStatusProjection {
  receiptId: string;
  receiptHash: string;
  schemaVersion: string;
  runId: string;
  workItemId: string;
  workItemRevision: number;
  attemptId: string;
  packetId: string;
  packetHash: string;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  workerSessionId: string;
  workerSessionRevision: number;
  workerRuntime: string;
  observedBaseSha: string;
  finalHeadSha?: string;
  patchHash?: string;
  outcome: AgentTaskReceiptOutcome;
  disposition: AttemptReceiptDisposition;
  summary: string;
  workerStartedAt: string;
  workerCompletedAt: string;
  submittedAt: string;
  recordedAt: string;
  counts: {
    filesTouched: number;
    commits: number;
    claimedChecks: number;
    blockers: number;
  };
}

/** Shared application boundary for immutable worker receipt claims. */
export class AgentWorkAttemptReceiptService {
  constructor(
    private readonly store: WorkspaceLifecycleStore & AttemptReceiptStore & WorkerSessionStore
  ) {}

  submit(
    input: Parameters<AttemptReceiptStore["submitAttemptReceipt"]>[0]
  ): Promise<AttemptReceiptSubmissionResult> {
    return this.store.submitAttemptReceipt(input);
  }

  async status(input: { runId: string; attemptId: string }): Promise<AttemptReceiptStatusResult> {
    const record = await this.store.getAttemptReceiptForAttempt(input.attemptId);
    if (!record || record.runId !== input.runId) return { receipt: null };
    const parsed = AgentTaskReceipt_v2.safeParse(JSON.parse(record.receiptJson) as unknown);
    if (!parsed.success) throw new Error("Stored Attempt receipt violates AgentTaskReceipt_v2");
    const receipt = parsed.data;
    return {
      receipt: {
        receiptId: bounded(record.receiptId),
        receiptHash: bounded(record.receiptHash),
        schemaVersion: receipt.schema_version,
        runId: bounded(record.runId),
        workItemId: bounded(record.workItemId),
        workItemRevision: record.workItemRevision,
        attemptId: bounded(record.attemptId),
        packetId: bounded(record.packetId),
        packetHash: bounded(record.packetHash),
        workspaceLeaseId: bounded(record.workspaceLeaseId),
        workspaceLeaseRevision: record.workspaceLeaseRevision,
        workerSessionId: bounded(record.workerSessionId),
        workerSessionRevision: record.workerSessionRevision,
        workerRuntime: bounded(record.workerRuntime),
        observedBaseSha: bounded(record.observedBaseSha),
        ...(record.finalHeadSha ? { finalHeadSha: bounded(record.finalHeadSha) } : {}),
        ...(record.patchHash ? { patchHash: bounded(record.patchHash) } : {}),
        outcome: record.outcome,
        disposition: record.disposition,
        summary: bounded(receipt.summary),
        workerStartedAt: receipt.worker_started_at,
        workerCompletedAt: receipt.worker_completed_at,
        submittedAt: receipt.submitted_at,
        recordedAt: record.recordedAt,
        counts: {
          filesTouched: receipt.files_touched.length,
          commits: receipt.commits.length,
          claimedChecks: receipt.claimed_checks.length,
          blockers: receipt.blockers.length,
        },
      },
    };
  }
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return value;
  let end = MAX_OUTPUT_BYTES - 3;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return Buffer.concat([bytes.subarray(0, end), Buffer.from("…")]).toString("utf8");
}
