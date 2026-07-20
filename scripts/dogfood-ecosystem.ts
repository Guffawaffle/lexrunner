import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  executeAgentWorkPreparation,
  type AgentWorkPreparationCommandRunner,
} from "../src/runs/agent-work-preparation-service.js";
import { createAgentTaskPacket } from "../src/schemas/agent-work.js";
import { computeCanonicalHash } from "../src/schemas/task-contract.js";
import { canonicalJSONStringify } from "../src/util/canonicalJson.js";

const execFileAsync = promisify(execFile);
const MARKER = ".lexrunner-dogfood-allocation.json";
const RECEIPT = "dogfood-receipt.json";
const DEFAULT_ALLOCATION_ROOT = path.join(os.tmpdir(), "lexrunner-ecosystem-dogfood");
const DEFAULT_VERSIONS = {
  lex: "3.0.1",
  lexMcp: "3.0.1",
  axf: "2.0.0",
  lexsona: "1.0.0",
} as const;

interface DogfoodMarker {
  schema_version: 1;
  kind: "LexRunnerEcosystemDogfoodAllocation";
  run_id: string;
  allocation_root_hash: string;
  created_at: string;
}

interface DogfoodStepReceipt {
  id: string;
  outcome: "passed" | "failed" | "interrupted";
  evidence_hash?: string;
}

interface DogfoodReceipt {
  schema_version: 1;
  kind: "LexRunnerEcosystemDogfoodReceipt";
  run_id: string;
  status: "running" | "passed" | "failed" | "interrupted";
  phase: string;
  allocation_root_hash: string;
  versions: Record<string, string>;
  steps: DogfoodStepReceipt[];
  preparation_receipt_hash?: string;
  started_at: string;
  completed_at?: string;
  error_code?: string;
  receipt_hash: string;
}

interface RunOptions {
  allocationRoot: string;
  projectRoot: string;
  receiptOut?: string;
  retain: boolean;
  diagnostics: boolean;
  faultAfter?: "stage" | "prepare";
  versions: typeof DEFAULT_VERSIONS;
}

