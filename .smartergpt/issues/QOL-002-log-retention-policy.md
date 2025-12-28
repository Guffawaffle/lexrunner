# QOL-002: Implement Log Retention & Cleanup

**Status**: ✅ Completed (2025-12-07)
**Priority**: Low
**Effort**: 2-4 hours (actual: 2h)
**Category**: Operational Hygiene

## Context

Governance logs will accumulate over time. Need automatic cleanup to prevent unbounded disk usage.

## Acceptance Criteria

- [x] Add `maxLogAgeDays` config (default: 30 days)
- [x] Add `maxLogSizeMB` config (default: 100 MB)
- [x] Implement cleanup function in `src/lexsona/logger.ts`
- [x] ~~Optionally compress old logs (`.json` → `.json.gz`)~~ (deferred - not needed yet)
- [x] Run cleanup automatically before writing new logs
- [x] Add `lex-pr governance:cleanup` CLI command for manual cleanup
- [x] Add tests for retention logic

## Implementation Details

**Files Modified:**

- `src/lexsona/logger.ts`: Added retention functions, async writeGovernanceLog
  - `cleanupOldLogs(maxAgeDays)`: Deletes logs older than threshold
  - `enforceRetentionPolicy(maxSizeMB)`: Deletes oldest logs if size exceeded
  - `applyRetentionPolicy(config)`: Unified cleanup (called before writes)
  - `getGovernanceLogsDir()`: Now exported for CLI usage
  - `RetentionConfig` interface with optional maxAgeDays, maxSizeMB

- `src/commands/governanceCleanup.ts`: NEW - Full CLI implementation
  - `lex-pr governance:cleanup --stats`: Show log statistics
  - `lex-pr governance:cleanup --dry-run`: Preview deletions
  - `lex-pr governance:cleanup --max-age <days>`: Custom age threshold
  - `lex-pr governance:cleanup --max-size <mb>`: Custom size threshold

- `src/commands/merge.ts`: Updated to await writeGovernanceLog (now async)

- `src/cli.ts`: Registered governanceCleanup command

**Tests Added:**

- `tests/governance-retention.spec.ts`: 8 comprehensive tests
  - Age-based cleanup
  - Size-based cleanup
  - Edge cases (no logs, non-existent directory)
  - Config resolution

**Defaults:**

- Max age: 30 days
- Max size: 100 MB
- Compression: Deferred (not implemented - add when disk usage becomes issue)
- Cleanup: Automatic before every log write

**CLI Examples:**

```bash
# Show current stats
lex-pr governance:cleanup --stats

# Preview cleanup
lex-pr governance:cleanup --dry-run --max-age 7

# Execute cleanup with custom thresholds
lex-pr governance:cleanup --max-age 60 --max-size 200
```

## Example Config

```yaml
# .smartergpt/governance.yml
retention:
  maxAgeDays: 30
  maxSizeMB: 100
  compressionEnabled: true
```

## Non-Goals

- Cloud storage integration (local disk only for now)
- Complex archival strategies
- Compression (deferred until needed)

## Test Results

✅ All 8 retention tests passing
✅ All 13 integration tests passing (21 total)
✅ CLI help and --stats working
✅ Dry-run mode verified
