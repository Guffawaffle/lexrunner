# QOL-006: Add Verbose Debug Mode for LexSona Integration

**Status**: Open
**Priority**: Low
**Effort**: 2-3 hours
**Category**: Debugging

## Context

When LexSona derivations fail or produce unexpected constraints, there's no way to see intermediate steps. Need verbose logging for troubleshooting.

## Acceptance Criteria

- [ ] Honor `LEXSONA_DEBUG=1` env var
- [ ] Log to stderr (not to governance logs):
  - Rules loaded count
  - Filtered rules count (by scope/mode)
  - Each constraint derivation step
  - Confidence calculations
  - Offline mode warnings
- [ ] Add debug logs to `src/lexsona/client.ts`
- [ ] Use `debug` npm package or simple `if (process.env.LEXSONA_DEBUG)`
- [ ] Add example debug session to README or docs

## Example Debug Output

```bash
$ LEXSONA_DEBUG=1 lex-pr merge-weave --plan test-plan.json

[lexsona:debug] Loading persona: quality-first_engineering
[lexsona:debug] Rules loaded: 12
[lexsona:debug] Filtered by scope (merge-weave): 8 rules
[lexsona:debug] Confidence threshold: 0.30
[lexsona:debug] Deriving constraints...
[lexsona:debug]   Rule "require-full-test-suite" -> constraint (confidence: 0.85)
[lexsona:debug]   Rule "no-todos-in-pr" -> constraint (confidence: 0.72)
[lexsona:debug]   Rule "verify-changelog" -> SKIPPED (confidence: 0.25 < 0.30)
[lexsona:debug] Final: 2 constraints derived
[lexsona:debug] Offline mode: true (no Lex DB connection)
```

## Non-Goals

- Interactive debugger (just logs)
- Performance profiling (separate concern)
