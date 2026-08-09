import { describe, expect, it } from "vitest";

import {
  ExternalWsl2CodexProviderBridge,
  type Wsl2CodexProviderTransport,
} from "../../src/runs/external-wsl2-codex-provider-bridge.js";
import type { AttemptAuthorization_v1 } from "../../src/runs/governed-attempt-executor.js";
import { GovernedControlId } from "../../src/runs/governed-attempt-executor.js";
import { computeCanonicalHash } from "../../src/schemas/task-contract.js";

const hash = (value: string) => computeCanonicalHash({ value });
const at = (seconds: number) => `2026-08-09T16:00:${String(seconds).padStart(2, "0")}.000Z`;

describe("ExternalWsl2CodexProviderBridge", () => {
  it("prepares short-lived synthetic attestations before authorization", async () => {
    const transport = new FakeTransport();
    const bridge = new ExternalWsl2CodexProviderBridge({
      distribution: "lexrunner-attempt-01234567",
      transport,
    });
    await expect(
      bridge.prepareSynthetic({
        environment_id: "disposable-environment-1",
        repository_id: "synthetic-repository",
        base_object_id: "1".repeat(40),
        candidate_object_id: "2".repeat(40),
      })
    ).resolves.toEqual(attestations());
    const request = transport.requests.find((candidate) => candidate.args[0] === "prepare")!;
    expect(request.args).toEqual(["prepare", "--stdin-format", "canonical-json-v1"]);
    expect(JSON.parse(Buffer.from(request.stdin!).toString("utf8"))).toMatchObject({
      environment_id: "disposable-environment-1",
      repository_id: "synthetic-repository",
    });
  });

  it("keeps launch metadata and prompt in a bounded stdin frame, never argv", async () => {
    const transport = new FakeTransport();
    const bridge = new ExternalWsl2CodexProviderBridge({
      distribution: "lexrunner-attempt-01234567",
      transport,
    });
    const prompt = Buffer.from("synthetic prompt only");
    const receipt = await bridge.launch({
      authorization: authorization(),
      promptStdin: prompt,
      outputSchema: { type: "object" },
      mode: "synthetic_only",
    });
    expect(receipt).toMatchObject({
      operationId: "operation-1",
      providerHandle: "provider-handle-1",
    });
    const launch = transport.requests.find((request) => request.args[0] === "launch")!;
    expect(launch.args).toEqual(["launch", "--stdin-framing", "lexrunner-provider-v1"]);
    expect(launch.args.join(" ")).not.toContain(prompt.toString("utf8"));
    const framed = Buffer.from(launch.stdin!);
    const metadataLength = framed.readUInt32BE(0);
    const metadata = JSON.parse(framed.subarray(4, 4 + metadataLength).toString("utf8")) as {
      mode: string;
    };
    expect(metadata.mode).toBe("synthetic_only");
    expect(framed.subarray(4 + metadataLength)).toEqual(prompt);
  });

  it("decodes provider JSONL as event-stream evidence without exposing raw bytes in argv", async () => {
    const transport = new FakeTransport();
    const bridge = new ExternalWsl2CodexProviderBridge({
      distribution: "lexrunner-attempt-01234567",
      transport,
    });
    const events = [];
    for await (const event of bridge.observe("provider-handle-1", { afterSequence: 4 })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "completed", sequence: 5 });
    expect(Buffer.from(events[0]!.raw_bytes).toString("utf8")).toBe('{"type":"turn.completed"}');
    expect(transport.streams[0]!.args).toEqual([
      "observe",
      "--provider-handle",
      "provider-handle-1",
      "--after-sequence",
      "4",
    ]);
    expect(transport.streams[0]!.args.join(" ")).not.toContain("turn.completed");
  });

  it("sends the exact continuation authorization on stdin and never argv", async () => {
    const transport = new FakeTransport();
    const bridge = new ExternalWsl2CodexProviderBridge({
      distribution: "lexrunner-attempt-01234567",
      transport,
    });
    const exactAuthorization = authorization();
    await bridge.continueAfterAcceptance("provider-handle-1", exactAuthorization);
    const continuation = transport.requests.at(-1)!;
    expect(continuation.args).toEqual([
      "continue",
      "--provider-handle",
      "provider-handle-1",
      "--stdin-format",
      "canonical-json-v1",
    ]);
    expect(continuation.args.join(" ")).not.toContain(exactAuthorization.binding_digest);
    expect(JSON.parse(Buffer.from(continuation.stdin!).toString("utf8"))).toEqual(
      exactAuthorization
    );
  });

  it("releases the transient provider spool only through the opaque handle", async () => {
    const transport = new FakeTransport();
    const bridge = new ExternalWsl2CodexProviderBridge({
      distribution: "lexrunner-attempt-01234567",
      transport,
    });
    await bridge.release("provider-handle-1");
    expect(transport.requests.at(-1)?.args).toEqual([
      "release",
      "--provider-handle",
      "provider-handle-1",
    ]);
  });

  it("accepts only the disposable distribution namespace", () => {
    expect(
      () =>
        new ExternalWsl2CodexProviderBridge({
          distribution: "Ubuntu",
          transport: new FakeTransport(),
        })
    ).toThrow("disposable LexRunner distribution");
  });
});

