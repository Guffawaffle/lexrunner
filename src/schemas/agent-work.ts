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
/** Breaking receipt-only evolution; the surrounding agent-work v1 contracts remain unchanged. */
export const AGENT_TASK_RECEIPT_V2_VERSION = "2.0.0" as const;
/** Reproducible patch-byte profile used by AgentTaskReceipt_v2.patch_hash claims. */
export const AGENT_TASK_RECEIPT_PATCH_PROFILE = "git-diff-binary-v1" as const;
/** Breaking verification-only evolution for durable AgentTaskReceipt v2 evidence. */
export const AGENT_ENGINE_VERIFICATION_V2_VERSION = "2.0.0" as const;

const Id = z.string().min(1);
const Timestamp = z.string().datetime();
const Revision = z.number().int().nonnegative();

function timestampMillis(value: string): number {
  return Date.parse(value);
}

function requireTimestampOrder(
  earlier: string,
  later: string,
  laterPath: string,
  ctx: z.RefinementCtx
): void {
  if (timestampMillis(later) < timestampMillis(earlier)) {
    ctx.addIssue({
      code: "custom",
      path: [laterPath],
      message: `${laterPath} must not precede the related earlier timestamp`,
    });
  }
}

/** A full Git object ID. Abbreviated SHAs are not safe concurrency preconditions. */
export const GitObjectId = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, "Must be a full SHA-1 or SHA-256 Git object ID");
export type GitObjectId = z.infer<typeof GitObjectId>;

/** Canonical persisted Git identity for receipt v2. */
const CanonicalGitObjectId = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Must be a lowercase full Git object ID");
const ReceiptTimestampV2 = z.string().datetime({ offset: true });

const PortableRepository = z
  .object({
    id: Id,
    remote_url: z.string().url().optional(),
    default_branch: z.string().min(1).optional(),
  })
  .strict();

const PortableGlob = z
  .string()
  .min(1)
  .refine((value) => !isMachineLocalAbsolutePath(value), {
    message: "Glob must be repository-relative",
  })
  .refine((value) => !value.split(/[\\/]/u).includes(".."), {
    message: "Glob must not escape the repository root",
  });

const AgentRepoRelativePath = RepoRelativePath.min(1).refine(
  (value) => !value.split(/[\\/]/u).includes(".."),
  { message: "Path must not escape repo root" }
);

/** Canonical slash-only Git repository path used by receipt v2 persistence. */
const CanonicalAgentRepoPathV2 = AgentRepoRelativePath.refine((value) => !value.includes("\0"), {
  message: "Path must not contain NUL bytes",
})
  .refine((value) => !value.includes("\\"), {
    message: "Path must use forward-slash separators",
  })
  .refine((value) => value.split("/").every((segment) => segment.length > 0 && segment !== "."), {
    message: "Path must not contain empty or dot segments",
  });

const PortableScope = z
  .object({
    read_globs: z.array(PortableGlob),
    write_globs: z.array(PortableGlob),
    deny_globs: z.array(PortableGlob),
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

function requireUniqueIds(
  values: Array<{ id: string }>,
  field: string,
  ctx: z.RefinementCtx
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      ctx.addIssue({
        code: "custom",
        path: [field, index, "id"],
        message: `${field} IDs must be unique`,
      });
    }
    seen.add(value.id);
  });
}

function requireUniqueStrings(values: string[], field: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [field, index],
        message: `${field} values must be unique`,
      });
    }
    seen.add(value);
  });
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
// COORDINATED RUNS AND ATTEMPTS
// =============================================================================

