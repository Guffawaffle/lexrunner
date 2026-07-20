import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeAgentWorkPreparation,
  orderAgentWorkPreparationSteps,
  type AgentWorkPreparationCommandRunner,
} from "../../src/runs/agent-work-preparation-service.js";
import { createAgentTaskPacket } from "../../src/schemas/agent-work.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent-work preparation", () => {
  it("orders packet-owned provisioning and build dependencies deterministically", () => {
    const packet = makePacket();
    expect(orderAgentWorkPreparationSteps(packet.preparation!)).toMatchObject([
      { id: "install" },
      { id: "build-core" },
      { id: "build-consumer" },
    ]);
    expect(packet.verification[0]).toMatchObject({
      id: "test-consumer",
      depends_on: ["build-consumer"],
    });
  });

  it("rejects unknown and cyclic execution dependencies", () => {
    const input = packetInput();
    input.preparation!.steps[0]!.depends_on = ["missing"];
    expect(() => createAgentTaskPacket(input)).toThrow();

    const cyclic = packetInput();
    cyclic.preparation!.steps[1]!.depends_on = ["build-core"];
    expect(() => createAgentTaskPacket(cyclic)).toThrow();
  });

  it("executes the declared phase and emits only canonical hashed command evidence", async () => {
    const root = await workspace();
    const runner: AgentWorkPreparationCommandRunner = {
      run: vi.fn(async ({ argv, policyHash }) => ({
        exitCode: 0,
        stdout: `installed ${argv.join(" ")} with secret-token`,
        stderr: "",
        policyHash,
      })),
    };
    const times = ["2026-07-20T10:00:00.000Z", "2026-07-20T10:00:03.000Z"];
    const result = await executeAgentWorkPreparation({
      packet: makePacket(),
      worktreeRoot: root,
      receiptId: "preparation-receipt-1",
      runner,
      now: () => times.shift()!,
    });
    expect(result).toMatchObject({ ok: true, receipt: { outcome: "passed" } });
    expect(result.receipt.steps.map(({ id, outcome }) => ({ id, outcome }))).toEqual([
      { id: "install", outcome: "passed" },
      { id: "build-core", outcome: "passed" },
      { id: "build-consumer", outcome: "passed" },
    ]);
    expect(JSON.stringify(result.receipt)).not.toContain("secret-token");
    expect(
      result.receipt.steps.every(({ policy_hash }) => policy_hash === result.receipt.policy_hash)
    ).toBe(true);
  });

  it("fails closed on policy mismatch and blocks dependent preparation", async () => {
    const root = await workspace();
    const result = await executeAgentWorkPreparation({
      packet: makePacket(),
      worktreeRoot: root,
      receiptId: "preparation-receipt-2",
      runner: {
        async run() {
          return {
            exitCode: 0,
            stdout: "untrusted",
            stderr: "",
            policyHash: `sha256:${"0".repeat(64)}`,
          };
        },
      },
      now: sequentialClock(),
    });
    expect(result).toMatchObject({ ok: false, failedStepId: "install" });
    expect(result.receipt.steps).toMatchObject([
      { id: "install", outcome: "failed" },
      { id: "build-core", outcome: "blocked" },
      { id: "build-consumer", outcome: "blocked" },
    ]);
  });

  it("continues independent preparation after a localized failure", async () => {
    const root = await workspace();
    const packet = packetInput();
    packet.preparation!.steps.push({
      id: "independent-evidence",
      kind: "build",
      argv: ["npm", "run", "inspect"],
      depends_on: [],
      expected_exit_codes: [0],
    });
    const result = await executeAgentWorkPreparation({
      packet: createAgentTaskPacket(packet),
      worktreeRoot: root,
      receiptId: "preparation-receipt-independent",
      runner: {
        async run({ argv, policyHash }) {
          return {
            exitCode: argv.includes("install") ? 1 : 0,
            stdout: "",
            stderr: "",
            policyHash,
          };
        },
      },
      now: sequentialClock(),
    });
    expect(result.receipt.steps).toMatchObject([
      { id: "independent-evidence", outcome: "passed" },
      { id: "install", outcome: "failed" },
      { id: "build-core", outcome: "blocked" },
      { id: "build-consumer", outcome: "blocked" },
    ]);
  });

  it("refuses to launch preparation without external-runtime authority", async () => {
    const root = await workspace();
    const packet = packetInput();
    packet.authority.external_runtime = false;
    await expect(
      executeAgentWorkPreparation({
        packet: createAgentTaskPacket(packet),
        worktreeRoot: root,
        receiptId: "preparation-receipt-no-authority",
        runner: {
          async run({ policyHash }) {
            return { exitCode: 0, stdout: "", stderr: "", policyHash };
          },
        },
        now: sequentialClock(),
      })
    ).rejects.toThrow("does not authorize");
  });

  it("refuses a preparation cwd that resolves outside the allocation root", async () => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "lexrunner-preparation-outside-"));
    roots.push(outside);
    await rm(path.join(root, "packages", "core"), { recursive: true });
    await symlink(outside, path.join(root, "packages", "core"));
    await expect(
      executeAgentWorkPreparation({
        packet: makePacket(),
        worktreeRoot: root,
        receiptId: "preparation-receipt-3",
        runner: {
          async run({ policyHash }) {
            return { exitCode: 0, stdout: "", stderr: "", policyHash };
          },
        },
        now: sequentialClock(),
      })
    ).rejects.toThrow("escapes the worktree root");
  });
});

