import { describe, expect, it } from "vitest";
import {
  AGENT_WORK_CONTRACT_VERSION,
  AGENT_TASK_RECEIPT_PATCH_PROFILE,
  AGENT_TASK_RECEIPT_V2_VERSION,
  AGENT_ENGINE_VERIFICATION_V2_VERSION,
  AgentEngineVerification_v2,
  AgentTaskPacket_v1,
  AgentTaskReceipt_v1,
  AgentTaskReceipt_v2,
  Attempt_v1,
  ControllerLease_v1,
  AgentEngineVerification_v1,
  ExecutionEnvelope_v1,
  HumanActionReceipt_v1,
  HumanActionRequest_v1,
  Run_v1,
  WorkItem_v1,
  WorkerSession_v1,
  WorkspaceLease_v1,
  WorkspaceAllocation_v1,
  computeAgentTaskPacketHash,
  computeAgentEngineVerificationV2Hash,
  createAgentTaskPacket,
  parseAgentTaskReceiptV2,
  parseAgentEngineVerificationV2,
  validateAgentTaskReceiptBinding,
  validateAgentTaskReceiptV2Binding,
  validateAgentTaskReceiptV2PacketReferences,
  validateAgentEngineVerificationV2PacketReferences,
  validateHumanActionReceiptBinding,
  type AgentTaskPacketHashInput,
} from "../../../src/schemas/agent-work.js";
import { computeCanonicalHash } from "../../../src/schemas/task-contract.js";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PACKET_CREATED_AT = "2026-07-11T12:00:00.000Z";
const NOW = "2026-07-11T12:01:00.000Z";
const LATER = "2026-07-11T12:06:00.000Z";
const SUBMITTED = "2026-07-11T12:07:00.000Z";

function packetInput(): AgentTaskPacketHashInput {
  return {
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    packet_id: "packet-1",
    run_id: "run-1",
    work_item: {
      work_item_id: "LEX-390",
      revision: 3,
    },
    attempt_id: "attempt-1",
    repository: {
      id: "Guffawaffle/lexrunner",
      remote_url: "https://github.com/Guffawaffle/lexrunner.git",
      default_branch: "main",
      base_sha: BASE_SHA,
    },
    objective: "Add a source-neutral agent work protocol.",
    acceptance_criteria: [
      {
        id: "ac-1",
        text: "A worker receipt is bound to one attempt.",
      },
    ],
    instructions: ["Preserve the existing repair-task contracts."],
    scope: {
      read_globs: ["src/**/*.ts", "tests/**/*.ts"],
      write_globs: ["src/schemas/agent-work.ts", "tests/unit/schemas/agent-work.spec.ts"],
      deny_globs: ["docs/TERMS.md", "dist/**"],
      cross_repo_allowed: false,
    },
    authority: {
      edit: true,
      git_write: false,
      github_write: false,
      external_runtime: true,
      secrets: false,
      signing: false,
      release: false,
    },
    verification: [
      {
        id: "unit",
        argv: ["npm", "test", "--", "tests/unit/schemas/agent-work.spec.ts"],
        cwd_rel: ".",
        expected_exit_codes: [0],
      },
    ],
    budget: {
      max_tokens: 8000,
      max_tool_calls: 40,
      max_elapsed_ms: 900000,
    },
    created_at: PACKET_CREATED_AT,
  };
}

function packet() {
  return createAgentTaskPacket(packetInput());
}

function workspaceLease() {
  const taskPacket = packet();
  return WorkspaceLease_v1.parse({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    lease_id: "workspace-lease-1",
    revision: 2,
    run_id: taskPacket.run_id,
    run_revision: 8,
    work_item_id: taskPacket.work_item.work_item_id,
    work_item_revision: taskPacket.work_item.revision,
    attempt_id: taskPacket.attempt_id,
    controller_lease_id: "controller-lease-1",
    controller_fence: 42,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    repository: {
      id: taskPacket.repository.id,
      remote_url: taskPacket.repository.remote_url,
      default_branch: taskPacket.repository.default_branch,
    },
    base_sha: taskPacket.repository.base_sha,
    branch: "agent/lexrunner-contracts-v1",
    scope: taskPacket.scope,
    authority: taskPacket.authority,
    status: "active",
    acquired_at: NOW,
    heartbeat_at: NOW,
    expires_at: LATER,
  });
}

function workerSession() {
  const taskPacket = packet();
  const lease = workspaceLease();
  return WorkerSession_v1.parse({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    session_id: "worker-session-1",
    run_id: taskPacket.run_id,
    attempt_id: taskPacket.attempt_id,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    workspace_lease_id: lease.lease_id,
    workspace_lease_revision: lease.revision,
    execution_envelope_id: "envelope-1",
    worker: {
      backend: "host-subagent",
      worker_id: "contracts-v1",
      model: "codex",
    },
    status: "running",
    started_at: NOW,
    heartbeat_at: NOW,
  });
}

