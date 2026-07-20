import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  AgentTaskPacket_v1,
  AgentWorkPreparationReceipt_v1,
  type AgentTaskPacket_v1 as AgentTaskPacket,
  type AgentWorkPreparationReceipt_v1 as PreparationReceipt,
} from "../schemas/agent-work.js";
import { computeCanonicalHash } from "../schemas/task-contract.js";

const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;

type Preparation = NonNullable<AgentTaskPacket["preparation"]>;
type PreparationStep = Preparation["steps"][number];

export interface AgentWorkPreparationCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The adapter must attest that it enforced the exact packet-owned policy. */
  policyHash: string;
}

export interface AgentWorkPreparationCommandRunner {
  run(input: {
    argv: string[];
    cwd: string;
    policy: Preparation["policy"];
    policyHash: string;
  }): Promise<AgentWorkPreparationCommandResult>;
}

export interface ExecuteAgentWorkPreparationInput {
  packet: AgentTaskPacket;
  worktreeRoot: string;
  receiptId: string;
  runner: AgentWorkPreparationCommandRunner;
  now(): string;
}

export interface AgentWorkPreparationResult {
  ok: boolean;
  receipt: PreparationReceipt;
  failedStepId?: string;
}

/** Stable dependency order for packet-owned preparation steps. */
export function orderAgentWorkPreparationSteps(preparation: Preparation): PreparationStep[] {
  const byId = new Map(preparation.steps.map((step) => [step.id, step]));
  const remaining = new Set(byId.keys());
  const completed = new Set<string>();
  const ordered: PreparationStep[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((id) => byId.get(id)!)
      .filter((step) => step.depends_on.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ready.length === 0) {
      throw new TypeError("Preparation dependencies are cyclic or incomplete");
    }
    for (const step of ready) {
      ordered.push(step);
      completed.add(step.id);
      remaining.delete(step.id);
    }
  }
  return ordered;
}

/** Executes only the explicit preparation phase and emits hashes, never command logs. */
export async function executeAgentWorkPreparation(
  input: ExecuteAgentWorkPreparationInput
): Promise<AgentWorkPreparationResult> {
  const packet = AgentTaskPacket_v1.parse(input.packet);
  if (!packet.preparation) {
    throw new TypeError("AgentTaskPacket_v1 does not declare a preparation phase");
  }
  if (!packet.authority.external_runtime) {
    throw new TypeError("AgentTaskPacket_v1 does not authorize an external preparation runtime");
  }
  if (!path.isAbsolute(input.worktreeRoot)) {
    throw new TypeError("worktreeRoot must be an absolute native path");
  }
  const root = await realpath(input.worktreeRoot);
  const preparationPlanHash = computeCanonicalHash(packet.preparation);
  const policyHash = computeCanonicalHash(packet.preparation.policy);
  const startedAt = input.now();
  const results: PreparationReceipt["steps"] = [];
  let failedStepId: string | undefined;

  for (const step of orderAgentWorkPreparationSteps(packet.preparation)) {
    if (step.depends_on.some((dependency) => !passed(results, dependency))) {
      results.push({ id: step.id, outcome: "blocked" });
      continue;
    }
    const cwd = await containedExistingDirectory(root, step.cwd_rel);
    let result: AgentWorkPreparationCommandResult;
    try {
      result = await input.runner.run({
        argv: [...step.argv],
        cwd,
        policy: packet.preparation.policy,
        policyHash,
      });
    } catch {
      result = { exitCode: -1, stdout: "", stderr: "runner_failed", policyHash };
    }
    const bounded = boundedCommandResult(result, policyHash);
    const outcome = step.expected_exit_codes.includes(bounded.exitCode) ? "passed" : "failed";
    results.push({
      id: step.id,
      outcome,
      exit_code: bounded.exitCode,
      stdout_hash: computeCanonicalHash(bounded.stdout),
      stderr_hash: computeCanonicalHash(bounded.stderr),
      policy_hash: bounded.policyHash,
    });
    if (outcome === "failed" && !failedStepId) failedStepId = step.id;
  }

  const hashable = {
    schema_version: "1.0.0" as const,
    receipt_id: input.receiptId,
    run_id: packet.run_id,
    attempt_id: packet.attempt_id,
    packet_id: packet.packet_id,
    packet_hash: packet.packet_hash,
    preparation_plan_hash: preparationPlanHash,
    policy_hash: policyHash,
    outcome: failedStepId ? ("failed" as const) : ("passed" as const),
    steps: results,
    started_at: startedAt,
    completed_at: input.now(),
  };
  const receipt = AgentWorkPreparationReceipt_v1.parse({
    ...hashable,
    receipt_hash: computeCanonicalHash(hashable),
  });
  return {
    ok: receipt.outcome === "passed",
    receipt,
    ...(failedStepId ? { failedStepId } : {}),
  };
}

function passed(results: PreparationReceipt["steps"], id: string): boolean {
  return results.some((result) => result.id === id && result.outcome === "passed");
}

async function containedExistingDirectory(root: string, relative?: string): Promise<string> {
  const candidate = relative ? path.resolve(root, relative) : root;
  const resolved = await realpath(candidate);
  const relation = path.relative(root, resolved);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new TypeError("Preparation cwd escapes the worktree root");
  }
  return resolved;
}

function boundedCommandResult(
  result: AgentWorkPreparationCommandResult,
  expectedPolicyHash: string
): AgentWorkPreparationCommandResult {
  if (!Number.isSafeInteger(result.exitCode)) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: "invalid_exit_code",
      policyHash: expectedPolicyHash,
    };
  }
  if (result.policyHash !== expectedPolicyHash) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: "policy_evidence_mismatch",
      policyHash: expectedPolicyHash,
    };
  }
  if (
    Buffer.byteLength(result.stdout, "utf8") > MAX_COMMAND_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr, "utf8") > MAX_COMMAND_OUTPUT_BYTES
  ) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: "command_output_exceeded",
      policyHash: expectedPolicyHash,
    };
  }
  return result;
}
