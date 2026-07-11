/**
 * Agent work protocol contracts.
 *
 * These contracts describe the durable boundary between a run controller,
 * workspace broker, worker, verifier, and human operator. They intentionally
 * do not replace ADR-007's repair-specific TaskSnapshot/TaskReceipt contract.
 *
 * Portable intent lives in AgentTaskPacket_v1. Machine-local paths and runtime
 * details live exclusively in ExecutionEnvelope_v1.
 */

import { z } from "zod";
import { computeCanonicalHash, RepoRelativePath, SHA256Hash } from "./task-contract.js";

export const AGENT_WORK_CONTRACT_VERSION = "1.0.0" as const;

const Id = z.string().min(1);
const Timestamp = z.string().datetime();
const Revision = z.number().int().nonnegative();

/** A full Git object ID. Abbreviated SHAs are not safe concurrency preconditions. */
export const GitObjectId = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, "Must be a full SHA-1 or SHA-256 Git object ID");
export type GitObjectId = z.infer<typeof GitObjectId>;

const PortableRepository = z
  .object({
    id: Id,
    remote_url: z.string().url().optional(),
    default_branch: z.string().min(1).optional(),
  })
  .strict();

const PortableScope = z
  .object({
    read_globs: z.array(z.string().min(1)),
    write_globs: z.array(z.string().min(1)),
    deny_globs: z.array(z.string().min(1)),
    cross_repo_allowed: z.boolean(),
  })
  .strict();

/** Independent authority lanes; false is an explicit denial. */
export const AuthorityEnvelope = z
  .object({
    edit: z.boolean(),
    git_write: z.boolean(),
    github_write: z.boolean(),
    external_runtime: z.boolean(),
    secrets: z.boolean(),
    signing: z.boolean(),
    release: z.boolean(),
  })
  .strict();
export type AuthorityEnvelope = z.infer<typeof AuthorityEnvelope>;

const AcceptanceCriterion = z
  .object({
    id: Id,
    text: z.string().min(1),
  })
  .strict();

// A packet may contain prose, but values that are themselves absolute paths are
// forbidden. This catches accidental host-path fields while allowing URLs and
// ordinary prose. Structured path fields use RepoRelativePath as well.
function isMachineLocalAbsolutePath(value: string): boolean {
  return (
    /(?:^|\s)\/(?!\/)[^\s]*/.test(value) ||
    /(?:^|\s)~\/[^\s]*/.test(value) ||
    /(?:^|\s)\\\\[^\s]*/.test(value) ||
    /(?:^|\s)[a-z]:[\\/][^\s]*/i.test(value) ||
    /(?:^|\s)file:/i.test(value)
  );
}

function rejectMachineLocalPaths(
  value: unknown,
  ctx: z.RefinementCtx,
  path: PropertyKey[] = []
): void {
  if (typeof value === "string") {
    if (isMachineLocalAbsolutePath(value)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: "AgentTaskPacket_v1 must not contain machine-local absolute paths",
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectMachineLocalPaths(item, ctx, [...path, index]));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      rejectMachineLocalPaths(item, ctx, [...path, key]);
    }
  }
}

// =============================================================================
// WORK INTAKE
// =============================================================================

export const WorkItem_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    work_item_id: Id,
    revision: Revision,
    source: z
      .object({
        kind: z.enum(["jira", "github", "manual"]),
        external_id: Id,
        revision: z.string().min(1),
        url: z.string().url().optional(),
        captured_at: Timestamp,
      })
      .strict(),
    repository: PortableRepository,
    title: z.string().min(1),
    objective: z.string().min(1),
    description: z.string(),
    acceptance_criteria: z.array(AcceptanceCriterion),
    constraints: z.array(z.string()),
    labels: z.array(z.string()),
    dependencies: z.array(Id),
  })
  .strict();
export type WorkItem_v1 = z.infer<typeof WorkItem_v1>;

// =============================================================================
// PORTABLE TASK PACKET AND LOCAL EXECUTION ENVELOPE
// =============================================================================

const AgentTaskPacketBase = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    packet_id: Id,
    run_id: Id,
    work_item: z
      .object({
        work_item_id: Id,
        revision: Revision,
      })
      .strict(),
    attempt_id: Id,
    repository: PortableRepository.extend({
      base_sha: GitObjectId,
    }).strict(),
    objective: z.string().min(1),
    acceptance_criteria: z.array(AcceptanceCriterion),
    instructions: z.array(z.string()),
    scope: PortableScope,
    authority: AuthorityEnvelope,
    verification: z.array(
      z
        .object({
          id: Id,
          argv: z.array(z.string()).min(1),
          cwd_rel: RepoRelativePath.optional(),
          expected_exit_codes: z.array(z.number().int()).min(1),
        })
        .strict()
    ),
    budget: z
      .object({
        max_tokens: z.number().int().positive().optional(),
        max_tool_calls: z.number().int().positive().optional(),
        max_elapsed_ms: z.number().int().positive().optional(),
      })
      .strict(),
    created_at: Timestamp,
    packet_hash: SHA256Hash,
  })
  .strict();

