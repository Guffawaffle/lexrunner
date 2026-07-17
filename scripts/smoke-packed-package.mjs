import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-packed-smoke-"));
const consumerRoot = path.join(temporaryRoot, "consumer");

try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
      { cwd: projectRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    )
  )[0];
  const tarball = path.join(temporaryRoot, packed.filename);

  fs.mkdirSync(consumerRoot);
  fs.writeFileSync(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "lexrunner-packed-smoke", private: true, type: "module" })}\n`
  );
  execFileSync(
    "npm",
    [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--no-save",
      tarball,
    ],
    { cwd: consumerRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        const main = await import("@smartergpt/lexrunner");
        if (typeof main.canonicalJSONStringify !== "function") throw new Error("missing ESM root API");
        const checks = [
          ["@smartergpt/lexrunner/audit-sdk", "AUDIT_SCHEMA_VERSION"],
          ["@smartergpt/lexrunner/frames", "ExecutionFrameSchema"],
          ["@smartergpt/lexrunner/errors", "createAXError"],
          ["@smartergpt/lexrunner/schemas/runner-stack", "RunnerStackSchema"],
          ["@smartergpt/lexrunner/schemas/runner-scope", "RunnerScopeSchema"],
          ["@smartergpt/lexrunner/schemas/execution-plan-v1", "ExecutionPlanV1Schema"],
          ["@smartergpt/lexrunner/schemas/gates", "GatesSchema"],
          ["@smartergpt/lexrunner/schemas/behavior-rule", "BehaviorRuleSchema"],
        ];
        for (const [specifier, name] of checks) {
          const module = await import(specifier);
          if (!(name in module)) throw new Error("missing " + name + " from " + specifier);
        }
      `,
    ],
    { cwd: consumerRoot, encoding: "utf8" }
  );

  execFileSync(
    process.execPath,
    [
      "--eval",
      `
        const main = require("@smartergpt/lexrunner");
        if (typeof main.canonicalJSONStringify !== "function") throw new Error("missing CJS root API");
        const schema = require("@smartergpt/lexrunner/schemas/runner-stack");
        if (!schema.RunnerStackSchema) throw new Error("missing CJS schema API");
      `,
    ],
    { cwd: consumerRoot, encoding: "utf8" }
  );

  const binRoot = path.join(consumerRoot, "node_modules", ".bin");
  const cliHelp = execFileSync(path.join(binRoot, "lex-pr"), ["--help"], {
    cwd: consumerRoot,
    encoding: "utf8",
  });
  if (!cliHelp.includes("Usage: lex-pr")) throw new Error("Packed CLI bin did not render help");

  const toolCount = await smokeMcp(path.join(binRoot, "lexrunner-mcp"), consumerRoot);
  process.stdout.write(
    `${JSON.stringify({
      installed: "@smartergpt/lexrunner",
      import: "passed",
      require: "passed",
      cli: "passed",
      mcpTools: toolCount,
    })}\n`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

async function smokeMcp(binPath, cwd) {
  const child = spawn(binPath, [], {
    cwd,
    env: { ...process.env, ALLOW_MUTATIONS: "false" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Packed MCP smoke timed out. stderr:\n${stderr}`));
    }, 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code && stdout.length === 0) {
        clearTimeout(timeout);
        reject(new Error(`Packed MCP exited ${code}. stderr:\n${stderr}`));
      }
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`
    );
  });

  child.stdin.end();
  const tools = response?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`Packed MCP returned no tools: ${JSON.stringify(response)}`);
  }
  await new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Packed MCP did not exit after stdin closed. stderr:\n${stderr}`));
    }, 5_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Packed MCP exited ${code}. stderr:\n${stderr}`));
    });
  });
  return tools.length;
}
