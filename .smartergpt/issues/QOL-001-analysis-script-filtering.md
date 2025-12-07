# QOL-001: Add Filtering & Formatting to Governance Log Analysis

**Status**: Open
**Priority**: Medium
**Effort**: 2-3 hours
**Category**: DX (Developer Experience)

## Context

The `analyze-governance-logs.mjs` script currently processes ALL logs and outputs plain text. For real usage, we need filtering and multiple output formats.

## Acceptance Criteria

- [ ] Add CLI flags: `--since <date>`, `--until <date>`, `--persona <id>`, `--workflow <id>`
- [ ] Add `--format` flag supporting: `json`, `table`, `markdown`
- [ ] Add `--disagreements-only` flag to show only logs where runner/LexSona disagree
- [ ] Update script help text with examples
- [ ] Add 2-3 tests for filtering logic

## Example Usage

```bash
# Show only quality-first_engineering logs from last 7 days
node scripts/analyze-governance-logs.mjs \
  --since 2025-12-01 \
  --persona quality-first_engineering \
  --format markdown

# Show disagreements only (where LexSona would block but runner allowed)
node scripts/analyze-governance-logs.mjs --disagreements-only
```

## Non-Goals

- Interactive TUI (keep it simple CLI for now)
- Statistical modeling (just aggregation)
