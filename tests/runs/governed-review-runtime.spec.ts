import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernedControlId } from "../../src/runs/governed-attempt-executor.js";
import {
  GovernedReviewRuntime,
  type StartSyntheticGovernedReviewInput,
} from "../../src/runs/governed-review-runtime.js";
import type { QualifiedCodexProviderBridge } from "../../src/runs/qualified-wsl2-codex-executor.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";
import { InMemoryGovernedAttemptOperationStore } from "../../src/store/inmemory/governed-attempt-operation-store.js";
import { LocalProtectedEvidenceStore } from "../../src/store/local-protected-evidence-store.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T17:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("GovernedReviewRuntime", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "lexrunner-review-runtime-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("binds a real durable Attempt while leaving its Delegation offered until the worker accepts", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const bridge = providerBridge();
    const evidenceStore = new LocalProtectedEvidenceStore(root, {
      attestRoot: async () => true,
      syncDirectory: async () => undefined,
      now: () => at(2),
      random: (length) => Buffer.alloc(length, 0x22),
    });
    const ids = ["delegation", "logical-thread", "authorization", "capture"];
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: {
        getAttempt: vi.fn(async () => ({
          attemptId: "attempt-1",
          runId: "run-1",
          runRevision: 0,
          workItemId: "work-1",
          workItemRevision: 0,
          packetId: "packet-1",
          packetHash: hash("packet"),
          baseSha: "1".repeat(40),
          revision: 0,
          status: "running" as const,
          workspaceLeaseId: "workspace-1",
          receiptId: null,
          verificationId: null,
          createdAt: at(0),
          updatedAt: at(0),
          completedAt: null,
        })),
      },
      evidenceStore,
      bridge,
      now: () => at(2),
      randomId: () => ids.shift()!,
    });

    const result = await runtime.startSynthetic(startInput());

    expect(result).toMatchObject({
      started: true,
      delegationId: "delegation-delegation",
      captureId: "capture-capture",
    });
    if (!result.started) throw new Error(result.reason);
    expect((await store.getDelegation(result.delegationId))?.status).toBe("offered");
    expect(await store.getAttemptOperation(result.operationId)).toMatchObject({
      attempt_id: "attempt-1",
      status: "running",
      verification_context: { workspace: { corpus_kind: "synthetic" } },
    });
    expect(bridge.launch).toHaveBeenCalledOnce();
    await store.close();
  });

  it("refuses to treat a merely prepared Attempt as launch authority", async () => {
    const store = new InMemoryGovernedAttemptOperationStore();
    const bridge = providerBridge();
    const runtime = new GovernedReviewRuntime({
      store,
      lifecycle: {
        getAttempt: async () => ({
          attemptId: "attempt-1",
          runId: "run-1",
          runRevision: 0,
          workItemId: "work-1",
          workItemRevision: 0,
          packetId: "packet-1",
          packetHash: hash("packet"),
          baseSha: "1".repeat(40),
          revision: 0,
          status: "prepared",
          workspaceLeaseId: null,
          receiptId: null,
          verificationId: null,
          createdAt: at(0),
          updatedAt: at(0),
          completedAt: null,
        }),
      },
      evidenceStore: new LocalProtectedEvidenceStore(root, {
        attestRoot: async () => true,
        syncDirectory: async () => undefined,
        now: () => at(2),
      }),
      bridge,
      now: () => at(2),
    });

    await expect(runtime.startSynthetic(startInput())).resolves.toEqual({
      started: false,
      reason: "attempt_not_running",
    });
    expect(bridge.launch).not.toHaveBeenCalled();
    await store.close();
  });
});

function startInput(): StartSyntheticGovernedReviewInput {
  return {
    runId: "run-1",
    attemptId: "attempt-1",
    environmentId: "environment-1",
    objective: "Review the retry bound",
    prompt: Buffer.from("Return BLOCK if the bounded retry was removed.", "utf8"),
  };
}

function providerBridge(): QualifiedCodexProviderBridge & {
  launch: ReturnType<typeof vi.fn>;
} {
  const observed = { observed_at: at(1), expires_at: at(59) };
  const attestations = {
    executor: {
      schema_version: "1.0.0" as const,
      executor_id: "qualified-codex",
      executor_version: "0.145.0",
      executable_hash: hash("executor"),
      protocol: "jsonl-stdin" as const,
      configuration_hash: hash("configuration"),
      tool_surface_hash: hash("tools"),
      ...observed,
    },
    environment: {
      schema_version: "1.0.0" as const,
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced" as const,
        strength: "independently_enforced_verified" as const,
        evidence_refs: [hash(`control:${control}`)],
        enforcement_owner: "host-verifier",
      })),
      ...observed,
    },
    workspace: {
      schema_version: "1.0.0" as const,
      workspace_id: "synthetic-workspace",
      repository_id: "lexrunner-synthetic-retry-window",
      base_object_id: "1".repeat(40),
      candidate_object_id: "2".repeat(40),
      corpus_hash: hash("corpus"),
      selection_hash: hash("selection"),
      corpus_kind: "synthetic" as const,
      ...observed,
    },
  };
  const launch = vi.fn(async () => ({
    operationId: "operation-1",
    providerHandle: "provider-1",
    startedAt: at(3),
  }));
  return {
    inspect: async () => attestations.executor,
    prepareSynthetic: async () => attestations,
    attest: async () => attestations,
    launch,
    observe: async function* () {},
    continueAfterAcceptance: async () => undefined,
    cancel: async () => undefined,
    collect: async () => ({ taskOutcome: "block" }),
    release: async () => undefined,
  };
}
