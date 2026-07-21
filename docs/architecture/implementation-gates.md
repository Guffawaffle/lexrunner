# Implementation and release gates

LexRunner uses two explicit test tiers. Agent implementation time is evaluated against the
implementation tier; release readiness is evaluated only from the canonical release commit.

## Implementation tier

`lex-pr gate select --base <sha> --head <sha> --json` resolves the committed diff through the
versioned `GATE_IMPACT_MODEL`. Selection is deterministic for a fixed repository state and emits
every selected test with its direct-owner or adjacent-contract rationale.

- Direct source owners and checked-in adjacent contracts run as focused Vitest paths.
- Changed tests run directly.
- Documentation-only diffs run `npm run docs:check` against the explicit base/head pair.
- Unknown mappings and shared/public surfaces fall back to `npm test`.
- Schemas, public exports, CLI/MCP registration, persistence, shared fixtures, build/release files,
  and workflow configuration are always full-suite triggers.
- Lint, typecheck, build, and package-boundary validation remain global static gates.

To apply the selection during a frozen-plan run, opt in explicitly:

```bash
lex-pr gate run plan.json \
  --implementation-base <base-sha> \
  --implementation-head <head-sha>
```

The plan file is not rewritten. LexRunner writes `gate-impact-selection.json` under the selected
artifact directory with the input SHAs, changed files, selected tests, rationale, command, and any
full-suite fallback reason.

## Timeout contract

Local gates run in a dedicated POSIX process group or a Windows process tree. On timeout,
LexRunner terminates the tree, waits for cleanup, escalates when necessary, and does not resolve the
gate until descendant cleanup is observed. The result uses exit code `124`, failure kind `timeout`,
and a bounded cleanup projection. Assertion/nonzero failures use failure kind `nonzero_exit`.

## Release tier

Issue #795 remains the release gate. From the canonical release commit it must run the complete
unit, git-backed, package, benchmark, dogfood, and compatibility suites. Focused implementation
selection never weakens or replaces that final evidence.