export async function runEcosystemDogfood(options: RunOptions): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  const sourceState = await gitStatus(options.projectRoot);
  const allocationRoot = await ensureAllocationRoot(options.allocationRoot);
  const runRoot = await mkdtemp(path.join(allocationRoot, "run-"));
  const runId = path.basename(runRoot);
  const allocationRootHash = hashText(allocationRoot);
  const marker: DogfoodMarker = {
    schema_version: 1,
    kind: "LexRunnerEcosystemDogfoodAllocation",
    run_id: runId,
    allocation_root_hash: allocationRootHash,
    created_at: startedAt,
  };
  await writeCanonical(path.join(runRoot, MARKER), marker);
  let receipt = withReceiptHash({
    schema_version: 1 as const,
    kind: "LexRunnerEcosystemDogfoodReceipt" as const,
    run_id: runId,
    status: "running" as const,
    phase: "stage",
    allocation_root_hash: allocationRootHash,
    versions: requestedVersions(options.versions),
    steps: [],
    started_at: startedAt,
  });
  await writeCanonical(path.join(runRoot, RECEIPT), receipt);
  let keep = options.retain;
  try {
    const stageRoot = path.join(runRoot, "stage");
    const candidateRoot = path.join(stageRoot, "candidate");
    const consumerRoot = path.join(runRoot, "consumer");
    const cacheRoot = path.join(runRoot, "npm-cache");
    await Promise.all([mkdir(stageRoot), mkdir(consumerRoot), mkdir(cacheRoot)]);

    await materializeCandidate(options.projectRoot, candidateRoot);
    const buildOutput = await runExpectedCommand(
      "candidate_build_failed",
      "npm",
      ["run", "build"],
      candidateRoot,
      300_000
    );
    const packOutput = await runExpectedCommand(
      "candidate_pack_failed",
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", stageRoot],
      candidateRoot,
      120_000
    );
    const packed = (await readdir(stageRoot)).filter((entry) => entry.endsWith(".tgz"));
    if (packed.length !== 1) throw failure("pack_artifact_ambiguous");
    const tarball = path.join(stageRoot, packed[0]!);
    receipt = await advanceReceipt(
      runRoot,
      receipt,
      "stage",
      computeCanonicalHash({
        build_stdout: hashText(buildOutput.stdout),
        build_stderr: hashText(buildOutput.stderr),
        pack_stdout: hashText(packOutput.stdout),
      })
    );
    if (options.faultAfter === "stage") throw interruption("fault_after_stage");

    const consumerPackage = {
      name: "lexrunner-ecosystem-dogfood",
      private: true,
      type: "module",
      dependencies: {
        "@smartergpt/axf": options.versions.axf,
        "@smartergpt/lex": options.versions.lex,
        "@smartergpt/lex-mcp": options.versions.lexMcp,
        "@smartergpt/lexrunner": `file:${tarball}`,
        "@smartergpt/lexsona": options.versions.lexsona,
      },
    };
    await writeCanonical(path.join(consumerRoot, "package.json"), consumerPackage);
    const packet = createAgentTaskPacket({
      schema_version: "1.0.0",
      packet_id: `${runId}-packet`,
      run_id: runId,
      work_item: { work_item_id: "ecosystem-dogfood", revision: 1 },
      attempt_id: `${runId}-attempt`,
      repository: { id: "lexrunner", base_sha: await gitHead(options.projectRoot) },
      objective: "Install and smoke the published ecosystem with the staged LexRunner candidate.",
      acceptance_criteria: [
        {
          id: "clean-install",
          text: "Exact public package versions install without sibling checkouts.",
        },
        { id: "public-smoke", text: "Every ecosystem package responds through a public surface." },
      ],
      instructions: ["Do not mutate source checkouts.", "Retain only bounded hashed evidence."],
      scope: {
        read_globs: ["package.json", "package-lock.json", "node_modules/**"],
        write_globs: ["package-lock.json", "node_modules/**"],
        deny_globs: [".git/**"],
        cross_repo_allowed: false,
      },
      authority: {
        edit: false,
        git_write: false,
        github_write: false,
        external_runtime: true,
        secrets: false,
        signing: false,
        release: false,
      },
      preparation: {
        policy: {
          network: "registry_only",
          registries: ["https://registry.npmjs.org/"],
          cache: "read_write",
          lifecycle_scripts: "forbidden",
        },
        steps: [
          {
            id: "install-exact-ecosystem",
            kind: "provision",
            argv: ["npm", "install", "--no-audit", "--no-fund"],
            depends_on: [],
            expected_exit_codes: [0],
          },
        ],
      },
      verification: [
        {
          id: "smoke-public-surfaces",
          argv: ["node", "--input-type=module", "--eval", "bounded-embedded-smoke"],
          depends_on: ["install-exact-ecosystem"],
          expected_exit_codes: [0],
        },
      ],
      budget: { max_elapsed_ms: 15 * 60_000 },
      created_at: startedAt,
    });
    const runner = new NpmPreparationRunner(cacheRoot);
    const preparation = await executeAgentWorkPreparation({
      packet,
      worktreeRoot: consumerRoot,
      receiptId: `${runId}-preparation`,
      runner,
      now: monotonicNow(),
    });
    if (!preparation.ok) throw failure(`preparation_${preparation.failedStepId ?? "failed"}`);
    receipt = await advanceReceipt(
      runRoot,
      { ...receipt, preparation_receipt_hash: preparation.receipt.receipt_hash },
      "prepare",
      preparation.receipt.receipt_hash
    );
    if (options.faultAfter === "prepare") throw interruption("fault_after_prepare");

    const installedVersions = await readInstalledVersions(consumerRoot);
    assertExactVersions(installedVersions, requestedVersions(options.versions));
    const smoke = await runExpectedCommand(
      "public_surface_smoke_failed",
      process.execPath,
      ["--input-type=module", "--eval", PUBLIC_SURFACE_SMOKE],
      consumerRoot,
      120_000
    );
    if ((await gitStatus(options.projectRoot)) !== sourceState) {
      throw failure("source_checkout_changed");
    }
    receipt = await advanceReceipt(runRoot, receipt, "verify", hashText(smoke.stdout));
    receipt = withReceiptHash({
      ...withoutHash(receipt),
      status: "passed",
      phase: "complete",
      versions: installedVersions,
      completed_at: new Date().toISOString(),
    });
    await persistReceipt(runRoot, receipt, options.receiptOut);
    if (!keep) await reapDogfoodRun({ allocationRoot, runRoot });
    return compactRunResult(receipt, runRoot, options);
  } catch (error) {
    keep = true;
    const interrupted = isInterruption(error);
    receipt = withReceiptHash({
      ...withoutHash(receipt),
      status: interrupted ? "interrupted" : "failed",
      completed_at: new Date().toISOString(),
      error_code: errorCode(error),
    });
    await persistReceipt(runRoot, receipt, options.receiptOut);
    return compactRunResult(receipt, runRoot, { ...options, retain: true });
  }
}

