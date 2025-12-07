# QOL-003: Add Real-time Console Feedback for Shadow Mode

**Status**: Open  
**Priority**: High  
**Effort**: 1-2 hours  
**Category**: DX (Developer Experience)

## Context

Currently, shadow mode silently logs to disk. Users have no immediate feedback about LexSona's opinion during execution. This makes it hard to notice disagreements.

## Acceptance Criteria

- [ ] After shadow derivation, print 1-line summary to console:
  ```
  [LexSona shadow] quality-first_engineering: 3 constraints, WOULD BLOCK (runner: allow)
  [LexSona shadow] quality-first_engineering: 0 constraints, AGREES (runner: allow)
  ```
- [ ] Use colored output (yellow for disagreements, green for agreement)
- [ ] Add `--quiet-shadow` flag to suppress console output
- [ ] Update `src/lexsona/client.ts` to return summary string
- [ ] Add unit test for summary formatting

## Example Output

```bash
$ lex-pr merge-weave --plan test-plan.json

Running gates...
✓ lint passed
✓ typecheck passed
✓ test passed

[LexSona shadow] quality-first_engineering: 2 constraints, AGREES (runner: allow)
  - "Run full test suite before merge" (confidence: 0.85)
  - "Verify no TODOs in diff" (confidence: 0.72)

Merging PR-123...
```

## Non-Goals

- Detailed constraint explanations in console (keep logs for that)
- Interactive mode (shadow is observation-only)
