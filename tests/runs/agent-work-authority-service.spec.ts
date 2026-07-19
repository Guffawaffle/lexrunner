import { describe, expect, it, vi } from "vitest";

import { createAgentTaskPacket } from "../../src/schemas/agent-work.js";
import { canonicalJSONStringify } from "../../src/util/canonicalJson.js";
import {
  AgentWorkAuthorityService,
  classifyWorkerAuthorityAction,
  WorkerAuthorityCommandBroker,
  type WorkerAuthorityBinding,
  type WorkerAuthorityCommandExecutor,
} from "../../src/runs/agent-work-authority-service.js";
import type {
  RecordWorkerAuthorityDecisionInput,
  WorkerAuthorityEventRecord,
} from "../../src/store/workspace-lifecycle-store.js";

const controller = {
  runId: "run-authority",
  controllerId: "controller-authority",
  leaseId: "controller-lease-authority",
  fencingToken: 1,
};

describe("worker authority enforcement", () => {
  it("denies a prohibited external runtime before spawn and allows it only for a new grant", async () => {
    let packet = taskPacket("attempt-denied", false);
    const recorded: RecordWorkerAuthorityDecisionInput[] = [];
    const store = {
      getTaskPacketBinding: vi.fn(async () => ({ packetJson: canonicalJSONStringify(packet) })),
      recordWorkerAuthorityDecision: vi.fn(async (input: RecordWorkerAuthorityDecisionInput) => {
        recorded.push(input);
        return { recorded: true as const, event: authorityEvent(input), idempotentReplay: false };
      }),
    };
    const executor: WorkerAuthorityCommandExecutor = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdoutHash: `sha256:${"1".repeat(64)}`,
        stderrHash: `sha256:${"2".repeat(64)}`,
      })),
    };
    const broker = new WorkerAuthorityCommandBroker(
      new AgentWorkAuthorityService(store as never, () => "2026-07-19T12:00:00.000Z"),
      executor
    );

    const denied = await broker.run({
      binding: binding("attempt-denied"),
      mutationId: "deny-docker",
      argv: ["docker", "run", "--env", "TOKEN=must-not-persist", "postgres"],
      cwd: "/tmp",
    });
    expect(denied).toMatchObject({
      executed: false,
      authorization: {
        authorized: false,
        action: { dimension: "external_runtime", actionClass: "external_runtime" },
        reason: "packet_denied",
      },
    });
    expect(executor.run).not.toHaveBeenCalled();
    expect(JSON.stringify(recorded[0])).not.toContain("must-not-persist");
    expect(JSON.stringify(recorded[0])).not.toContain("postgres");

    packet = taskPacket("attempt-granted", true);
    const granted = await broker.run({
      binding: binding("attempt-granted"),
      mutationId: "allow-docker",
      argv: ["docker", "version"],
      cwd: "/tmp",
    });
    expect(granted).toMatchObject({
      executed: true,
      authorization: { authorized: true, event: { decision: "allowed" } },
      result: { exitCode: 0 },
    });
    expect(executor.run).toHaveBeenCalledTimes(1);
  });

  it("classifies sensitive command lanes conservatively without hashing arguments", () => {
    expect(classifyWorkerAuthorityAction(["C:\\Tools\\docker.exe", "run", "secret"])).toMatchObject(
      {
        dimension: "external_runtime",
      }
    );
    expect(classifyWorkerAuthorityAction(["git", "commit", "-S"])).toMatchObject({
      dimension: "git_write",
    });
    expect(classifyWorkerAuthorityAction(["gh", "release", "create", "v1"])).toMatchObject({
      dimension: "release",
    });
    expect(classifyWorkerAuthorityAction(["printenv", "TOKEN"])).toMatchObject({
      dimension: "secrets",
    });
    expect(classifyWorkerAuthorityAction(["gpg", "--sign", "artifact"])).toMatchObject({
      dimension: "signing",
    });
    expect(classifyWorkerAuthorityAction(["npm", "publish"])).toMatchObject({
      dimension: "release",
    });
    const first = classifyWorkerAuthorityAction(["docker", "run", "secret-one"]);
    const second = classifyWorkerAuthorityAction(["docker", "run", "secret-two"]);
    expect(first.actionHash).toBe(second.actionHash);
  });

  it("records an observed prohibited action as a deviation for later verification", async () => {
    const packet = taskPacket("attempt-deviation", false);
    const store = {
      getTaskPacketBinding: vi.fn(async () => ({ packetJson: canonicalJSONStringify(packet) })),
      recordWorkerAuthorityDecision: vi.fn(async (input: RecordWorkerAuthorityDecisionInput) => ({
        recorded: true as const,
        event: authorityEvent(input),
        idempotentReplay: false,
      })),
    };
    const service = new AgentWorkAuthorityService(store as never, () => "2026-07-19T12:00:00.000Z");
    const recorded = await service.recordObservedDeviation({
      binding: binding("attempt-deviation"),
      action: classifyWorkerAuthorityAction(["podman", "run", "postgres"]),
      mutationId: "observed-podman",
      enforcement: "unenforced",
    });

    expect(recorded).toMatchObject({
      recorded: true,
      event: {
        decision: "deviation",
        dimension: "external_runtime",
        reason: "observed_after_execution",
      },
    });
  });

  it("requires reconciliation instead of repeating an idempotently replayed authorization", async () => {
    const packet = taskPacket("attempt-replay", true);
    const store = {
      getTaskPacketBinding: vi.fn(async () => ({ packetJson: canonicalJSONStringify(packet) })),
      recordWorkerAuthorityDecision: vi.fn(async (input: RecordWorkerAuthorityDecisionInput) => ({
        recorded: true as const,
        event: authorityEvent(input),
        idempotentReplay: true,
      })),
    };
    const executor: WorkerAuthorityCommandExecutor = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdoutHash: `sha256:${"1".repeat(64)}`,
        stderrHash: `sha256:${"2".repeat(64)}`,
      })),
    };
    const broker = new WorkerAuthorityCommandBroker(
      new AgentWorkAuthorityService(store as never, () => "2026-07-19T12:00:01.000Z"),
      executor
    );

    await expect(
      broker.run({
        binding: binding("attempt-replay"),
        mutationId: "replayed-docker",
        argv: ["docker", "version"],
        cwd: "/tmp",
      })
    ).resolves.toMatchObject({
      executed: false,
      reason: "authorization_replayed",
      authorization: { authorized: true, idempotentReplay: true },
    });
    expect(executor.run).not.toHaveBeenCalled();
  });

  it("treats nested execution entry points and ambiguous Git branch commands conservatively", () => {
    for (const executable of ["bash", "node", "python", "pwsh"]) {
      expect(classifyWorkerAuthorityAction([executable, "script"])).toMatchObject({
        dimension: "external_runtime",
      });
    }
    expect(classifyWorkerAuthorityAction(["git", "branch", "--show-current"])).toMatchObject({
      dimension: "git_write",
    });
  });
});

