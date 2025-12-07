# QOL-004: Add `lex-pr governance:report` CLI Command

**Status**: Open
**Priority**: Medium
**Effort**: 3-4 hours
**Category**: Integration

## Context

The `analyze-governance-logs.mjs` script is a good start, but it's not discoverable and lives outside the main CLI. Users expect `lex-pr <command>` for all operations.

## Acceptance Criteria

- [ ] Create `src/commands/governanceReport.ts`
- [ ] Wire into main CLI as `lex-pr governance:report`
- [ ] Support same filtering flags as QOL-001
- [ ] Add `--output <file>` flag to save report
- [ ] Add `--top N` to show top N constraints/personas
- [ ] Print to stdout by default (no file arg needed)
- [ ] Add integration test for command

## Example Usage

```bash
# Quick summary of all logs
lex-pr governance:report

# Detailed markdown report for last 7 days
lex-pr governance:report --since 2025-12-01 --format markdown --output governance-report.md

# Show top 5 most frequent constraints
lex-pr governance:report --top 5
```

## Implementation Notes

- Move logic from `scripts/analyze-governance-logs.mjs` into `src/lexsona/logger.ts`
- Keep script as thin wrapper for backwards compat
- Use Commander for CLI parsing

## Non-Goals

- Web UI or dashboard (CLI only)
- Real-time streaming (batch processing is fine)
