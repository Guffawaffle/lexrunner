# Event Schema for Fanout and Merge-Weave Hooks

This document defines the event schemas for fanout and merge-weave hooks in LexRunner. These events are designed to integrate with Lex's Frame API, capturing workflow execution data for memory and analytics.

## Overview

LexRunner emits structured events during key workflow operations:

- **FanoutEvent**: Emitted when PRs are batched/fanned out for parallel execution
- **MergeWeaveEvent**: Emitted during merge-weave operations (conflict resolution, gate execution)

These events conform to Lex Frame schema v2 (Lex#88), including:
- `runId`: Unique identifier for correlating events across a workflow execution
- `planHash`: SHA-256 hash of the execution plan for idempotency
- `spend`: Cost tracking metrics (tokens, latency, turn cost)

## Event Types

### FanoutEvent

Captures information when issues/PRs are batched and distributed for parallel execution.

**Purpose**: Track what work was parallelized, which modules were touched, and provide context for downstream correlation.

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | `"fanout"` | ✓ | Event discriminator |
| `runId` | `string` | ✓ | Unique run identifier (UUID v4) |
| `timestamp` | `string` | ✓ | ISO 8601 timestamp (e.g., `2025-12-14T22:43:58.569Z`) |
| `planHash` | `string` | ✓ | SHA-256 hash of the execution plan |
| `prList` | `string[]` | ✓ | List of PR numbers or identifiers (e.g., `["#123", "#124"]`) |
| `modulesTouched` | `string[]` | ✓ | Canonical module identifiers affected by this fanout |
| `batchSize` | `number` | ✓ | Number of items in this batch |
| `totalPRs` | `number` | ✓ | Total number of PRs in the workflow |
| `planContext` | `PlanContext` | ✓ | Reference to the source plan |
| `metadata` | `FanoutMetadata` | ✗ | Additional operational metadata |

**PlanContext**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planPath` | `string` | ✓ | Path to the plan.json file |
| `planVersion` | `string` | ✓ | Schema version of the plan (e.g., `"1.0.0"`) |
| `planSize` | `number` | ✓ | Number of items in the plan |

**FanoutMetadata** (optional):

| Field | Type | Description |
|-------|------|-------------|
| `executionMode` | `string` | Mode of execution (e.g., `"parallel"`, `"sequential"`) |
| `targetBranch` | `string` | Target branch for PRs |
| `repository` | `string` | Repository identifier (e.g., `"owner/repo"`) |
| `batchIndex` | `number` | Index of this batch (0-based) if multiple batches |
| `estimatedDuration` | `number` | Estimated duration in milliseconds |

### MergeWeaveEvent

Captures comprehensive information during merge-weave operations, including conflict resolution, gate execution, and cost metrics.

**Purpose**: Provide detailed execution trace for merge-weave workflows, enabling Frame-based memory and post-mortem analysis.

**Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | `"merge-weave"` | ✓ | Event discriminator |
| `runId` | `string` | ✓ | Unique run identifier (UUID v4) |
| `timestamp` | `string` | ✓ | ISO 8601 timestamp |
| `planHash` | `string` | ✓ | SHA-256 hash of the execution plan |
| `outcome` | `"success" \| "failure" \| "partial"` | ✓ | Overall outcome of the merge-weave |
| `conflictInfo` | `ConflictInfo` | ✓ | Details about conflicts encountered |
| `resolution` | `ResolutionInfo` | ✓ | How conflicts were resolved |
| `gateResults` | `GateResults` | ✓ | Results from all gate executions |
| `spend` | `SpendMetrics` | ✓ | Cost tracking metrics |
| `planContext` | `PlanContext` | ✓ | Reference to the source plan |
| `metadata` | `MergeWeaveMetadata` | ✗ | Additional operational metadata |

**ConflictInfo**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalConflicts` | `number` | ✓ | Total number of conflicts detected |
| `conflictsResolved` | `number` | ✓ | Number of conflicts successfully resolved |
| `conflictFiles` | `string[]` | ✓ | Paths of files with conflicts |
| `conflictTypes` | `ConflictType[]` | ✗ | Types of conflicts encountered |

**ConflictType**:

```typescript
type ConflictType = 
  | "content"      // Standard merge conflict in file content
  | "delete-modify" // File deleted in one branch, modified in another
  | "modify-delete" // File modified in one branch, deleted in another
  | "rename-rename" // File renamed differently in both branches
  | "add-add";     // Same file added in both branches with different content
```

**ResolutionInfo**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `strategy` | `string` | ✓ | Resolution strategy used (e.g., `"manual"`, `"auto-theirs"`, `"semantic-merge"`) |
| `resolvedFiles` | `string[]` | ✓ | Files that were successfully resolved |
| `unresolvedFiles` | `string[]` | ✓ | Files still in conflict (for partial outcomes) |
| `resolutionNotes` | `string` | ✗ | Human-readable notes about resolution approach |

**GateResults**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalGates` | `number` | ✓ | Total number of gates executed |
| `gatesPassed` | `string[]` | ✓ | Names of gates that passed |
| `gatesFailed` | `string[]` | ✓ | Names of gates that failed |
| `gateDetails` | `GateDetail[]` | ✗ | Detailed results for each gate |

**GateDetail**:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Gate name |
| `status` | `"pass" \| "fail" \| "skip"` | Gate execution status |
| `duration` | `number` | Duration in milliseconds |
| `exitCode` | `number` | Exit code from gate command |
| `artifacts` | `string[]` | Paths to artifacts produced (e.g., test reports) |

**SpendMetrics** (Lex v2 schema):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration` | `number` | ✓ | Total duration in milliseconds |
| `turnCost` | `TurnCost` | ✗ | Turn Cost metrics (if available) |
| `tokenUsage` | `TokenUsage` | ✗ | Token consumption metrics |
| `tierMetrics` | `TierMetrics` | ✗ | Governance tier metrics |

**TurnCost** (see existing Frame types):

| Field | Type | Description |
|-------|------|-------------|
| `components.latencyMs` | `number` | Latency component |
| `components.contextResetTokens` | `number` | Context reset overhead |
| `components.renegotiationCount` | `number` | Number of renegotiations |
| `components.tokenBloat` | `number` | Token bloat metric |
| `components.attentionSwitchCount` | `number` | Attention switches |
| `weightedScore` | `number` | Composite weighted score |
| `eventCount` | `number` | Number of events recorded |
| `priorRunScore` | `number?` | Previous run score for comparison |
| `improvement` | `string?` | Improvement percentage |

**TokenUsage**:

| Field | Type | Description |
|-------|------|-------------|
| `input` | `number` | Input tokens consumed |
| `output` | `number` | Output tokens generated |
| `total` | `number` | Total tokens (input + output) |

**TierMetrics** (Governance, Claim 3.4):

| Field | Type | Description |
|-------|------|-------------|
| `totalTasks` | `number` | Total tasks in workflow |
| `byTier.senior` | `number` | Tasks requiring senior-level |
| `byTier.mid` | `number` | Tasks requiring mid-level |
| `byTier.junior` | `number` | Tasks requiring junior-level |
| `escalations` | `number` | Number of tier escalations |
| `mismatches` | `number` | Tier assignment mismatches |
| `tierMatchRate` | `number` | Percentage of correct tier assignments |
| `escalationRate` | `number` | Escalation rate |

**MergeWeaveMetadata** (optional):

| Field | Type | Description |
|-------|------|-------------|
| `targetBranch` | `string` | Target branch for merge |
| `integrationBranch` | `string` | Integration branch used (if umbrella pattern) |
| `mergedPRs` | `string[]` | PRs successfully merged |
| `failedPRs` | `string[]` | PRs that failed to merge |
| `repository` | `string` | Repository identifier |
| `error` | `string` | Error message if outcome is failure |

## Frame Metadata Mapping

Events are transformed into Lex Frames using the following mapping:

### FanoutEvent → ExecutionFrame

| Frame Field | Source |
|-------------|--------|
| `type` | `"execution"` |
| `reference_point` | `"fanout-{timestamp}-{runId}"` |
| `summary_caption` | `"Fanout: {batchSize} PRs to {modulesTouched.length} modules"` |
| `module_scope` | `modulesTouched` (canonical module IDs) |
| `keywords` | `["fanout", "batch", ...prList]` |
| `outcome` | `"success"` (fanout is pre-execution setup) |
| `next_actions` | `["Execute batched PRs", "Monitor gate results"]` |
| `metadata.run_id` | `runId` |
| `metadata.plan_hash` | `planHash` |

### MergeWeaveEvent → ExecutionFrame

| Frame Field | Source |
|-------------|--------|
| `type` | `"merge-weave"` |
| `reference_point` | `"merge-weave-{timestamp}-{runId}"` |
| `summary_caption` | `"Merge-weave: {conflictInfo.totalConflicts} conflicts, {gateResults.totalGates} gates, outcome: {outcome}"` |
| `module_scope` | `conflictInfo.conflictFiles.map(toModuleId)` |
| `keywords` | `["merge-weave", "conflicts", ...gateResults.gatesPassed, ...gateResults.gatesFailed]` |
| `outcome` | `outcome` |
| `next_actions` | Derived from outcome and failed gates |
| `metadata.run_id` | `runId` |
| `metadata.plan_hash` | `planHash` |
| `metadata.duration_ms` | `spend.duration` |
| `metadata.conflicts_resolved` | `conflictInfo.conflictsResolved` |
| `metadata.gates_passed` | `gateResults.gatesPassed` |
| `metadata.gates_failed` | `gateResults.gatesFailed` |
| `metadata.turn_cost` | `spend.turnCost` |
| `metadata.tier_metrics` | `spend.tierMetrics` |
| `metadata.error` | `metadata.error` (if outcome is failure) |

## Example Event Payloads

### Example 1: FanoutEvent

```json
{
  "eventType": "fanout",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-12-14T22:43:58.569Z",
  "planHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prList": ["#123", "#124", "#125"],
  "modulesTouched": [
    "lexrunner/src/cli",
    "lexrunner/src/gates",
    "lexrunner/src/frames"
  ],
  "batchSize": 3,
  "totalPRs": 10,
  "planContext": {
    "planPath": ".smartergpt/plan.json",
    "planVersion": "1.0.0",
    "planSize": 10
  },
  "metadata": {
    "executionMode": "parallel",
    "targetBranch": "main",
    "repository": "Guffawaffle/LexRunner",
    "batchIndex": 0,
    "estimatedDuration": 300000
  }
}
```

### Example 2: MergeWeaveEvent (Success)

```json
{
  "eventType": "merge-weave",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-12-14T23:15:42.123Z",
  "planHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "outcome": "success",
  "conflictInfo": {
    "totalConflicts": 3,
    "conflictsResolved": 3,
    "conflictFiles": [
      "src/cli.ts",
      "src/gates.ts",
      "package.json"
    ],
    "conflictTypes": ["content", "content", "add-add"]
  },
  "resolution": {
    "strategy": "semantic-merge",
    "resolvedFiles": [
      "src/cli.ts",
      "src/gates.ts",
      "package.json"
    ],
    "unresolvedFiles": [],
    "resolutionNotes": "Auto-merged imports and dependency versions"
  },
  "gateResults": {
    "totalGates": 4,
    "gatesPassed": ["lint", "typecheck", "test", "build"],
    "gatesFailed": [],
    "gateDetails": [
      {
        "name": "lint",
        "status": "pass",
        "duration": 2500,
        "exitCode": 0
      },
      {
        "name": "typecheck",
        "status": "pass",
        "duration": 5200,
        "exitCode": 0
      },
      {
        "name": "test",
        "status": "pass",
        "duration": 12300,
        "exitCode": 0,
        "artifacts": [".smartergpt/runner/cache/test-results.xml"]
      },
      {
        "name": "build",
        "status": "pass",
        "duration": 8900,
        "exitCode": 0
      }
    ]
  },
  "spend": {
    "duration": 45200,
    "turnCost": {
      "components": {
        "latencyMs": 1200,
        "contextResetTokens": 0,
        "renegotiationCount": 0,
        "tokenBloat": 50,
        "attentionSwitchCount": 2
      },
      "weightedScore": 145.5,
      "eventCount": 12,
      "priorRunScore": 180.3,
      "improvement": "19.3%"
    },
    "tokenUsage": {
      "input": 15000,
      "output": 3500,
      "total": 18500
    },
    "tierMetrics": {
      "totalTasks": 3,
      "byTier": {
        "senior": 1,
        "mid": 2,
        "junior": 0
      },
      "escalations": 0,
      "mismatches": 0,
      "tierMatchRate": 1.0,
      "escalationRate": 0.0
    }
  },
  "planContext": {
    "planPath": ".smartergpt/plan.json",
    "planVersion": "1.0.0",
    "planSize": 10
  },
  "metadata": {
    "targetBranch": "main",
    "integrationBranch": "integration/wave-1",
    "mergedPRs": ["#123", "#124", "#125"],
    "failedPRs": [],
    "repository": "Guffawaffle/LexRunner"
  }
}
```

### Example 3: MergeWeaveEvent (Partial Failure)

```json
{
  "eventType": "merge-weave",
  "runId": "660f9511-f3ac-52e5-b827-557766551111",
  "timestamp": "2025-12-14T23:45:10.789Z",
  "planHash": "a7b2c33298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999",
  "outcome": "partial",
  "conflictInfo": {
    "totalConflicts": 5,
    "conflictsResolved": 3,
    "conflictFiles": [
      "src/cli.ts",
      "src/schema.ts",
      "src/types/index.ts",
      "package.json",
      "package-lock.json"
    ],
    "conflictTypes": ["content", "modify-delete", "content", "add-add", "content"]
  },
  "resolution": {
    "strategy": "manual",
    "resolvedFiles": [
      "src/cli.ts",
      "package.json",
      "package-lock.json"
    ],
    "unresolvedFiles": [
      "src/schema.ts",
      "src/types/index.ts"
    ],
    "resolutionNotes": "Complex type conflicts require manual intervention"
  },
  "gateResults": {
    "totalGates": 2,
    "gatesPassed": ["lint"],
    "gatesFailed": ["typecheck"],
    "gateDetails": [
      {
        "name": "lint",
        "status": "pass",
        "duration": 2300,
        "exitCode": 0
      },
      {
        "name": "typecheck",
        "status": "fail",
        "duration": 4100,
        "exitCode": 1
      }
    ]
  },
  "spend": {
    "duration": 28400,
    "turnCost": {
      "components": {
        "latencyMs": 1800,
        "contextResetTokens": 1200,
        "renegotiationCount": 2,
        "tokenBloat": 120,
        "attentionSwitchCount": 5
      },
      "weightedScore": 285.7,
      "eventCount": 18
    },
    "tokenUsage": {
      "input": 22000,
      "output": 5200,
      "total": 27200
    }
  },
  "planContext": {
    "planPath": ".smartergpt/plan.json",
    "planVersion": "1.0.0",
    "planSize": 8
  },
  "metadata": {
    "targetBranch": "main",
    "integrationBranch": "integration/wave-2",
    "mergedPRs": ["#130", "#131"],
    "failedPRs": ["#132"],
    "repository": "Guffawaffle/LexRunner",
    "error": "Type conflicts in schema module require manual resolution"
  }
}
```

## Validation

Event schemas are validated using Zod. See `src/hooks/events.ts` for TypeScript types and validation schemas.

## Cross-Repository References

- **Lex#88**: Frame schema v2 extension (runId, planHash, spend)
- **Lex#79**: Frame ingestion API
- **Lex#82-85**: Aliasing adoption (for module-scope resolution)
- **LexRunner#330**: Frames & metrics implementation
- **LexRunner#344**: Frame schema v2 alignment validation
- **LexRunner#345**: Module aliasing integration

## Next Steps

1. Implement hook emission logic in Epic B subtasks
2. Integrate with Lex Frame API (LexRunner#330)
3. Add aliasing support for module resolution (LexRunner#345)
4. Validate v2 field compatibility (LexRunner#344)

## Notes

- All events include `runId` for correlation across distributed workflows
- `planHash` enables idempotency and change detection
- `spend` metrics capture both Turn Cost (LexRunner-specific) and standard token usage
- Module identifiers should use canonical aliasing (see `ALIASING_FOR_RUNNER.md`)
- Events are emitted to local storage first, then synced to Lex Frame API asynchronously
