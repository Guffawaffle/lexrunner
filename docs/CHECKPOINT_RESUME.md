# Checkpoint and Resume Support

## Overview

Merge-weave persists an operation journal before and after every gate, merge, and post-check. A
restart continues from the last proven boundary without repeating completed side effects.

`weave resume` and `merge --resume` are two CLI entry points to the same application service and
the same checkpoint. They cannot apply different recovery semantics.

## Quick Start

### Resume from latest checkpoint

```bash
lex-pr weave resume --latest
```

### Resume from specific checkpoint

```bash
lex-pr weave resume --run-id <run-id>
```

### List available checkpoints

```bash
lex-pr weave checkpoints list
```

### View checkpoint details

```bash
lex-pr weave checkpoints show <run-id>
```

### Clean up old checkpoints

```bash
lex-pr weave checkpoints clean
```

## Checkpoint Schema

Each checkpoint contains:

```typescript
interface WeaveCheckpoint {
  runId: string; // Unique run identifier
  timestamp: string; // ISO 8601 timestamp
  phase: CheckpointPhase; // discovery | gates | merge | post_checks | complete
  state: WeaveState; // Current state machine state
  planHash: string; // Plan hash for validation
  plan: Plan; // Original plan
  completedItems: string[]; // Items successfully completed
  pendingItems: string[]; // Items still pending
  failedItems: string[]; // Items that failed
  lastSuccessfulSha?: string; // Last successful merge commit
  currentBatchIndex: number; // Current batch being processed
  totalBatches: number; // Total number of batches
  successfulMerges: number; // Count of successful merges
  failedMerges: number; // Count of failed merges
  startedAt: string; // Execution start time
  lastUpdatedAt: string; // Last update time
  metadata?: {
    version?: string; // Lexrunner version
    target?: string; // Target branch
    warnings?: string[]; // Any warnings
    resume?: {
      schemaVersion: "1.0.0";
      revision: number;
      operations: Array<{
        id: string;
        phase: "gate" | "merge" | "post_check";
        status: "pending" | "in_progress" | "completed" | "failed";
        attempts: number;
      }>;
      repository: {
        target: string;
        targetHeadSha: string;
        integrationBranch: string;
        sourceHeads: Record<string, string>;
      };
    };
  };
}
```

## Storage

- **Location**: `.lexrunner/checkpoints/`
- **Format**: JSON files named `<run-id>.json`
- **Writes**: atomic replace, with a local execution lease preventing concurrent resume
- **Retention**: 7 days (automatic cleanup)

## Commands

### `lex-pr weave resume`

Resume merge-weave execution from a checkpoint.

Options:

- `--run-id <id>` - Resume from specific run ID
- `--latest` - Resume from most recent checkpoint
- `--json` - Output JSON format

Example:

```bash
# Resume from latest
lex-pr weave resume --latest

# Resume from specific run
lex-pr weave resume --run-id abc123-def456
```

### `lex-pr weave checkpoints list`

List all available checkpoints.

Options:

- `--phase <phase>` - Filter by phase (discovery|gates|merge|complete)
- `--state <state>` - Filter by state
- `--limit <n>` - Maximum number of results
- `--json` - Output JSON format

Example:

```bash
# List all checkpoints
lex-pr weave checkpoints list

# List merge phase checkpoints
lex-pr weave checkpoints list --phase merge --limit 5
```

### `lex-pr weave checkpoints show`

Show detailed information about a specific checkpoint.

Options:

- `--json` - Output JSON format

Example:

```bash
lex-pr weave checkpoints show abc123-def456
```

### `lex-pr weave checkpoints clean`

Clean up old checkpoints based on retention policy (7 days).

Options:

- `--json` - Output JSON format

Example:

```bash
lex-pr weave checkpoints clean
```

## Phases

Checkpoints are categorized by execution phase:

- **discovery**: Initial planning and order computation
- **gates**: Gate execution and validation
- **merge**: Actual merge operations
- **post_checks**: Integrated-result validation
- **complete**: Successfully completed execution

## Resumable States

A checkpoint can be resumed when its versioned operation journal, canonical plan hash, captured
target head, source heads, and integration-branch boundary still agree. If a process exits after a
merge but before recording success, LexRunner observes the exact source commit on the integration
branch and records the operation as completed. It does not repeat the merge.

Gate and post-check processes do not expose equivalent external proof. If one exits while marked
`in_progress`, resume fails closed as ambiguous instead of claiming or repeating success.

## Implementation Status

### Implemented

- automatic checkpoint creation and atomic progress writes;
- one versioned operation journal for gates, merges, and post-checks;
- plan, target, source-head, and integration-head validation;
- idempotent observation of a merge completed immediately before a crash;
- bounded JSON results and actionable fail-closed errors;
- compatible checkpoint list, show, cleanup, and retention commands.

## Notes

- Checkpoints created before the `metadata.resume` journal existed are inspectable but are not
  executable. Their item-level state cannot prove which individual side effects completed, so
  LexRunner asks for a fresh execution rather than guessing.
- The repository-local execution lease is not a distributed lock. Cross-host scheduling belongs
  to the durable agent-work coordination layer, not this local merge-weave checkpoint.

## Design Decisions

1. **File-based storage**: Simple, deterministic, no external dependencies
2. **JSON format**: Human-readable, easy to debug, compatible with existing tooling
3. **7-day retention**: Balances disk space with recovery window
4. **Plan and repository validation**: Ensures the plan and captured Git refs still match
5. **Write-ahead operation state**: Persists `in_progress` before issuing a side effect
6. **Observation before retry**: Retries only after proving the side effect remains pending

## Related Documentation

- [MERGE_WEAVE_QUICKSTART.md](../MERGE_WEAVE_QUICKSTART.md) - Merge-weave basics
- [MERGE_WEAVE_USAGE_GUIDE.md](../MERGE_WEAVE_USAGE_GUIDE.md) - Usage patterns
- State machine documentation in `src/weave/stateMachine.ts`