export const RunStatus = z.enum([
  "created",
  "planning",
  "ready",
  "executing",
  "verifying",
  "delivering",
  "awaiting_human",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

const RunResumeStatus = z.enum(["planning", "ready", "executing", "verifying", "delivering"]);
const INTERRUPTED_RUN_STATUSES = new Set<RunStatus>(["awaiting_human", "paused", "blocked"]);
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["completed", "failed", "cancelled"]);

/** Canonical orchestration state for one immutable WorkItem revision. */
export const Run_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    run_id: Id,
    revision: Revision,
    work_item_id: Id,
    work_item_revision: Revision,
    control_mode: z.enum(["assisted", "headless"]),
    authority_ceiling: AuthorityEnvelope,
    status: RunStatus,
    active_controller_lease_id: Id.optional(),
    attempt_ids: z.array(Id),
    current_attempt_id: Id.optional(),
    resume_status: RunResumeStatus.optional(),
    created_at: Timestamp,
    updated_at: Timestamp,
    completed_at: Timestamp.optional(),
  })
  .strict()
  .superRefine((run, ctx) => {
    requireTimestampOrder(run.created_at, run.updated_at, "updated_at", ctx);

    if (run.completed_at !== undefined) {
      requireTimestampOrder(run.created_at, run.completed_at, "completed_at", ctx);
      requireTimestampOrder(run.completed_at, run.updated_at, "updated_at", ctx);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status) !== (run.completed_at !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "completed_at is required exactly when a Run is terminal",
      });
    }
    if (INTERRUPTED_RUN_STATUSES.has(run.status) !== (run.resume_status !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["resume_status"],
        message: "resume_status is required exactly when a Run is interrupted",
      });
    }
    if (new Set(run.attempt_ids).size !== run.attempt_ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["attempt_ids"],
        message: "attempt_ids must not contain duplicates",
      });
    }
    if (run.current_attempt_id !== undefined && !run.attempt_ids.includes(run.current_attempt_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["current_attempt_id"],
        message: "current_attempt_id must reference an entry in attempt_ids",
      });
    }
  });
export type Run_v1 = z.infer<typeof Run_v1>;

export const AttemptStatus = z.enum([
  "prepared",
  "leased",
  "launching",
  "running",
  "receipt_submitted",
  "verifying",
  "verified",
  "accepted",
  "rejected",
  "inconclusive",
  "blocked",
  "launch_failed",
  "failed",
  "cancelled",
  "quarantined",
]);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

const ATTEMPT_STATUSES_REQUIRING_LEASE = new Set<AttemptStatus>([
  "leased",
  "launching",
  "running",
  "receipt_submitted",
  "verifying",
  "verified",
  "accepted",
  "rejected",
  "inconclusive",
  "blocked",
  "launch_failed",
  "failed",
  "quarantined",
]);
const ATTEMPT_STATUSES_REQUIRING_RECEIPT = new Set<AttemptStatus>([
  "receipt_submitted",
  "verifying",
  "verified",
  "accepted",
  "rejected",
  "inconclusive",
]);
const ATTEMPT_STATUSES_REQUIRING_VERIFICATION = new Set<AttemptStatus>([
  "verified",
  "accepted",
  "rejected",
  "inconclusive",
]);
const TERMINAL_ATTEMPT_STATUSES = new Set<AttemptStatus>([
  "accepted",
  "rejected",
  "inconclusive",
  "blocked",
  "launch_failed",
  "failed",
  "cancelled",
  "quarantined",
]);

export function attemptStatusRequiresReceipt(status: AttemptStatus): boolean {
  return ATTEMPT_STATUSES_REQUIRING_RECEIPT.has(status);
}

export function attemptStatusRequiresVerification(status: AttemptStatus): boolean {
  return ATTEMPT_STATUSES_REQUIRING_VERIFICATION.has(status);
}

export function isTerminalAttemptStatus(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status);
}

/** One worker try, bound to one immutable packet and pinned repository base. */
export const Attempt_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    attempt_id: Id,
    revision: Revision,
    run_id: Id,
    run_revision: Revision,
    work_item_id: Id,
    work_item_revision: Revision,
    packet_id: Id,
    packet_hash: SHA256Hash,
    base_sha: GitObjectId,
    workspace_lease_id: Id.optional(),
    receipt_id: Id.optional(),
    verification_id: Id.optional(),
    status: AttemptStatus,
    created_at: Timestamp,
    updated_at: Timestamp,
    completed_at: Timestamp.optional(),
  })
  .strict()
  .superRefine((attempt, ctx) => {
    requireTimestampOrder(attempt.created_at, attempt.updated_at, "updated_at", ctx);

    if (attempt.completed_at !== undefined) {
      requireTimestampOrder(attempt.created_at, attempt.completed_at, "completed_at", ctx);
      requireTimestampOrder(attempt.completed_at, attempt.updated_at, "updated_at", ctx);
    }
    if (TERMINAL_ATTEMPT_STATUSES.has(attempt.status) !== (attempt.completed_at !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "completed_at is required exactly when an Attempt is terminal",
      });
    }
    if (
      ATTEMPT_STATUSES_REQUIRING_LEASE.has(attempt.status) &&
      attempt.workspace_lease_id === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["workspace_lease_id"],
        message: `workspace_lease_id is required for Attempt status ${attempt.status}`,
      });
    }
    if (attempt.status === "prepared" && attempt.workspace_lease_id !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["workspace_lease_id"],
        message: "A prepared Attempt has not acquired a workspace lease",
      });
    }
    if (
      ATTEMPT_STATUSES_REQUIRING_RECEIPT.has(attempt.status) &&
      attempt.receipt_id === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["receipt_id"],
        message: `receipt_id is required for Attempt status ${attempt.status}`,
      });
    }
    if (
      ATTEMPT_STATUSES_REQUIRING_VERIFICATION.has(attempt.status) &&
      attempt.verification_id === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["verification_id"],
        message: `verification_id is required for Attempt status ${attempt.status}`,
      });
    }
  });
