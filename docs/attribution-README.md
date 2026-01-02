# Constraint Attribution - LR-TSF-001

## Overview

The constraint attribution feature allows you to trace back from execution actions to the constraints/rules that drove those decisions. This provides transparency into "why did the system do X?"

## Core Components

### 1. Attribution Tracker (`src/runs/attribution.ts`)

Tracks constraint applications during execution.

```typescript
import { createAttributionTracker } from "./runs/attribution.js";

const tracker = createAttributionTracker();

// Log when a constraint influences a decision
tracker.logAttribution(
  "merge-gates-required", // constraint ID
  "All PRs must pass lint gate", // human-readable statement
  "baseline", // source: baseline | persona | learned
  "ran lint gate on PR-123", // action taken
  "PR-123" // optional target
);
```

### 2. Execution Context (`src/runs/context.ts`)

Provides attribution tracking within execution flows.

```typescript
import { createExecutionContext, logAttribution } from "./runs/context.js";

const context = createExecutionContext(runId);

// Log attribution during execution
logAttribution(
  context,
  "no-force-push",
  "Never use force push",
  "persona",
  "used merge instead of rebase",
  "PR-124"
);
```

### 3. Frame Emission (`src/frames/emitter.ts`)

Frames now include `governed_by` metadata showing which constraints governed the execution.

```typescript
import { emitMergeWeaveFrame } from "./frames/emitter.js";

const result = await emitMergeWeaveFrame({
  runId: "01JFZG...",
  mergedPRs: ["#123", "#124"],
  conflictsResolved: 2,
  gatesPassed: ["lint", "typecheck"],
  durationMs: 45000,
  outcome: "success",
  targetBranch: "main",
  governedBy: [
    { constraintId: "merge-gates-required", source: "baseline", action: "ran lint gate" },
    { constraintId: "no-force-push", source: "persona", action: "used merge" },
  ],
});
```

### 4. Explain Command (`src/commands/explain.ts`)

Query attributions to understand why actions were taken.

```bash
# Search for all attributions mentioning "lint"
lexrunner explain "lint gate"

# Limit to a specific run
lexrunner explain "skip gate" --run-id 01JFZG...

# JSON output
lexrunner explain "merge" --json
```

## Integration Example

Here's how to integrate attribution tracking in a merge-weave workflow:

```typescript
import { ulid } from "ulid";
import { createExecutionContext, logAttribution } from "./runs/index.js";
import { writeAttributions, ensureRunDir } from "./runs/storage.js";
import { emitMergeWeaveFrame } from "./frames/emitter.js";

async function executeMergeWeave(plan: Plan) {
  // Create execution context
  const runId = ulid();
  const context = createExecutionContext(runId);

  // Execute merge-weave with attribution tracking
  const startTime = Date.now();
  const mergedPRs: string[] = [];
  const gatesPassed: string[] = [];

  // Example: Running gates
  for (const gate of plan.policy.requiredGates) {
    // Log the constraint that requires this gate
    logAttribution(
      context,
      "merge-gates-required",
      "All PRs must pass all required gates before merging",
      "baseline",
      `ran ${gate} gate on ${plan.items[0]}`,
      plan.items[0]
    );

    // Execute gate...
    gatesPassed.push(gate);
  }

  // Example: Merge operation
  for (const item of plan.items) {
    // Log the constraint that prevents force push
    logAttribution(
      context,
      "no-force-push",
      "Never use force push to maintain history integrity",
      "persona",
      `used merge instead of rebase for ${item}`,
      item
    );

    // Perform merge...
    mergedPRs.push(item);
  }

  const durationMs = Date.now() - startTime;

  // Save attributions to run artifacts
  ensureRunDir(runId);
  const logEntries = context.attributionTracker.getLogEntries();
  writeAttributions(runId, logEntries);

  // Emit frame with attribution metadata
  const frameResult = await emitMergeWeaveFrame({
    runId,
    mergedPRs,
    conflictsResolved: 0,
    gatesPassed,
    durationMs,
    outcome: "success",
    targetBranch: plan.target,
    governedBy: context.attributionTracker.getFrameAttributions(),
  });

  return {
    success: true,
    runId,
    frameId: frameResult.frameId,
    attributions: context.attributionTracker.getAttributions(),
  };
}
```

## Storage Format

Attributions are stored in `.lexrunner/runs/{runId}/attributions.ndjson`:

```json
{"timestamp":"2026-01-02T05:00:00.000Z","constraintId":"merge-gates-required","action":"ran lint gate","target":"PR-123","source":"baseline","statement":"All PRs must pass lint gate"}
{"timestamp":"2026-01-02T05:00:15.000Z","constraintId":"no-force-push","action":"used merge","target":"PR-123","source":"persona","statement":"Never use force push"}
```

## Frame Output

Frames include attribution in metadata:

```json
{
  "type": "merge-weave",
  "reference_point": "merge-weave-2026-01-02-abc123",
  "summary_caption": "Merged 4 PRs into main",
  "metadata": {
    "duration_ms": 45000,
    "gates_passed": ["lint", "typecheck", "test"],
    "run_id": "01JFZG7X2T3K4M5N6P7Q8R9S0W",
    "governed_by": [
      {
        "constraintId": "merge-gates-required",
        "source": "baseline",
        "action": "ran lint gate"
      },
      {
        "constraintId": "no-force-push",
        "source": "persona",
        "action": "used merge"
      }
    ]
  }
}
```

## CLI Usage

### Explain Command

```bash
# Find out why a lint gate was run
$ lexrunner explain "why lint gate"
🔍 Found 2 attribution(s):

Run: 01JFZG7X2T3K4M5N6P7Q8R9S0W
  Timestamp: 2026-01-02T05:00:00.000Z
  Action: ran lint gate on PR-123
  Target: PR-123
  Constraint: merge-gates-required (baseline)
  Statement: All PRs must pass lint gate

Run: 01JFZG7X2T3K4M5N6P7Q8R9S0W
  Timestamp: 2026-01-02T05:00:10.000Z
  Action: ran lint gate on PR-124
  Target: PR-124
  Constraint: merge-gates-required (baseline)
  Statement: All PRs must pass lint gate
```

### Show Attribution Flag (Future)

Once integrated with merge-weave:

```bash
# Show attribution during merge-weave execution
$ lexrunner merge-weave --plan plan.json --show-attribution

🚀 Executing Merge-Weave

[Attribution] merge-gates-required (baseline): ran lint gate on PR-123
✅ PR-123: lint passed

[Attribution] merge-gates-required (baseline): ran typecheck gate on PR-123
✅ PR-123: typecheck passed

[Attribution] no-force-push (persona): used merge instead of rebase
✅ PR-123: merged to main

Frame emitted: merge-weave-2026-01-02-abc123
Governed by 2 constraints
```

## Testing

Unit tests cover all core functionality:

```bash
npm test tests/unit/runs/attribution.spec.ts
```

Tests verify:

- Attribution logging
- Frame attribution generation
- Log entry format
- Constraint source tracking
- Immutability of attribution data
