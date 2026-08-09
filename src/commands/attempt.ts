import { createReadStream, promises as fs } from "node:fs";

import type { Command } from "commander";

import { throwExit } from "../cli/exitHandler.js";
import { writeJsonOutput } from "../cli/output.js";
import {
  createAgentWorkContainmentPreflightHandler,
  type AgentWorkContainmentPreflightHandler,
} from "../runs/agent-work-containment-preflight.js";
import {
  createNativeWslProjectionLifecycleHandlers,
  type NativeWslProjectionLifecycleHandlers,
} from "../runs/agent-work-projection-lifecycle.js";
import {
  createAttemptLifecycleHandlers,
  type AttemptPreparationHandler,
  type AttemptLifecycleHandlers,
} from "../runs/agent-work-adapters.js";
import {
  createAttemptWorkerHandlers,
  type AttemptWorkerHandlers,
} from "../runs/agent-work-worker-adapters.js";
import {
  createAttemptReceiptHandlers,
  type AttemptReceiptHandlers,
} from "../runs/agent-work-attempt-receipt-adapters.js";
import {
  createAttemptVerificationHandlers,
  type AttemptVerificationHandlers,
} from "../runs/agent-work-attempt-verification-adapters.js";
import {
  createGovernedDelegationHandlers,
  type GovernedDelegationHandlers,
} from "../runs/governed-delegation-adapters.js";
import {
  createGovernedAttemptOperationHandlers,
  type GovernedAttemptOperationHandlers,
} from "../runs/governed-attempt-operation-adapters.js";

const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;

export interface AttemptCommandDependencies {
  containmentHandler?: AgentWorkContainmentPreflightHandler;
  projectionHandlers?: NativeWslProjectionLifecycleHandlers;
  handlers?: AttemptLifecycleHandlers;
  preparationHandler?: AttemptPreparationHandler;
  workerHandlers?: AttemptWorkerHandlers;
  receiptHandlers?: AttemptReceiptHandlers;
  verificationHandlers?: AttemptVerificationHandlers;
  delegationHandlers?: GovernedDelegationHandlers;
  governedReviewHandlers?: GovernedAttemptOperationHandlers;
  jsonModeActive: () => boolean;
  maxInputBytes?: number;
  writeJson?: (value: unknown) => void;
}