export type Attempt_v1 = z.infer<typeof Attempt_v1>;

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
          cwd_rel: AgentRepoRelativePath.optional(),
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

/** Portable packet content before LexRunner derives and verifies packet_hash. */
export const AgentTaskPacketHashInput_v1 = AgentTaskPacketBase.omit({ packet_hash: true });

export const AgentTaskPacket_v1 = AgentTaskPacketBase.superRefine((packet, ctx) => {
  rejectMachineLocalPaths(packet, ctx);
  requireUniqueIds(packet.acceptance_criteria, "acceptance_criteria", ctx);
  requireUniqueIds(packet.verification, "verification", ctx);
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

export type AgentTaskPacketHashInput = z.infer<typeof AgentTaskPacketHashInput_v1>;

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

export const ExecutionEnvironmentOS = z.enum(["linux", "windows", "darwin", "other"]);
export type ExecutionEnvironmentOS = z.infer<typeof ExecutionEnvironmentOS>;

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
    /** Emitted by Stage 3 launch bundles; optional for pre-Stage-3 v1 envelopes. */
    branch: z.string().min(1).optional(),
    runtime: z
      .object({
        host_id: Id,
        os: ExecutionEnvironmentOS,
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
  "reserved",
  "acquired",
  "active",
  "receipt_submitted",
  "verifying",
  "released",
  "preserved",
  "quarantined",
  "expired",
  "abandoned",
]);
export type WorkspaceLeaseStatus = z.infer<typeof WorkspaceLeaseStatus>;

export const WorkspaceCleanupDisposition = z.enum([
  "integrated",
  "preserved",
  "abandoned",
  "discarded",
]);
export type WorkspaceCleanupDisposition = z.infer<typeof WorkspaceCleanupDisposition>;

export const WorkspaceLease_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    lease_id: Id,
    revision: Revision,
    run_id: Id,
    run_revision: Revision,
    work_item_id: Id,
    work_item_revision: Revision,
    attempt_id: Id,
    controller_lease_id: Id,
    controller_fence: z.number().int().positive(),
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
    cleanup_disposition: WorkspaceCleanupDisposition.optional(),
  })
  .strict()
  .superRefine((lease, ctx) => {
    requireTimestampOrder(lease.acquired_at, lease.heartbeat_at, "heartbeat_at", ctx);
    requireTimestampOrder(lease.acquired_at, lease.expires_at, "expires_at", ctx);
    if (timestampMillis(lease.heartbeat_at) > timestampMillis(lease.expires_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["heartbeat_at"],
        message: "heartbeat_at must not be later than expires_at",
      });
    }

    const dispositionByTerminalStatus = {
      preserved: "preserved",
      quarantined: "preserved",
      abandoned: "abandoned",
    } as const;
    const finalized = new Set<WorkspaceLeaseStatus>([
      "released",
      "preserved",
      "quarantined",
      "abandoned",
    ]);

    if (finalized.has(lease.status) !== (lease.released_at !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["released_at"],
        message: "released_at is required exactly when a workspace lease is finalized",
      });
    }
    if (lease.released_at !== undefined) {
      requireTimestampOrder(lease.acquired_at, lease.released_at, "released_at", ctx);
    }

    if (lease.status === "released") {
      if (lease.cleanup_disposition !== "integrated" && lease.cleanup_disposition !== "discarded") {
        ctx.addIssue({
          code: "custom",
          path: ["cleanup_disposition"],
          message: "A released lease must be integrated or safely discarded",
        });
      }
    } else if (lease.status in dispositionByTerminalStatus) {
      const expected =
        dispositionByTerminalStatus[lease.status as keyof typeof dispositionByTerminalStatus];
      if (lease.cleanup_disposition !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["cleanup_disposition"],
          message: `Workspace lease status ${lease.status} requires disposition ${expected}`,
        });
      }
    } else if (lease.cleanup_disposition !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cleanup_disposition"],
        message: "A non-finalized workspace lease must not have a cleanup disposition",
      });
    }
  });
