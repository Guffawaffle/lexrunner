# QOL-002: Implement Log Retention & Cleanup

**Status**: Open  
**Priority**: Low  
**Effort**: 2-4 hours  
**Category**: Operational Hygiene

## Context

Governance logs will accumulate over time. Need automatic cleanup to prevent unbounded disk usage.

## Acceptance Criteria

- [ ] Add `maxLogAgeDays` config (default: 30 days)
- [ ] Add `maxLogSizeMB` config (default: 100 MB)
- [ ] Implement cleanup function in `src/lexsona/logger.ts`
- [ ] Optionally compress old logs (`.json` → `.json.gz`)
- [ ] Run cleanup automatically before writing new logs
- [ ] Add `lex-pr governance:cleanup` CLI command for manual cleanup
- [ ] Add tests for retention logic

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