export async function inspectDogfoodRun(input: {
  allocationRoot: string;
  runRoot: string;
  diagnostics?: boolean;
}): Promise<Record<string, unknown>> {
  const { runRoot } = await validateOwnedRun(input.allocationRoot, input.runRoot);
  const receipt = parseReceipt(await readFile(path.join(runRoot, RECEIPT), "utf8"));
  return input.diagnostics
    ? {
        ok: true,
        runId: receipt.run_id,
        status: receipt.status,
        phase: receipt.phase,
        versions: receipt.versions,
        steps: receipt.steps,
        receiptHash: receipt.receipt_hash,
      }
    : {
        ok: true,
        runId: receipt.run_id,
        status: receipt.status,
        phase: receipt.phase,
        passed: receipt.steps.filter(({ outcome }) => outcome === "passed").length,
        total: receipt.steps.length,
      };
}

export async function reapDogfoodRun(input: {
  allocationRoot: string;
  runRoot: string;
}): Promise<Record<string, unknown>> {
  const allocationRoot = path.resolve(input.allocationRoot);
  const runRoot = path.resolve(input.runRoot);
  assertDirectChild(allocationRoot, runRoot);
  try {
    await lstat(runRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, outcome: "absent" };
    }
    throw error;
  }
  const owned = await validateOwnedRun(allocationRoot, runRoot);
  await rm(owned.runRoot, { recursive: true, force: false });
  return { ok: true, outcome: "removed", runId: owned.marker.run_id };
}

class NpmPreparationRunner implements AgentWorkPreparationCommandRunner {
  constructor(private readonly cacheRoot: string) {}

  async run(input: Parameters<AgentWorkPreparationCommandRunner["run"]>[0]) {
    if (input.argv[0] !== "npm") {
      return policyFailure(input.policyHash, "unsupported_preparation_command");
    }
    if (input.policy.network !== "registry_only" || input.policy.cache !== "read_write") {
      return policyFailure(input.policyHash, "preparation_policy_not_enforceable");
    }
    const args = input.argv.slice(1);
    if (input.policy.registries.length !== 1) {
      return policyFailure(input.policyHash, "registry_policy_not_enforceable");
    }
    args.push("--registry", input.policy.registries[0]!, "--cache", this.cacheRoot);
    if (input.policy.lifecycle_scripts === "forbidden") args.push("--ignore-scripts");
    try {
      const output = await runCommand("npm", args, input.cwd, 300_000);
      return {
        exitCode: 0,
        stdout: output.stdout,
        stderr: output.stderr,
        policyHash: input.policyHash,
      };
    } catch (error) {
      const command = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: Number.isSafeInteger(command.code) ? command.code! : -1,
        stdout: command.stdout ?? "",
        stderr: command.stderr ?? "command_failed",
        policyHash: input.policyHash,
      };
    }
  }
}

async function validateOwnedRun(allocationInput: string, runInput: string) {
  const allocationRoot = await realpath(path.resolve(allocationInput));
  const runRootInput = path.resolve(runInput);
  assertDirectChild(allocationRoot, runRootInput);
  const stat = await lstat(runRootInput);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("allocation_not_directory");
  const runRoot = await realpath(runRootInput);
  assertDirectChild(allocationRoot, runRoot);
  const marker = JSON.parse(await readFile(path.join(runRoot, MARKER), "utf8")) as DogfoodMarker;
  if (
    marker.schema_version !== 1 ||
    marker.kind !== "LexRunnerEcosystemDogfoodAllocation" ||
    marker.run_id !== path.basename(runRoot) ||
    marker.allocation_root_hash !== hashText(allocationRoot)
  ) {
    throw failure("allocation_marker_mismatch");
  }
  return { allocationRoot, runRoot, marker };
}

function assertDirectChild(allocationRoot: string, runRoot: string): void {
  if (path.dirname(runRoot) !== allocationRoot || path.basename(runRoot).length === 0) {
    throw failure("cleanup_containment_violation");
  }
}

async function ensureAllocationRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("invalid_allocation_root");
  return realpath(resolved);
}

async function advanceReceipt(
  runRoot: string,
  current: DogfoodReceipt,
  id: string,
  evidenceHash: string
): Promise<DogfoodReceipt> {
  const next = withReceiptHash({
    ...withoutHash(current),
    phase: id,
    steps: [...current.steps, { id, outcome: "passed" as const, evidence_hash: evidenceHash }],
  });
  await writeCanonical(path.join(runRoot, RECEIPT), next);
  return next;
}

async function persistReceipt(
  runRoot: string,
  receipt: DogfoodReceipt,
  receiptOut?: string
): Promise<void> {
  await writeCanonical(path.join(runRoot, RECEIPT), receipt);
  if (receiptOut) await writeCanonical(path.resolve(receiptOut), receipt);
}

