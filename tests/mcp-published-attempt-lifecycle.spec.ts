import { materializeAttemptInput } from "../src/runs/selected-work-materialization.js";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { createNativeWslProjectionRequest } from "../src/schemas/agent-work-projection.js";
import { computeCanonicalHash } from "../src/schemas/task-contract.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("published MCP Attempt lifecycle", () => {
  it("materializes identical selected input through built CLI and mutations-disabled MCP", async () => {
    const input = JSON.parse(
      await readFile(join(repositoryRoot, "examples/selected-work-input.json"), "utf8")
    );
    const expected = materializeAttemptInput(input);
    const [response] = await invoke({
      id: 90,
      method: "tools/call",
      params: { name: "materialize_attempt_input", arguments: input },
    });
    expect(JSON.parse(response.result.content[0].text)).toEqual(expected);
    const cli = await execa(
      "node",
      ["dist/cli.js", "attempt", "materialize", "--input", "-", "--json"],
      {
        cwd: repositoryRoot,
        input: JSON.stringify(input),
      }
    );
    expect(JSON.parse(cli.stdout)).toEqual(expected);
    expect(expected.ok).toBe(true);
  });

  it("advertises the shared bounded schemas from the npm launcher", async () => {
    const [response] = await invoke({ id: 1, method: "tools/list", params: {} });
    const tools = response.result.tools as Array<{
      name: string;
      inputSchema: { required?: string[]; properties?: Record<string, unknown> };
    }>;

    const preflight = tools.find((tool) => tool.name === "preflight_attempt_containment");
    const projectionPrepare = tools.find((tool) => tool.name === "prepare_native_wsl_projection");
    const projectionStatus = tools.find((tool) => tool.name === "get_native_wsl_projection_status");
    const projectionCleanup = tools.find((tool) => tool.name === "cleanup_native_wsl_projection");
    const projectionQuarantine = tools.find(
      (tool) => tool.name === "inspect_native_wsl_projection_quarantine"
    );
    const start = tools.find((tool) => tool.name === "start_attempt");
    const prepare = tools.find((tool) => tool.name === "prepare_attempt");
    const materialize = tools.find((tool) => tool.name === "materialize_attempt_input");
    expect(materialize?.inputSchema.properties).toHaveProperty("artifact");
    expect(materialize?.inputSchema.properties).toHaveProperty("selectedItemId");
    expect(prepare?.inputSchema.properties).toHaveProperty("expectedPacketHash");
    expect(prepare?.inputSchema.required).not.toContain("expectedPacketHash");
    const status = tools.find((tool) => tool.name === "get_attempt_status");
    const workerAttach = tools.find((tool) => tool.name === "attach_attempt_worker");
    const workerHeartbeat = tools.find((tool) => tool.name === "heartbeat_attempt_worker");
    const workerEnd = tools.find((tool) => tool.name === "end_attempt_worker");
    const workerStatus = tools.find((tool) => tool.name === "get_attempt_worker");
    const receiptSubmit = tools.find((tool) => tool.name === "submit_attempt_receipt");
    const receiptStatus = tools.find((tool) => tool.name === "get_attempt_receipt");
    const verificationRun = tools.find((tool) => tool.name === "verify_attempt");
    const verificationStatus = tools.find((tool) => tool.name === "get_attempt_verification");
    const acceptanceApply = tools.find((tool) => tool.name === "accept_attempt");
    const acceptanceStatus = tools.find((tool) => tool.name === "get_attempt_acceptance");

    expect(preflight?.inputSchema.required).toEqual(["runtime"]);
    expect(projectionPrepare?.inputSchema.required).toEqual(["request", "mutation"]);
    expect(projectionStatus?.inputSchema.required).toEqual(["request"]);
    expect(projectionCleanup?.inputSchema.required).toEqual(["request", "mutation"]);
    expect(projectionQuarantine?.inputSchema.required).toEqual(["request"]);
    expect(projectionPrepare?.inputSchema.properties?.request).toBeDefined();
    expect(projectionPrepare?.inputSchema.properties?.mutation).toBeDefined();
    expect(preflight?.inputSchema.properties?.runtime).toBeDefined();
    expect(verificationRun?.inputSchema.required).toEqual(["databasePath", "verification"]);
    expect(verificationStatus?.inputSchema.required).toEqual([
      "databasePath",
      "runId",
      "attemptId",
    ]);
    expect(verificationStatus?.inputSchema.properties).toHaveProperty("diagnostics");
    expect(acceptanceApply?.inputSchema.required).toEqual(["databasePath", "acceptance"]);
    expect(acceptanceStatus?.inputSchema.required).toEqual(["databasePath", "runId", "attemptId"]);
    expect(receiptSubmit?.inputSchema.required).toEqual(["databasePath", "submission"]);
    expect(receiptStatus?.inputSchema.required).toEqual(["databasePath", "runId", "attemptId"]);
    expect(workerAttach?.inputSchema.required).toEqual(["runtime", "attach"]);
    expect(workerHeartbeat?.inputSchema.required).toEqual(["databasePath", "heartbeat"]);
    expect(workerEnd?.inputSchema.required).toEqual(["databasePath", "end"]);
    expect(workerStatus?.inputSchema.required).toEqual(["databasePath", "runId", "attemptId"]);
    expect(prepare?.inputSchema.required).toEqual([
      "runtime",
      "workItem",
      "identity",
      "packet",
      "envelope",
      "attempt",
    ]);
    expect(prepare?.inputSchema.properties).toHaveProperty("workItem");
    expect(prepare?.inputSchema.properties).toHaveProperty("packet");
    expect(prepare?.inputSchema.properties).toHaveProperty("envelope");
    const envelopeSchema = prepare?.inputSchema.properties?.envelope as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(envelopeSchema.properties).toHaveProperty("projectRoot");
    expect(envelopeSchema.properties).toHaveProperty("executionRoot");
    expect(envelopeSchema.required).toEqual(
      expect.arrayContaining(["projectRoot", "executionRoot"])
    );
    expect(start?.inputSchema.required).toEqual(["runtime", "attempt"]);
    expect(start?.inputSchema.properties).toHaveProperty("runtime");
    expect(start?.inputSchema.properties).toHaveProperty("attempt");
    expect(status?.inputSchema.required).toEqual(["databasePath", "runId", "attemptId"]);
  });

  it("runs containment preflight read-only without mutation authority or durable state", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-mcp-containment-"));
    roots.push(root);
    const repositoryRoot = join(root, "repository");
    const worktreeRoot = join(root, "worktrees");
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(worktreeRoot);
    const before = (await readdir(root, { recursive: true })).map(String).sort();

    const [response] = await invoke({
      id: 15,
      method: "tools/call",
      params: {
        name: "preflight_attempt_containment",
        arguments: {
          runtime: {
            repositoryId: "repo-1",
            repositoryRoot,
            worktreeRoot,
            gitRuntime: "native-linux",
            pathComparison: "case-sensitive",
          },
        },
      },
    });
    const output = response.result.content[0].text as string;
    const after = (await readdir(root, { recursive: true })).map(String).sort();

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.containment.preflight",
        state: "native_ready",
        reasonCode: "native_linux_ready",
        physicalContainmentAvailable: true,
      },
    });
    expect(output).not.toContain(repositoryRoot);
    expect(after).toEqual(before);
  });

  it("reads projection status without mutation authority or control-state creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-mcp-projection-status-"));
    roots.push(root);
    const sourceRoot = join(root, "mapped-source");
    const projectionRoot = join(root, "native-projections");
    const worktreeRoot = join(root, "native-worktrees");
    await Promise.all([mkdir(sourceRoot), mkdir(projectionRoot), mkdir(worktreeRoot)]);
    const request = createNativeWslProjectionRequest({
      schema_version: "1.0.0",
      request_id: "mcp-projection-status",
      repository: {
        id: "repo-1",
        expected_remote_hash: computeCanonicalHash("https://example.invalid/repo.git"),
      },
      source: {
        windows_runtime: "windows-git",
        windows_repository_path: "D:\\dev\\repo",
        wsl_distribution: "Ubuntu",
        wsl_git_runtime: "wsl-git",
        wsl_repository_path: sourceRoot,
        head_policy: "observe",
        dirty_policy: "committed_base_only",
      },
      native: {
        host_id: "native-wsl",
        git_runtime: "wsl-git",
        projection_root: projectionRoot,
        worktree_root: worktreeRoot,
      },
      base_sha: "a".repeat(40),
    });
    const before = (await readdir(root, { recursive: true })).map(String).sort();

    const [response] = await invoke({
      id: 16,
      method: "tools/call",
      params: {
        name: "get_native_wsl_projection_status",
        arguments: { request },
      },
    });
    const output = response.result.content[0].text as string;

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      result: {
        operation: "agent-work.projection.status",
        state: "absent",
        nextActions: ["prepare_projection"],
      },
    });
    expect(output).not.toContain(root);
    expect(output).not.toContain("D:\\dev\\repo");
    expect((await readdir(root, { recursive: true })).map(String).sort()).toEqual(before);
  });

  it("keeps projection prepare and cleanup behind the published mutation gate", async () => {
    for (const [name, action] of [
      ["prepare_native_wsl_projection", "prepare a native WSL projection"],
      ["cleanup_native_wsl_projection", "clean up a native WSL projection"],
    ] as const) {
      const [response] = await invoke({
        id: 17,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      expect(JSON.parse(response.result.content[0].text)).toEqual({
        error: {
          code: "mutations_disabled",
          message: `Mutations not allowed. Set ALLOW_MUTATIONS=true to ${action}.`,
        },
        ok: false,
      });
    }
  });

  it("keeps receipt submission behind the mutation gate", async () => {
    const [response] = await invoke({
      id: 11,
      method: "tools/call",
      params: { name: "submit_attempt_receipt", arguments: {} },
    });

    expect(JSON.parse(response.result.content[0].text)).toEqual({
      error: {
        code: "mutations_disabled",
        message: "Mutations not allowed. Set ALLOW_MUTATIONS=true to submit an Attempt receipt.",
      },
      ok: false,
    });
  });

  it("returns the shared bounded receipt failure contract when mutations are enabled", async () => {
    const [response] = await invoke(
      {
        id: 13,
        method: "tools/call",
        params: { name: "submit_attempt_receipt", arguments: {} },
      },
      true
    );

    const output = response.result.content[0].text as string;
    expect(JSON.parse(output)).toEqual({
      error: {
        code: "invalid_input",
        issues: [
          { message: "Invalid input: expected string, received undefined", path: "databasePath" },
          { message: "Invalid input: expected object, received undefined", path: "submission" },
        ],
        message: "Invalid Attempt receipt input",
      },
      ok: false,
    });
    expect(Buffer.byteLength(output, "utf8")).toBeLessThan(4_096);
    expect(output).not.toContain("receiptJson");
  });

  it("keeps worker mutations behind the published mutation gate", async () => {
    const operations = [
      ["attach_attempt_worker", "attach an Attempt worker"],
      ["heartbeat_attempt_worker", "heartbeat an Attempt worker"],
      ["end_attempt_worker", "end an Attempt worker"],
    ] as const;

    for (const [name, action] of operations) {
      const [response] = await invoke({
        id: 10,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      expect(JSON.parse(response.result.content[0].text)).toEqual({
        error: {
          code: "mutations_disabled",
          message: `Mutations not allowed. Set ALLOW_MUTATIONS=true to ${action}.`,
        },
        ok: false,
      });
    }
  });

  it("keeps verification and acceptance behind the published mutation gate", async () => {
    const operations = [
      ["verify_attempt", "verify an Attempt"],
      ["accept_attempt", "accept an Attempt"],
    ] as const;
    for (const [name, action] of operations) {
      const [response] = await invoke({
        id: 14,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      expect(JSON.parse(response.result.content[0].text)).toEqual({
        error: {
          code: "mutations_disabled",
          message: `Mutations not allowed. Set ALLOW_MUTATIONS=true to ${action}.`,
        },
        ok: false,
      });
    }
  });

  it("keeps prepare_attempt behind the published mutation gate", async () => {
    const [response] = await invoke({
      id: 4,
      method: "tools/call",
      params: { name: "prepare_attempt", arguments: {} },
    });

    expect(JSON.parse(response.result.content[0].text)).toEqual({
      error: {
        code: "mutations_disabled",
        message: "Mutations not allowed. Set ALLOW_MUTATIONS=true to prepare an Attempt.",
      },
      ok: false,
    });
  });

  it("keeps start_attempt behind the published mutation gate", async () => {
    const [response] = await invoke({
      id: 2,
      method: "tools/call",
      params: { name: "start_attempt", arguments: {} },
    });

    expect(JSON.parse(response.result.content[0].text)).toEqual({
      error: {
        code: "mutations_disabled",
        message: "Mutations not allowed. Set ALLOW_MUTATIONS=true to start an Attempt.",
      },
      ok: false,
    });
  });

  it("does not create SQLite state while reading missing status", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-mcp-attempt-"));
    roots.push(root);
    const databasePath = join(root, "missing.db");
    const [response] = await invoke({
      id: 3,
      method: "tools/call",
      params: {
        name: "get_attempt_status",
        arguments: { databasePath, runId: "run-missing", attemptId: "attempt-missing" },
      },
    });

    expect(JSON.parse(response.result.content[0].text)).toMatchObject({
      error: { code: "invalid_input", issues: [{ path: "databasePath" }] },
      ok: false,
    });
    await expect(access(databasePath)).rejects.toThrow();
  });

  it("does not create SQLite state while reading missing receipt status", async () => {
    const root = await mkdtemp(join(tmpdir(), "lexrunner-mcp-receipt-"));
    roots.push(root);
    const databasePath = join(root, "missing.db");
    const [response] = await invoke({
      id: 12,
      method: "tools/call",
      params: {
        name: "get_attempt_receipt",
        arguments: { databasePath, runId: "run-missing", attemptId: "attempt-missing" },
      },
    });

    expect(JSON.parse(response.result.content[0].text)).toMatchObject({
      error: { code: "invalid_input", issues: [{ path: "databasePath" }] },
      ok: false,
    });
    await expect(access(databasePath)).rejects.toThrow();
  });
});

interface JsonRpcResponse {
  result: any;
}

async function invoke(
  request: {
    id: number;
    method: string;
    params: Record<string, unknown>;
  },
  allowMutations = false
): Promise<JsonRpcResponse[]> {
  const subprocess = execa("node", ["mcp-server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, ALLOW_MUTATIONS: String(allowMutations) },
  });
  let stdout = "";
  const response = new Promise<JsonRpcResponse>((resolveResponse, rejectResponse) => {
    subprocess.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline >= 0) resolveResponse(JSON.parse(stdout.slice(0, newline)) as JsonRpcResponse);
    });
    subprocess.once("error", rejectResponse);
  });

  subprocess.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
  const result = await response;
  subprocess.stdin?.end();
  await subprocess;
  return [result];
}