export type WorkspaceLease_v1 = z.infer<typeof WorkspaceLease_v1>;

// A local allocation is deliberately separate from AgentTaskPacket_v1. These
// paths and Git registration details are meaningful only to the named host and
// Git runtime; consumers must not infer Windows/WSL equivalence.
export const WorkspaceAllocationStatus = z.enum(["allocated", "active", "released", "quarantined"]);
export type WorkspaceAllocationStatus = z.infer<typeof WorkspaceAllocationStatus>;

export const WorkspaceAllocation_v1 = z
  .object({
    schema_version: z.literal(AGENT_WORK_CONTRACT_VERSION),
    allocation_id: Id,
    revision: Revision,
    run_id: Id,
    attempt_id: Id,
    workspace_lease_id: Id,
    repository: PortableRepository,
    base_sha: GitObjectId,
    branch: z.string().min(1),
    host_id: Id,
    git_runtime: z.string().min(1),
    paths: z
      .object({
        project_root: AbsolutePath,
        worktree_root: AbsolutePath,
        repository_git_common_dir: AbsolutePath,
        worktree_git_dir: AbsolutePath,
      })
      .strict(),
    status: WorkspaceAllocationStatus,
    observation: z
      .object({
        registration: z.enum([
          "registered",
          "missing",
          "unregistered",
          "wrong_repository",
          "wrong_branch",
        ]),
        cleanliness: z.enum(["clean", "dirty", "unknown"]),
        observed_branch: z.string().min(1).optional(),
        observed_head_sha: GitObjectId.optional(),
        observed_at: Timestamp,
      })
      .strict()
      .optional(),
    quarantine_reason: z
      .enum([
        "dirty",
        "missing",
        "unregistered",
        "wrong_repository",
        "wrong_branch",
        "identity_ambiguous",
        "expired",
        "other",
      ])
      .optional(),
    quarantine_evidence: z.array(z.string().min(1)).min(1).optional(),
    allocated_at: Timestamp,
    updated_at: Timestamp,
    released_at: Timestamp.optional(),
    quarantined_at: Timestamp.optional(),
  })
  .strict()
  .superRefine((allocation, ctx) => {
    requireTimestampOrder(allocation.allocated_at, allocation.updated_at, "updated_at", ctx);

    if (allocation.observation !== undefined) {
      requireTimestampOrder(
        allocation.allocated_at,
        allocation.observation.observed_at,
        "observation.observed_at",
        ctx
      );
      requireTimestampOrder(
        allocation.observation.observed_at,
        allocation.updated_at,
        "updated_at",
        ctx
      );
    }
    if (allocation.status === "released") {
      if (allocation.released_at === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["released_at"],
          message: "A released allocation must record released_at",
        });
      }
    } else if (allocation.released_at !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["released_at"],
        message: "released_at is only valid for a released allocation",
      });
    }
    if (allocation.released_at !== undefined) {
      requireTimestampOrder(allocation.allocated_at, allocation.released_at, "released_at", ctx);
      requireTimestampOrder(allocation.released_at, allocation.updated_at, "updated_at", ctx);
    }

    const quarantineFieldsPresent =
      allocation.quarantined_at !== undefined ||
      allocation.quarantine_reason !== undefined ||
      allocation.quarantine_evidence !== undefined;
    if (allocation.status === "quarantined") {
      if (allocation.quarantined_at === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["quarantined_at"],
          message: "A quarantined allocation must record quarantined_at",
        });
      }
      if (allocation.quarantine_reason === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["quarantine_reason"],
          message: "A quarantined allocation must record a reason",
        });
      }
      if (allocation.quarantine_evidence === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["quarantine_evidence"],
          message: "A quarantined allocation must preserve inspection evidence",
        });
      }
      if (allocation.observation === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["observation"],
          message: "A quarantined allocation must include its reconciliation observation",
        });
      }
    } else if (quarantineFieldsPresent) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Quarantine metadata is only valid for a quarantined allocation",
      });
    }
    if (allocation.quarantined_at !== undefined) {
      requireTimestampOrder(
        allocation.allocated_at,
        allocation.quarantined_at,
        "quarantined_at",
        ctx
      );
      requireTimestampOrder(allocation.quarantined_at, allocation.updated_at, "updated_at", ctx);
    }
  });
