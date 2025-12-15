# Executor Authoring Guide

This guide explains how to create new executors for lexrunner, from initial prototype to canonical implementation.

> **Audience:** Developers creating new executors. Level: intermediate.
>
> **Prerequisites:** Familiarity with TypeScript, YAML, and the lexrunner architecture.

## Overview

An **executor** is a small, named, versioned unit that:
- Implements a narrow role (e.g., code review, triage, pattern mining)
- Fixes its **tool budget** (which tools it may call, under what limits)
- Binds to a particular **guardrail profile** (scope, tool, epistemic, style, audit)
- Follows the **Jordan-mode protocol** (prep → stochastic → receipt)

Executors are the operational units that perform specific tasks within the lexrunner ecosystem.

## Quick Start

### 1. Create a Prototype in `project/`

Start by creating a prototype in the `project/` directory (untracked R&D playground):

```bash
mkdir -p project/my-executor
```

### 2. Create the Manifest

Create `project/my-executor/executor-manifest.yaml`:

```yaml
schemaVersion: "executor-1.0.0"
role: "my-executor-role"
description: "Brief description of what this executor does"

toolBudget:
  allowed:
    - grep_search
    - read_file
  denied:
    - run_in_terminal
  limits:
    maxToolCalls: 20
    maxTokensOut: 2000

jordanModeProtocol:
  prepPhase:
    - load-context
    - validate-scope
  stochasticPhase:
    promptTemplate: "prompts/my-executor.prompt.md"
    maxCalls: 1
  receiptPhase:
    frameType: "my-executor-frame"
    fields:
      - decision
      - rationale
```

### 3. Implement the TypeScript Core

Create the executor implementation in `src/executors/myExecutor/`:

```typescript
// src/executors/myExecutor/index.ts
export type { MyExecutorInput, MyExecutorResult } from "./types.js";
export { executeMyTask } from "./core.js";
```

### 4. Add Tests

Create tests in `tests/executors/myExecutor.spec.ts`.

### 5. Graduate to Canon