/** Register the machine-facing ADR-010 Attempt lifecycle commands. */
export function registerAttemptCommand(
  program: Command,
  dependencies: AttemptCommandDependencies
): void {
  const defaults = createAttemptLifecycleHandlers();
  const containmentHandler =
    dependencies.containmentHandler ?? createAgentWorkContainmentPreflightHandler();
  const projectionHandlers =
    dependencies.projectionHandlers ?? createNativeWslProjectionLifecycleHandlers();
  const handlers = dependencies.handlers ?? defaults;
  const preparationHandler = dependencies.preparationHandler ?? defaults;
  const workerHandlers = dependencies.workerHandlers ?? createAttemptWorkerHandlers();
  const receiptHandlers = dependencies.receiptHandlers ?? createAttemptReceiptHandlers();
  const verificationHandlers =
    dependencies.verificationHandlers ?? createAttemptVerificationHandlers();
  const delegationHandlers = dependencies.delegationHandlers ?? createGovernedDelegationHandlers();
  const governedReviewHandlers =
    dependencies.governedReviewHandlers ?? createGovernedAttemptOperationHandlers();
  const attempt = program.command("attempt").description("Manage fenced agent-work Attempts");

  attempt
    .command("preflight")
    .description("Check physical-containment capability before constructing an Attempt packet")
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await containmentHandler.preflight(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
      if (
        output.ok &&
        output.result.state !== "native_ready" &&
        (process.exitCode === undefined || process.exitCode === 0)
      ) {
        process.exitCode = 1;
      }
    });

  const projection = attempt
    .command("projection")
    .description("Manage native WSL projection lifecycle state");
  registerProjectionInputCommand(
    projection,
    "prepare",
    "Prepare or exactly reuse a native WSL projection",
    (input) => projectionHandlers.prepare(input),
    dependencies
  );
  registerProjectionInputCommand(
    projection,
    "status",
    "Read bounded projection status without creating state",
    (input) => projectionHandlers.status(input),
    dependencies
  );
  registerProjectionInputCommand(
    projection,
    "cleanup",
    "Remove exact idle projection and quarantine state",
    (input) => projectionHandlers.cleanup(input),
    dependencies
  );
  registerProjectionInputCommand(
    projection,
    "quarantine",
    "Inspect privacy-bounded projection quarantine state",
    (input) => projectionHandlers.quarantine(input),
    dependencies
  );

  const worker = attempt.command("worker").description("Manage attached native worker sessions");
  registerWorkerInputCommand(
    worker,
    "attach",
    "Attach a native worker session",
    (input) => workerHandlers.attach(input),
    dependencies
  );
  registerWorkerInputCommand(
    worker,
    "heartbeat",
    "Record a worker heartbeat",
    (input) => workerHandlers.heartbeat(input),
    dependencies
  );
  registerWorkerInputCommand(
    worker,
    "end",
    "End an attached worker session",
    (input) => workerHandlers.end(input),
    dependencies
  );
  worker
    .command("status")
    .description("Read bounded status for an attached worker session")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--attempt-id <id>", "Attempt identifier")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        runId: string;
        attemptId: string;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await workerHandlers.status({
          databasePath: options.databasePath,
          runId: options.runId,
          attemptId: options.attemptId,
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );

  const receipt = attempt.command("receipt").description("Manage immutable worker receipt claims");
  registerReceiptInputCommand(
    receipt,
    "submit",
    "Persist one AgentTaskReceipt v2 claim",
    (input) => receiptHandlers.submit(input),
    dependencies
  );
  receipt
    .command("status")
    .description("Read bounded status for one persisted receipt claim")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--attempt-id <id>", "Attempt identifier")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        runId: string;
        attemptId: string;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await receiptHandlers.status({
          databasePath: options.databasePath,
          runId: options.runId,
          attemptId: options.attemptId,
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );

  const verification = attempt
    .command("verification")
    .description("Run engine-owned packet verification and inspect its evidence");
  registerReceiptInputCommand(
    verification,
    "run",
    "Run and persist immutable packet-declared verification",
    (input) => verificationHandlers.run(input),
    dependencies
  );
  verification
    .command("status")
    .description("Read compact verification status; diagnostics are opt-in")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--attempt-id <id>", "Attempt identifier")
    .option("--diagnostics", "Include bounded check evidence and trust-gap diagnostics")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        runId: string;
        attemptId: string;
        diagnostics?: boolean;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await verificationHandlers.status({
          databasePath: options.databasePath,
          runId: options.runId,
          attemptId: options.attemptId,
          ...(options.diagnostics ? { diagnostics: true } : {}),
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );

  const acceptance = attempt
    .command("acceptance")
    .description("Apply and inspect policy acceptance for verified evidence");
  registerReceiptInputCommand(
    acceptance,
    "apply",
    "Apply the built-in strict acceptance policy",
    (input) => verificationHandlers.applyAcceptance(input),
    dependencies
  );
  acceptance
    .command("status")
    .description("Read bounded policy-acceptance status")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--attempt-id <id>", "Attempt identifier")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        runId: string;
        attemptId: string;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await verificationHandlers.acceptanceStatus({
          databasePath: options.databasePath,
          runId: options.runId,
          attemptId: options.attemptId,
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );

  attempt
    .command("prepare")
    .description("Prepare a packet and authorized execution envelope for assisted launch")
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await preparationHandler.prepare(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });

  attempt
    .command("start")
    .description("Create, lease, and authorize an Attempt for launch")
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await handlers.start(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });

  attempt
    .command("status")
    .description("Read bounded status for one Attempt")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--run-id <id>", "Run identifier")
    .requiredOption("--attempt-id <id>", "Attempt identifier")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        runId: string;
        attemptId: string;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await handlers.status({
          databasePath: options.databasePath,
          runId: options.runId,
          attemptId: options.attemptId,
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );

  const delegation = attempt
    .command("delegation")
    .description("Exercise governed worker acceptance and refusal without launching an executor");
  delegation
    .command("synthetic")
    .description("Persist a synthetic ACCEPT or NO and prove the invocation latch")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--delegation-id <id>", "Opaque synthetic Delegation identifier")
    .requiredOption("--decision <ACCEPT|NO>", "Exact worker decision")
    .option("--attempt-id <id>", "Opaque synthetic Attempt identifier")
    .option("--reason <text>", "Optional volunteered refusal reason; never persisted as raw text")
    .option("--json", "Output canonical JSON")
    .action(
      async (options: {
        databasePath: string;
        delegationId: string;
        decision: string;
        attemptId?: string;
        reason?: string;
        json?: boolean;
      }) => {
        requireJsonMode(options.json, dependencies.jsonModeActive());
        const output = await delegationHandlers.synthetic({
          databasePath: options.databasePath,
          delegationId: options.delegationId,
          decision: options.decision,
          ...(options.attemptId ? { attemptId: options.attemptId } : {}),
          ...(options.reason ? { reason: options.reason } : {}),
        });
        (dependencies.writeJson ?? writeJsonOutput)(output);
        setFailureExitCode(output);
      }
    );
  delegation
    .command("status")
    .description("Read coordination-safe synthetic Delegation state and events")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--delegation-id <id>", "Delegation identifier")
    .option("--json", "Output canonical JSON")
    .action(async (options: { databasePath: string; delegationId: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const output = await delegationHandlers.status({
        databasePath: options.databasePath,
        delegationId: options.delegationId,
      });
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });

  const review = attempt
    .command("review")
    .description("Inspect durable governed-review operations without reading raw evidence");
  review
    .command("status")
    .description("Read coordination-safe asynchronous review status")
    .requiredOption("--database-path <path>", "Absolute path to the lifecycle SQLite database")
    .requiredOption("--operation-id <id>", "Governed review operation identifier")
    .option("--json", "Output canonical JSON")
    .action(async (options: { databasePath: string; operationId: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const output = await governedReviewHandlers.status({
        databasePath: options.databasePath,
        operationId: options.operationId,
      });
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });
}

function registerProjectionInputCommand(
  projection: Command,
  name: string,
  description: string,
  dispatch: (input: unknown) => Promise<unknown>,
  dependencies: AttemptCommandDependencies
): void {
  projection
    .command(name)
    .description(description)
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await dispatch(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
      setProjectionExitCode(output);
    });
}

function registerWorkerInputCommand(
  worker: Command,
  name: string,
  description: string,
  dispatch: (input: unknown) => Promise<unknown>,
  dependencies: AttemptCommandDependencies
): void {
  worker
    .command(name)
    .description(description)
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await dispatch(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });
}

function registerReceiptInputCommand(
  receipt: Command,
  name: string,
  description: string,
  dispatch: (input: unknown) => Promise<unknown>,
  dependencies: AttemptCommandDependencies
): void {
  receipt
    .command(name)
    .description(description)
    .requiredOption("--input <file|->", "JSON request file, or - for stdin")
    .option("--json", "Output canonical JSON")
    .action(async (options: { input: string; json?: boolean }) => {
      requireJsonMode(options.json, dependencies.jsonModeActive());
      const input = await readJsonInput(
        options.input,
        dependencies.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
      );
      const output = await dispatch(input);
      (dependencies.writeJson ?? writeJsonOutput)(output);
      setFailureExitCode(output);
    });
}

async function readJsonInput(inputPath: string, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxInputBytes must be a positive safe integer");
  }

  let content: string;
  try {
    content =
      inputPath === "-"
        ? await readBoundedStream(process.stdin, maxBytes)
        : await readBoundedFile(inputPath, maxBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwExit(2, `Failed to read Attempt input: ${message}`);
  }

  if (content.trim().length === 0) {
    throwExit(2, "Attempt input must not be empty");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throwExit(2, "Attempt input must be valid JSON");
  }
}

async function readBoundedFile(inputPath: string, maxBytes: number): Promise<string> {
  const stats = await fs.stat(inputPath);
  if (!stats.isFile()) throw new Error("input path is not a file");
  if (stats.size > maxBytes) throw new Error(`input exceeds ${maxBytes} bytes`);
  return readBoundedStream(createReadStream(inputPath), maxBytes);
}

async function readBoundedStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`input exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requireJsonMode(local: boolean | undefined, global: boolean): void {
  if (!local && !global) {
    throwExit(2, "Attempt lifecycle commands require --json");
  }
}

function setFailureExitCode(output: unknown): void {
  if (!isRecord(output)) return;
  if (output.ok === false) {
    process.exitCode = isRecord(output.error) && output.error.code === "invalid_input" ? 2 : 1;
    return;
  }
  if (output.ok === true && isRecord(output.result) && output.result.ok === false) {
    process.exitCode = 1;
    return;
  }
  if (output.ok === true && isRecord(output.result) && output.result.updated === false) {
    process.exitCode = 1;
  }
  if (output.ok === true && isRecord(output.result) && output.result.submitted === false) {
    process.exitCode = 1;
  }
  if (output.ok === true && isRecord(output.result) && output.result.recorded === false) {
    process.exitCode = 1;
  }
  if (output.ok === true && isRecord(output.result) && output.result.applied === false) {
    process.exitCode = 1;
  }
  if (output.ok === true && isRecord(output.result) && output.result.completed === false) {
    process.exitCode = 1;
  }
}

function setProjectionExitCode(output: unknown): void {
  if (
    !isRecord(output) ||
    output.ok !== true ||
    !isRecord(output.result) ||
    typeof output.result.operation !== "string"
  ) {
    return;
  }
  if (
    output.result.operation === "agent-work.projection.prepare" &&
    output.result.state !== "ready"
  ) {
    process.exitCode = 1;
  }
  if (
    output.result.operation === "agent-work.projection.status" &&
    output.result.state !== "ready"
  ) {
    process.exitCode = 1;
  }
  if (
    output.result.operation === "agent-work.projection.cleanup" &&
    (output.result.outcome === "refused" ||
      output.result.outcome === "quarantined" ||
      output.result.outcome === "failed")
  ) {
    process.exitCode = 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
