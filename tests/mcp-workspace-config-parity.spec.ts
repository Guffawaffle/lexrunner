import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("published MCP workspace/config parity", () => {
  it("shares deterministic non-interactive initialization across CLI and MCP", async () => {
    const cliRoot = fixtureRoot();
    const mcpRoot = fixtureRoot();
    for (const root of [cliRoot, mcpRoot]) {
      fs.mkdirSync(path.join(root, ".smartergpt"), { recursive: true });
      fs.writeFileSync(path.join(root, ".smartergpt", "scope.yml"), "version: 1\ntarget: main\n");
    }

    const cli = JSON.parse(
      (
        await execa(
          "node",
          [
            path.join(repositoryRoot, "dist", "cli.js"),
            "workspace",
            "init",
            "--non-interactive",
            "--json",
          ],
          { cwd: cliRoot }
        )
      ).stdout
    ).data;
    const mcp = await invoke(mcpRoot, {
      id: 10,
      method: "tools/call",
      params: { name: "local.init", arguments: {} },
    });
    const mcpResult = JSON.parse(mcp.result.content[0].text);
    const { path: _cliPath, ...cliComparable } = cli;
    const { path: _mcpPath, ...mcpComparable } = mcpResult;

    expect(mcpComparable).toEqual(cliComparable);
    expect(mcpResult.contract).toBe("bounded-ax-v1");
  });

  it("routes CLI and MCP configuration queries through the same bounded result", async () => {
    const root = fixtureRoot();
    fs.mkdirSync(path.join(root, ".smartergpt"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".smartergpt", "scope.yml"),
      "version: 1\ntarget: main\ncredentials:\n  token: never-print-this\n"
    );

    const cli = JSON.parse(
      (
        await execa(
          "node",
          [path.join(repositoryRoot, "dist", "cli.js"), "config", "show", "--json"],
          {
            cwd: root,
          }
        )
      ).stdout
    );
    const mcp = await invoke(root, {
      id: 1,
      method: "tools/call",
      params: { name: "config.show", arguments: {} },
    });
    const mcpResult = JSON.parse(mcp.result.content[0].text);

    expect(mcpResult).toEqual(cli);
    expect(mcpResult.contract).toBe("bounded-ax-v1");
    expect(JSON.stringify(mcpResult)).not.toContain("never-print-this");
  });

  it("publishes the health removal window and delegates compatibility output to doctor", async () => {
    const root = fixtureRoot();
    fs.writeFileSync(path.join(root, ".nvmrc"), `${process.versions.node.split(".")[0]}\n`);
    const tools = await invoke(root, { id: 2, method: "tools/list", params: {} });
    const healthTool = tools.result.tools.find((tool: { name: string }) => tool.name === "health");
    expect(healthTool.description).toContain("DEPRECATED: use doctor");
    expect(healthTool.description).toContain("2.0.0");

    const doctor = await invoke(root, {
      id: 3,
      method: "tools/call",
      params: { name: "doctor", arguments: {} },
    });
    const health = await invoke(root, {
      id: 4,
      method: "tools/call",
      params: { name: "health", arguments: {} },
    });
    const doctorResult = JSON.parse(doctor.result.content[0].text);
    const healthResult = JSON.parse(health.result.content[0].text);

    expect(doctorResult.contract).toBe("bounded-ax-v1");
    expect(healthResult).toMatchObject(doctorResult);
    expect(healthResult.deprecation).toEqual({
      tool: "health",
      replacement: "doctor",
      removeIn: "2.0.0",
    });
  });

  it("maps shared service failures to stable bounded AX errors", async () => {
    const response = await invoke(fixtureRoot(), {
      id: 5,
      method: "tools/call",
      params: { name: "config.show", arguments: { key: "missing.key" } },
    });
    const error = JSON.parse(response.error.message);

    expect(error).toMatchObject({
      code: "CONFIG_KEY_NOT_FOUND",
      context: { tool: "config.show" },
    });
    expect(error.nextActions.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(response.error.message, "utf8")).toBeLessThan(4096);
  });
});

interface JsonRpcResponse {
  result: any;
  error: any;
}

async function invoke(
  cwd: string,
  request: { id: number; method: string; params: Record<string, unknown> }
): Promise<JsonRpcResponse> {
  const subprocess = execa("node", [path.join(repositoryRoot, "mcp-server.mjs")], {
    cwd,
    env: { ...process.env, ALLOW_MUTATIONS: "false" },
  });
  let stdout = "";
  const response = new Promise<JsonRpcResponse>((resolve, reject) => {
    subprocess.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline >= 0) resolve(JSON.parse(stdout.slice(0, newline)) as JsonRpcResponse);
    });
    subprocess.once("error", reject);
  });
  subprocess.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
  const result = await response;
  subprocess.stdin?.end();
  await subprocess;
  return result;
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-mcp-workspace-"));
  roots.push(root);
  return root;
}