function taskPacket(attemptId: string, externalRuntime: boolean) {
  return createAgentTaskPacket({
    schema_version: "1.0.0",
    packet_id: `packet-${attemptId}`,
    run_id: "run-authority",
    work_item: { work_item_id: `work-${attemptId}`, revision: 1 },
    attempt_id: attemptId,
    repository: { id: "owner/repo", base_sha: "a".repeat(40) },
    objective: "Exercise packet authority",
    acceptance_criteria: [],
    instructions: [],
    scope: {
      read_globs: ["**"],
      write_globs: ["**"],
      deny_globs: [],
      cross_repo_allowed: false,
    },
    authority: {
      edit: true,
      git_write: false,
      github_write: false,
      external_runtime: externalRuntime,
      secrets: false,
      signing: false,
      release: false,
    },
    verification: [],
    budget: {},
    created_at: "2026-07-19T11:00:00.000Z",
  });
}

function binding(attemptId: string): WorkerAuthorityBinding {
  return {
    runId: "run-authority",
    expectedRunRevision: 0,
    controller,
    attemptId,
    expectedAttemptRevision: 3,
    workspaceLeaseId: `lease-${attemptId}`,
    expectedWorkspaceLeaseRevision: 0,
    workerSessionId: `session-${attemptId}`,
    expectedWorkerSessionRevision: 0,
  };
}

function authorityEvent(input: RecordWorkerAuthorityDecisionInput): WorkerAuthorityEventRecord {
  return {
    runId: input.runId,
    attemptId: input.attemptId,
    workerSessionId: input.workerSessionId,
    mutationId: input.mutationId,
    sequence: 1,
    attemptRevision: input.expectedAttemptRevision,
    workspaceLeaseId: input.workspaceLeaseId,
    workspaceLeaseRevision: input.expectedWorkspaceLeaseRevision,
    workerSessionRevision: input.expectedWorkerSessionRevision,
    packetId: `packet-${input.attemptId}`,
    packetHash: `sha256:${"a".repeat(64)}`,
    dimension: input.dimension,
    decision: input.decision,
    enforcement: input.enforcement,
    actionClass: input.actionClass,
    actionHash: input.actionHash,
    backendId: input.backendId,
    backendVersion: input.backendVersion,
    reason: input.reason,
    controllerId: input.controller.controllerId,
    controllerLeaseId: input.controller.leaseId,
    fencingToken: input.controller.fencingToken,
    createdAt: input.now,
  };
}
