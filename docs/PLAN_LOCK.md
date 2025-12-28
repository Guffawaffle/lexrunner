# Plan Lock Mechanism

## Overview

The plan lock mechanism ensures idempotent merge-weave runs by computing a unique hash from the plan configuration and PR head commits. This prevents duplicate executions and provides traceability through audit events.

## Lock Hash Computation

**Formula:** `SHA-256(canonical(plan.json) + sorted(PR heads))`

- Plan is serialized in canonical JSON format for consistency
- PR heads are sorted by name to ensure deterministic ordering
- Full hash is 64 hex characters; displayed as first 12 characters

## Lock File Format

**Location:** `weave-lock.json` (same directory as plan.json)

```json
{
  "lockHash": "abcdef...",
  "planHash": "123456...",
  "prHeads": [
    { "name": "pr-123", "sha": "abc123" },
    { "name": "pr-456", "sha": "def456" }
  ],
  "timestamp": "2025-11-10T08:30:00.000Z",
  "status": "completed",
  "integrationBranch": "integration/weave-2025-11-10-abc123"
}
```

### Status Values

- `in-progress` - Execution started but not completed
- `completed` - Execution finished successfully
- `failed` - Execution finished with failures

## Idempotency Behavior

1. **First Run:** Lock hash computed, lock file created, execution proceeds
2. **Same Input:** If lock hash matches existing lock, execution is skipped
3. **Different Input:** If plan or PR heads change, new hash is computed and execution proceeds
4. **Force Override:** `--force` flag bypasses lock check

## Audit Integration

All audit events (Frames) include the lock hash in the event envelope:

```json
{
  "schema_version": "0.1.0",
  "event": "command_invocation",
  "lock_hash": "abcdef123456",
  "payload": { ... }
}
```

This enables:

- Correlation of events across retries
- Detection of duplicate runs
- Forensic analysis of execution history

## CLI Usage

```bash
# Dry-run: preview with lock hash
lex-pr merge

# Execute: create lock file
lex-pr merge --execute

# Force execution despite existing lock
lex-pr merge --execute --force

# JSON output includes lock hash
lex-pr merge --json
```

## Lock Hash Display

**Console Output:**

```
🔒 Lock Hash: abcdef123456
```

**JSON Output:**

```json
{
  "mode": "dry-run",
  "lockHash": "abcdef123456",
  ...
}
```

## Implementation Files

- `src/util/lockHash.ts` - Hash computation utilities
- `src/schema/weaveLock.ts` - Lock file schema and validation
- `src/audit/events.ts` - Event envelope with lock_hash field
- `src/audit/emitter.ts` - Lock hash propagation to events
- `src/commands/merge.ts` - Lock mechanism integration
- `src/git/operations.ts` - Branch head SHA retrieval

## Testing

- `tests/lockHash.spec.ts` - Hash computation tests
- `tests/weaveLock.spec.ts` - Schema validation tests
- `tests/mergeLockHash.spec.ts` - Integration tests

All 29 tests pass successfully.
