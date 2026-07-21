import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repositoryRoot, "dist", "cli.js");
const mcpPath = join(repositoryRoot, "mcp-server.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("published merge application parity", () => {
  it("returns equivalent bounded dry-run JSON through CLI, MCP, and the merge alias", async () => {
    const root = await fixtureRepository(planWithOneItem());
    const planPath = join(root, "profile", "runner", "plan.json");

    const canonical = await execa(
      "node",
      [cliPath, "weave", "apply", "--plan", planPath, "--dry-run", "--no-constraints", "--json"],
      { cwd: root }
    );
    const compatibility = await execa(
      "node",
      [cliPath, "merge", "--plan", planPath, "--no-constraints", "--json"],
      { cwd: root }
    );
    const response = await invokeMcp(root, false, { dryRun: true });

    expect(JSON.parse(canonical.stdout)).toEqual(JSON.parse(response.result.content[0].text));
    expect(JSON.parse(compatibility.stdout)).toEqual(JSON.parse(canonical.stdout));
    expect(compatibility.stderr).toContain('compatibility alias "merge"; use "weave apply"');
  });

  it("returns semantically equivalent authorized execution summaries through CLI and MCP", async () => {
    const cliRoot = await fixtureRepository(emptyPlan());
    const mcpRoot = await fixtureRepository(emptyPlan());
    const planPath = join(cliRoot, "profile", "runner", "plan.json");

    const cli = await execa(
      "node",
      [cliPath, "weave", "apply", "--plan", planPath, "--skip-gates", "--execute", "--json"],
      { cwd: cliRoot }
    );
    const response = await invokeMcp(mcpRoot, true, { dryRun: false });

    expect(normalizeExecution(JSON.parse(cli.stdout))).toEqual(
      normalizeExecution(JSON.parse(response.result.content[0].text))
    );
  });

  it("publishes mutation denial as a stable bounded AXError", async () => {
    const root = await fixtureRepository(emptyPlan());
    const response = await invokeMcp(root, false, { dryRun: false });
    const error = JSON.parse(response.error.message);

    expect(error).toMatchObject({
      code: "MERGE_MUTATION_DENIED",
      context: { tool: "merge.apply" },
      message: "Merge mutation requires explicit execute authority",
    });
    expect(error.nextActions).toEqual(expect.arrayContaining([expect.stringContaining("dryRun")]));
    expect(Buffer.byteLength(response.error.message, "utf8")).toBeLessThan(4_096);
  });
});

function planWithOneItem() {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [{ name: "feature", deps: [], gates: [] }],
  };
}

function emptyPlan() {
  return { schemaVersion: "1.0.0", target: "main", items: [] };
}

async function fixtureRepository(plan: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lexrunner-merge-parity-"));
  roots.push(root);
  const profile = join(root, "profile");
  await mkdir(join(profile, "runner"), { recursive: true });
  await writeFile(join(profile, "profile.yml"), "role: local\n", "utf8");
  await writeFile(
    join(profile, "runner", "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8"
  );
  await execa("git", ["init", "-b", "main"], { cwd: root });
  await execa("git", ["add", "profile"], { cwd: root });
  await execa(
    "git",
    [
      "-c",
      "user.name=LexRunner Test",
      "-c",
      "user.email=lexrunner@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root }
  );
  return root;
}

async function invokeMcp(
  root: string,
  allowMutations: boolean,
  args: { dryRun: boolean }
): Promise<any> {
  const subprocess = execa("node", [mcpPath], {
    cwd: root,
    env: {
      ...process.env,
      ALLOW_MUTATIONS: String(allowMutations),
      LEX_PR_PROFILE_DIR: join(root, "profile"),
    },
  });
  let stdout = "";
  const response = new Promise<any>((resolveResponse, rejectResponse) => {
    subprocess.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline >= 0) resolveResponse(JSON.parse(stdout.slice(0, newline)));
    });
    subprocess.once("error", rejectResponse);
  });
  subprocess.stdin?.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "merge.apply", arguments: args },
    })}\n`
  );
  const result = await response;
  subprocess.stdin?.end();
  await subprocess;
  return result;
}

function normalizeExecution(result: Record<string, any>): Record<string, any> {
  return {
    ...result,
    runId: "<run-id>",
    artifactRefs: result.artifactRefs.map(({ kind }: { kind: string }) => ({
      kind,
      id: "<run-id>",
    })),
  };
}
