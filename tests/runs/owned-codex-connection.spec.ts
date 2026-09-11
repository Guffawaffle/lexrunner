import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { OwnedCodexConnection } from "../../src/runs/owned-codex-connection.js";
import { InMemoryWorkerObservationStore } from "../../src/store/inmemory/worker-observation-store.js";
import { createAttachedWorker, taskPacket } from "../store/worker-dispatch-fixture.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const options = {
  executable: resolve("codex.exe"),
  cwd: resolve("scratch"),
  codexHome: resolve("home"),
  adapterId: "test",
  adapterVersion: "1",
};
let child: EventEmitter & {
  pid: number;
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
let sent: Array<{ id?: number; method: string; params: unknown }>;
let mode: string;
let providerThreadId: string;
let connection: OwnedCodexConnection | undefined;
function reply(value: unknown) {
  child.stdout.write(JSON.stringify(value) + "\n");
}
beforeEach(() => {
  sent = [];
  mode = "normal";
  providerThreadId = "owned-thread";
  child = Object.assign(new EventEmitter(), {
    pid: 123,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(chunk.toString());
        sent.push(message);
        queueMicrotask(() => {
          if (message.method === "initialize") reply({ id: message.id, result: {} });
          if (message.method === "thread/start")
            reply({
              id: message.id,
              result: {
                thread: {
                  id: providerThreadId,
                  ephemeral: true,
                  status: { type: "idle" },
                  turns: [],
                },
                cwd: options.cwd,
                approvalPolicy: "never",
                sandbox: { type: mode === "bad-settings" ? "dangerFullAccess" : "readOnly" },
                model: "test-model",
                modelProvider: "test",
              },
            });
          if (message.method === "turn/start" && mode !== "lost")
            reply({ id: message.id, result: { turn: { id: "turn-1" } } });
        });
        callback();
      },
      final(callback) {
        queueMicrotask(() => child.emit("close", 0, null));
        callback();
      },
    }),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    }),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});
afterEach(async () => {
  await connection?.close();
  connection = undefined;
  vi.restoreAllMocks();
});
const requestOptions = () => ({
  signal: new AbortController().signal,
  deadlineAt: new Date(Date.now() + 1000).toISOString(),
});
const params = { threadId: "owned-thread", input: [{ type: "text" as const, text: "task" }] };

