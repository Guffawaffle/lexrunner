import { computeCanonicalHashFromCompactJSON } from "../schemas/task-contract.js";
import { canonicalJSONStringify } from "../util/canonicalJson.js";
import type { JsonValue } from "./coordination-store.js";
import type {
  AttemptRecord,
  BindLaunchEnvelopeInput,
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
  const envelope = parseCanonicalEnvelope(input.envelopeJson);
  if (
    !envelope ||
    input.envelopeHash !== computeCanonicalHashFromCompactJSON(JSON.stringify(envelope))
  )
    return null;

  const expected = {
    envelope_id: input.envelopeId,
    run_id: input.runId,
    attempt_id: input.attemptId,
    packet_id: attempt.packetId,
    packet_hash: attempt.packetHash,
    workspace_lease_id: input.workspaceLeaseId,
    workspace_lease_revision: input.expectedWorkspaceLeaseRevision,
    expected_head_sha: attempt.baseSha,
    branch: lease.branch,
    created_at: input.createdAt,
    runtime: {
      host_id: lease.hostId,
      git_runtime: lease.gitRuntime,
    },
    paths: {
      worktree_root: lease.worktreePath,
    },
  } satisfies CanonicalEnvelopeRecord;

  return containsExpectedFields(envelope, expected) ? envelope : null;
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