export const AgentTaskPacket_v1 = AgentTaskPacketBase.superRefine((packet, ctx) => {
  rejectMachineLocalPaths(packet, ctx);
  const { packet_hash: _packetHash, ...hashable } = packet;
  const expected = computeCanonicalHash(hashable);
  if (packet.packet_hash !== expected) {
    ctx.addIssue({
      code: "custom",
      path: ["packet_hash"],
      message: `Packet hash does not match canonical packet content; expected ${expected}`,
    });
  }
});
export type AgentTaskPacket_v1 = z.infer<typeof AgentTaskPacket_v1>;

export type AgentTaskPacketHashInput = Omit<AgentTaskPacket_v1, "packet_hash">;

export function computeAgentTaskPacketHash(packet: AgentTaskPacketHashInput): string {
  return computeCanonicalHash(packet);
}

export function createAgentTaskPacket(packet: AgentTaskPacketHashInput): AgentTaskPacket_v1 {
  return AgentTaskPacket_v1.parse({
    ...packet,
    packet_hash: computeAgentTaskPacketHash(packet),
  });
}

const AbsolutePath = z.string().min(1).refine(isMachineLocalAbsolutePath, {
  message: "Must be an absolute machine-local path",
});

export const ExecutionEnvelope_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    envelope_id: Id,
    run_id: Id,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    expected_head_sha: GitObjectId,
    runtime: z
      .object({
        host_id: Id,
        os: z.enum(["linux", "windows", "darwin", "other"]),
        architecture: z.string().min(1),
        worker_runtime: z.string().min(1),
        git_runtime: z.string().min(1),
      })
      .strict(),
    paths: z
      .object({
        project_root: AbsolutePath,
        execution_root: AbsolutePath,
        worktree_root: AbsolutePath,
      })
      .strict(),
    path_mappings: z.array(
      z
        .object({
          runtime: z.string().min(1),
          worktree_root: AbsolutePath,
        })
        .strict()
    ),
    exposed_environment_keys: z.array(z.string().min(1)),
    created_at: Timestamp,
  })
  .strict();
export type ExecutionEnvelope_v1 = z.infer<typeof ExecutionEnvelope_v1>;

// =============================================================================
// CONTROLLER AND WORKSPACE LEASES
// =============================================================================

export const ControllerLease_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    lease_id: Id,
    run_id: Id,
    controller_id: Id,
    control_mode: z.enum(["assisted", "headless"]),
    /** Monotonic token used to reject operations from superseded controllers. */
    fence: z.number().int().positive(),
    revision: Revision,
    run_revision: Revision,
    status: z.enum(["active", "released", "expired", "revoked"]),
    acquired_at: Timestamp,
    heartbeat_at: Timestamp,
    expires_at: Timestamp,
    released_at: Timestamp.optional(),
  })
  .strict();
export type ControllerLease_v1 = z.infer<typeof ControllerLease_v1>;

export const WorkspaceLeaseStatus = z.enum([
  "acquired",
  "active",
  "receipt_submitted",
  "verifying",
  "released",
  "preserved",
  "expired",
  "abandoned",
]);
export type WorkspaceLeaseStatus = z.infer<typeof WorkspaceLeaseStatus>;

export const WorkspaceLease_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    lease_id: Id,
    revision: Revision,
    run_id: Id,
    run_revision: Revision,
    work_item_id: Id,
    attempt_id: Id,
    controller_lease_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    repository: PortableRepository,
    base_sha: GitObjectId,
    branch: z.string().min(1),
    scope: PortableScope,
    authority: AuthorityEnvelope,
    status: WorkspaceLeaseStatus,
    acquired_at: Timestamp,
    heartbeat_at: Timestamp,
    expires_at: Timestamp,
    released_at: Timestamp.optional(),
    cleanup_disposition: z.enum(["integrated", "preserved", "abandoned", "discarded"]).optional(),
  })
  .strict();
export type WorkspaceLease_v1 = z.infer<typeof WorkspaceLease_v1>;

// =============================================================================
// WORKER SESSION, RECEIPT, AND ENGINE VERIFICATION
// =============================================================================