export type WorkspaceAllocation_v1 = z.infer<typeof WorkspaceAllocation_v1>;

// =============================================================================
// WORKER SESSION, RECEIPT, AND ENGINE VERIFICATION
// =============================================================================

export const WorkerSessionBackend = z.enum(["host-subagent", "codex-cli", "external"]);
export type WorkerSessionBackend = z.infer<typeof WorkerSessionBackend>;

export const WorkerSessionStatus = z.enum([
  "starting",
  "running",
  "awaiting_human",
  "completed",
  "failed",
  "cancelled",
  "lost",
]);
export type WorkerSessionStatus = z.infer<typeof WorkerSessionStatus>;

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
        backend: WorkerSessionBackend,
        worker_id: Id,
        model: z.string().min(1).optional(),
      })
      .strict(),
    status: WorkerSessionStatus,
    started_at: Timestamp,
    heartbeat_at: Timestamp,
    ended_at: Timestamp.optional(),
  })
  .strict();
export type WorkerSession_v1 = z.infer<typeof WorkerSession_v1>;

export const ClaimedCheckOutcome = z.enum(["pass", "fail", "not_run"]);
export type ClaimedCheckOutcome = z.infer<typeof ClaimedCheckOutcome>;

const ClaimedCheck = z
  .object({
    id: Id,
    outcome: ClaimedCheckOutcome,
    exit_code: z.number().int().optional(),
    output_snippet: z.string().optional(),
  })
  .strict();

export const AgentTaskReceiptOutcome = z.enum(["completed", "blocked", "failed", "cancelled"]);
export type AgentTaskReceiptOutcome = z.infer<typeof AgentTaskReceiptOutcome>;

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
    outcome: AgentTaskReceiptOutcome,
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

/**
 * Complete general-work receipt claim for durable ingestion.
 *
 * Every result carries a content identity even when the coordinator, rather
 * than the worker, owns Git commits. Claimed checks and result hashes remain
 * worker assertions; only AgentEngineVerification may establish truth.
 */
export const AgentTaskReceipt_v2 = z
  .object({
    schema_version: z.literal(AGENT_TASK_RECEIPT_V2_VERSION),
    receipt_id: Id,
    run_id: Id,
    work_item_id: Id,
    work_item_revision: Revision,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    worker_runtime: Id,
    worker_session_id: Id,
    observed_base_sha: CanonicalGitObjectId,
    final_head_sha: CanonicalGitObjectId.optional(),
    /**
     * Claimed SHA-256 of git-diff-binary-v1 bytes. With one new GIT_INDEX_FILE,
     * read-tree observed_base_sha; intent-to-add only non-ignored untracked
     * files_touched paths using NUL-safe --literal-pathspecs commands; then run
     * the configuration-independent diff profile specified by ADR-010. Hash
     * stdout bytes unchanged. This differs from receipt_hash and remains a claim.
     */
    patch_hash: SHA256Hash.optional(),
    outcome: AgentTaskReceiptOutcome,
    exit_reason: Id,
    summary: z.string().min(1),
    files_touched: z.array(CanonicalAgentRepoPathV2),
    commits: z.array(CanonicalGitObjectId),
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
    worker_started_at: ReceiptTimestampV2,
    worker_completed_at: ReceiptTimestampV2,
    submitted_at: ReceiptTimestampV2,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    if (receipt.final_head_sha === undefined && receipt.patch_hash === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["final_head_sha"],
        message: "A receipt must identify its result with final_head_sha and/or patch_hash",
      });
    }
    if (receipt.outcome === "blocked" && receipt.blockers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "A blocked receipt must include at least one blocker",
      });
    }
    requireTimestampOrder(
      receipt.worker_started_at,
      receipt.worker_completed_at,
      "worker_completed_at",
      ctx
    );
    requireTimestampOrder(receipt.worker_completed_at, receipt.submitted_at, "submitted_at", ctx);
    requireUniqueStrings(receipt.files_touched, "files_touched", ctx);
    requireUniqueStrings(
      receipt.acceptance_criteria_addressed,
      "acceptance_criteria_addressed",
      ctx
    );
    requireUniqueIds(receipt.claimed_checks, "claimed_checks", ctx);
    requireUniqueStrings(receipt.assumptions, "assumptions", ctx);
    requireUniqueStrings(receipt.blockers, "blockers", ctx);
    requireUniqueStrings(receipt.human_action_request_ids, "human_action_request_ids", ctx);
  })
  .transform((receipt) => ({
    ...receipt,
    files_touched: [...receipt.files_touched].sort(compareCanonicalStrings),
    acceptance_criteria_addressed: [...receipt.acceptance_criteria_addressed].sort(
      compareCanonicalStrings
    ),
    claimed_checks: [...receipt.claimed_checks].sort((left, right) =>
      compareCanonicalStrings(left.id, right.id)
    ),
    assumptions: [...receipt.assumptions].sort(compareCanonicalStrings),
    blockers: [...receipt.blockers].sort(compareCanonicalStrings),
    human_action_request_ids: [...receipt.human_action_request_ids].sort(compareCanonicalStrings),
  }));