Once validated, move from `project/` → `executors/` following the [promotion criteria](#promotion-criteria-graduating-to-canon).

---

## Manifest Reference

The executor manifest (`executor-manifest.yaml`) defines the contract for an executor.

### Schema Version

```yaml
schemaVersion: "executor-1.0.0"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | string | ✅ | Format: `executor-X.Y.Z` (semver) |

### Role & Description

```yaml
role: "senior-dev-review"
description: "Code review with mentorship feedback"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | string | ✅ | Unique identifier for the executor role |
| `description` | string | ❌ | Human-readable description |

### Tool Budget

Specifies which tools the executor can use and under what constraints.

```yaml
toolBudget:
  allowed:
    - grep_search
    - read_file
    - list_dir
    - get_errors
  denied:
    - run_in_terminal
    - create_file
    - replace_string_in_file
  limits:
    maxToolCalls: 20
    maxTokensOut: 2000
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolBudget.allowed` | string[] | ❌ | Tools the executor may call (default: []) |
| `toolBudget.denied` | string[] | ❌ | Tools explicitly forbidden (default: []) |
| `toolBudget.limits.maxToolCalls` | integer | ❌ | Maximum number of tool calls (min: 1) |
| `toolBudget.limits.maxTokensOut` | integer | ❌ | Maximum output tokens (min: 1) |

**Tool Budget Philosophy:**
- Be explicit about what's allowed; deny-list catches edge cases
- Read-only executors should deny all write tools
- Set reasonable limits to prevent runaway execution

### Guardrails

Optional guardrail bindings that constrain executor behavior.

```yaml
guardrails:
  scope:
    allowedPaths:
      - "src/**"
      - "tests/**"
    deniedPaths:
      - "*.env"
      - "secrets/**"

  tool:
    required:
      - get_errors
    optional:
      - grep_search

  epistemic:
    allowIDK: true
    escalationThreshold: "high-risk"

  style:
    requirePlan: true
    requireSummary: true

  audit:
    level: "normal"
    frameSchema: "frame-v2"
```

#### Scope Guardrail (`guardrails.scope`)

Controls which file paths the executor can access.

| Field | Type | Description |
|-------|------|-------------|
| `allowedPaths` | string[] | Glob patterns for allowed paths |
| `deniedPaths` | string[] | Glob patterns for denied paths |

#### Tool Guardrail (`guardrails.tool`)

Specifies tool dependencies.

| Field | Type | Description |
|-------|------|-------------|
| `required` | string[] | Tools that must be available |
| `optional` | string[] | Tools that may be used if available |

#### Epistemic Guardrail (`guardrails.epistemic`)

Controls uncertainty handling and escalation.

| Field | Type | Description |
|-------|------|-------------|
| `allowIDK` | boolean | Whether the executor may respond "I don't know" (default: true) |
| `escalationThreshold` | enum | When to escalate: `low-risk`, `medium-risk`, `high-risk`, `critical` |

#### Style Guardrail (`guardrails.style`)

Controls output formatting requirements.

| Field | Type | Description |
|-------|------|-------------|
| `requirePlan` | boolean | Must output a plan before execution (default: false) |
| `requireSummary` | boolean | Must include summary in output (default: false) |

#### Audit Guardrail (`guardrails.audit`)

Controls logging and frame emission.

| Field | Type | Description |
|-------|------|-------------|
| `level` | enum | Audit level: `minimal`, `normal`, `verbose`, `debug` (default: normal) |
| `frameSchema` | string | Schema version for emitted frames |

### Jordan-Mode Protocol

The execution protocol that all executors must follow.

```yaml
jordanModeProtocol:
  prepPhase:
    - load-context
    - validate-scope

  stochasticPhase:
    promptTemplate: "prompts/code-review.prompt.md"
    maxCalls: 1

  receiptPhase:
    frameType: "review-frame"
    fields:
      - decision
      - rationale
      - suggestions
```

#### Prep Phase

Deterministic preparation steps that run before the model call.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prepPhase` | string[] | ❌ | List of preparation steps (default: []) |

Common prep phase steps:
- `load-context` - Load execution context from environment
- `validate-scope` - Verify paths are within allowed scope
- `recall-frames` - Query Lex memory for relevant frames

#### Stochastic Phase

The irreducibly stochastic model call.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stochasticPhase.promptTemplate` | string | ✅ | Path to prompt template file |
| `stochasticPhase.maxCalls` | integer | ❌ | Maximum model calls (default: 1, min: 1) |

**Important:** The stochastic phase should contain exactly one model call. Multiple calls indicate the executor should be split.

#### Receipt Phase

What the executor must emit as output (the "receipt").

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `receiptPhase.frameType` | string | ✅ | Type identifier for emitted frame |
| `receiptPhase.fields` | string[] | ✅ | Required fields in the frame (min: 1) |

---

## TypeScript Implementation

### Directory Structure

```
src/executors/
└── myExecutor/
    ├── index.ts      # Module exports
    ├── types.ts      # Type definitions
    └── core.ts       # Core implementation
```

### Types File (`types.ts`)

Define input/output types for your executor:

```typescript
/**
 * My Executor Types
 */

// Input types
export interface MyExecutorInput {
  target: string;
  options?: {
    verbose?: boolean;
    limit?: number;
  };
}

// Output types
export interface MyExecutorResult {
  executor: "my-executor";
  phase: "prep" | "stochastic" | "receipt";
  timestamp: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### Core File (`core.ts`)

Implement the executor logic following Jordan-mode phases:

```typescript
/**
 * My Executor — Core Implementation
 */

import type { MyExecutorInput, MyExecutorResult } from "./types.js";

function getTimestamp(): string {
  return new Date().toISOString();
}

// Placeholder: Implement these functions based on your executor's needs
async function gatherContext(target: string): Promise<unknown> {
  // Your context-gathering logic here
  return { target };
}

function parseModelResponse(response: string): unknown {
  // Your response parsing logic here
  return JSON.parse(response);
}

async function emitFrame(data: unknown): Promise<string> {
  // Your frame emission logic here (e.g., call Lex memory API)
  return `frame-${Date.now()}`;
}

/**
 * Phase 1: Deterministic preparation
 */
export async function prepareContext(
  input: MyExecutorInput
): Promise<MyExecutorResult> {
  // Validate inputs
  if (!input.target) {
    throw new Error("Target is required");
  }

  // Gather context deterministically
  const context = await gatherContext(input.target);

  return {
    executor: "my-executor",
    phase: "prep",
    timestamp: getTimestamp(),
    success: true,
    data: context,
  };
}

/**
 * Phase 2: Stochastic model call (wrapper)
 *
 * Note: The actual model call happens externally.
 * This function prepares the prompt and validates the response.
 */
export async function executeStochasticPhase(
  prepResult: MyExecutorResult,
  modelResponse: string
): Promise<MyExecutorResult> {
  // Validate and parse model response
  const parsed = parseModelResponse(modelResponse);

  return {
    executor: "my-executor",
    phase: "stochastic",
    timestamp: getTimestamp(),
    success: true,
    data: parsed,
  };
}

/**
 * Phase 3: Emit receipt frame
 */
export async function captureFrame(
  stochasticResult: MyExecutorResult
): Promise<MyExecutorResult> {
  // Emit frame to Lex memory
  const frameId = await emitFrame(stochasticResult.data);

  return {
    executor: "my-executor",
    phase: "receipt",
    timestamp: getTimestamp(),
    success: true,
    data: { frameId },
  };
}
```

### Index File (`index.ts`)

Export public API:

```typescript
/**
 * My Executor — Module Index
 */

// Types
export type { MyExecutorInput, MyExecutorResult } from "./types.js";

// Core functions
export {
  prepareContext,
  executeStochasticPhase,
  captureFrame,
} from "./core.js";
```

---

## Prompt Authoring

Prompts are Markdown files that define the model's behavior during the stochastic phase.

### Location

Store prompts in the executor's `prompts/` directory:

```
executors/
└── myExecutor/
    └── prompts/
        └── main.prompt.md
```

### Template Structure

```markdown
# My Executor Prompt

## Context

You are acting as a {role}. You have been given:

- **Target:** {{target}}
- **Options:** {{options}}

## Prior Frames

{{recalled_frames}}

## Instructions

1. Analyze the provided context
2. Apply your expertise
3. Produce structured output

## Output Format

Respond with a JSON object:

\`\`\`json
{
  "decision": "approve | reject | request-changes",
  "rationale": "Explain your reasoning",
  "suggestions": ["List", "of", "suggestions"]
}
\`\`\`

## Constraints

- Stay within scope
- Be concise
- Cite evidence from the context
```

### Variables

Prompts support template variables:

| Variable | Description |
|----------|-------------|
| `{{target}}` | The primary target of the operation |
| `{{options}}` | Parsed options object |
| `{{recalled_frames}}` | Frames recalled from Lex memory |
| `{{context}}` | Full context object from prep phase |

---

## Testing Executors

### Unit Tests

Test each phase independently:

```typescript
// tests/executors/myExecutor.spec.ts
import { describe, it, expect } from "vitest";
import {
  prepareContext,
  executeStochasticPhase,
  captureFrame,
} from "../../src/executors/myExecutor/index.js";

describe("My Executor", () => {
  describe("prepareContext", () => {
    it("should validate input", async () => {
      await expect(prepareContext({ target: "" })).rejects.toThrow();
    });

    it("should gather context", async () => {
      const result = await prepareContext({ target: "src/" });
      expect(result.success).toBe(true);
      expect(result.phase).toBe("prep");
    });
  });

  describe("executeStochasticPhase", () => {
    it("should parse valid model response", async () => {
      const prepResult = { /* mock */ };
      const modelResponse = '{"decision": "approve"}';
      
      const result = await executeStochasticPhase(prepResult, modelResponse);
      expect(result.success).toBe(true);
    });
  });

  describe("captureFrame", () => {
    it("should emit frame", async () => {
      const stochasticResult = { /* mock */ };
      const result = await captureFrame(stochasticResult);
      expect(result.data.frameId).toBeDefined();
    });
  });
});
```

### Integration Tests

Test the full lifecycle:

```typescript
// tests/executors/myExecutor.integration.spec.ts
import { describe, it, expect } from "vitest";

describe("My Executor Integration", () => {
  it("should complete full lifecycle", async () => {
    // 1. Prep
    const prepResult = await prepareContext({ target: "src/" });
    expect(prepResult.success).toBe(true);

    // 2. Stochastic (mock model)
    const mockResponse = '{"decision": "approve"}';
    const stochasticResult = await executeStochasticPhase(
      prepResult,
      mockResponse
    );
    expect(stochasticResult.success).toBe(true);

    // 3. Receipt
    const receiptResult = await captureFrame(stochasticResult);
    expect(receiptResult.success).toBe(true);
  });
});
```

---

## Promotion Criteria: Graduating to Canon

An executor graduates from `project/` → `executors/` when it meets all of the following criteria:

### Required Artifacts

- [ ] **Manifest** (`executor-manifest.yaml`)
  - Passes schema validation
  - All required fields present
  - Tool budget is explicit and minimal

- [ ] **Documentation** (`ARCHITECTURE.md` or `README.md`)
  - Purpose and use cases
  - Input/output contracts
  - Modes and configuration

- [ ] **TypeScript Core** (`src/executors/<name>/`)
  - `index.ts` with exports
  - `types.ts` with type definitions
  - `core.ts` with implementation

- [ ] **At Least One Example**
  - Happy-path example in `examples/`
  - Demonstrates primary use case

### Quality Checks

- [ ] **Tests Pass**
  - Unit tests for each phase
  - Integration test for lifecycle
  - All tests green in CI

- [ ] **Manifest Validates**
  - `npm run validate-manifests` passes
  - No schema warnings

- [ ] **Jordan-Mode Compliance**
  - Clear prep phase (deterministic)
  - Single stochastic phase
  - Receipt phase emits frame

### IP Separation

Executor documentation should cover:
- ✅ Inputs/outputs
- ✅ Modes and configuration
- ✅ Jordan-mode discipline
- ✅ Frame emission

Executor documentation should NOT cover:
- ❌ Merge plans (LexRunner concern)
- ❌ Gate orchestration (LexRunner concern)
- ❌ Fan-out strategies (LexRunner concern)

---

## Worked Example: Senior Dev Executor

The Senior Dev executor is the canonical example. Here's how it was built:

### 1. Manifest

```yaml
# executors/senior-dev/executor-manifest.yaml
schemaVersion: "executor-1.0.0"
role: "senior-dev-review"
description: "Code review with mentorship feedback"

toolBudget:
  allowed:
    - grep_search
    - read_file
    - list_dir
    - get_errors
  denied:
    - run_in_terminal
    - create_file
    - replace_string_in_file
  limits:
    maxToolCalls: 20
    maxTokensOut: 2000

guardrails:
  scope:
    allowedPaths:
      - "src/**"
      - "tests/**"
    deniedPaths:
      - "*.env"
      - "secrets/**"
  tool:
    required:
      - get_errors
    optional:
      - grep_search
  epistemic:
    allowIDK: true
    escalationThreshold: "high-risk"
  style:
    requirePlan: true
    requireSummary: true
  audit:
    level: "normal"
    frameSchema: "frame-v2"

jordanModeProtocol:
  prepPhase:
    - load-context
    - validate-scope
  stochasticPhase:
    promptTemplate: "prompts/code-review.prompt.md"
    maxCalls: 1
  receiptPhase:
    frameType: "review-frame"
    fields:
      - decision
      - rationale
      - suggestions
```

### 2. TypeScript Implementation

The Senior Dev executor implements three main functions:

```typescript
// src/executors/seniorDev/core.ts

/**
 * prepareReviewContext - Phase 1: Deterministic artifact gathering
 * - Runs lint, typecheck, tests
 * - Captures diff and PR metadata
 * - Recalls related frames from Lex
 */
export async function prepareReviewContext(
  input: PrepareContextInput
): Promise<PrepareContextResult>;

/**
 * recallSeniorDevContext - Phase 1: Memory recall
 * - Queries Lex for prior reviews
 * - Finds relevant patterns
 * - Suggests appropriate prompt
 */
export async function recallSeniorDevContext(
  input: RecallContextInput
): Promise<RecallContextResult>;

/**
 * captureSeniorDevFrame - Phase 3: Frame capture
 * - Writes review receipt to Lex
 * - Includes severity, blockers, next action
 */
export async function captureSeniorDevFrame(
  input: CaptureFrameInput
): Promise<CaptureFrameResult>;
```

### 3. Types

```typescript
// src/executors/seniorDev/types.ts

export interface PrepareContextInput {
  pr_number: string;
  base_branch?: string;
  output_dir?: string;
  skip_tests?: boolean;
  skip_lint?: boolean;
  skip_typecheck?: boolean;
}

export interface PrepareContextResult {
  executor: "senior-dev";
  phase: "deterministic-prep";
  pr_number: string;
  base_branch: string;
  timestamp: string;
  output_dir: string;
  artifacts: ArtifactPaths;
  commands_run: CommandResult[];
  modules_detected: string[];
}
```

### 4. Modes

The Senior Dev executor supports multiple modes:

| Mode | Purpose | Prompt |
|------|---------|--------|
| `triage` | Quick PR assessment | `pr-analysis.prompt.md` |
| `deep_review` | Detailed code analysis | `code-review.prompt.md` |
| `pattern_mining` | Identify recurring issues | `pattern-recognition.prompt.md` |
| `mentorship` | Developer growth feedback | `mentorship-feedback.prompt.md` |

---

## Checklist for New Executors

Use this checklist when creating a new executor:

### Prototype Phase (`project/`)

- [ ] Created `project/<name>/` directory
- [ ] Created `executor-manifest.yaml`
- [ ] Defined role and description
- [ ] Specified tool budget (allowed/denied/limits)
- [ ] Defined Jordan-mode protocol

### Implementation Phase (`src/executors/`)

- [ ] Created `src/executors/<name>/` directory
- [ ] Implemented `types.ts` with I/O types
- [ ] Implemented `core.ts` with phase functions
- [ ] Created `index.ts` with exports
- [ ] Added JSDoc comments

### Testing Phase

- [ ] Created `tests/executors/<name>.spec.ts`
- [ ] Unit tests for each phase
- [ ] Integration test for lifecycle
- [ ] All tests pass

### Documentation Phase

- [ ] Created `README.md` or `ARCHITECTURE.md`
- [ ] Documented inputs and outputs
- [ ] Documented modes (if applicable)
- [ ] Created at least one example

### Promotion Phase

- [ ] All [promotion criteria](#promotion-criteria-graduating-to-canon) met
- [ ] Files moved to `executors/<name>/`
- [ ] CI validation passes
- [ ] CLI/MCP integration working

---

## Related Documentation

- [Executor Manifest Schema](../schemas/executor-manifest.schema.json) - JSON Schema
- [Architecture Overview](./architecture.md) - System architecture
- [Command Creation Guide](./command-creation-guide.md) - CLI commands
- [TERMS.md](./TERMS.md) - Canonical terminology

---

## FAQ

### When should I create a new executor vs. adding a mode?

Create a new executor when:
- The role is fundamentally different
- The tool budget differs significantly
- The guardrail profile is unique

Add a mode when:
- The role is the same, just different focus
- Tool budget remains similar
- Guardrails don't change

### Can an executor call another executor?

Not directly. Executors are independent units. If you need composition, use the orchestration layer (LexRunner) to chain executors.

### How do I handle errors in an executor?

- In prep phase: throw immediately (deterministic failure)
- In stochastic phase: return structured error in result
- In receipt phase: emit error frame with details

### What if my executor needs more than one model call?

Split it into multiple executors. The Jordan-mode protocol enforces single stochastic call per executor for auditability.
