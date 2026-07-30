import {
  ExecutionEnvelope_v1,
  type ExecutionEnvelope_v1 as ExecutionEnvelope,
} from "../schemas/agent-work.js";
import { validateAgentExecutionPathBinding } from "../schemas/agent-work-projection.js";
import { computeCanonicalHashFromCompactJSON } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import type { JsonValue } from "./coordination-store.js";
import type {
  AttemptRecord,
  BindLaunchEnvelopeInput,
  LaunchEnvelopeBindingRecord,
  WorkspaceLifecycleLeaseRecord,
} from "./workspace-lifecycle-store.js";

export const MAX_CANONICAL_ENVELOPE_BYTES = 256 * 1024;

export type CanonicalEnvelopeRecord = { [key: string]: JsonValue };

/**
 * Validate immutable launch evidence against its request, Attempt, and lease.
 *
 * This is the shared fail-closed boundary for every workspace lifecycle store.
 * The subset mirrors the durable identities that authorize a worker launch;
 * additional canonical envelope fields remain available to later contract
 * validation without being rewritten here.
 */
export function validateCanonicalEnvelope(
  input: BindLaunchEnvelopeInput,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord
): CanonicalEnvelopeRecord | null {
  return validateEnvelopeEvidence(
    {
      envelopeId: input.envelopeId,
      envelopeHash: input.envelopeHash,
      envelopeJson: input.envelopeJson,
      runId: input.runId,
      attemptId: input.attemptId,
      workspaceLeaseId: input.workspaceLeaseId,
      workspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
      createdAt: input.createdAt,
    },
    attempt,
    lease
  );
}

/** Revalidate a persisted immutable envelope before later lifecycle authority is granted. */
export function validatePersistedCanonicalEnvelope(
  binding: LaunchEnvelopeBindingRecord,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord
): ExecutionEnvelope | null {
  return validateEnvelopeEvidence(
    {
      envelopeId: binding.envelopeId,
      envelopeHash: binding.envelopeHash,
      envelopeJson: binding.envelopeJson,
      runId: binding.runId,
      attemptId: binding.attemptId,
      workspaceLeaseId: binding.workspaceLeaseId,
      workspaceLeaseRevision: binding.workspaceLeaseRevision,
      createdAt: binding.createdAt,
    },
    attempt,
    lease
  );
}

interface EnvelopeEvidence {
  envelopeId: string;
  envelopeHash: string;
  envelopeJson: string;
  runId: string;
  attemptId: string;
  workspaceLeaseId: string;
  workspaceLeaseRevision: number;
  createdAt: string;
}

function validateEnvelopeEvidence(
  evidence: EnvelopeEvidence,
  attempt: AttemptRecord,
  lease: WorkspaceLifecycleLeaseRecord
): ExecutionEnvelope | null {
  const envelope = parseCanonicalEnvelope(evidence.envelopeJson);
  if (
    !envelope ||
    evidence.envelopeHash !== computeCanonicalHashFromCompactJSON(JSON.stringify(envelope))
  )
    return null;

  const expected = {
    envelope_id: evidence.envelopeId,
    run_id: evidence.runId,
    attempt_id: evidence.attemptId,
    packet_id: attempt.packetId,
    packet_hash: attempt.packetHash,
    workspace_lease_id: evidence.workspaceLeaseId,
    workspace_lease_revision: evidence.workspaceLeaseRevision,
    expected_head_sha: attempt.baseSha,
    branch: lease.branch,
    created_at: evidence.createdAt,
    runtime: {
      host_id: lease.hostId,
      git_runtime: lease.gitRuntime,
    },
    paths: {
      worktree_root: lease.worktreePath,
    },
  } satisfies CanonicalEnvelopeRecord;

  if (!containsExpectedFields(envelope, expected)) return null;
  const parsed = ExecutionEnvelope_v1.safeParse(envelope);
  if (!parsed.success || !parsed.data.paths.allocation_root) return null;
  const mapping = validateAgentExecutionPathBinding(parsed.data.path_mappings, {
    repositoryId: lease.repositoryId,
    baseSha: attempt.baseSha,
    hostId: lease.hostId,
    gitRuntime: lease.gitRuntime,
    repositoryRoot: lease.projectRoot,
    allocationRoot: parsed.data.paths.allocation_root,
    worktreePath: lease.worktreePath,
  });
  return mapping.valid ? parsed.data : null;
}

function parseCanonicalEnvelope(envelopeJson: string): CanonicalEnvelopeRecord | null {
  if (Buffer.byteLength(envelopeJson, "utf8") > MAX_CANONICAL_ENVELOPE_BYTES) return null;

  let envelope: unknown;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    return null;
  }

  return isJsonRecord(envelope) && canonicalJSONStringify(envelope) === envelopeJson
    ? envelope
    : null;
}

function containsExpectedFields(
  actual: CanonicalEnvelopeRecord,
  expected: CanonicalEnvelopeRecord
): boolean {
  return Object.entries(expected).every(([field, expectedValue]) => {
    const actualValue = actual[field];
    if (isJsonRecord(expectedValue)) {
      return isJsonRecord(actualValue) && containsExpectedFields(actualValue, expectedValue);
    }
    return actualValue === expectedValue;
  });
}

function isJsonRecord(value: unknown): value is CanonicalEnvelopeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