function completedWorkerSession() {
  return WorkerSession_v1.parse({
    ...workerSession(),
    status: "completed",
    heartbeat_at: LATER,
    ended_at: LATER,
  });
}

function agentReceipt() {
  const taskPacket = packet();
  const lease = workspaceLease();
  const session = workerSession();
  return AgentTaskReceipt_v1.parse({
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    receipt_id: "agent-receipt-1",
    run_id: taskPacket.run_id,
    work_item_id: taskPacket.work_item.work_item_id,
    attempt_id: taskPacket.attempt_id,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    workspace_lease_id: lease.lease_id,
    workspace_lease_revision: lease.revision,
    worker_session_id: session.session_id,
    base_sha: BASE_SHA,
    final_head_sha: HEAD_SHA,
    outcome: "completed",
    summary: "Added and tested the contract schemas.",
    files_touched: ["src/schemas/agent-work.ts", "tests/unit/schemas/agent-work.spec.ts"],
    commits: [],
    acceptance_criteria_addressed: ["ac-1"],
    claimed_checks: [{ id: "unit", outcome: "pass", exit_code: 0 }],
    assumptions: [],
    blockers: [],
    human_action_request_ids: [],
    cost: { tool_calls: 12, elapsed_ms: 1000 },
    submitted_at: LATER,
  });
}

function agentReceiptV2(overrides: Record<string, unknown> = {}) {
  const taskPacket = packet();
  const lease = workspaceLease();
  const session = workerSession();
  return parseAgentTaskReceiptV2({
    schema_version: AGENT_TASK_RECEIPT_V2_VERSION,
    receipt_id: "agent-receipt-v2-1",
    run_id: taskPacket.run_id,
    work_item_id: taskPacket.work_item.work_item_id,
    work_item_revision: taskPacket.work_item.revision,
    attempt_id: taskPacket.attempt_id,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    workspace_lease_id: lease.lease_id,
    workspace_lease_revision: session.workspace_lease_revision,
    worker_runtime: "codex-native",
    worker_session_id: session.session_id,
    observed_base_sha: BASE_SHA,
    final_head_sha: HEAD_SHA,
    outcome: "completed",
    exit_reason: "work_complete",
    summary: "Added and tested the complete receipt claims contract.",
    files_touched: ["src/schemas/agent-work.ts", "tests/unit/schemas/agent-work.spec.ts"],
    commits: [HEAD_SHA],
    acceptance_criteria_addressed: ["ac-1"],
    claimed_checks: [{ id: "unit", outcome: "pass", exit_code: 0 }],
    assumptions: [],
    blockers: [],
    human_action_request_ids: [],
    cost: { tool_calls: 12, elapsed_ms: 1000 },
    worker_started_at: NOW,
    worker_completed_at: LATER,
    submitted_at: SUBMITTED,
    ...overrides,
  });
}

function agentVerificationV2(overrides: Record<string, unknown> = {}) {
  const taskPacket = packet();
  const lease = workspaceLease();
  const receipt = agentReceiptV2();
  return parseAgentEngineVerificationV2({
    schema_version: AGENT_ENGINE_VERIFICATION_V2_VERSION,
    verification_id: "agent-verification-v2-1",
    run_id: taskPacket.run_id,
    work_item_id: taskPacket.work_item.work_item_id,
    work_item_revision: taskPacket.work_item.revision,
    attempt_id: taskPacket.attempt_id,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    workspace_lease_id: lease.lease_id,
    workspace_lease_revision: lease.revision,
    worker_session_id: "worker-session-1",
    worker_session_revision: 1,
    receipt_id: receipt.receipt_id,
    receipt_hash: computeCanonicalHash(receipt),
    observed_base_sha: BASE_SHA,
    verified_head_sha: HEAD_SHA,
    workspace_observation_hash: `sha256:${"c".repeat(64)}`,
    outcome: "pass",
    summary: "Engine independently verified the result.",
    checks: [
      {
        id: "unit",
        source: "packet",
        outcome: "pass",
        command_hash: `sha256:${"d".repeat(64)}`,
        environment_fingerprint: `sha256:${"e".repeat(64)}`,
        exit_code: 0,
        stdout_hash: `sha256:${"f".repeat(64)}`,
        duration_ms: 125,
        retry_count: 0,
        artifact_refs: [],
        determinism: "deterministic",
      },
    ],
    failures: [],
    trust_gap_reasons: [],
    verifier_id: "lexrunner-engine",
    verifier_version: "1.1.0",
    started_at: NOW,
    completed_at: LATER,
    ...overrides,
  });
}

function runRecord() {
  return {
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    run_id: "run-1",
    revision: 8,
    work_item_id: "LEX-390",
    work_item_revision: 3,
    control_mode: "assisted" as const,
    authority_ceiling: packetInput().authority,
    status: "executing" as const,
    active_controller_lease_id: "controller-lease-1",
    attempt_ids: ["attempt-1"],
    current_attempt_id: "attempt-1",
    created_at: PACKET_CREATED_AT,
    updated_at: NOW,
  };
}

