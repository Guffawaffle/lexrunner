import { ExecutionState } from "../executionState.js";
import { executeGatesWithPolicy } from "../gates.js";
import type { Plan } from "../schema.js";

const MAX_ITEMS = 256;
const MAX_GATES_PER_ITEM = 64;
const MAX_LABEL_BYTES = 512;
const MAX_ARTIFACT_REF_BYTES = 4096;

type GateExecutor = typeof executeGatesWithPolicy;

export interface GateExecutionServiceInput {
  plan: Plan;
  artifactDir: string;
  timeoutMs?: number;
  progressReporter?: Parameters<GateExecutor>[4];
  skipValidation?: boolean;
  repoRoot?: string;
  options?: Parameters<GateExecutor>[7];
  onlyItem?: string;
  onlyGate?: string;
  executionState?: ExecutionState;
}

export interface BoundedGateRunResult {
  contract: "bounded-ax-v1";
  items: Array<{
    name: string;
    status: string;
    gates: Array<{
      name: string;
      status: string;
      failureKind?: "nonzero_exit" | "spawn_error" | "timeout";
      timeoutCleanup?: {
        method: "process-group" | "taskkill" | "direct-child";
        forceKilled: boolean;
        descendantsReaped: boolean;
      };
    }>;
  }>;
  allGreen: boolean;
  artifactRefs: Array<{ kind: "gate-results-directory"; path: string }>;
}

export interface GateExecutionServiceResult {
  summary: BoundedGateRunResult;
  executionState: ExecutionState;
}

export class GateExecutionServiceError extends Error {
  constructor(
    readonly code:
      "GATE_EXECUTION_FAILED" | "GATE_RESULT_LIMIT_EXCEEDED" | "GATE_SELECTION_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "GateExecutionServiceError";
  }
}

/** One bounded transport-neutral owner for canonical CLI and MCP gate execution. */
export class GateExecutionService {
  constructor(private readonly execute: GateExecutor = executeGatesWithPolicy) {}

  async run(input: GateExecutionServiceInput): Promise<GateExecutionServiceResult> {
    assertSelectionExists(input);
    const executionState = input.executionState ?? new ExecutionState(input.plan);
    try {
      await this.execute(
        input.plan,
        executionState,
        bounded(input.artifactDir, MAX_ARTIFACT_REF_BYTES),
        input.timeoutMs,
        input.progressReporter,
        input.skipValidation,
        input.repoRoot,
        {
          ...input.options,
          onlyItem: input.onlyItem,
          onlyGate: input.onlyGate,
        }
      );
    } catch {
      throw new GateExecutionServiceError(
        "GATE_EXECUTION_FAILED",
        "Gate execution failed; inspect the gate artifact references for details"
      );
    }

    const items = [...executionState.getResults().entries()]
      .filter(([name]) => !input.onlyItem || name === input.onlyItem)
      .map(([name, result]) => ({
        name: bounded(name, MAX_LABEL_BYTES),
        status: bounded(result.status, MAX_LABEL_BYTES),
        gates: result.gates
          .filter((gate) => !input.onlyGate || gate.gate === input.onlyGate)
          .map((gate) => ({
            name: bounded(gate.gate, MAX_LABEL_BYTES),
            status: bounded(gate.status, MAX_LABEL_BYTES),
            ...(gate.failureKind ? { failureKind: gate.failureKind } : {}),
            ...(gate.timeoutCleanup ? { timeoutCleanup: gate.timeoutCleanup } : {}),
          })),
      }));
    if (items.length > MAX_ITEMS || items.some(({ gates }) => gates.length > MAX_GATES_PER_ITEM)) {
      throw new GateExecutionServiceError(
        "GATE_RESULT_LIMIT_EXCEEDED",
        `Gate result exceeds ${MAX_ITEMS} items or ${MAX_GATES_PER_ITEM} gates per item`
      );
    }
    return {
      executionState,
      summary: {
        contract: "bounded-ax-v1",
        items,
        allGreen: items.every(({ status }) => status === "pass"),
        artifactRefs: [
          {
            kind: "gate-results-directory",
            path: bounded(input.artifactDir, MAX_ARTIFACT_REF_BYTES),
          },
        ],
      },
    };
  }
}

function assertSelectionExists(input: GateExecutionServiceInput): void {
  const selectedItems = input.onlyItem
    ? input.plan.items.filter(({ name }) => name === input.onlyItem)
    : input.plan.items;
  if (input.onlyItem && selectedItems.length === 0) {
    throw new GateExecutionServiceError(
      "GATE_SELECTION_NOT_FOUND",
      "The selected plan item does not exist"
    );
  }
  if (
    input.onlyGate &&
    !selectedItems.some(({ gates }) => gates.some(({ name }) => name === input.onlyGate))
  ) {
    throw new GateExecutionServiceError(
      "GATE_SELECTION_NOT_FOUND",
      "The selected gate does not exist on the selected plan items"
    );
  }
}

function bounded(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new GateExecutionServiceError(
      "GATE_RESULT_LIMIT_EXCEEDED",
      "Gate result contains an overlong label or artifact reference"
    );
  }
  return value;
}