export type AgentTaskReceipt_v2 = z.infer<typeof AgentTaskReceipt_v2>;

/**
 * Validate set membership that only the authoritative packet snapshot can establish.
 *
 * AgentTaskReceipt_v2 has no extra-check lane: every claimed check must name one
 * packet-declared verification. A future extra-check lane requires a versioned
 * contract rather than overloading the declared-check namespace.
 */
export function validateAgentTaskReceiptV2PacketReferences(
  packet: AgentTaskPacket_v1,
  receipt: AgentTaskReceipt_v2
): { valid: boolean; errors: string[] } {
  const criterionIds = new Set(packet.acceptance_criteria.map(({ id }) => id));
  const declaredCheckIds = new Set(packet.verification.map(({ id }) => id));
  const errors = [
    ...receipt.acceptance_criteria_addressed
      .filter((id) => !criterionIds.has(id))
      .map((id) => `acceptance_criteria_addressed contains undeclared criterion: ${id}`),
    ...receipt.claimed_checks
      .filter(({ id }) => !declaredCheckIds.has(id))
      .map(({ id }) => `claimed_checks contains undeclared verification: ${id}`),
  ];
  return { valid: errors.length === 0, errors };
}

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

export const EngineVerificationCheckSource_v2 = z.enum(["packet", "engine_extra"]);
export type EngineVerificationCheckSource_v2 = z.infer<typeof EngineVerificationCheckSource_v2>;

export const EngineVerificationDeterminism_v2 = z.enum([
  "deterministic",
  "externally_nondeterministic",
  "unknown",
]);
export type EngineVerificationDeterminism_v2 = z.infer<typeof EngineVerificationDeterminism_v2>;

export const EngineVerificationTrustGapReason_v2 = z.enum([
  "worker_outcome_disagrees",
  "head_identity_disagrees",
  "patch_identity_disagrees",
  "claimed_check_disagrees",
  "authority_deviation",
]);
export type EngineVerificationTrustGapReason_v2 = z.infer<
  typeof EngineVerificationTrustGapReason_v2
>;

const AgentEngineVerificationCheck_v2 = z
  .object({
    id: Id,
    source: EngineVerificationCheckSource_v2,
    outcome: VerificationOutcome,
    command_hash: SHA256Hash,
    cwd_rel: CanonicalAgentRepoPathV2.optional(),
    environment_fingerprint: SHA256Hash,
    exit_code: z.number().int().optional(),
    stdout_hash: SHA256Hash.optional(),
    stderr_hash: SHA256Hash.optional(),
    stdout_snippet: z.string().max(4_096).optional(),
    stderr_snippet: z.string().max(4_096).optional(),
    duration_ms: z.number().int().nonnegative(),
    retry_count: z.number().int().nonnegative(),
    artifact_refs: z.array(z.string().min(1).max(1_024)).max(512),
    determinism: EngineVerificationDeterminism_v2,
  })
  .strict();