export const WorkerSession_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    session_id: Id,
    run_id: Id,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    execution_envelope_id: Id,
    worker: z
      .object({
        backend: z.enum(["host-subagent", "codex-cli", "external"]),
        worker_id: Id,
        model: z.string().min(1).optional(),
      })
      .strict(),
    status: z.enum([
      "starting",
      "running",
      "awaiting_human",
      "completed",
      "failed",
      "cancelled",
      "lost",
    ]),
    started_at: Timestamp,
    heartbeat_at: Timestamp,
    ended_at: Timestamp.optional(),
  })
  .strict();
export type WorkerSession_v1 = z.infer<typeof WorkerSession_v1>;

const ClaimedCheck = z
  .object({
    id: Id,
    outcome: z.enum(["pass", "fail", "not_run"]),
    exit_code: z.number().int().optional(),
    output_snippet: z.string().optional(),
  })
  .strict();

export const AgentTaskReceipt_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    receipt_id: Id,
    run_id: Id,
    work_item_id: Id,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    worker_session_id: Id,
    base_sha: GitObjectId,
    final_head_sha: GitObjectId.optional(),
    outcome: z.enum(["completed", "blocked", "failed", "cancelled"]),
    summary: z.string().min(1),
    files_touched: z.array(RepoRelativePath),
    commits: z.array(GitObjectId),
    acceptance_criteria_addressed: z.array(Id),
    claimed_checks: z.array(ClaimedCheck),
    assumptions: z.array(z.string()),
    blockers: z.array(z.string()),
    human_action_request_ids: z.array(Id),
    cost: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        tool_calls: z.number().int().nonnegative().optional(),
        elapsed_ms: z.number().int().nonnegative().optional(),
      })
      .strict(),
    submitted_at: Timestamp,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    if (receipt.outcome === "completed" && receipt.final_head_sha === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["final_head_sha"],
        message: "A completed receipt must identify its final HEAD",
      });
    }
    if (receipt.outcome === "blocked" && receipt.blockers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "A blocked receipt must include at least one blocker",
      });
    }
  });
export type AgentTaskReceipt_v1 = z.infer<typeof AgentTaskReceipt_v1>;

export const VerificationOutcome = z.enum([
  "pass",
  "fail",
  "inconclusive",
  "infrastructure_error",
  "cancelled",
]);
export type VerificationOutcome = z.infer<typeof VerificationOutcome>;

export const AgentEngineVerification_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    verification_id: Id,
    run_id: Id,
    work_item_id: Id,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    worker_session_id: Id,
    receipt_id: Id,
    receipt_hash: SHA256Hash,
    base_sha: GitObjectId,
    verified_head_sha: GitObjectId.optional(),
    outcome: VerificationOutcome,
    summary: z.string().min(1),
    checks: z.array(
      z
        .object({
          id: Id,
          outcome: VerificationOutcome,
          exit_code: z.number().int().optional(),
          stdout_snippet: z.string().optional(),
          stderr_snippet: z.string().optional(),
          artifact_refs: z.array(z.string()),
        })
        .strict()
    ),
    failures: z.array(z.string()),
    trust_gap: z.boolean(),
    verifier_id: Id,
    started_at: Timestamp,
    completed_at: Timestamp,
  })
  .strict();
export type AgentEngineVerification_v1 = z.infer<typeof AgentEngineVerification_v1>;

export interface AgentTaskReceiptBindingContext {
  packet: AgentTaskPacket_v1;
  lease: WorkspaceLease_v1;
  session: WorkerSession_v1;
}

