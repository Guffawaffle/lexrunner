import { describe, expect, it } from "vitest";
import {
  AGENT_WORK_CONTRACT_VERSION,
  AgentTaskPacket_v1,
  AgentTaskReceipt_v1,
  ControllerLease_v1,
  AgentEngineVerification_v1,
  ExecutionEnvelope_v1,
  HumanActionReceipt_v1,
  HumanActionRequest_v1,
  WorkItem_v1,
  WorkerSession_v1,
  WorkspaceLease_v1,
  computeAgentTaskPacketHash,
  createAgentTaskPacket,
  validateAgentTaskReceiptBinding,
  validateHumanActionReceiptBinding,
  type AgentTaskPacketHashInput,
} from "../../../src/schemas/agent-work.js";
import { computeCanonicalHash } from "../../../src/schemas/task-contract.js";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PACKET_CREATED_AT = "2026-07-11T12:00:00.000Z";
const NOW = "2026-07-11T12:01:00.000Z";
const LATER = "2026-07-11T12:06:00.000Z";

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
    attempt_id: taskPacket.attempt_id,
    controller_lease_id: "controller-lease-1",
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
