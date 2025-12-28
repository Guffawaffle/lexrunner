# Executor Frame Contract

**Status:** Implemented (LPR-044)  
**Schema Version:** 1.0.0  
**Related:** Lex#88 Frame schema v2, EXE-001 Executor Manifest Schema

---

## Overview

The **Frame Contract** enforces that every executor invocation MUST emit at least one Frame. This requirement ensures:

1. **Auditability** — Every execution produces a verifiable receipt
2. **Traceability** — Inputs, outputs, and tool calls are hashed and recorded
3. **Memory Integration** — Frames feed into the Lex memory system for context accumulation
4. **Accountability** — Executors cannot complete without documenting what they did

**Core Principle:** _Frames are receipts, not logs. They prove what happened._

---

## Quick Start

### Enforce Frame Emission

```typescript
import { enforceFrameEmission } from "./src/executors/frameContract.js";

const context = {
  executorRole: "senior-dev",
  runId: "01JFZG7X2T3K4M5N6P7Q8R9S0W",
  inputs: { prNumber: "123", module: "src/cli.ts" },
  toolCalls: [],
  startTime: new Date().toISOString(),
};

const output = await myExecutor(context.inputs);

// Will throw FrameContractViolationError if output.frame is missing
const validatedFrame = enforceFrameEmission(context, output);
```

### Wrap Executor with Contract

```typescript
import { withFrameContract } from "./src/executors/frameContract.js";

const wrappedExecutor = withFrameContract(myExecutorImplementation, {
  executorRole: "senior-dev",
  runId: "run-001",
});

// Frame emission is automatically enforced
const result = await wrappedExecutor({ prNumber: "123" });
console.log(result.validatedFrame); // Guaranteed to exist
```

### Build Frame from Template

```typescript
import { buildFrameFromTemplate } from "./src/executors/frameContract.js";

const frame = buildFrameFromTemplate({
  role: "senior-dev",
  runId: "run-001",
  summary: "Code review completed for PR-123",
  moduleScope: ["src/cli.ts", "src/schema.ts"],
  outcome: "success",
  nextActions: ["Address review findings", "Merge after CI"],
  inputsHash: "abc123...",
  outputsHash: "def456...",
  toolCalls: [{ tool: "grep_search", timestamp: "2025-12-16T10:00:00Z", success: true }],
  durationMs: 120000,
});
```

---

## Frame Contract Requirements

### 1. **Every Executor MUST Emit a Frame**

```typescript
interface ExecutorOutput {
  outputs: Record<string, unknown>;
  endTime: string;
  frame: ExecutionFrame; // REQUIRED
}
```

If an executor completes without emitting a Frame, `FrameContractViolationError` is thrown.

### 2. **Frames MUST Include Executor Metadata**

All executor Frames include:

| Field              | Type       | Description                                    |
| ------------------ | ---------- | ---------------------------------------------- |
| `executor_role`    | string     | Executor name (e.g., "senior-dev", "eager-pm") |
| `inputs_hash`      | string     | SHA-256 hash of input parameters               |
| `outputs_hash`     | string     | SHA-256 hash of output results                 |
| `tool_calls`       | ToolCall[] | List of tools called during execution          |
| `tool_calls_count` | number     | Number of tools invoked                        |
| `duration_ms`      | number     | Execution duration in milliseconds             |
| `run_id`           | string     | Run ID for correlation                         |

**Why Hashes?** Input and output hashes enable:

- **Idempotency checks** — Detect duplicate executions
- **Determinism validation** — Same inputs → same outputs
- **Tamper detection** — Verify frame integrity

### 3. **Tool Calls MUST Be Recorded**

Each tool call includes:

```typescript
interface ToolCall {
  tool: string; // Tool name
  timestamp: string; // ISO 8601 timestamp
  durationMs?: number; // Execution time
  success: boolean; // Whether the call succeeded
  error?: string; // Error message if failed
}
```

**Example:**

```typescript
{
  tool: "grep_search",
  timestamp: "2025-12-16T10:01:23.456Z",
  durationMs: 150,
  success: true
}
```

---

## API Reference

### `enforceFrameEmission(context, output)`

Validates that executor output includes a Frame.

**Signature:**

```typescript
function enforceFrameEmission(
  context: ExecutorInvocationContext,
  output: ExecutorOutput
): ExecutionFrame;
```

**Throws:**

- `FrameContractViolationError` if `output.frame` is missing

**Example:**

```typescript
try {
  const frame = enforceFrameEmission(context, output);
  console.log("Frame validated:", frame.reference_point);
} catch (error) {
  if (error instanceof FrameContractViolationError) {
    console.error(`Executor ${error.executorRole} violated contract`);
  }
}
```

---

### `withFrameContract(executor, baseContext)`

Higher-order function that wraps an executor to enforce Frame emission.

**Signature:**

```typescript
function withFrameContract<TInput, TOutput>(
  executor: (inputs: TInput, context: ExecutorInvocationContext) => Promise<TOutput>,
  baseContext: { executorRole: string; runId: string }
): (inputs: TInput) => Promise<TOutput & { validatedFrame: ExecutionFrame }>;
```

**Example:**

```typescript
const safeExecutor = withFrameContract(myExecutor, {
  executorRole: "senior-dev",
  runId: "run-001",
});

const result = await safeExecutor({ prNumber: "123" });
// result.validatedFrame is guaranteed to exist
```

---

### `createFrameMetadata(context, output)`

Generates Frame metadata from executor invocation.

**Signature:**

