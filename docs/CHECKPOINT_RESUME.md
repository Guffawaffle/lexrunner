# Checkpoint and Resume Support

## Overview

Merge-weave now supports checkpointing and resume functionality to handle interruptions during execution (network issues, rate limits, system crashes). The system automatically saves execution state at key milestones, allowing you to resume from the last successful state.

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
  phase: CheckpointPhase; // discovery | gates | merge | complete
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
  };
}
```

## Storage

- **Location**: `.lexrunner/checkpoints/`
- **Format**: JSON files named `<run-id>.json`
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
- **complete**: Successfully completed execution

## Resumable States

A checkpoint can be resumed if:

- State is not `COMPLETED` or `FAILED`
- Plan is valid and contains items
- Batch index is within valid range

## Implementation Status

### ✅ Completed

- Checkpoint data structure and types
- File-based storage layer with auto-cleanup
- CLI commands (resume, list, show, clean)
- Comprehensive test suite (49 tests)
- Plan hash validation
- Checkpoint filtering and formatting

### ⚠️ Pending (Future Work)

- Automatic checkpoint saving during weave execution
- State machine integration for checkpoint creation
- Actual resume execution logic
- Checkpoint versioning for schema evolution
- Distributed checkpoint storage options

## Notes

- **Current Limitation**: While checkpoint infrastructure is complete, automatic checkpoint saving during weave execution is not yet fully integrated. Manual checkpoint creation is supported via the storage API.

- **Manual Testing**: You can create checkpoints programmatically using the storage API:

```typescript
import { saveCheckpoint, createCheckpointFromContext } from "./src/weave/checkpoint";

// During weave execution
const checkpoint = createCheckpointFromContext(context, completedItems, pendingItems, failedItems);
await saveCheckpoint(checkpoint);
```

## Design Decisions

1. **File-based storage**: Simple, deterministic, no external dependencies
2. **JSON format**: Human-readable, easy to debug, compatible with existing tooling
3. **7-day retention**: Balances disk space with recovery window
4. **Plan hash validation**: Ensures checkpoint matches current plan
5. **Phase categorization**: Enables filtering and monitoring by execution stage

## Related Documentation

- [MERGE_WEAVE_QUICKSTART.md](../MERGE_WEAVE_QUICKSTART.md) - Merge-weave basics
- [MERGE_WEAVE_USAGE_GUIDE.md](../MERGE_WEAVE_USAGE_GUIDE.md) - Usage patterns
- State machine documentation in `src/weave/stateMachine.ts`