function attemptRecord() {
  const taskPacket = packet();
  return {
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    attempt_id: taskPacket.attempt_id,
    revision: 2,
    run_id: taskPacket.run_id,
    run_revision: 8,
    work_item_id: taskPacket.work_item.work_item_id,
    work_item_revision: taskPacket.work_item.revision,
    packet_id: taskPacket.packet_id,
    packet_hash: taskPacket.packet_hash,
    base_sha: taskPacket.repository.base_sha,
    workspace_lease_id: "workspace-lease-1",
    status: "running" as const,
    created_at: PACKET_CREATED_AT,
    updated_at: NOW,
  };
}

function workspaceAllocation() {
  return {
    schema_version: AGENT_WORK_CONTRACT_VERSION,
    allocation_id: "allocation-1",
    revision: 2,
    run_id: "run-1",
    attempt_id: "attempt-1",
    workspace_lease_id: "workspace-lease-1",
    repository: {
      id: "Guffawaffle/lexrunner",
      remote_url: "https://github.com/Guffawaffle/lexrunner.git",
      default_branch: "main",
    },
    base_sha: BASE_SHA,
    branch: "agent/attempt-workspace-persistence",
    host_id: "devbox-1",
    git_runtime: "wsl-git",
    paths: {
      project_root: "/srv/lex-mcp/lexrunner",
      worktree_root: "/srv/lex-mcp/lexrunner-agent-worktrees/attempt-1",
      repository_git_common_dir: "/srv/lex-mcp/lexrunner/.git",
      worktree_git_dir: "/srv/lex-mcp/lexrunner/.git/worktrees/attempt-1",
    },
    status: "active" as const,
    observation: {
      registration: "registered" as const,
      cleanliness: "clean" as const,
      observed_branch: "agent/attempt-workspace-persistence",
      observed_head_sha: BASE_SHA,
      observed_at: NOW,
    },
    allocated_at: PACKET_CREATED_AT,
    updated_at: NOW,
  };
}