```typescript
function createFrameMetadata(
  context: ExecutorInvocationContext,
  output: ExecutorOutput
): {
  executorRole: string;
  inputsHash: string;
  outputsHash: string;
  toolCalls: ToolCall[];
  durationMs: number;
};
```

**Example:**

```typescript
const metadata = createFrameMetadata(context, output);
console.log(`Inputs hash: ${metadata.inputsHash}`);
console.log(`Duration: ${metadata.durationMs}ms`);
```

---

### `buildFrameFromTemplate(template)`

Builds a complete ExecutionFrame from an executor template.

**Signature:**

```typescript
function buildFrameFromTemplate(template: ExecutorFrameTemplate): ExecutionFrame;
```

**Template Fields:**

```typescript
interface ExecutorFrameTemplate {
  role: string;
  runId: string;
  summary: string;
  moduleScope: string[];
  outcome: "success" | "failure" | "partial";
  nextActions: string[];
  inputsHash: string;
  outputsHash: string;
  toolCalls: ToolCall[];
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

**Example:**

```typescript
const frame = buildFrameFromTemplate({
  role: "eager-pm",
  runId: "run-002",
  summary: "Selected 5 issues for batch processing",
  moduleScope: ["issues"],
  outcome: "success",
  nextActions: ["Create batch plan", "Assign to agents"],
  inputsHash: hashInputs(inputs),
  outputsHash: hashOutputs(outputs),
  toolCalls: recordedToolCalls,
  durationMs: 30000,
});
```

---

### `validateFrameMetadata(frame, expectedMetadata)`

Validates that a Frame includes required executor metadata.

**Signature:**

```typescript
function validateFrameMetadata(
  frame: ExecutionFrame,
  expectedMetadata: {
    executorRole: string;
    inputsHash: string;
    outputsHash: string;
    toolCalls: ToolCall[];
  }
): boolean;
```

**Returns:** `true` if Frame has metadata, `false` otherwise.

---

## Error Handling

### `FrameContractViolationError`

Thrown when an executor does not emit a Frame.

**Properties:**

```typescript
class FrameContractViolationError extends Error {
  executorRole: string; // Executor that violated the contract
  runId: string; // Run ID for correlation
  message: string; // Error description
}
```

**Example:**

```typescript
catch (error) {
  if (error instanceof FrameContractViolationError) {
    console.error(`Contract violation:`);
    console.error(`  Executor: ${error.executorRole}`);
    console.error(`  Run ID: ${error.runId}`);
    console.error(`  Message: ${error.message}`);
  }
}
```

---

## Integration with Lex

Frames emitted by executors integrate with the Lex memory system:

1. **Storage** — Frames are stored in `.lex/memory.db` (via Lex CLI delegation)
2. **Recall** — Prior executions can be queried by role, module, or pattern
3. **Learning** — Patterns emerge from accumulated Frame history

**Example Frame Query:**

```bash
lex recall "executor:senior-dev reviews for src/cli.ts"
```

**Memory Tools:** For details on the relationship between Lex memory tools and LexRunner executor tools, see [MEMORY_TOOLS.md](../../docs/MEMORY_TOOLS.md).

---

## Best Practices

### 1. **Always Emit a Frame**

Even if an executor fails, it MUST emit a Frame documenting the failure:

```typescript
const frame = buildFrameFromTemplate({
  role: "my-executor",
  runId: context.runId,
  summary: "Execution failed: input validation error",
  moduleScope: [],
  outcome: "failure",
  nextActions: ["Fix input parameters", "Retry execution"],
  inputsHash: hashInputs(inputs),
  outputsHash: hashOutputs({ error: "validation failed" }),
  toolCalls: context.toolCalls,
  durationMs: 500,
  error: "Invalid input: missing required field 'prNumber'",
});
```

### 2. **Record All Tool Calls**

Track every tool invocation in `context.toolCalls`:

```typescript
async function myExecutor(inputs, context) {
  const startTime = Date.now();
  const result = await callTool("grep_search", { pattern: "TODO" });

  context.toolCalls.push({
    tool: "grep_search",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    success: result.success,
    error: result.error,
  });

  // ... rest of executor logic
}
```

### 3. **Use Descriptive Summaries**

Frame summaries should be human-readable and actionable:

✅ **Good:** "Code review completed for PR-123: 3 findings (1 blocker, 2 suggestions)"  
❌ **Bad:** "Executor finished"

### 4. **Specify Next Actions**

Always include concrete next steps:

✅ **Good:** `["Address blocking issue in src/cli.ts", "Re-run linter", "Request re-review"]`  
❌ **Bad:** `["Done"]`

---

## Testing

See `tests/executors/frameContract.spec.ts` for comprehensive test coverage:

```bash
npm test -- frameContract
```

**Test Coverage:**

- ✅ Frame emission enforcement
- ✅ Input/output hashing
- ✅ Tool call recording
- ✅ Error handling
- ✅ Template-based Frame building
- ✅ Metadata validation

---

## Related Documentation

- [Executor Authoring Guide](../../docs/executor-authoring.md)
- [Frame Types](../frames/types.ts)
- [Frame Emitter](../frames/emitter.ts)
- [Memory Integration](../../executors/senior-dev/MEMORY_INTEGRATION.md)

---

## Changelog

### v1.0.0 (2025-12-16)

- ✅ Initial implementation of Frame contract enforcement
- ✅ `enforceFrameEmission` validation function
- ✅ `withFrameContract` HOF wrapper
- ✅ `buildFrameFromTemplate` helper
- ✅ Input/output hashing for Frame metadata
- ✅ Tool call recording support
- ✅ Comprehensive test coverage
