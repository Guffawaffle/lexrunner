import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveContainedPackageTarget } from "./packed-package-paths.mjs";

const projectRoot = process.cwd();
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
).version;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lexrunner-packed-smoke-"));
const consumerRoot = path.join(temporaryRoot, "consumer");
const requiredAttemptTools = [
  "preflight_attempt_containment",
  "prepare_attempt",
  "start_attempt",
  "get_attempt_status",
  "attach_attempt_worker",
  "heartbeat_attempt_worker",
  "end_attempt_worker",
  "get_attempt_worker",
  "submit_attempt_receipt",
  "get_attempt_receipt",
  "verify_attempt",
  "get_attempt_verification",
  "accept_attempt",
  "get_attempt_acceptance",
  "prepare_native_wsl_projection",
  "get_native_wsl_projection_status",
  "cleanup_native_wsl_projection",
  "inspect_native_wsl_projection_quarantine",
];

try {
  const npmCliPath = resolveNpmCliPath();
  const packed = JSON.parse(
    execFileSync(
      process.execPath,
      [npmCliPath, "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
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
    process.execPath,
    [
      npmCliPath,
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
        if (typeof main.createAgentWorkContainmentPreflightHandler !== "function") {
          throw new Error("missing containment preflight root API");
        }
        if (!main.NativeWslProjectionRequest_v1) {
          throw new Error("missing native WSL projection contract root API");
        }
        if (typeof main.planNativeWslProjection !== "function") {
          throw new Error("missing native WSL projection planner root API");
        }
        if (typeof main.createNativeWslProjectionLifecycleHandlers !== "function") {
          throw new Error("missing native WSL projection lifecycle root API");
        }
        for (const name of [
          "NativeWslProjectionPrepareRequestJsonSchema",
          "NativeWslProjectionStatusRequestJsonSchema",
          "NativeWslProjectionCleanupRequestJsonSchema",
          "NativeWslProjectionQuarantineRequestJsonSchema",
        ]) {
          if (!main[name]) throw new Error("missing " + name + " root API");
        }
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
        if (!main.NativeWslProjectionRequest_v1) {
          throw new Error("missing CJS native WSL projection contract root API");
        }
        if (typeof main.planNativeWslProjection !== "function") {
          throw new Error("missing CJS native WSL projection planner root API");
        }
        if (typeof main.createNativeWslProjectionLifecycleHandlers !== "function") {
          throw new Error("missing CJS native WSL projection lifecycle root API");
        }
        const schema = require("@smartergpt/lexrunner/schemas/runner-stack");
        if (!schema.RunnerStackSchema) throw new Error("missing CJS schema API");
      `,
    ],
    { cwd: consumerRoot, encoding: "utf8" }
  );

  const binRoot = path.join(consumerRoot, "node_modules", ".bin");
  const installedPackageRoot = path.join(consumerRoot, "node_modules", "@smartergpt", "lexrunner");
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedPackageRoot, "package.json"), "utf8")
  );
  for (const name of ["lexrunner", "lex-pr", "lexrunner-mcp"]) assertBinShim(binRoot, name);
  const canonicalCli = resolvePackageBinTarget(
    installedPackageRoot,
    installedManifest,
    "lexrunner"
  );
  const compatibilityCli = resolvePackageBinTarget(
    installedPackageRoot,
    installedManifest,
    "lex-pr"
  );
  const expectedVersion = `LexRunner ${packageVersion} (lexrunner)`;
  const canonicalVersion = execFileSync(process.execPath, [canonicalCli, "--version"], {
    cwd: consumerRoot,
    encoding: "utf8",
  }).trim();
  const compatibilityVersion = execFileSync(process.execPath, [compatibilityCli, "--version"], {
    cwd: consumerRoot,
    encoding: "utf8",
  }).trim();
  if (canonicalVersion !== expectedVersion) {
    throw new Error(`Packed canonical CLI reported unexpected version: ${canonicalVersion}`);
  }
  if (compatibilityVersion !== canonicalVersion) {
    throw new Error("Packed lex-pr compatibility alias did not execute the canonical CLI");
  }

  const cliHelp = execFileSync(process.execPath, [canonicalCli, "--help"], {
    cwd: consumerRoot,
    encoding: "utf8",
  });
  if (!cliHelp.includes("Usage: lexrunner")) {
    throw new Error("Packed canonical CLI bin did not render canonical help");
  }
  const compatibilityHelp = execFileSync(process.execPath, [compatibilityCli, "--help"], {
    cwd: consumerRoot,
    encoding: "utf8",
  });
  if (!compatibilityHelp.includes("Usage: lexrunner")) {
    throw new Error("Packed lex-pr compatibility alias did not render canonical help");
  }

  smokeBoundedAttemptStatus(canonicalCli, consumerRoot);
  smokeProjectionCliSurface(canonicalCli, consumerRoot);

  const toolCount = await smokeMcp(
    resolvePackageBinTarget(installedPackageRoot, installedManifest, "lexrunner-mcp"),
    consumerRoot
  );
  process.stdout.write(
    `${JSON.stringify({
      installed: "@smartergpt/lexrunner",
      import: "passed",
      require: "passed",
      cli: "passed",
      cliAliases: ["lexrunner", "lex-pr"],
      assistedLifecycle: "bounded_read_only_status_passed",
      mcpTools: toolCount,
      mcpAttemptTools: requiredAttemptTools.length,
    })}\n`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function resolveNpmCliPath(env = process.env, nodeExecutable = process.execPath) {
  const configured = env.npm_execpath?.trim();
  if (configured) {
    if (path.win32.isAbsolute(configured) || path.posix.isAbsolute(configured)) return configured;
    return path.resolve(configured);
  }
  const pathApi = path.posix.isAbsolute(nodeExecutable)
    ? path.posix
    : path.win32.isAbsolute(nodeExecutable)
      ? path.win32
      : path;
  return pathApi.join(pathApi.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
}

function assertBinShim(binRoot, name) {
  const candidates =
    process.platform === "win32"
      ? [path.join(binRoot, `${name}.cmd`), path.join(binRoot, name)]
      : [path.join(binRoot, name), path.join(binRoot, `${name}.cmd`)];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) throw new Error(`Packed package omitted the ${name} executable`);
}

function resolvePackageBinTarget(packageRoot, manifest, name) {
  const relativeTarget = typeof manifest.bin === "object" ? manifest.bin?.[name] : undefined;
  if (typeof relativeTarget !== "string" || relativeTarget.length === 0) {
    throw new Error(`Packed package omitted the ${name} bin mapping`);
  }
  let target;
  try {
    target = resolveContainedPackageTarget(packageRoot, relativeTarget);
  } catch {
    throw new Error(`Packed package ${name} bin target escaped the package root`);
  }
  if (!fs.existsSync(target)) throw new Error(`Packed package omitted the ${name} bin target`);
  return target;
}

function smokeBoundedAttemptStatus(cliPath, cwd) {
  const databasePath = path.join(cwd, "missing-attempt.db");
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "attempt",
      "status",
      "--database-path",
      databasePath,
      "--run-id",
      "run-missing",
      "--attempt-id",
      "attempt-missing",
      "--json",
    ],
    { cwd, encoding: "utf8" }
  );

  if (result.error) throw result.error;
  if (result.status !== 2) {
    throw new Error(`Packed Attempt status exited ${result.status}: ${result.stderr}`);
  }
  const output = JSON.parse(result.stdout);
  if (output?.ok !== false || output?.error?.code !== "invalid_input") {
    throw new Error(`Packed Attempt status was not bounded: ${result.stdout}`);
  }
  if (Buffer.byteLength(result.stdout, "utf8") >= 4_096) {
    throw new Error("Packed Attempt status exceeded the bounded-output budget");
  }
  if (fs.existsSync(databasePath)) {
    throw new Error("Packed read-only Attempt status created lifecycle state");
  }
}

function smokeProjectionCliSurface(cliPath, cwd) {
  const inputPath = path.join(cwd, "invalid-projection-request.json");
  fs.writeFileSync(inputPath, "{}\n");
  for (const operation of ["prepare", "status", "cleanup", "quarantine"]) {
    const result = spawnSync(
      process.execPath,
      [cliPath, "attempt", "projection", operation, "--input", inputPath, "--json"],
      { cwd, encoding: "utf8" }
    );
    if (result.error) throw result.error;
    if (result.status !== 2) {
      throw new Error(`Packed projection ${operation} exited ${result.status}: ${result.stderr}`);
    }
    const output = JSON.parse(result.stdout);
    if (output?.ok !== false || output?.error?.code !== "invalid_input") {
      throw new Error(`Packed projection ${operation} was not bounded: ${result.stdout}`);
    }
    if (Buffer.byteLength(result.stdout, "utf8") >= 8_192) {
      throw new Error(`Packed projection ${operation} exceeded the output budget`);
    }
  }
}

async function smokeMcp(binPath, cwd) {
  const child = spawn(process.execPath, [binPath], {
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
  const publishedToolNames = new Set(tools.map(({ name }) => name));
  for (const name of requiredAttemptTools) {
    if (!publishedToolNames.has(name)) throw new Error(`Packed MCP omitted Attempt tool ${name}`);
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