describe("agent work protocol contracts", () => {
  it("validates a source-neutral work item", () => {
    expect(
      WorkItem_v1.parse({
        schema_version: AGENT_WORK_CONTRACT_VERSION,
        work_item_id: "LEX-390",
        revision: 3,
        source: {
          kind: "jira",
          external_id: "LEX-390",
          revision: "2026-07-11T11:59:00Z",
          url: "https://jira.example.test/browse/LEX-390",
          captured_at: PACKET_CREATED_AT,
        },
        repository: {
          id: "Guffawaffle/lexrunner",
          remote_url: "https://github.com/Guffawaffle/lexrunner.git",
          default_branch: "main",
        },
        title: "Run one issue to completion",
        objective: "Deliver an independently verified pull request.",
        description: "Exercise the agent work protocol.",
        acceptance_criteria: [{ id: "ac-1", text: "The run can resume safely." }],
        constraints: ["Do not bypass required gates."],
        labels: ["agent-work"],
        dependencies: [],
      }).source.kind
    ).toBe("jira");
  });

  it("models a strict coordinated Run without embedding legacy RunState", () => {
    const run = Run_v1.parse(runRecord());
    expect(run.current_attempt_id).toBe("attempt-1");

    expect(
      Run_v1.safeParse({
        ...runRecord(),
        status: "paused",
      }).success
    ).toBe(false);
    expect(
      Run_v1.safeParse({
        ...runRecord(),
        status: "paused",
        resume_status: "executing",
      }).success
    ).toBe(true);
    expect(
      Run_v1.safeParse({
        ...runRecord(),
        status: "completed",
      }).success
    ).toBe(false);
    expect(
      Run_v1.safeParse({
        ...runRecord(),
        status: "completed",
        completed_at: LATER,
        updated_at: LATER,
      }).success
    ).toBe(true);
  });

  it("binds lifecycle Attempts to a packet and requires state evidence", () => {
    expect(Attempt_v1.parse(attemptRecord()).status).toBe("running");

    const { workspace_lease_id: _leaseId, ...prepared } = attemptRecord();
    expect(Attempt_v1.safeParse({ ...prepared, status: "prepared" }).success).toBe(true);
    expect(Attempt_v1.safeParse({ ...prepared, status: "leased" }).success).toBe(false);

    expect(
      Attempt_v1.safeParse({
        ...attemptRecord(),
        status: "accepted",
        completed_at: LATER,
      }).success
    ).toBe(false);
    expect(
      Attempt_v1.safeParse({
        ...attemptRecord(),
        status: "accepted",
        receipt_id: "receipt-1",
        verification_id: "verification-1",
        completed_at: LATER,
        updated_at: LATER,
      }).success
    ).toBe(true);
  });

  it("rejects impossible Run and Attempt timestamp orderings", () => {
    expect(
      Run_v1.safeParse({
        ...runRecord(),
        updated_at: "2026-07-11T11:59:00.000Z",
      }).success
    ).toBe(false);
    expect(
      Attempt_v1.safeParse({
        ...attemptRecord(),
        updated_at: "2026-07-11T11:59:00.000Z",
      }).success
    ).toBe(false);
  });

  it("constructs and validates a canonically bound portable task packet", () => {
    const taskPacket = packet();
    const { packet_hash: _packetHash, ...hashable } = taskPacket;

    expect(taskPacket.packet_hash).toBe(computeAgentTaskPacketHash(hashable));
    expect(AgentTaskPacket_v1.parse(taskPacket)).toEqual(taskPacket);

    expect(
      AgentTaskPacket_v1.safeParse({
        ...taskPacket,
        objective: "A silently changed objective.",
      }).success
    ).toBe(false);
  });

  it("rejects machine-local paths from the portable packet", () => {
    expect(() =>
      createAgentTaskPacket({
        ...packetInput(),
        instructions: ["Use /home/operator/private-worktree"],
      })
    ).toThrow(/machine-local absolute paths/);

    expect(() =>
      createAgentTaskPacket({
        ...packetInput(),
        instructions: ["C:\\dev\\private-worktree"],
      })
    ).toThrow(/machine-local absolute paths/);
  });

  it("keeps machine-local roots in the execution envelope", () => {
    const taskPacket = packet();
    const lease = workspaceLease();
    const envelope = ExecutionEnvelope_v1.parse({
      schema_version: AGENT_WORK_CONTRACT_VERSION,
      envelope_id: "envelope-1",
      run_id: taskPacket.run_id,
      attempt_id: taskPacket.attempt_id,
      packet_id: taskPacket.packet_id,
      packet_hash: taskPacket.packet_hash,
      workspace_lease_id: lease.lease_id,
      workspace_lease_revision: lease.revision,
      expected_head_sha: BASE_SHA,
      branch: lease.branch,
      runtime: {
        host_id: "devbox-1",
        os: "linux",
        architecture: "x64",
        worker_runtime: "codex-host",
        git_runtime: "wsl-git",
      },
      paths: {
        project_root: "/mnt/d/dev/lexrunner",
        execution_root: "/srv/lex-mcp",
        worktree_root: "/srv/lex-mcp/lexrunner-agent-worktrees/contracts-v1",
      },
      path_mappings: [
        { runtime: "wsl", worktree_root: "/srv/lex-mcp/lexrunner-agent-worktrees/contracts-v1" },
        { runtime: "windows", worktree_root: "D:\\dev\\lexrunner-contracts-v1" },
      ],
      exposed_environment_keys: ["PATH"],
      created_at: NOW,
    });

    expect(envelope.paths.worktree_root).toContain("lexrunner-agent-worktrees");
    expect(envelope.path_mappings).toHaveLength(2);
  });

  it("models independent controller and workspace leases", () => {
    const controller = ControllerLease_v1.parse({
      schema_version: AGENT_WORK_CONTRACT_VERSION,
      lease_id: "controller-lease-1",
      run_id: "run-1",
      controller_id: "chat-controller-1",
      control_mode: "assisted",
      fence: 42,
      revision: 1,
      run_revision: 8,
      status: "active",
      acquired_at: NOW,
      heartbeat_at: NOW,
      expires_at: LATER,
    });

    expect(controller.control_mode).toBe("assisted");
    expect(controller.fence).toBe(42);
    expect(ControllerLease_v1.safeParse({ ...controller, fence: 0 }).success).toBe(false);
    expect(workspaceLease().controller_lease_id).toBe(controller.lease_id);
    expect(workspaceLease().controller_fence).toBe(controller.fence);
  });

  it("couples finalized workspace leases to timestamps and cleanup disposition", () => {
    const lease = workspaceLease();
    expect(WorkspaceLease_v1.safeParse({ ...lease, status: "reserved" }).success).toBe(true);
    expect(
      WorkspaceLease_v1.safeParse({
        ...lease,
        status: "quarantined",
        released_at: LATER,
        cleanup_disposition: "preserved",
      }).success
    ).toBe(true);
    expect(
      WorkspaceLease_v1.safeParse({
        ...lease,
        status: "quarantined",
        cleanup_disposition: "discarded",
      }).success
    ).toBe(false);
    expect(
      WorkspaceLease_v1.safeParse({
        ...lease,
        heartbeat_at: "2026-07-11T12:07:00.000Z",
      }).success
    ).toBe(false);
  });

  it("keeps runtime-native workspace identity in a machine-local allocation", () => {
    const allocation = WorkspaceAllocation_v1.parse(workspaceAllocation());
    expect(allocation.paths.worktree_git_dir).toContain(".git/worktrees");
    expect(allocation.host_id).toBe("devbox-1");

    expect(
      WorkspaceAllocation_v1.safeParse({
        ...workspaceAllocation(),
        paths: { ...workspaceAllocation().paths, worktree_root: "relative/worktree" },
      }).success
    ).toBe(false);
  });

  it("requires inspection evidence only for quarantined allocations", () => {
    const allocation = workspaceAllocation();
    expect(
      WorkspaceAllocation_v1.safeParse({
        ...allocation,
        status: "quarantined",
        quarantine_reason: "dirty",
        quarantine_evidence: ["git status reported uncommitted changes"],
        quarantined_at: LATER,
        observation: {
          ...allocation.observation,
          cleanliness: "dirty",
          observed_at: LATER,
        },
        updated_at: LATER,
      }).success
    ).toBe(true);
    expect(
      WorkspaceAllocation_v1.safeParse({
        ...allocation,
        status: "quarantined",
        quarantined_at: LATER,
      }).success
    ).toBe(false);
    expect(
      WorkspaceAllocation_v1.safeParse({
        ...allocation,
        quarantine_reason: "dirty",
        quarantine_evidence: ["unexpected changes"],
        quarantined_at: LATER,
      }).success
    ).toBe(false);
  });

  it("binds a worker receipt to one packet, lease revision, session, and base SHA", () => {
    const binding = validateAgentTaskReceiptBinding(
      { packet: packet(), lease: workspaceLease(), session: workerSession() },
      agentReceipt()
    );
    expect(binding).toEqual({ valid: true, errors: [] });

    const staleReceipt = {
      ...agentReceipt(),
      workspace_lease_revision: 1,
      base_sha: "c".repeat(40),
    };
    const stale = validateAgentTaskReceiptBinding(
      { packet: packet(), lease: workspaceLease(), session: workerSession() },
      AgentTaskReceipt_v1.parse(staleReceipt)
    );
    expect(stale.valid).toBe(false);
    expect(stale.errors).toEqual([
      expect.stringContaining("workspace_lease_revision mismatch"),
      expect.stringContaining("base_sha mismatch"),
    ]);
  });

  it("represents committed and uncommitted v2 result claims with canonical hashes", () => {
    const committed = agentReceiptV2();
    const uncommitted = agentReceiptV2({
      receipt_id: "agent-receipt-v2-uncommitted",
      final_head_sha: undefined,
      patch_hash: `sha256:${"c".repeat(64)}`,
      commits: [],
    });
    const both = agentReceiptV2({
      receipt_id: "agent-receipt-v2-both",
      patch_hash: `sha256:${"d".repeat(64)}`,
    });

    expect(committed.schema_version).toBe("2.0.0");
    expect(AGENT_TASK_RECEIPT_PATCH_PROFILE).toBe("git-diff-binary-v1");
    expect(uncommitted.patch_hash).toBe(`sha256:${"c".repeat(64)}`);
    expect(both.final_head_sha).toBe(HEAD_SHA);
    expect(computeCanonicalHash(parseAgentTaskReceiptV2(committed))).toBe(
      computeCanonicalHash(committed)
    );
    expect(computeCanonicalHash(uncommitted)).not.toBe(computeCanonicalHash(committed));
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...committed,
        final_head_sha: undefined,
        patch_hash: undefined,
      }).success
    ).toBe(false);
  });

  it("canonicalizes receipt v2 set fields while preserving commit order", () => {
    const unordered = parseAgentTaskReceiptV2({
      ...agentReceiptV2(),
      files_touched: ["z.ts", "a.ts"],
      acceptance_criteria_addressed: ["criterion-z", "criterion-a"],
      claimed_checks: [
        { id: "z-check", outcome: "not_run" },
        { id: "a-check", outcome: "pass" },
      ],
      assumptions: ["z assumption", "a assumption"],
      blockers: ["z blocker", "a blocker"],
      human_action_request_ids: ["request-z", "request-a"],
      commits: [HEAD_SHA, BASE_SHA],
    });
    const canonical = parseAgentTaskReceiptV2({
      ...unordered,
      files_touched: ["a.ts", "z.ts"],
      acceptance_criteria_addressed: ["criterion-a", "criterion-z"],
      claimed_checks: [
        { id: "a-check", outcome: "pass" },
        { id: "z-check", outcome: "not_run" },
      ],
      assumptions: ["a assumption", "z assumption"],
      blockers: ["a blocker", "z blocker"],
      human_action_request_ids: ["request-a", "request-z"],
    });

    expect(unordered).toEqual(canonical);
    expect(computeCanonicalHash(unordered)).toBe(computeCanonicalHash(canonical));
    expect(unordered.commits).toEqual([HEAD_SHA, BASE_SHA]);
  });

  it.each([
    ["files_touched", ["same.ts", "same.ts"]],
    ["acceptance_criteria_addressed", ["same", "same"]],
    [
      "claimed_checks",
      [
        { id: "same", outcome: "pass" },
        { id: "same", outcome: "fail" },
      ],
    ],
    ["assumptions", ["same", "same"]],
    ["blockers", ["same", "same"]],
    ["human_action_request_ids", ["same", "same"]],
  ])("rejects duplicate receipt v2 %s set members", (field, value) => {
    expect(AgentTaskReceipt_v2.safeParse({ ...agentReceiptV2(), [field]: value }).success).toBe(
      false
    );
  });

  it("validates receipt v2 criterion and check references against the packet", () => {
    expect(validateAgentTaskReceiptV2PacketReferences(packet(), agentReceiptV2())).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      validateAgentTaskReceiptV2PacketReferences(
        packet(),
        agentReceiptV2({
          acceptance_criteria_addressed: ["criterion-unknown"],
          claimed_checks: [{ id: "check-unknown", outcome: "pass" }],
        })
      )
    ).toEqual({
      valid: false,
      errors: [
        "acceptance_criteria_addressed contains undeclared criterion: criterion-unknown",
        "claimed_checks contains undeclared verification: check-unknown",
      ],
    });
  });

  it("enforces v2 decisive evidence and worker timestamp ordering", () => {
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        outcome: "blocked",
        blockers: [],
      }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        worker_completed_at: "2026-07-11T12:00:00.000Z",
      }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        submitted_at: NOW,
      }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        files_touched: ["src/../outside.ts"],
      }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        observed_base_sha: BASE_SHA.toUpperCase(),
      }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        final_head_sha: HEAD_SHA.toUpperCase(),
        commits: [HEAD_SHA.toUpperCase()],
      }).success
    ).toBe(false);
  });

  it("accepts canonical slash-separated v2 touched paths", () => {
    expect(
      AgentTaskReceipt_v2.safeParse({
        ...agentReceiptV2(),
        files_touched: ["src/schemas/agent-work.ts", "tests/fixtures/result.bin"],
      }).success
    ).toBe(true);
  });

  it.each([
    ["NUL", "src/bad\0path.ts"],
    ["UNC", "\\\\server\\share\\file.ts"],
    ["backslash", "src\\schemas\\agent-work.ts"],
    ["dot segment", "./src/agent-work.ts"],
    ["internal dot segment", "src/./agent-work.ts"],
    ["double slash", "src//agent-work.ts"],
    ["trailing slash", "src/"],
  ])("rejects noncanonical v2 touched path form %s", (_form, path) => {
    expect(
      AgentTaskReceipt_v2.safeParse({ ...agentReceiptV2(), files_touched: [path] }).success
    ).toBe(false);
  });

  it("leaves legacy v1 touched-path spelling unchanged", () => {
    expect(
      AgentTaskReceipt_v1.safeParse({
        ...agentReceipt(),
        files_touched: ["src\\legacy.ts"],
      }).success
    ).toBe(true);
  });

  it("binds v2 claims to work revision, packet, lease, runtime, session, and base", () => {
    const context = {
      packet: packet(),
      lease: workspaceLease(),
      session: completedWorkerSession(),
      workerRuntime: "codex-native",
    };
    expect(validateAgentTaskReceiptV2Binding(context, agentReceiptV2())).toEqual({
      valid: true,
      errors: [],
    });

    const mismatched = agentReceiptV2({
      work_item_revision: 4,
      packet_hash: `sha256:${"e".repeat(64)}`,
      workspace_lease_revision: 9,
      worker_runtime: "other-runtime",
      worker_session_id: "other-session",
      observed_base_sha: "c".repeat(40),
    });
    const binding = validateAgentTaskReceiptV2Binding(context, mismatched);
    expect(binding.valid).toBe(false);
    expect(binding.errors).toEqual([
      expect.stringContaining("work_item_revision mismatch"),
      expect.stringContaining("packet_hash mismatch"),
      expect.stringContaining("workspace_lease_revision mismatch"),
      expect.stringContaining("worker_runtime mismatch"),
      expect.stringContaining("worker_session_id mismatch"),
      expect.stringContaining("observed_base_sha mismatch"),
    ]);

    expect(
      validateAgentTaskReceiptV2Binding(
        context,
        agentReceiptV2({
          worker_started_at: "2026-07-11T12:02:00.000Z",
          worker_completed_at: "2026-07-11T12:05:00.000Z",
        })
      )
    ).toEqual({ valid: true, errors: [] });
    expect(
      validateAgentTaskReceiptV2Binding(
        context,
        agentReceiptV2({
          worker_started_at: "2026-07-11T07:01:00.000-05:00",
          worker_completed_at: "2026-07-11T07:06:00.000-05:00",
          submitted_at: "2026-07-11T07:07:00.000-05:00",
        })
      )
    ).toEqual({ valid: true, errors: [] });

    const startsEarly = validateAgentTaskReceiptV2Binding(
      context,
      agentReceiptV2({
        worker_started_at: "2026-07-11T12:00:00.000Z",
        worker_completed_at: "2026-07-11T12:05:00.000Z",
      })
    );
    expect(startsEarly.errors).toEqual([expect.stringContaining("worker_started_at precedes")]);

    const endsLate = validateAgentTaskReceiptV2Binding(
      context,
      agentReceiptV2({ worker_completed_at: "2026-07-11T12:06:30.000Z" })
    );
    expect(endsLate.errors).toEqual([expect.stringContaining("worker_completed_at follows")]);

    const missingEnd = validateAgentTaskReceiptV2Binding(
      { ...context, session: { ...completedWorkerSession(), ended_at: undefined } },
      agentReceiptV2()
    );
    expect(missingEnd.errors).toEqual([expect.stringContaining("ended_at is required")]);

    const nonterminal = validateAgentTaskReceiptV2Binding(
      {
        ...context,
        session: { ...completedWorkerSession(), status: "running" as const },
      },
      agentReceiptV2()
    );
    expect(nonterminal.errors).toEqual([expect.stringContaining("status is not terminal")]);

    const invalidSessionWindow = validateAgentTaskReceiptV2Binding(
      {
        ...context,
        session: WorkerSession_v1.parse({
          ...completedWorkerSession(),
          started_at: LATER,
          ended_at: NOW,
        }),
      },
      agentReceiptV2()
    );
    expect(invalidSessionWindow.errors).toEqual([
      expect.stringContaining("worker_session time window is invalid"),
    ]);
  });

  it("rejects incoherent authoritative v2 binding context", () => {
    const taskPacket = packet();
    const lease = workspaceLease();
    const session = completedWorkerSession();
    const binding = validateAgentTaskReceiptV2Binding(
      {
        packet: taskPacket,
        lease: {
          ...lease,
          run_id: "other-run",
          work_item_id: "other-work",
          work_item_revision: lease.work_item_revision + 1,
          attempt_id: "other-attempt",
          packet_id: "other-packet",
          packet_hash: `sha256:${"c".repeat(64)}`,
          repository: { ...lease.repository, id: "other/repository" },
          base_sha: "c".repeat(40),
        },
        session: {
          ...session,
          run_id: "session-run",
          attempt_id: "session-attempt",
          packet_id: "session-packet",
          packet_hash: `sha256:${"d".repeat(64)}`,
          workspace_lease_id: "session-lease",
        },
        workerRuntime: "codex-native",
      },
      agentReceiptV2()
    );

    expect(binding.valid).toBe(false);
    expect(binding.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("context.lease.run_id mismatch"),
        expect.stringContaining("context.lease.work_item_id mismatch"),
        expect.stringContaining("context.lease.work_item_revision mismatch"),
        expect.stringContaining("context.lease.attempt_id mismatch"),
        expect.stringContaining("context.lease.packet_id mismatch"),
        expect.stringContaining("context.lease.packet_hash mismatch"),
        expect.stringContaining("context.lease.repository.id mismatch"),
        expect.stringContaining("context.lease.base_sha mismatch"),
        expect.stringContaining("context.session.run_id mismatch"),
        expect.stringContaining("context.session.attempt_id mismatch"),
        expect.stringContaining("context.session.packet_id mismatch"),
        expect.stringContaining("context.session.packet_hash mismatch"),
        expect.stringContaining("context.session.workspace_lease_id mismatch"),
      ])
    );
  });

  it.each(["pass", "fail", "inconclusive", "infrastructure_error", "cancelled"] as const)(
    "represents engine verification outcome %s",
    (outcome) => {
      const taskPacket = packet();
      const lease = workspaceLease();
      const session = workerSession();
      const receipt = agentReceipt();
      const verification = AgentEngineVerification_v1.parse({
        schema_version: AGENT_WORK_CONTRACT_VERSION,
        verification_id: `verification-${outcome}`,
        run_id: taskPacket.run_id,
        work_item_id: taskPacket.work_item.work_item_id,
        attempt_id: taskPacket.attempt_id,
        packet_id: taskPacket.packet_id,
        packet_hash: taskPacket.packet_hash,
        workspace_lease_id: lease.lease_id,
        workspace_lease_revision: lease.revision,
        worker_session_id: session.session_id,
        receipt_id: receipt.receipt_id,
        receipt_hash: computeCanonicalHash(receipt),
        base_sha: BASE_SHA,
        verified_head_sha: HEAD_SHA,
        outcome,
        summary: `Verification result: ${outcome}`,
        checks: [],
        failures: [],
        trust_gap: outcome !== "pass",
        verifier_id: "engine-1",
        started_at: NOW,
        completed_at: LATER,
      });

      expect(verification.outcome).toBe(outcome);
    }
  );

  it("represents canonical immutable engine verification v2 evidence", () => {
    const verification = agentVerificationV2({
      checks: [
        {
          id: "z-extra",
          source: "engine_extra",
          outcome: "pass",
          command_hash: `sha256:${"1".repeat(64)}`,
          environment_fingerprint: `sha256:${"2".repeat(64)}`,
          duration_ms: 1,
          retry_count: 0,
          artifact_refs: ["z-artifact", "a-artifact"],
          determinism: "unknown",
        },
        ...agentVerificationV2().checks,
      ],
      failures: [],
      trust_gap_reasons: ["authority_deviation"],
    });

    expect(verification.checks.map(({ id }) => id)).toEqual(["unit", "z-extra"]);
    expect(verification.checks[1]?.artifact_refs).toEqual(["a-artifact", "z-artifact"]);
    expect(computeAgentEngineVerificationV2Hash(verification)).toBe(
      computeCanonicalHash(verification)
    );
    expect(AgentEngineVerification_v2.safeParse(verification).success).toBe(true);
  });

  it("requires conclusive result identity, coherent pass evidence, unique sets, and ordered time", () => {
    expect(
      AgentEngineVerification_v2.safeParse({
        ...agentVerificationV2(),
        verified_head_sha: undefined,
        verified_patch_hash: undefined,
      }).success
    ).toBe(false);
    expect(
      AgentEngineVerification_v2.safeParse({
        ...agentVerificationV2({
          outcome: "infrastructure_error",
          checks: [],
          failures: ["workspace observation unavailable"],
          trust_gap_reasons: ["patch_identity_disagrees"],
        }),
        verified_head_sha: undefined,
        verified_patch_hash: undefined,
      }).success
    ).toBe(true);
    expect(
      AgentEngineVerification_v2.safeParse({
        ...agentVerificationV2(),
        failures: ["gate failed"],
      }).success
    ).toBe(false);
    expect(
      AgentEngineVerification_v2.safeParse({
        ...agentVerificationV2(),
        trust_gap_reasons: ["authority_deviation", "authority_deviation"],
      }).success
    ).toBe(false);
    expect(
      AgentEngineVerification_v2.safeParse({
        ...agentVerificationV2(),
        completed_at: "2026-07-11T12:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("binds the declared verification lane to the packet", () => {
    expect(
      validateAgentEngineVerificationV2PacketReferences(packet(), agentVerificationV2())
    ).toEqual({ valid: true, errors: [] });
    const dangling = agentVerificationV2({
      outcome: "fail",
      checks: [
        {
          ...agentVerificationV2().checks[0],
          id: "undeclared",
          outcome: "fail",
        },
      ],
      failures: ["undeclared check failed"],
    });
    expect(validateAgentEngineVerificationV2PacketReferences(packet(), dangling)).toEqual({
      valid: false,
      errors: ["checks contains undeclared packet verification: undeclared"],
    });
    const omitted = agentVerificationV2({ checks: [] });
    expect(validateAgentEngineVerificationV2PacketReferences(packet(), omitted)).toEqual({
      valid: false,
      errors: ["passing verification omits packet verification: unit"],
    });
  });

  it("requires completed and blocked receipts to carry their decisive evidence", () => {
    expect(
      AgentTaskReceipt_v1.safeParse({ ...agentReceipt(), final_head_sha: undefined }).success
    ).toBe(false);
    expect(
      AgentTaskReceipt_v1.safeParse({
        ...agentReceipt(),
        outcome: "blocked",
        final_head_sha: undefined,
        blockers: [],
      }).success
    ).toBe(false);
  });

  it("accepts a human action receipt only at the requested revision and HEAD", () => {
    const request = HumanActionRequest_v1.parse({
      schema_version: AGENT_WORK_CONTRACT_VERSION,
      request_id: "human-action-1",
      run_id: "run-1",
      attempt_id: "attempt-1",
      workspace_lease_id: "workspace-lease-1",
      worker_session_id: "worker-session-1",
      action: "sign_commit",
      summary: "Unlock release signing and sign the release commit.",
      instructions: ["Run the supplied signing command in the foreground."],
      suggested_commands: ["git commit -S --amend --no-edit"],
      preconditions: {
        run_revision: 8,
        workspace_lease_revision: 2,
        expected_head_sha: BASE_SHA,
      },
      requested_at: NOW,
      expires_at: LATER,
    });
    const receipt = HumanActionReceipt_v1.parse({
      schema_version: AGENT_WORK_CONTRACT_VERSION,
      receipt_id: "human-action-receipt-1",
      request_id: request.request_id,
      run_id: request.run_id,
      attempt_id: request.attempt_id,
      workspace_lease_id: request.workspace_lease_id,
      worker_session_id: request.worker_session_id,
      observed_preconditions: request.preconditions,
      outcome: "completed",
      actor_id: "guff",
      summary: "Signed the expected commit.",
      resulting_head_sha: HEAD_SHA,
      completed_at: LATER,
    });

    expect(validateHumanActionReceiptBinding(request, receipt)).toEqual({
      valid: true,
      errors: [],
    });

    const stale = HumanActionReceipt_v1.parse({
      ...receipt,
      observed_preconditions: {
        ...receipt.observed_preconditions,
        run_revision: 9,
        expected_head_sha: "c".repeat(40),
      },
    });
    const result = validateHumanActionReceiptBinding(request, stale);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.stringContaining("run_revision mismatch"),
      expect.stringContaining("expected_head_sha mismatch"),
    ]);
  });

  it("rejects abbreviated SHAs where stale-state protection depends on identity", () => {
    expect(
      AgentTaskPacket_v1.safeParse({
        ...packet(),
        repository: { ...packet().repository, base_sha: "abcdef1" },
      }).success
    ).toBe(false);
  });
});
