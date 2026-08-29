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

describe("published IntegrationRun compatibility retirement", () => {
  it("publishes explicit replacements, ownership, and the 3.0.0 removal window", async () => {
    const response = await invoke(fixtureRoot(), { id: 1, method: "tools/list", params: {} });
    const names = ["lexrunner.startRun", "lexrunner.getStatus", "lexrunner.listArtifacts"];

    for (const name of names) {
      const tool = response.result.tools.find((entry: { name: string }) => entry.name === name);
      expect(tool.description).toContain("DEPRECATED");
      expect(tool.description).toContain("IntegrationRun");
      expect(tool.description).toContain("3.0.0");
    }
  });

  it("returns bounded compatibility records without claiming ADR-010 authority", async () => {
    const root = fixtureRoot();
    const startedResponse = await invoke(root, {
      id: 2,
      method: "tools/call",
      params: {
        name: "lexrunner.startRun",
        arguments: { mode: "senior-dev", procedure: "merge-weave-main", repo: "owner/repo" },
      },
    });
    const started = JSON.parse(startedResponse.result.content[0].text);
    const statusResponse = await invoke(root, {
      id: 3,
      method: "tools/call",
      params: {
        name: "lexrunner.getStatus",
        arguments: { runId: started.runId },
      },
    });
    const status = JSON.parse(statusResponse.result.content[0].text);

    expect(started).toMatchObject({
      contract: "bounded-ax-v1",
      kind: "IntegrationRun",
      authority: "integration-record-only",
      deprecation: { tool: "lexrunner.startRun", removeIn: "3.0.0" },
    });
    expect(status).toMatchObject({
      contract: "bounded-ax-v1",
      kind: "IntegrationRun",
      authority: "integration-record-only",
      deprecation: { tool: "lexrunner.getStatus", removeIn: "3.0.0" },
      runId: started.runId,
    });
    expect(Buffer.byteLength(statusResponse.result.content[0].text, "utf8")).toBeLessThan(
      64 * 1024
    );
  });

  it("maps oversized compatibility input to a stable bounded AX error", async () => {
    const response = await invoke(fixtureRoot(), {
      id: 4,
      method: "tools/call",
      params: {
        name: "lexrunner.startRun",
        arguments: {
          mode: "test",
          procedure: "test",
          repo: "owner/repo",
          params: { payload: "x".repeat(20 * 1024) },
        },
      },
    });
    const error = JSON.parse(response.error.message);

    expect(error).toMatchObject({
      code: "INTEGRATION_RECORD_INVALID_INPUT",
      context: { tool: "lexrunner.startRun" },
    });
    expect(Buffer.byteLength(response.error.message, "utf8")).toBeLessThan(4096);
  });

  it("keeps the published retirement adapter outside CoordinationStore authority", () => {
    const service = fs.readFileSync(
      path.join(repositoryRoot, "src/application/integration-record-compatibility-service.ts"),
      "utf8"
    );
    const launcher = fs.readFileSync(path.join(repositoryRoot, "mcp-server.mjs"), "utf8");

    expect(service).not.toContain('from "../store/coordination-store');
    expect(service).not.toContain("createCoordinationStore");
    expect(launcher).not.toContain("createCoordinationStore");
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-mcp-integration-record-"));
  roots.push(root);
  return root;
}
