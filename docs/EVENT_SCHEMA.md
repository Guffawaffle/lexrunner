# Event Schema for Fanout and Merge-Weave Hooks

This document defines the event schemas for fanout and merge-weave hooks in LexRunner. These events are designed to integrate with Lex's Frame API, capturing workflow execution data for memory and analytics.

## Schema Version Compatibility

**LexRunner Event Schema**: v2.0 (compatible with Lex Frame Schema v2)
**Minimum Lex Version**: 0.4.0 (see package.json: `@smartergpt/lex: ^2.0.2`)
**Last Updated**: 2025-12-28

### Version Contract

LexRunner's event emission is guaranteed compatible with:

- **Lex v2.x** (Frame schema v2 with runId, planHash, spend extensions)
- **Lex Frame API** endpoints (Lex#79: Frame ingestion)
- **Lex Atlas** rebuild capabilities (Lex#80: On-demand memory refresh)

For version migration guidance, see [MIGRATION_v0.1.md](./MIGRATION_v0.1.md).

## Overview

LexRunner emits structured events during key workflow operations:

- **FanoutEvent**: Emitted when PRs are batched/fanned out for parallel execution
- **MergeWeaveEvent**: Emitted during merge-weave operations (conflict resolution, gate execution)

These events conform to Lex Frame schema v2 (Lex#88), including:

- `runId`: Unique identifier for correlating events across a workflow execution (UUID v4 format)
- `planHash`: SHA-256 hash (64 hex chars) of the execution plan for idempotency
- `spend`: Cost tracking metrics (tokens, latency, turn cost)

## Event Types

### FanoutEvent

Captures information when issues/PRs are batched and distributed for parallel execution.

**Purpose**: Track what work was parallelized, which modules were touched, and provide context for downstream correlation.

**Fields**:

| Field            | Type             | Required | Description                                                  |
| ---------------- | ---------------- | -------- | ------------------------------------------------------------ |
| `eventType`      | `"fanout"`       | ✓        | Event discriminator                                          |
| `runId`          | `string`         | ✓        | Unique run identifier (UUID v4)                              |
| `timestamp`      | `string`         | ✓        | ISO 8601 timestamp (e.g., `2025-12-14T22:43:58.569Z`)        |
| `planHash`       | `string`         | ✓        | SHA-256 hash of the execution plan                           |
| `prList`         | `string[]`       | ✓        | List of PR numbers or identifiers (e.g., `["#123", "#124"]`) |
| `modulesTouched` | `string[]`       | ✓        | Canonical module identifiers affected by this fanout         |
| `batchSize`      | `number`         | ✓        | Number of items in this batch                                |
| `totalPRs`       | `number`         | ✓        | Total number of PRs in the workflow                          |
| `planContext`    | `PlanContext`    | ✓        | Reference to the source plan                                 |
| `metadata`       | `FanoutMetadata` | ✗        | Additional operational metadata                              |

**PlanContext**:

| Field         | Type     | Required | Description                                  |
| ------------- | -------- | -------- | -------------------------------------------- |
| `planPath`    | `string` | ✓        | Path to the plan.json file                   |
| `planVersion` | `string` | ✓        | Schema version of the plan (e.g., `"1.0.0"`) |
| `planSize`    | `number` | ✓        | Number of items in the plan                  |

**FanoutMetadata** (optional):

| Field               | Type     | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `executionMode`     | `string` | Mode of execution (e.g., `"parallel"`, `"sequential"`) |
| `targetBranch`      | `string` | Target branch for PRs                                  |
| `repository`        | `string` | Repository identifier (e.g., `"owner/repo"`)           |
| `batchIndex`        | `number` | Index of this batch (0-based) if multiple batches      |
| `estimatedDuration` | `number` | Estimated duration in milliseconds                     |

### MergeWeaveEvent

Captures comprehensive information during merge-weave operations, including conflict resolution, gate execution, and cost metrics.

**Purpose**: Provide detailed execution trace for merge-weave workflows, enabling Frame-based memory and post-mortem analysis.

**Fields**:

| Field          | Type                                  | Required | Description                         |
| -------------- | ------------------------------------- | -------- | ----------------------------------- |
| `eventType`    | `"merge-weave"`                       | ✓        | Event discriminator                 |
| `runId`        | `string`                              | ✓        | Unique run identifier (UUID v4)     |
| `timestamp`    | `string`                              | ✓        | ISO 8601 timestamp                  |
| `planHash`     | `string`                              | ✓        | SHA-256 hash of the execution plan  |
| `outcome`      | `"success" \| "failure" \| "partial"` | ✓        | Overall outcome of the merge-weave  |
| `conflictInfo` | `ConflictInfo`                        | ✓        | Details about conflicts encountered |
| `resolution`   | `ResolutionInfo`                      | ✓        | How conflicts were resolved         |
| `gateResults`  | `GateResults`                         | ✓        | Results from all gate executions    |
| `spend`        | `SpendMetrics`                        | ✓        | Cost tracking metrics               |
| `planContext`  | `PlanContext`                         | ✓        | Reference to the source plan        |
| `metadata`     | `MergeWeaveMetadata`                  | ✗        | Additional operational metadata     |

**ConflictInfo**:

| Field               | Type             | Required | Description                               |
| ------------------- | ---------------- | -------- | ----------------------------------------- |
| `totalConflicts`    | `number`         | ✓        | Total number of conflicts detected        |
| `conflictsResolved` | `number`         | ✓        | Number of conflicts successfully resolved |
| `conflictFiles`     | `string[]`       | ✓        | Paths of files with conflicts             |
| `conflictTypes`     | `ConflictType[]` | ✗        | Types of conflicts encountered            |

**ConflictType**:

```typescript
type ConflictType =
  | "content" // Standard merge conflict in file content
  | "delete-modify" // File deleted in one branch, modified in another
  | "modify-delete" // File modified in one branch, deleted in another
  | "rename-rename" // File renamed differently in both branches
  | "add-add"; // Same file added in both branches with different content
```

**ResolutionInfo**:

| Field             | Type       | Required | Description                                                                      |
| ----------------- | ---------- | -------- | -------------------------------------------------------------------------------- |
| `strategy`        | `string`   | ✓        | Resolution strategy used (e.g., `"manual"`, `"auto-theirs"`, `"semantic-merge"`) |
| `resolvedFiles`   | `string[]` | ✓        | Files that were successfully resolved                                            |
| `unresolvedFiles` | `string[]` | ✓        | Files still in conflict (for partial outcomes)                                   |
| `resolutionNotes` | `string`   | ✗        | Human-readable notes about resolution approach                                   |

**GateResults**:

| Field         | Type           | Required | Description                    |
| ------------- | -------------- | -------- | ------------------------------ |
| `totalGates`  | `number`       | ✓        | Total number of gates executed |
| `gatesPassed` | `string[]`     | ✓        | Names of gates that passed     |
| `gatesFailed` | `string[]`     | ✓        | Names of gates that failed     |
| `gateDetails` | `GateDetail[]` | ✗        | Detailed results for each gate |

**GateDetail**:

| Field       | Type                         | Description                                      |
| ----------- | ---------------------------- | ------------------------------------------------ |
| `name`      | `string`                     | Gate name                                        |
| `status`    | `"pass" \| "fail" \| "skip"` | Gate execution status                            |
| `duration`  | `number`                     | Duration in milliseconds                         |
| `exitCode`  | `number`                     | Exit code from gate command                      |
| `artifacts` | `string[]`                   | Paths to artifacts produced (e.g., test reports) |

**SpendMetrics** (Lex v2 schema):

| Field         | Type          | Required | Description                      |
| ------------- | ------------- | -------- | -------------------------------- |
| `duration`    | `number`      | ✓        | Total duration in milliseconds   |
| `turnCost`    | `TurnCost`    | ✗        | Turn Cost metrics (if available) |
| `tokenUsage`  | `TokenUsage`  | ✗        | Token consumption metrics        |
| `tierMetrics` | `TierMetrics` | ✗        | Governance tier metrics          |

**TurnCost** (see existing Frame types):

| Field                             | Type      | Description                       |
| --------------------------------- | --------- | --------------------------------- |
| `components.latencyMs`            | `number`  | Latency component                 |
| `components.contextResetTokens`   | `number`  | Context reset overhead            |
| `components.renegotiationCount`   | `number`  | Number of renegotiations          |
| `components.tokenBloat`           | `number`  | Token bloat metric                |
| `components.attentionSwitchCount` | `number`  | Attention switches                |
| `weightedScore`                   | `number`  | Composite weighted score          |
| `eventCount`                      | `number`  | Number of events recorded         |
| `priorRunScore`                   | `number?` | Previous run score for comparison |
| `improvement`                     | `string?` | Improvement percentage            |

**TokenUsage**:

| Field    | Type     | Description                   |
| -------- | -------- | ----------------------------- |
| `input`  | `number` | Input tokens consumed         |
| `output` | `number` | Output tokens generated       |
| `total`  | `number` | Total tokens (input + output) |

**TierMetrics** (Governance, Claim 3.4):

| Field            | Type     | Description                            |
| ---------------- | -------- | -------------------------------------- |
| `totalTasks`     | `number` | Total tasks in workflow                |
| `byTier.senior`  | `number` | Tasks requiring senior-level           |
| `byTier.mid`     | `number` | Tasks requiring mid-level              |
| `byTier.junior`  | `number` | Tasks requiring junior-level           |
| `escalations`    | `number` | Number of tier escalations             |
| `mismatches`     | `number` | Tier assignment mismatches             |
| `tierMatchRate`  | `number` | Percentage of correct tier assignments |
| `escalationRate` | `number` | Escalation rate                        |

**MergeWeaveMetadata** (optional):

| Field               | Type       | Description                                   |
| ------------------- | ---------- | --------------------------------------------- |
| `targetBranch`      | `string`   | Target branch for merge                       |
| `integrationBranch` | `string`   | Integration branch used (if umbrella pattern) |
| `mergedPRs`         | `string[]` | PRs successfully merged                       |
| `failedPRs`         | `string[]` | PRs that failed to merge                      |
| `repository`        | `string`   | Repository identifier                         |
| `error`             | `string`   | Error message if outcome is failure           |

## Frame Metadata Mapping

Events are transformed into Lex Frames using the following mapping:

### FanoutEvent → ExecutionFrame

| Frame Field          | Source                                                         |
| -------------------- | -------------------------------------------------------------- |
| `type`               | `"execution"`                                                  |
| `reference_point`    | `"fanout-{timestamp}-{runId}"`                                 |
| `summary_caption`    | `"Fanout: {batchSize} PRs to {modulesTouched.length} modules"` |
| `module_scope`       | `modulesTouched` (canonical module IDs)                        |
| `keywords`           | `["fanout", "batch", ...prList]`                               |
| `outcome`            | `"success"` (fanout is pre-execution setup)                    |
| `next_actions`       | `["Execute batched PRs", "Monitor gate results"]`              |
| `metadata.run_id`    | `runId`                                                        |
| `metadata.plan_hash` | `planHash`                                                     |

### MergeWeaveEvent → ExecutionFrame

| Frame Field                   | Source                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `type`                        | `"merge-weave"`                                                                                              |
| `reference_point`             | `"merge-weave-{timestamp}-{runId}"`                                                                          |
| `summary_caption`             | `"Merge-weave: {conflictInfo.totalConflicts} conflicts, {gateResults.totalGates} gates, outcome: {outcome}"` |
| `module_scope`                | `conflictInfo.conflictFiles.map(toModuleId)`                                                                 |
| `keywords`                    | `["merge-weave", "conflicts", ...gateResults.gatesPassed, ...gateResults.gatesFailed]`                       |
| `outcome`                     | `outcome`                                                                                                    |
| `next_actions`                | Derived from outcome and failed gates                                                                        |
| `metadata.run_id`             | `runId`                                                                                                      |
| `metadata.plan_hash`          | `planHash`                                                                                                   |
| `metadata.duration_ms`        | `spend.duration`                                                                                             |
| `metadata.conflicts_resolved` | `conflictInfo.conflictsResolved`                                                                             |
| `metadata.gates_passed`       | `gateResults.gatesPassed`                                                                                    |
| `metadata.gates_failed`       | `gateResults.gatesFailed`                                                                                    |
| `metadata.turn_cost`          | `spend.turnCost`                                                                                             |
| `metadata.tier_metrics`       | `spend.tierMetrics`                                                                                          |
| `metadata.error`              | `metadata.error` (if outcome is failure)                                                                     |

## Example Event Payloads

### Example 1: FanoutEvent

```json
{
  "eventType": "fanout",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-12-14T22:43:58.569Z",
  "planHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prList": ["#123", "#124", "#125"],
  "modulesTouched": ["lexrunner/src/cli", "lexrunner/src/gates", "lexrunner/src/frames"],
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
    "conflictFiles": ["src/cli.ts", "src/gates.ts", "package.json"],
    "conflictTypes": ["content", "content", "add-add"]
  },
  "resolution": {
    "strategy": "semantic-merge",
    "resolvedFiles": ["src/cli.ts", "src/gates.ts", "package.json"],
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
    "resolvedFiles": ["src/cli.ts", "package.json", "package-lock.json"],
    "unresolvedFiles": ["src/schema.ts", "src/types/index.ts"],
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

### Integration Test

Comprehensive v2 schema validation is available in:

- `tests/frames/v2-schema-integration.spec.ts`: Tests all v2 fields (runId, planHash, spend)
- `tests/hooks/events.spec.ts`: Schema validation for FanoutEvent and MergeWeaveEvent

Run tests with:

```bash
npm test -- tests/frames/v2-schema-integration.spec.ts
```

## v2 Field Sources & Data Flow

### runId and planHash Capture

Frame emission captures `runId` and `planHash` from the execution context:

1. **Source**: `weave-lock.json` (WeaveLockFile schema)
   - Located at: `src/schema/weaveLock.ts`
   - Created by: `src/weave/lockFile.ts` during merge-weave initialization
2. **Data Flow**:

   ```
   WeaveLockFile.runId → WeaveContext.runId → Frame.metadata.run_id
   WeaveLockFile.planHash → WeaveContext.metadata.planHash → Frame.metadata.plan_hash
   ```

3. **Plan Lock Mechanism** (LexRunner#323):
   - `planHash` is computed from `hash(plan.json + PR heads)` using SHA-256
   - Ensures idempotency: same plan + same PR states = same hash
   - Stored in `weave-lock.json` for resume capability

### Spend Metadata Alignment

Frame spend tracking aligns with LexRunner's budget guards (LexRunner#327):

1. **Turn Cost**: Captured from `src/metrics/turncost.ts`
   - Tracks latency, context resets, renegotiations, token bloat, attention switches
   - Weighted score formula enables cross-run comparison
2. **Token Usage**: Integrated with budget tracker (`src/budget/tracker.ts`)
   - Input/output token counts
   - Total consumption tracking

3. **Tier Metrics**: Governance data (Claim 3.4)
   - Task distribution across senior/mid/junior tiers
   - Escalation and mismatch tracking

### Example Data Flow

```typescript
// 1. Lock file created during merge-weave initialization
const lockFile: WeaveLockFile = {
  runId: "550e8400-e29b-41d4-a716-446655440000",
  planHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // ... other fields
};

// 2. Frame emitted with v2 fields
const frame = emitMergeWeaveFrame({
  runId: lockFile.runId, // From weave-lock.json
  planHash: lockFile.planHash, // From weave-lock.json
  turnCost: turnCostData, // From metrics/turncost.ts
  tierMetrics: governanceData, // From governance tracking
  // ... other fields
});

// 3. Frame stored with all v2 fields
// frame.metadata.run_id === "550e8400-e29b-41d4-a716-446655440000"
// frame.metadata.plan_hash === "e3b0c44..."
```

## Cross-Repository References

- **Lex#88**: Frame schema v2 extension (runId, planHash, spend)
- **Lex#79**: Frame ingestion API endpoint
- **Lex#80**: Atlas rebuild on demand
- **Lex#82-85**: Aliasing adoption (for module-scope resolution)
- **LexRunner#323**: Plan lock (idempotency via hash)
- **LexRunner#327**: Budget guards (token counting and spend tracking)
- **LexRunner#330**: Frames & metrics implementation
- **LexRunner#344**: Frame schema v2 alignment validation ✅
- **LexRunner#345**: Module aliasing integration ✅

## Module Alias Resolution

LexRunner integrates with Lex's alias resolution system to ensure Frame `module_scope` fields contain **canonical module IDs** rather than file paths or shorthand aliases.

### Resolution Workflow

1. **Frame Emission**: When `emitMergeWeaveFrame`, `emitExecutorFrame`, or `emitProcedureFrame` is called with file paths in `moduleScope`
2. **Alias Resolution**: LexRunner calls Lex's `resolveModuleId` API for each path
3. **Canonical Storage**: Resolved canonical IDs are stored in Frame `module_scope`
4. **Graceful Fallback**: If resolution fails or confidence is low, original path is used with debug warning

### Path Detection

- **File paths** (contain `/` or `.`): Resolved through Lex alias system → `"src/cli.ts"` → `"cli/main"`
- **PR numbers** (e.g., `"#123"`, `"PR-456"`): Passed through unchanged
- **Unknown formats**: Passed through with low confidence

### Example

```typescript
// Input to Frame emitter
mergedPRs: ["src/frames/emitter.ts", "src/aliases/resolver.ts", "#123"];

// After alias resolution
module_scope: ["frames/emitter", "aliases/resolver", "#123"];
```

### Configuration

Alias resolution uses:

- **Alias table**: Loaded from `.smartergpt/aliases.json` (via Lex)
- **Policy**: Loaded from `.smartergpt/lexmap.policy.json` (via Lex)
- **Fallback**: Original path if not found (confidence threshold: 0.9)

### Implementation

See:

- `src/aliases/resolver.ts`: Resolution logic
- `src/frames/emitter.ts`: Integration with Frame emission
- `tests/aliases/resolver.spec.ts`: Test coverage

## Version Compatibility

### Lex Dependency Pinning

LexRunner pins Lex version in `package.json`:

```json
{
  "dependencies": {
    "@smartergpt/lex": "^2.0.2"
  }
}
```

This ensures:

- Frame schema v2 compatibility (runId, planHash, spend fields)
- Access to Frame ingestion API (Lex#79)
- Atlas rebuild capabilities (Lex#80)

### CI Validation

Cross-repo version validation is performed in CI:

- `npm ci` verifies exact Lex version match via package-lock.json
- Integration tests validate v2 field compatibility
- TypeScript compilation ensures type compatibility across versions

For details, see [CI Version Validation](./ci-version-validation.md).

### Frame Emission Gate (LPR-009)

A dedicated CI workflow validates Frame emission quality:

**Workflow**: `.github/workflows/frame-emission-gate.yml`

**Triggers**:

- Pull requests touching `src/frames/`, `src/hooks/`, `src/weave/`, `src/aliases/`
- Push to `main` affecting Frame-related code
- Manual workflow dispatch

**Jobs**:

1. **frame-emission-tests**: Runs all Frame-related unit tests
2. **frame-schema-validation**: Validates module exports and schema compliance
3. **frame-emission-integration**: Tests Frame emission in merge-weave context

**Test Files**:

- `tests/frames/emitter.spec.ts`: Frame emitter functions
- `tests/frames/types.spec.ts`: Type validation
- `tests/frames/v2-schema-integration.spec.ts`: v2 schema compliance
- `tests/frames/ci-gate-integration.spec.ts`: CI-specific integration tests
- `tests/hooks/`: Event schema tests

This gate fails if:

- Frame emission returns errors
- v2 fields (runId, planHash) are missing
- Module exports are broken
- Event schemas fail validation

## Next Steps

1. ✅ Implement hook emission logic in Epic B subtasks
2. ✅ Integrate with Lex Frame API (LexRunner#330)
3. ✅ Add aliasing support for module resolution (LexRunner#345)
4. ✅ Validate v2 field compatibility (LexRunner#344)

## Notes

- All events include `runId` (UUID v4 format) for correlation across distributed workflows
- `planHash` (SHA-256, 64 hex chars) enables idempotency and change detection
- `spend` metrics capture both Turn Cost (LexRunner-specific) and standard token usage
- **Module identifiers use canonical aliasing** (LexRunner#345)
- Events are emitted to local storage first, then synced to Lex Frame API asynchronously
- WeaveLock (`weave-lock.json`) is the single source of truth for runId and planHash during execution