/** Verify that a worker receipt belongs to one exact attempt and workspace. */
export function validateAgentTaskReceiptBinding(
  context: AgentTaskReceiptBindingContext,
  receipt: AgentTaskReceipt_v1
): { valid: boolean; errors: string[] } {
  const { packet, lease, session } = context;
  const expected: Array<[string, unknown, unknown]> = [
    ["run_id", packet.run_id, receipt.run_id],
    ["attempt_id", packet.attempt_id, receipt.attempt_id],
    ["work_item_id", packet.work_item.work_item_id, receipt.work_item_id],
    ["packet_id", packet.packet_id, receipt.packet_id],
    ["packet_hash", packet.packet_hash, receipt.packet_hash],
    ["workspace_lease_id", lease.lease_id, receipt.workspace_lease_id],
    ["workspace_lease_revision", lease.revision, receipt.workspace_lease_revision],
    ["worker_session_id", session.session_id, receipt.worker_session_id],
    ["base_sha", packet.repository.base_sha, receipt.base_sha],
  ];

  const errors = expected
    .filter(([, expectedValue, actualValue]) => expectedValue !== actualValue)
    .map(
      ([field, expectedValue, actualValue]) =>
        `${field} mismatch: expected=${String(expectedValue)}, actual=${String(actualValue)}`
    );

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// DELIBERATE HUMAN AIRLOCK
// =============================================================================

export const HumanActionPreconditions = z
  .object({
    run_revision: Revision,
    workspace_lease_revision: Revision,
    expected_head_sha: GitObjectId,
  })
  .strict();
export type HumanActionPreconditions = z.infer<typeof HumanActionPreconditions>;

export const HumanActionRequest_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    request_id: Id,
    run_id: Id,
    attempt_id: Id,
    workspace_lease_id: Id,
    worker_session_id: Id,
    action: z.enum([
      "approve_scope",
      "sign_commit",
      "authenticate",
      "approve_push",
      "approve_merge",
      "other",
    ]),
    summary: z.string().min(1),
    instructions: z.array(z.string()).min(1),
    suggested_commands: z.array(z.string()),
    preconditions: HumanActionPreconditions,
    requested_at: Timestamp,
    expires_at: Timestamp.optional(),
  })
  .strict();
export type HumanActionRequest_v1 = z.infer<typeof HumanActionRequest_v1>;

export const HumanActionReceipt_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    receipt_id: Id,
    request_id: Id,
    run_id: Id,
    attempt_id: Id,
    workspace_lease_id: Id,
    worker_session_id: Id,
    observed_preconditions: HumanActionPreconditions,
    outcome: z.enum(["completed", "declined", "expired", "failed"]),
    actor_id: Id,
    summary: z.string().min(1),
    resulting_head_sha: GitObjectId.optional(),
    completed_at: Timestamp,
  })
  .strict();
export type HumanActionReceipt_v1 = z.infer<typeof HumanActionReceipt_v1>;

/** Refuse stale or cross-attempt human approvals. */
export function validateHumanActionReceiptBinding(
  request: HumanActionRequest_v1,
  receipt: HumanActionReceipt_v1
): { valid: boolean; errors: string[] } {
  const expected: Array<[string, unknown, unknown]> = [
    ["request_id", request.request_id, receipt.request_id],
    ["run_id", request.run_id, receipt.run_id],
    ["attempt_id", request.attempt_id, receipt.attempt_id],
    ["workspace_lease_id", request.workspace_lease_id, receipt.workspace_lease_id],
    ["worker_session_id", request.worker_session_id, receipt.worker_session_id],
    [
      "run_revision",
      request.preconditions.run_revision,
      receipt.observed_preconditions.run_revision,
    ],
    [
      "workspace_lease_revision",
      request.preconditions.workspace_lease_revision,
      receipt.observed_preconditions.workspace_lease_revision,
    ],
    [
      "expected_head_sha",
      request.preconditions.expected_head_sha,
      receipt.observed_preconditions.expected_head_sha,
    ],
  ];

  const errors = expected
    .filter(([, expectedValue, actualValue]) => expectedValue !== actualValue)
    .map(
      ([field, expectedValue, actualValue]) =>
        `${field} mismatch: expected=${String(expectedValue)}, actual=${String(actualValue)}`
    );

  return { valid: errors.length === 0, errors };
}

export function parseWorkItem(data: unknown): WorkItem_v1 {
  return WorkItem_v1.parse(data);
}

export function parseAgentTaskPacket(data: unknown): AgentTaskPacket_v1 {
  return AgentTaskPacket_v1.parse(data);
}

export function parseExecutionEnvelope(data: unknown): ExecutionEnvelope_v1 {
  return ExecutionEnvelope_v1.parse(data);
}

export function parseControllerLease(data: unknown): ControllerLease_v1 {
  return ControllerLease_v1.parse(data);
}

export function parseWorkspaceLease(data: unknown): WorkspaceLease_v1 {
  return WorkspaceLease_v1.parse(data);
}

export function parseWorkerSession(data: unknown): WorkerSession_v1 {
  return WorkerSession_v1.parse(data);
}

export function parseAgentTaskReceipt(data: unknown): AgentTaskReceipt_v1 {
  return AgentTaskReceipt_v1.parse(data);
}

export function parseAgentEngineVerification(data: unknown): AgentEngineVerification_v1 {
  return AgentEngineVerification_v1.parse(data);
}

export function parseHumanActionRequest(data: unknown): HumanActionRequest_v1 {
  return HumanActionRequest_v1.parse(data);
}

export function parseHumanActionReceipt(data: unknown): HumanActionReceipt_v1 {
  return HumanActionReceipt_v1.parse(data);
}
