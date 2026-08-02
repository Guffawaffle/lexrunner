import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execa } from "execa";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/mcp/server.js";
import { formatPlanValidationFailure, loadPlan, SchemaValidationError } from "../src/schema.js";
import { InMemoryRunStore } from "../src/store/inmemory/index.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const roots: string[] = [];
const SECRET_VALUE = "dogfood-secret-value-that-must-not-be-reported";
const SECRET_KEY = "dogfood-secret-key-that-must-not-be-reported";
const CLI_INVOCATION_TIMEOUT_MS = 5_000;
const CLI_SCENARIO_TIMEOUT_MS = 12_000;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bounded plan validation diagnostics", () => {
  it("preserves all five dogfood item paths without echoing rejected values", () => {
    const error = captureSchemaError(JSON.stringify(invalidPlan(5)));
    const failure = formatPlanValidationFailure(error);

    expect(failure).toMatchObject({
      contract: "bounded-ax-v1",
      valid: false,
      code: "PLAN_VALIDATION_FAILED",
      message: "Plan validation failed with 5 error(s)",
      errorCount: 5,
      errorsTruncated: false,
      context: { errorCount: 5, errorsTruncated: false },
    });
    expect(failure.errors).toHaveLength(5);
    expect(failure.errors.map((entry) => entry.path)).toEqual([
      "items.0.gates.0.run",
      "items.1.gates.0.run",
      "items.2.gates.0.run",
      "items.3.gates.0.run",
      "items.4.gates.0.run",
    ]);
    expect(failure.errors.every((entry) => entry.code === "invalid_type")).toBe(true);
    expect(JSON.stringify(failure)).not.toContain(SECRET_VALUE);
  });

  it("bounds hostile error counts, paths, messages, and serialized output", () => {
    const error = captureSchemaError(JSON.stringify(invalidPlan(75)));
    const failure = formatPlanValidationFailure(error);

    expect(failure.errorCount).toBe(75);
    expect(failure.errors).toHaveLength(50);
    expect(failure.errorsTruncated).toBe(true);
    expect(failure.errors.every((entry) => Buffer.byteLength(entry.path, "utf8") <= 256)).toBe(
      true
    );
    expect(failure.errors.every((entry) => Buffer.byteLength(entry.message, "utf8") <= 512)).toBe(
      true
    );
    expect(Buffer.byteLength(JSON.stringify(failure), "utf8")).toBeLessThan(64 * 1024);
    expect(JSON.stringify(failure)).not.toContain(SECRET_VALUE);
  });

  it("does not echo hostile unknown or dynamic record keys", () => {
    const unknownKeyFailure = formatPlanValidationFailure(
      captureSchemaError(JSON.stringify(planWithSecretUnknownKey()))
    );
    expect(unknownKeyFailure.errors).toEqual([
      {
        path: "root",
        message: "Object contains one or more unrecognized keys",
        code: "unrecognized_keys",
      },
    ]);
    expect(JSON.stringify(unknownKeyFailure)).not.toContain(SECRET_KEY);

    const dynamicKeyFailure = formatPlanValidationFailure(
      captureSchemaError(JSON.stringify(planWithSecretEnvironmentKey()))
    );
    expect(dynamicKeyFailure.errors).toEqual([
      {
        path: "items.0.gates.0.env.<key>",
        message: "Value has an invalid type",
        code: "invalid_type",
      },
    ]);
    expect(JSON.stringify(dynamicKeyFailure)).not.toContain(SECRET_KEY);
  });

  it(
    "keeps schema CLI JSON and human output actionable",
    async () => {
      const root = fixtureRoot();
      const planPath = writePlan(root, invalidPlan(5));

      const jsonResult = await runCli(["schema", "validate", planPath, "--json"]);
      expect(jsonResult.exitCode).toBe(1);
      const json = JSON.parse(jsonResult.stdout);
      expect(json.errorCount).toBe(5);
      expect(json.errors.map((entry: { path: string }) => entry.path)).toEqual([
        "items.0.gates.0.run",
        "items.1.gates.0.run",
        "items.2.gates.0.run",
        "items.3.gates.0.run",
        "items.4.gates.0.run",
      ]);
      expect(jsonResult.stdout).not.toContain(SECRET_VALUE);

      const humanResult = await runCli(["schema", "validate", planPath]);
      expect(humanResult.exitCode).toBe(1);
      expect(humanResult.stderr).toContain("Plan validation failed with 5 error(s)");
      expect(humanResult.stderr).toContain("items.0.gates.0.run [invalid_type]");
      expect(humanResult.stderr).toContain("items.4.gates.0.run [invalid_type]");
      expect(humanResult.stderr).not.toContain(SECRET_VALUE);
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it(
    "redacts hostile unknown keys from schema CLI JSON",
    async () => {
      const root = fixtureRoot();
      const planPath = writePlan(root, planWithSecretUnknownKey());
      const hostileResult = await runCli(["schema", "validate", planPath, "--json"]);
      expect(hostileResult.exitCode).toBe(1);
      expect(hostileResult.stdout).toContain("Object contains one or more unrecognized keys");
      expect(hostileResult.stdout).not.toContain(SECRET_KEY);
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it.each([0, 1])(
    "redacts malformed schema CLI input case %# in JSON and human output",
    async (caseIndex) => {
      const root = fixtureRoot();
      const planPath = path.join(root, "plan.json");
      const malformed = malformedSecretPlans()[caseIndex];
      if (!malformed) throw new Error(`Missing malformed-plan fixture ${caseIndex}`);
      fs.writeFileSync(planPath, malformed.content);

      const malformedResult = await runCli(["schema", "validate", planPath, "--json"]);
      expect(malformedResult.exitCode).toBe(1);
      expect(malformedResult.stdout).toContain("Invalid JSON: plan content could not be parsed");
      expect(JSON.parse(malformedResult.stdout)).toMatchObject({
        contract: "bounded-ax-v1",
        valid: false,
        code: "CONFIG_INVALID",
        errorCount: 1,
        errorsTruncated: false,
      });
      const output = `${malformedResult.stdout}${malformedResult.stderr}`;
      expect(output).not.toContain(malformed.secret);
      expect(output).not.toContain(SECRET_VALUE);
      expect(output).not.toContain("TOPSECRET");

      const malformedHumanResult = await runCli(["schema", "validate", planPath]);
      expect(malformedHumanResult.exitCode).toBe(1);
      expect(malformedHumanResult.stderr).toContain(
        "Invalid JSON: plan content could not be parsed"
      );
      expect(malformedHumanResult.stderr).not.toContain(malformed.secret);
      expect(malformedHumanResult.stderr).not.toContain(SECRET_VALUE);
      expect(malformedHumanResult.stderr).not.toContain("TOPSECRET");
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it(
    "keeps status CLI JSON and human output actionable",
    async () => {
      const root = fixtureRoot();
      const planPath = writePlan(root, invalidPlan(5));

      const jsonResult = await runCli(["status", "--plan", planPath, "--json"]);
      expect(jsonResult.exitCode).toBe(2);
      const json = JSON.parse(jsonResult.stdout);
      expect(json).toMatchObject({
        contract: "bounded-ax-v1",
        valid: false,
        errorCount: 5,
        errorsTruncated: false,
      });
      expect(json.errors).toHaveLength(5);
      expect(jsonResult.stdout).not.toContain(SECRET_VALUE);

      const humanResult = await runCli(["status", "--plan", planPath]);
      expect(humanResult.exitCode).toBe(2);
      expect(humanResult.stderr).toContain("Plan validation failed with 5 error(s)");
      expect(humanResult.stderr).toContain("items.0.gates.0.run [invalid_type]");
      expect(humanResult.stderr).toContain("items.4.gates.0.run [invalid_type]");
      expect(humanResult.stderr).not.toContain(SECRET_VALUE);
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it(
    "redacts malformed status CLI input in JSON and human output",
    async () => {
      const root = fixtureRoot();
      const planPath = path.join(root, "plan.json");
      fs.writeFileSync(planPath, "TOPSECRET");

      const malformedJsonResult = await runCli(["status", "--plan", planPath, "--json"]);
      expect(malformedJsonResult.exitCode).toBe(2);
      expect(JSON.parse(malformedJsonResult.stdout)).toMatchObject({
        contract: "bounded-ax-v1",
        valid: false,
        code: "CONFIG_INVALID",
        errorCount: 1,
        errorsTruncated: false,
      });
      expect(`${malformedJsonResult.stdout}${malformedJsonResult.stderr}`).not.toContain(
        "TOPSECRET"
      );

      const malformedHumanResult = await runCli(["status", "--plan", planPath]);
      expect(malformedHumanResult.exitCode).toBe(2);
      expect(malformedHumanResult.stderr).toContain(
        "Invalid JSON: plan content could not be parsed"
      );
      expect(malformedHumanResult.stderr).not.toContain("TOPSECRET");
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it(
    "bounds each CLI subprocess with command-level diagnostics",
    async () => {
      const root = fixtureRoot();
      const planPath = writePlan(root, invalidPlan(5));
      await expect(runCli(["schema", "validate", planPath, "--json"], 1)).rejects.toThrow(
        /CLI invocation timed out after 1ms \(schema validate --json; observed \d+ms\)/u
      );
    },
    CLI_SCENARIO_TIMEOUT_MS
  );

  it("returns detailed SDK MCP plan_validate errors and separates malformed JSON", async () => {
    const runStore = new InMemoryRunStore();
    const server = createServer({ runStore });
    const client = new Client({ name: "plan-validation-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const schemaResponse = await client.callTool({
        name: "plan_validate",
        arguments: { planContent: JSON.stringify(invalidPlan(5)) },
      });
      const schemaFailure = parseToolText(schemaResponse);
      expect(schemaFailure).toMatchObject({
        contract: "bounded-ax-v1",
        valid: false,
        code: "PLAN_VALIDATION_FAILED",
        errorCount: 5,
        errorsTruncated: false,
      });
      expect(schemaFailure.errors).toHaveLength(5);
      expect(JSON.stringify(schemaFailure)).not.toContain(SECRET_VALUE);

      for (const malformed of malformedSecretPlans()) {
        const malformedResponse = await client.callTool({
          name: "plan_validate",
          arguments: { planContent: malformed.content },
        });
        const malformedFailure = parseToolText(malformedResponse);
        expect(malformedFailure).toMatchObject({
          contract: "bounded-ax-v1",
          valid: false,
          code: "CONFIG_INVALID",
          message: "Invalid JSON: plan content could not be parsed",
          errorCount: 1,
          errorsTruncated: false,
          errors: [
            {
              path: "root",
              message: "Invalid JSON: plan content could not be parsed",
              code: "CONFIG_INVALID",
            },
          ],
        });
        const serialized = JSON.stringify(malformedFailure);
        expect(serialized).not.toContain(malformed.secret);
        expect(serialized).not.toContain(SECRET_VALUE);
        expect(serialized).not.toContain("TOPSECRET");
        expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(64 * 1024);
      }

      const hostileResponse = await client.callTool({
        name: "plan_validate",
        arguments: { planContent: JSON.stringify(planWithSecretUnknownKey()) },
      });
      const hostileFailure = parseToolText(hostileResponse);
      expect(hostileFailure.errors).toEqual([
        {
          path: "root",
          message: "Object contains one or more unrecognized keys",
          code: "unrecognized_keys",
        },
      ]);
      expect(JSON.stringify(hostileFailure)).not.toContain(SECRET_KEY);

      const duplicateResponse = await client.callTool({
        name: "plan_validate",
        arguments: { planContent: JSON.stringify(planWithSecretDuplicateName()) },
      });
      const duplicateFailure = parseToolText(duplicateResponse);
      expect(duplicateFailure).toMatchObject({
        contract: "bounded-ax-v1",
        valid: false,
        code: "PLAN_VALIDATION_FAILED",
        message: "Plan validation failed with 1 error(s)",
        errorCount: 1,
        errorsTruncated: false,
        errors: [
          {
            path: "items",
            message: "Plan item names must be unique",
            code: "DUPLICATE_NAMES",
          },
        ],
      });
      expect(JSON.stringify(duplicateFailure)).not.toContain(SECRET_VALUE);
    } finally {
      await client.close();
      await server.close();
      await runStore.close();
    }
  });

  it("returns bounded failures from every SDK MCP runtime plan consumer", async () => {
    const root = fixtureRoot();
    const planPath = writePlan(root, invalidPlan(5));
    const profilePath = path.join(root, "profile");
    fs.mkdirSync(path.join(profilePath, "runner"), { recursive: true });
    fs.writeFileSync(path.join(profilePath, "profile.yml"), "role: local\n");
    fs.writeFileSync(path.join(profilePath, "runner", "plan.json"), JSON.stringify(invalidPlan(5)));

    const previousProfile = process.env.LEX_PR_PROFILE_DIR;
    process.env.LEX_PR_PROFILE_DIR = profilePath;

    const runStore = new InMemoryRunStore();
    const server = createServer({ runStore });
    const client = new Client({ name: "runtime-validation-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const calls = [
        { name: "weave_status", arguments: { planFile: planPath } },
        { name: "gates_run", arguments: { planFile: planPath } },
        { name: "merge_order", arguments: { planFile: planPath } },
        { name: "plan_analyze", arguments: { planFile: planPath } },
        { name: "merge_apply", arguments: { dryRun: true } },
      ];

      for (const call of calls) {
        const failure = parseToolText(await client.callTool(call));
        expect(failure).toMatchObject({
          contract: "bounded-ax-v1",
          valid: false,
          code: "PLAN_VALIDATION_FAILED",
          errorCount: 5,
          errorsTruncated: false,
        });
        expect(failure.errors).toHaveLength(5);
        expect(JSON.stringify(failure)).not.toContain(SECRET_VALUE);
      }

      fs.writeFileSync(planPath, "TOPSECRET");
      fs.writeFileSync(path.join(profilePath, "runner", "plan.json"), "TOPSECRET");
      for (const call of calls) {
        const failure = parseToolText(await client.callTool(call));
        expect(failure).toMatchObject({
          contract: "bounded-ax-v1",
          valid: false,
          code: "CONFIG_INVALID",
          message: "Invalid JSON: plan content could not be parsed",
          errorCount: 1,
          errorsTruncated: false,
        });
        expect(JSON.stringify(failure)).not.toContain("TOPSECRET");
      }
    } finally {
      if (previousProfile === undefined) delete process.env.LEX_PR_PROFILE_DIR;
      else process.env.LEX_PR_PROFILE_DIR = previousProfile;
      await client.close();
      await server.close();
      await runStore.close();
    }
  });

  it("returns the same bounded failure from the published MCP status tool", async () => {
    const root = fixtureRoot();
    const planPath = writePlan(root, invalidPlan(5));
    const response = await invokePublishedMcp(root, {
      id: 1,
      method: "tools/call",
      params: { name: "status", arguments: { planFile: planPath } },
    });

    expect(response.error).toBeUndefined();
    const failure = JSON.parse(response.result.content[0].text);
    expect(failure).toMatchObject({
      contract: "bounded-ax-v1",
      valid: false,
      code: "PLAN_VALIDATION_FAILED",
      errorCount: 5,
      errorsTruncated: false,
    });
    expect(failure.errors).toHaveLength(5);
    expect(response.result.content[0].text).not.toContain(SECRET_VALUE);

    writePlan(root, planWithSecretUnknownKey());
    const hostileResponse = await invokePublishedMcp(root, {
      id: 2,
      method: "tools/call",
      params: { name: "status", arguments: { planFile: planPath } },
    });
    expect(hostileResponse.result.content[0].text).toContain(
      "Object contains one or more unrecognized keys"
    );
    expect(hostileResponse.result.content[0].text).not.toContain(SECRET_KEY);

    fs.writeFileSync(planPath, "TOPSECRET");
    const malformedResponse = await invokePublishedMcp(root, {
      id: 3,
      method: "tools/call",
      params: { name: "status", arguments: { planFile: planPath } },
    });
    expect(malformedResponse.error).toBeUndefined();
    expect(JSON.parse(malformedResponse.result.content[0].text)).toMatchObject({
      contract: "bounded-ax-v1",
      valid: false,
      code: "CONFIG_INVALID",
      errorCount: 1,
      errorsTruncated: false,
    });
    expect(malformedResponse.result.content[0].text).not.toContain("TOPSECRET");
  });
});

function invalidPlan(itemCount: number): object {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: Array.from({ length: itemCount }, (_, index) => ({
      name: `item-${index}`,
      deps: [],
      gates: [
        {
          name: `gate-${index}`,
          run: { token: SECRET_VALUE },
        },
      ],
    })),
  };
}

function validPlan(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [
      {
        name: "item-0",
        deps: [],
        gates: [{ name: "gate-0", run: "npm test" }],
      },
    ],
  };
}

function planWithSecretUnknownKey(): object {
  return { ...validPlan(), [SECRET_KEY]: true };
}

function planWithSecretEnvironmentKey(): object {
  const plan = validPlan();
  const items = plan.items as Array<{ gates: Array<Record<string, unknown>> }>;
  items[0].gates[0].env = { [SECRET_KEY]: { token: SECRET_VALUE } };
  return plan;
}

function planWithSecretDuplicateName(): object {
  const item = {
    name: SECRET_VALUE,
    deps: [],
    gates: [{ name: "gate-0", run: "npm test" }],
  };
  return {
    schemaVersion: "1.0.0",
    target: "main",
    items: [item, { ...item }],
  };
}

function malformedSecretPlans(): Array<{ content: string; secret: string }> {
  const shortSecret = "TOPSECRET";
  const longSecret = SECRET_VALUE.repeat(200);
  return [
    { content: shortSecret, secret: shortSecret },
    { content: `{"token": ${longSecret}}`, secret: longSecret },
  ];
}

function captureSchemaError(planContent: string): SchemaValidationError {
  try {
    loadPlan(planContent);
    throw new Error("Expected schema validation to fail");
  } catch (error) {
    if (error instanceof SchemaValidationError) return error;
    throw error;
  }
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-plan-validation-"));
  roots.push(root);
  return root;
}

function writePlan(root: string, plan: object): string {
  const planPath = path.join(root, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan));
  return planPath;
}

async function runCli(args: string[], timeoutMs = CLI_INVOCATION_TIMEOUT_MS) {
  const result = await execa("node", [cliPath, ...args], {
    cwd: repositoryRoot,
    timeout: timeoutMs,
    forceKillAfterDelay: 500,
    reject: false,
  });
  if (result.timedOut) {
    const invocation = args.filter((argument) => !path.isAbsolute(argument)).join(" ");
    throw new Error(
      `CLI invocation timed out after ${timeoutMs}ms (${invocation || "unknown"}; observed ${Math.ceil(result.durationMs)}ms)`
    );
  }
  return result;
}

function parseToolText(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, any> {
  const text = result.content.find((entry) => entry.type === "text")?.text;
  if (!text) throw new Error("MCP tool returned no text content");
  return JSON.parse(text);
}

interface JsonRpcResponse {
  result?: any;
  error?: any;
}

async function invokePublishedMcp(
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