describe("owned Codex connection", () => {
  it("retains terminal evidence before acknowledgment and retries only persistence after loss", async () => {
    const store = new InMemoryWorkerObservationStore();
    try {
      const controller = await createAttachedWorker(store);
      providerThreadId = "native-session-1";
      connection = await OwnedCodexConnection.open(options);
      const binding = {
        sessionId: "worker-session-1",
        claimId: "capture-claim",
        requestHash: "sha256:" + "b".repeat(64),
      };
      await store.claimWorkerDispatch({
        ...binding,
        controller,
        runId: "run-1",
        expectedRunRevision: 0,
        attemptId: "attempt-1",
        expectedAttemptRevision: 3,
        workspaceLeaseId: "workspace-lease-1",
        expectedWorkspaceLeaseRevision: 0,
        expectedSessionRevision: 0,
        packetHash: taskPacket().packet_hash,
        now: "2026-08-12T12:00:04.000Z",
      });
      const realPersist = store.recordWorkerTurnEvidence.bind(store);
      let lost = true;
      const port = {
        getWorkerTurnEvidence: store.getWorkerTurnEvidence.bind(store),
        recordWorkerTurnEvidence: vi.fn(async (input, now) => {
          const result = await realPersist(input, now);
          if (lost) {
            lost = false;
            throw new Error("lost persistence response");
          }
          return result;
        }),
      };
      mode = "lost";
      const abort = new AbortController();
      const send = connection.request(
        "turn/start",
        { ...params, threadId: providerThreadId },
        {
          ...requestOptions(),
          signal: abort.signal,
        }
      );
      const sendFailure = expect(send).rejects.toThrow("request_aborted");
      reply({
        method: "turn/completed",
        params: {
          threadId: providerThreadId,
          turn: { id: "turn-early", status: "completed", items: [{ text: "birds" }] },
        },
      });
      expect(connection.snapshot().pendingTurnCaptures).toBe(1);
      abort.abort();
      await sendFailure;
      await connection.close();
      await expect(
        connection.persistNextTurnCapture(port, binding, new Date().toISOString())
      ).rejects.toThrow("lost persistence response");
      expect(connection.snapshot().pendingTurnCaptures).toBe(1);
      expect(
        await connection.persistNextTurnCapture(port, binding, new Date().toISOString())
      ).toMatchObject({ recorded: true, replay: true });
      expect(connection.snapshot().pendingTurnCaptures).toBe(0);
      expect(await store.listWorkerObservations(binding.sessionId)).toHaveLength(1);
      const records = await store.listWorkerObservations(binding.sessionId);
      expect(
        await store.getWorkerTurnEvidence(binding.sessionId, records[0].observationId)
      ).toContain('"text":"birds"');
      expect(sent.filter((x) => x.method === "turn/start")).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
  it("rejects terminal events from another thread and premature completion", async () => {
    connection = await OwnedCodexConnection.open(options);
    reply({
      method: "turn/completed",
      params: { threadId: "other", turn: { id: "turn", status: "completed" } },
    });
    expect(connection.snapshot().failure).toBe("unexpected_execution");
    expect(connection.snapshot().pendingTurnCaptures).toBe(0);
  });
  it("rejects a different thread after dispatch without enqueuing its evidence", async () => {
    connection = await OwnedCodexConnection.open(options);
    await connection.request("turn/start", params, requestOptions());
    reply({
      method: "turn/completed",
      params: { threadId: "other", turn: { id: "turn", status: "completed" } },
    });
    expect(connection.snapshot().failure).toBe("thread_mismatch");
    expect(connection.snapshot().pendingTurnCaptures).toBe(0);
  });
  it("serializes capture persistence and retains an event when storage rejects it", async () => {
    connection = await OwnedCodexConnection.open(options);
    await connection.request("turn/start", params, requestOptions());
    reply({
      method: "turn/completed",
      params: { threadId: "owned-thread", turn: { id: "turn", status: "failed" } },
    });
    let finish!: (value: { recorded: false; reason: "evidence_limit" }) => void;
    const port = {
      getWorkerTurnEvidence: async () => null,
      recordWorkerTurnEvidence: vi.fn(
        () =>
          new Promise<{ recorded: false; reason: "evidence_limit" }>((resolve) => {
            finish = resolve;
          })
      ),
    };
    const binding = {
      sessionId: "session",
      claimId: "claim",
      requestHash: "sha256:" + "b".repeat(64),
    };
    const pending = connection.persistNextTurnCapture(port, binding, new Date().toISOString());
    await expect(
      connection.persistNextTurnCapture(port, binding, new Date().toISOString())
    ).rejects.toThrow("capture_in_progress");
    finish({ recorded: false, reason: "evidence_limit" });
    expect(await pending).toEqual({ recorded: false, reason: "evidence_limit" });
    expect(connection.snapshot().pendingTurnCaptures).toBe(1);
    expect(port.recordWorkerTurnEvidence).toHaveBeenCalledOnce();
  });
  it("bounds queued bytes independently of event count", async () => {
    connection = await OwnedCodexConnection.open(options);
    await connection.request("turn/start", params, requestOptions());
    for (let i = 0; i < 3; i++)
      reply({
        method: "turn/completed",
        params: {
          threadId: "owned-thread",
          turn: { id: String(i), status: "completed", items: [{ text: "x".repeat(900000) }] },
        },
      });
    expect(connection.snapshot().failure).toBe("turn_capture_limit");
    expect(connection.snapshot().pendingTurnCaptures).toBe(2);
  });
  it("fails explicitly on capture overflow while preserving previously queued evidence", async () => {
    connection = await OwnedCodexConnection.open(options);
    await connection.request("turn/start", params, requestOptions());
    for (let i = 0; i < 129; i++)
      reply({
        method: "turn/completed",
        params: { threadId: "owned-thread", turn: { id: String(i), status: "completed" } },
      });
    expect(connection.snapshot().failure).toBe("turn_capture_limit");
    expect(connection.snapshot().pendingTurnCaptures).toBe(128);
  });
  it("rejects invalid UTF-8 rather than changing retained evidence bytes", async () => {
    connection = await OwnedCodexConnection.open(options);
    child.stdout.write(Buffer.from([0xff]));
    expect(connection.snapshot().failure).toBe("invalid_utf8");
  });
  it("launches fixed argv, binds an idle session, and closes only its child", async () => {
    connection = await OwnedCodexConnection.open(options);
    expect(spawn).toHaveBeenCalledWith(
      options.executable,
      ["app-server", "--stdio"],
      expect.objectContaining({ shell: false, windowsHide: true, cwd: options.cwd })
    );
    const launch = vi.mocked(spawn).mock.calls[0][2]!;
    expect(launch.env?.CODEX_HOME).toBe(options.codexHome);
    expect(launch.env?.NODE_OPTIONS).toBeUndefined();
    expect(connection.session.threadId).toBe("owned-thread");
    expect(connection.snapshot().methods).toEqual(["initialize", "thread/start"]);
    expect(await connection.close()).toMatchObject({
      processExited: true,
      forced: false,
      execution: "not_dispatched",
    });
  });
  it("rejects changed settings and cleans up bootstrap", async () => {
    mode = "bad-settings";
    await expect(OwnedCodexConnection.open(options)).rejects.toThrow("bootstrap_rejected");
    expect(sent.some((x) => x.method === "turn/start")).toBe(false);
  });
  it("rejects a different thread and settings overrides before writing", async () => {
    connection = await OwnedCodexConnection.open(options);
    await expect(
      connection.request("turn/start", { ...params, threadId: "other" }, requestOptions())
    ).rejects.toThrow("thread_mismatch");
    await expect(
      connection.request(
        "turn/start",
        { ...params, model: "other" } as typeof params,
        requestOptions()
      )
    ).rejects.toThrow();
    expect(connection.snapshot().turnAttempted).toBe(false);
  });
  it("rejects expired and pre-aborted dispatch without spending the send", async () => {
    connection = await OwnedCodexConnection.open(options);
    await expect(
      connection.request("turn/start", params, { ...requestOptions(), deadlineAt: "invalid" })
    ).rejects.toThrow("dispatch_window_expired");
    await expect(
      connection.request("turn/start", params, { ...requestOptions(), signal: AbortSignal.abort() })
    ).rejects.toThrow("dispatch_window_expired");
    expect(connection.snapshot().turnAttempted).toBe(false);
  });
  it("sends at most once and retains possible execution at close", async () => {
    connection = await OwnedCodexConnection.open(options);
    await expect(connection.request("turn/start", params, requestOptions())).resolves.toEqual({
      turn: { id: "turn-1" },
    });
    await expect(connection.request("turn/start", params, requestOptions())).rejects.toThrow(
      "dispatch_already_attempted"
    );
    expect(sent.filter((x) => x.method === "turn/start")).toHaveLength(1);
    expect(await connection.close()).toMatchObject({ execution: "may_have_started" });
  });
  it("treats lost acknowledgment as uncertain and never replays", async () => {
    mode = "lost";
    connection = await OwnedCodexConnection.open(options);
    const abort = new AbortController();
    const result = connection.request("turn/start", params, {
      ...requestOptions(),
      signal: abort.signal,
    });
    abort.abort();
    await expect(result).rejects.toThrow("request_aborted");
    await expect(connection.request("turn/start", params, requestOptions())).rejects.toThrow();
    expect(sent.filter((x) => x.method === "turn/start")).toHaveLength(1);
    expect(await connection.close()).toMatchObject({
      execution: "may_have_started",
      processExited: true,
    });
  });
  it.each([
    [{ id: 99, result: {} }, "response_mismatch"],
    [{ id: 3, method: "approval/request", params: {} }, "server_request_unsupported"],
    [{ method: "turn/started", params: {} }, "unexpected_execution"],
    [{ method: "thread/started", params: { thread: { id: "other" } } }, "thread_mismatch"],
  ])("fails closed on protocol violation %j", async (message, reason) => {
    connection = await OwnedCodexConnection.open(options);
    reply(message);
    expect(connection.snapshot().failure).toBe(reason);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it("decodes fragmented UTF-8 and safely counts prototype-like notification names", async () => {
    connection = await OwnedCodexConnection.open(options);
    const bytes = Buffer.from(JSON.stringify({ method: "__proto__", params: "🐦" }) + "\n");
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    expect(connection.snapshot().notifications["__proto__"]).toBe(1);
    expect(connection.snapshot().failure).toBeNull();
  });
  it("bounds malformed output and never retains provider stderr", async () => {
    connection = await OwnedCodexConnection.open(options);
    child.stderr.write("private provider diagnostic");
    child.stdout.write("garbage\n");
    expect(connection.snapshot().failure).toBe("invalid_json");
    expect(JSON.stringify(connection.snapshot())).not.toContain("private provider");
  });
  it("times out a lost response without replay", async () => {
    mode = "lost";
    connection = await OwnedCodexConnection.open(options);
    await expect(
      connection.request("turn/start", params, {
        ...requestOptions(),
        deadlineAt: new Date(Date.now() + 20).toISOString(),
      })
    ).rejects.toThrow("request_timeout");
    expect(sent.filter((x) => x.method === "turn/start")).toHaveLength(1);
    expect(await connection.close()).toMatchObject({
      processExited: true,
      execution: "may_have_started",
    });
  });
  it("reports uncertainty if its child cannot be stopped", async () => {
    connection = await OwnedCodexConnection.open(options);
    vi.spyOn(child.stdin, "end").mockReturnValue(child.stdin);
    child.kill.mockImplementation(() => false);
    vi.useFakeTimers();
    try {
      const closing = connection.close();
      await vi.advanceTimersByTimeAsync(6000);
      expect(await closing).toMatchObject({
        processExited: false,
        forced: true,
        execution: "not_dispatched",
      });
      await expect(connection.request("turn/start", params, requestOptions())).rejects.toThrow(
        "connection_closed"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