class FakeTransport implements Wsl2CodexProviderTransport {
  readonly requests: {
    args: readonly string[];
    stdin?: Uint8Array;
    maxOutputBytes: number;
  }[] = [];
  readonly streams: { args: readonly string[]; maxLineBytes: number }[] = [];

  async request(input: {
    args: readonly string[];
    stdin?: Uint8Array;
    maxOutputBytes: number;
  }): Promise<Uint8Array> {
    this.requests.push(structuredClone(input));
    switch (input.args[0]) {
      case "launch":
        return json({
          operationId: "operation-1",
          providerHandle: "provider-handle-1",
          startedAt: at(1),
        });
      case "inspect":
        return json(attestations().executor);
      case "attest":
        return json(attestations());
      case "prepare":
        return json(attestations());
      case "collect":
        return json({ taskOutcome: "pass" });
      case "cancel":
        return json({ cancelled: true });
      case "continue":
        return json({ continued: true });
      case "release":
        return json({ released: true });
      default:
        throw new Error("unexpected fake transport request");
    }
  }

  async *stream(input: {
    args: readonly string[];
    signal?: AbortSignal;
    maxLineBytes: number;
  }): AsyncIterable<Uint8Array> {
    this.streams.push({ args: [...input.args], maxLineBytes: input.maxLineBytes });
    yield json({
      type: "completed",
      sequence: 5,
      observed_at: at(5),
      frame_class: "executor_event",
      raw_base64: Buffer.from('{"type":"turn.completed"}').toString("base64"),
    });
  }
}

function authorization(): AttemptAuthorization_v1 {
  const controls = GovernedControlId.options.map((control) => ({
    control,
    minimum_strength: "host_enforced_indirect" as const,
  }));
  const body = {
    schema_version: "1.0.0" as const,
    authorization_id: "authorization-1",
    attempt_id: "attempt-1",
    delegation_id: "delegation-1",
    requirements_hash: hash("requirements"),
    executor_attestation_hash: hash("executor"),
    environment_attestation_hash: hash("environment"),
    workspace_attestation_hash: hash("workspace"),
    grant: {
      schema_version: "1.0.0" as const,
      attempt_id: "attempt-1",
      delegation_id: "delegation-1",
      repository_id: "synthetic-repository",
      base_object_id: "1".repeat(40),
      candidate_object_id: "2".repeat(40),
      authorized_model_provider: "openai",
      source_disclosure_allowed: true as const,
      controls,
      tools: ["read_only_shell" as const],
      max_duration_ms: 60_000,
      max_output_bytes: 1_000_000,
    },
    authorized_at: at(1),
    expires_at: at(50),
  };
  return { ...body, binding_digest: computeCanonicalHash(body) };
}

function attestations() {
  return {
    executor: {
      schema_version: "1.0.0",
      executor_id: "codex-linux-pinned",
      executor_version: "0.145.0",
      executable_hash: hash("executable"),
      protocol: "jsonl-stdin",
      configuration_hash: hash("configuration"),
      tool_surface_hash: hash("tools"),
      observed_at: at(0),
      expires_at: at(50),
    },
    environment: {
      schema_version: "1.0.0",
      provider_id: "lexrunner.wsl2-bwrap",
      environment_id: "environment-1",
      topology_hash: hash("topology"),
      controls: GovernedControlId.options.map((control) => ({
        control,
        status: "enforced",
        strength: "independently_enforced_verified",
        evidence_refs: [hash(control)],
        enforcement_owner: "host-verifier",
      })),
      observed_at: at(0),
      expires_at: at(50),
    },
    workspace: {
      schema_version: "1.0.0",
      workspace_id: "workspace-1",
      repository_id: "synthetic-repository",
      base_object_id: "1".repeat(40),
      candidate_object_id: "2".repeat(40),
      corpus_hash: hash("corpus"),
      selection_hash: hash("selection"),
      corpus_kind: "synthetic",
      observed_at: at(0),
      expires_at: at(50),
    },
  };
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}