function parseReceipt(raw: string): DogfoodReceipt {
  const receipt = JSON.parse(raw) as DogfoodReceipt;
  if (
    receipt.schema_version !== 1 ||
    receipt.kind !== "LexRunnerEcosystemDogfoodReceipt" ||
    receipt.receipt_hash !== computeCanonicalHash(withoutHash(receipt))
  ) {
    throw failure("receipt_invalid");
  }
  return receipt;
}

function withReceiptHash(value: Omit<DogfoodReceipt, "receipt_hash">): DogfoodReceipt {
  return { ...value, receipt_hash: computeCanonicalHash(value) };
}

function withoutHash(receipt: DogfoodReceipt): Omit<DogfoodReceipt, "receipt_hash"> {
  const { receipt_hash: _hash, ...value } = receipt;
  return value;
}

async function writeCanonical(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${canonicalJSONStringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readInstalledVersions(consumerRoot: string): Promise<Record<string, string>> {
  const lock = JSON.parse(await readFile(path.join(consumerRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const packageNames = [
    "@smartergpt/axf",
    "@smartergpt/lex",
    "@smartergpt/lex-mcp",
    "@smartergpt/lexrunner",
    "@smartergpt/lexsona",
  ];
  return Object.fromEntries(
    packageNames.map((name) => [
      name,
      required(lock.packages?.[`node_modules/${name}`]?.version, `version_missing_${name}`),
    ])
  );
}

function requestedVersions(versions: typeof DEFAULT_VERSIONS): Record<string, string> {
  return {
    "@smartergpt/axf": versions.axf,
    "@smartergpt/lex": versions.lex,
    "@smartergpt/lex-mcp": versions.lexMcp,
    "@smartergpt/lexrunner": "staged",
    "@smartergpt/lexsona": versions.lexsona,
  };
}

function assertExactVersions(
  actual: Record<string, string>,
  expected: Record<string, string>
): void {
  for (const [name, version] of Object.entries(expected)) {
    if (name === "@smartergpt/lexrunner") continue;
    if (actual[name] !== version) throw failure(`version_mismatch_${name}`);
  }
}

function compactRunResult(
  receipt: DogfoodReceipt,
  runRoot: string,
  options: Pick<RunOptions, "diagnostics" | "retain" | "receiptOut">
): Record<string, unknown> {
  return {
    ok: receipt.status === "passed",
    runId: receipt.run_id,
    status: receipt.status,
    phase: receipt.phase,
    passed: receipt.steps.filter(({ outcome }) => outcome === "passed").length,
    total: receipt.steps.length,
    receiptHash: receipt.receipt_hash,
    ...(options.retain ? { runRoot } : {}),
    ...(options.receiptOut ? { receiptPath: path.resolve(options.receiptOut) } : {}),
    ...(options.diagnostics
      ? { versions: receipt.versions, steps: receipt.steps, errorCode: receipt.error_code ?? null }
      : {}),
  };
}

async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(executable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout,
  });
}

async function runExpectedCommand(
  failureCode: string,
  executable: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await runCommand(executable, args, cwd, timeout);
  } catch {
    throw failure(failureCode);
  }
}

async function gitHead(projectRoot: string): Promise<string> {
  const { stdout } = await runCommand("git", ["rev-parse", "HEAD"], projectRoot, 30_000);
  return stdout.trim();
}

async function gitStatus(projectRoot: string): Promise<string> {
  const { stdout } = await runCommand(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    projectRoot,
    30_000
  );
  return stdout;
}

async function materializeCandidate(
  projectRootInput: string,
  candidateRoot: string
): Promise<void> {
  const projectRoot = await realpath(projectRootInput);
  await mkdir(candidateRoot);
  const entries = [
    "package.json",
    "tsconfig.json",
    "tsup.config.ts",
    "src",
    "schemas",
    ".smartergpt/schemas",
    "scripts/validate-build-artifacts.ts",
    "mcp-server.mjs",
    "README.md",
    "README.mcp.md",
    "CHANGELOG.md",
    "NOTICE.md",
    "LICENSE.md",
  ];
  for (const entry of entries) {
    await cp(path.join(projectRoot, entry), path.join(candidateRoot, entry), { recursive: true });
  }
  await symlink(
    path.join(projectRoot, "node_modules"),
    path.join(candidateRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
}

function monotonicNow(): () => string {
  let prior = 0;
  return () => {
    const now = Math.max(Date.now(), prior + 1);
    prior = now;
    return new Date(now).toISOString();
  };
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function required<T>(value: T | undefined, code: string): T {
  if (value === undefined) throw failure(code);
  return value;
}

function failure(code: string): Error & { dogfoodCode: string } {
  return Object.assign(new Error(code), { dogfoodCode: code });
}

function interruption(code: string): Error & { dogfoodCode: string; interrupted: true } {
  return Object.assign(failure(code), { interrupted: true as const });
}

function isInterruption(error: unknown): boolean {
  return Boolean((error as { interrupted?: boolean })?.interrupted);
}

function errorCode(error: unknown): string {
  return (error as { dogfoodCode?: string })?.dogfoodCode ?? "unexpected_failure";
}

function policyFailure(policyHash: string, message: string) {
  return { exitCode: -1, stdout: "", stderr: message, policyHash };
}

const PUBLIC_SURFACE_SMOKE = String.raw`
  import { spawn, execFileSync } from "node:child_process";
  import path from "node:path";
  const lex = await import("@smartergpt/lex");
  const lexMcp = await import("@smartergpt/lex-mcp");
  const lexrunner = await import("@smartergpt/lexrunner");
  const lexsona = await import("@smartergpt/lexsona");
  if (Object.keys(lex).length === 0) throw new Error("lex root API empty");
  if (Object.keys(lexMcp).length === 0) throw new Error("lex-mcp root API empty");
  if (Object.keys(lexsona).length === 0) throw new Error("lexsona root API empty");
  for (const name of ["AgentWorkPreparationReceipt_v1", "AgentWorkFanoutPlan_v1", "executeAgentWorkPreparation", "AgentWorkFanoutService"]) {
    if (!(name in lexrunner)) throw new Error("missing LexRunner surface: " + name);
  }
  const bin = path.join(process.cwd(), "node_modules", ".bin");
  for (const [name, args] of [["lex", ["--help"]], ["axf", ["--help"]], ["lexsona", ["--help"]], ["lex-pr", ["--help"]]]) {
    execFileSync(path.join(bin, name), args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  const mcp = await new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, "lex-mcp"), [], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("lex-mcp timeout")); }, 15000);
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      const response = JSON.parse(stdout.slice(0, newline));
      child.stdin.end();
      if (!Array.isArray(response?.result?.tools) || response.result.tools.length === 0) reject(new Error("lex-mcp tools empty: " + stderr));
      else resolve(response.result.tools.length);
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n");
  });
  process.stdout.write(JSON.stringify({ ok: true, lex: "imported", lexMcpTools: mcp, axf: "cli", lexsona: "imported", lexrunner: "candidate" }) + "\n");
`;

async function main(argv: string[]): Promise<void> {
  const command = argv[0] && !argv[0].startsWith("-") ? argv.shift()! : "run";
  const flags = parseFlags(argv);
  const allocationRoot = path.resolve(flags.get("allocation-root") ?? DEFAULT_ALLOCATION_ROOT);
  let result: Record<string, unknown>;
  if (command === "run") {
    result = await runEcosystemDogfood({
      allocationRoot,
      projectRoot: process.cwd(),
      ...(flags.get("receipt-out") ? { receiptOut: flags.get("receipt-out") } : {}),
      retain: flags.has("retain"),
      diagnostics: flags.has("diagnostics"),
      ...(flags.get("fault-after")
        ? { faultAfter: flags.get("fault-after") as "stage" | "prepare" }
        : {}),
      versions: {
        lex: flags.get("lex") ?? DEFAULT_VERSIONS.lex,
        lexMcp: flags.get("lex-mcp") ?? DEFAULT_VERSIONS.lexMcp,
        axf: flags.get("axf") ?? DEFAULT_VERSIONS.axf,
        lexsona: flags.get("lexsona") ?? DEFAULT_VERSIONS.lexsona,
      },
    });
  } else {
    const runRoot = required(flags.get("run-root"), "run_root_required");
    result =
      command === "inspect"
        ? await inspectDogfoodRun({
            allocationRoot,
            runRoot,
            diagnostics: flags.has("diagnostics"),
          })
        : command === "reap"
          ? await reapDogfoodRun({ allocationRoot, runRoot })
          : (() => {
              throw failure("unknown_command");
            })();
  }
  process.stdout.write(`${canonicalJSONStringify(result)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) throw failure("invalid_argument");
    const name = token.slice(2);
    if (["retain", "diagnostics"].includes(name)) {
      flags.set(name, "true");
      continue;
    }
    flags.set(name, required(argv[++index], `value_required_${name}`));
  }
  return flags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).catch((error) => {
    process.stdout.write(`${canonicalJSONStringify({ ok: false, errorCode: errorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