/** Immutable engine-observed evidence for one durable AgentTaskReceipt v2. */
export const AgentEngineVerification_v2 = z
  .object({
    schema_version: z.literal(AGENT_ENGINE_VERIFICATION_V2_VERSION),
    verification_id: Id,
    run_id: Id,
    work_item_id: Id,
    work_item_revision: Revision,
    attempt_id: Id,
    packet_id: Id,
    packet_hash: SHA256Hash,
    workspace_lease_id: Id,
    workspace_lease_revision: Revision,
    worker_session_id: Id,
    worker_session_revision: Revision,
    receipt_id: Id,
    receipt_hash: SHA256Hash,
    observed_base_sha: CanonicalGitObjectId,
    verified_head_sha: CanonicalGitObjectId.optional(),
    verified_patch_hash: SHA256Hash.optional(),
    workspace_observation_hash: SHA256Hash,
    outcome: VerificationOutcome,
    summary: z.string().min(1).max(4_096),
    checks: z.array(AgentEngineVerificationCheck_v2).max(1_024),
    failures: z.array(z.string().min(1).max(2_048)).max(1_024),
    trust_gap_reasons: z.array(EngineVerificationTrustGapReason_v2).max(16),
    verifier_id: Id,
    verifier_version: Id,
    started_at: ReceiptTimestampV2,
    completed_at: ReceiptTimestampV2,
  })
  .strict()
  .superRefine((verification, ctx) => {
    if (
      (verification.outcome === "pass" || verification.outcome === "fail") &&
      verification.verified_head_sha === undefined &&
      verification.verified_patch_hash === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["verified_head_sha"],
        message:
          "Conclusive engine verification must identify an observed HEAD and/or canonical patch",
      });
    }
    requireTimestampOrder(verification.started_at, verification.completed_at, "completed_at", ctx);
    requireUniqueIds(verification.checks, "checks", ctx);
    requireUniqueStrings(verification.failures, "failures", ctx);
    requireUniqueStrings(verification.trust_gap_reasons, "trust_gap_reasons", ctx);
    verification.checks.forEach((check, index) => {
      requireUniqueStrings(check.artifact_refs, `checks.${index}.artifact_refs`, ctx);
    });
    if (
      verification.outcome === "pass" &&
      (verification.failures.length > 0 ||
        verification.checks.some((check) => check.outcome !== "pass"))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "A passing verification cannot contain failed checks or failures",
      });
    }
  })
  .transform((verification) => ({
    ...verification,
    checks: verification.checks
      .map((check) => ({
        ...check,
        artifact_refs: [...check.artifact_refs].sort(compareCanonicalStrings),
      }))
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
    failures: [...verification.failures].sort(compareCanonicalStrings),
    trust_gap_reasons: [...verification.trust_gap_reasons].sort(compareCanonicalStrings),
  }));
export type AgentEngineVerification_v2 = z.infer<typeof AgentEngineVerification_v2>;

export function computeAgentEngineVerificationV2Hash(
  verification: AgentEngineVerification_v2
): string {
  return computeCanonicalHash(verification);
}

/** Validate the packet-declared check lane without conflating explicit engine extras. */
export function validateAgentEngineVerificationV2PacketReferences(
  packet: AgentTaskPacket_v1,
  verification: AgentEngineVerification_v2
): { valid: boolean; errors: string[] } {
  const declaredIds = new Set(packet.verification.map(({ id }) => id));
  const observedDeclaredIds = new Set(
    verification.checks.filter(({ source }) => source === "packet").map(({ id }) => id)
  );
  const errors = verification.checks
    .filter(({ id, source }) => source === "packet" && !declaredIds.has(id))
    .map(({ id }) => `checks contains undeclared packet verification: ${id}`);
  if (verification.outcome === "pass") {
    errors.push(
      ...packet.verification
        .filter(({ id }) => !observedDeclaredIds.has(id))
        .map(({ id }) => `passing verification omits packet verification: ${id}`)
    );
  }
  return { valid: errors.length === 0, errors };
}

export interface AgentTaskReceiptBindingContext {
  packet: AgentTaskPacket_v1;
  lease: WorkspaceLease_v1;
  session: WorkerSession_v1;
}

