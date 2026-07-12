import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("published MCP Attempt lifecycle", () => {
  it("advertises the shared bounded schemas from the npm launcher", async () => {
    const [response] = await invoke({ id: 1, method: "tools/list", params: {} });
    const tools = response.result.tools as Array<{
      name: string;
      inputSchema: { required?: string[]; properties?: Record<string, unknown> };
    }>;

    const start = tools.find((tool) => tool.name === "start_attempt");
    const prepare = tools.find((tool) => tool.name === "prepare_attempt");
    const status = tools.find((tool) => tool.name === "get_attempt_status");

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
});

interface JsonRpcResponse {
  result: any;
}

async function invoke(request: {
  id: number;
  method: string;
  params: Record<string, unknown>;
}): Promise<JsonRpcResponse[]> {
  const subprocess = execa("node", ["mcp-server.mjs"], {
    cwd: repositoryRoot,
    env: { ...process.env, ALLOW_MUTATIONS: "false" },
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