function packetInput() {
  return {
    schema_version: "1.0.0" as const,
    packet_id: "packet-preparation",
    run_id: "run-preparation",
    work_item: { work_item_id: "work-preparation", revision: 1 },
    attempt_id: "attempt-preparation",
    repository: { id: "repo-preparation", base_sha: "a".repeat(40) },
    objective: "Prove deterministic preparation before verification.",
    acceptance_criteria: [{ id: "prepared", text: "The consumer is built before testing." }],
    instructions: ["Use only packet-owned commands."],
    scope: {
      read_globs: ["**/*"],
      write_globs: [],
      deny_globs: [".git/**"],
      cross_repo_allowed: false,
    },
    authority: {
      edit: false,
      git_write: false,
      github_write: false,
      external_runtime: true,
      secrets: false,
      signing: false,
      release: false,
    },
    preparation: {
      policy: {
        network: "registry_only" as const,
        registries: ["https://registry.npmjs.org/"],
        cache: "read_only" as const,
        lifecycle_scripts: "forbidden" as const,
      },
      steps: [
        {
          id: "build-consumer",
          kind: "build" as const,
          argv: ["npm", "run", "build"],
          cwd_rel: "packages/consumer",
          depends_on: ["build-core"],
          expected_exit_codes: [0],
        },
        {
          id: "install",
          kind: "provision" as const,
          argv: ["npm", "install", "--ignore-scripts"],
          depends_on: [],
          expected_exit_codes: [0],
        },
        {
          id: "build-core",
          kind: "build" as const,
          argv: ["npm", "run", "build"],
          cwd_rel: "packages/core",
          depends_on: ["install"],
          expected_exit_codes: [0],
        },
      ],
    },
    verification: [
      {
        id: "test-consumer",
        argv: ["npm", "test"],
        cwd_rel: "packages/consumer",
        depends_on: ["build-consumer"],
        expected_exit_codes: [0],
      },
    ],
    budget: { max_elapsed_ms: 60_000 },
    created_at: "2026-07-20T10:00:00.000Z",
  };
}

function makePacket() {
  return createAgentTaskPacket(packetInput());
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lexrunner-preparation-"));
  roots.push(root);
  await mkdir(path.join(root, "packages", "consumer"), { recursive: true });
  await mkdir(path.join(root, "packages", "core"), { recursive: true });
  return root;
}

function sequentialClock(): () => string {
  const values = ["2026-07-20T10:00:00.000Z", "2026-07-20T10:00:01.000Z"];
  return () => values.shift()!;
}