export interface AgentTaskReceiptV2BindingContext {
  packet: AgentTaskPacket_v1;
  lease: WorkspaceLease_v1;
  session: WorkerSession_v1;
  /** Runtime identity persisted with the exact WorkerSession attachment. */
  workerRuntime: string;
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

/** Validate v2 claim identity only; this deliberately does not verify result truth. */
export function validateAgentTaskReceiptV2Binding(
  context: AgentTaskReceiptV2BindingContext,
  receipt: AgentTaskReceipt_v2
): { valid: boolean; errors: string[] } {
  const { packet, lease, session } = context;
  const errors: string[] = [];
  const contextExpected: Array<[string, unknown, unknown]> = [
    ["context.lease.run_id", packet.run_id, lease.run_id],
    ["context.lease.work_item_id", packet.work_item.work_item_id, lease.work_item_id],
    ["context.lease.work_item_revision", packet.work_item.revision, lease.work_item_revision],
    ["context.lease.attempt_id", packet.attempt_id, lease.attempt_id],
    ["context.lease.packet_id", packet.packet_id, lease.packet_id],
    ["context.lease.packet_hash", packet.packet_hash, lease.packet_hash],
    ["context.lease.repository.id", packet.repository.id, lease.repository.id],
    [
      "context.lease.base_sha",
      packet.repository.base_sha.toLowerCase(),
      lease.base_sha.toLowerCase(),
    ],
    ["context.session.run_id", packet.run_id, session.run_id],
    ["context.session.attempt_id", packet.attempt_id, session.attempt_id],
    ["context.session.packet_id", packet.packet_id, session.packet_id],
    ["context.session.packet_hash", packet.packet_hash, session.packet_hash],
    ["context.session.workspace_lease_id", lease.lease_id, session.workspace_lease_id],
  ];
  errors.push(...mismatchErrors(contextExpected));

  const expected: Array<[string, unknown, unknown]> = [
    ["run_id", packet.run_id, receipt.run_id],
    ["attempt_id", packet.attempt_id, receipt.attempt_id],
    ["work_item_id", packet.work_item.work_item_id, receipt.work_item_id],
    ["work_item_revision", packet.work_item.revision, receipt.work_item_revision],
    ["packet_id", packet.packet_id, receipt.packet_id],
    ["packet_hash", packet.packet_hash, receipt.packet_hash],
    ["workspace_lease_id", lease.lease_id, receipt.workspace_lease_id],
    [
      "workspace_lease_revision",
      session.workspace_lease_revision,
      receipt.workspace_lease_revision,
    ],
    ["worker_runtime", context.workerRuntime, receipt.worker_runtime],
    ["worker_session_id", session.session_id, receipt.worker_session_id],
    ["observed_base_sha", packet.repository.base_sha.toLowerCase(), receipt.observed_base_sha],
  ];
  errors.push(...mismatchErrors(expected));
  errors.push(...validateAgentTaskReceiptV2PacketReferences(packet, receipt).errors);

  const terminalSession = new Set<WorkerSession_v1["status"]>([
    "completed",
    "failed",
    "cancelled",
    "lost",
  ]);
  if (!terminalSession.has(session.status)) {
    errors.push(`worker_session status is not terminal: actual=${session.status}`);
  }
  if (session.ended_at === undefined) {
    errors.push("worker_session ended_at is required for receipt binding");
  } else {
    const sessionStarted = timestampMillis(session.started_at);
    const sessionEnded = timestampMillis(session.ended_at);
    const receiptStarted = timestampMillis(receipt.worker_started_at);
    const receiptCompleted = timestampMillis(receipt.worker_completed_at);
    if (sessionStarted > sessionEnded) {
      errors.push("worker_session time window is invalid: ended_at precedes started_at");
    } else {
      if (receiptStarted < sessionStarted) {
        errors.push("worker_started_at precedes the authoritative WorkerSession start");
      }
      if (receiptCompleted > sessionEnded) {
        errors.push("worker_completed_at follows the authoritative WorkerSession end");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function mismatchErrors(values: Array<[string, unknown, unknown]>): string[] {
  return values
    .filter(([, expectedValue, actualValue]) => expectedValue !== actualValue)
    .map(
      ([field, expectedValue, actualValue]) =>
        `${field} mismatch: expected=${String(expectedValue)}, actual=${String(actualValue)}`
    );
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

export function parseRun(data: unknown): Run_v1 {
  return Run_v1.parse(data);
}

export function parseAttempt(data: unknown): Attempt_v1 {
  return Attempt_v1.parse(data);
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

export function parseWorkspaceAllocation(data: unknown): WorkspaceAllocation_v1 {
  return WorkspaceAllocation_v1.parse(data);
}

export function parseWorkerSession(data: unknown): WorkerSession_v1 {
  return WorkerSession_v1.parse(data);
}

export function parseAgentTaskReceipt(data: unknown): AgentTaskReceipt_v1 {
  return AgentTaskReceipt_v1.parse(data);
}

export function parseAgentTaskReceiptV2(data: unknown): AgentTaskReceipt_v2 {
  return AgentTaskReceipt_v2.parse(data);
}

export function parseAgentEngineVerification(data: unknown): AgentEngineVerification_v1 {
  return AgentEngineVerification_v1.parse(data);
}

export function parseAgentEngineVerificationV2(data: unknown): AgentEngineVerification_v2 {
  return AgentEngineVerification_v2.parse(data);
}

export function parseHumanActionRequest(data: unknown): HumanActionRequest_v1 {
  return HumanActionRequest_v1.parse(data);
}

export function parseHumanActionReceipt(data: unknown): HumanActionReceipt_v1 {
  return HumanActionReceipt_v1.parse(data);
}
