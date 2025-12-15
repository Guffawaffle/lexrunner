# ADR-003: Gate Uniform Execution

**Status:** Accepted
**Date:** 2025-11-25
**Authors:** lexrunner team

---

## Context

Gates (lint, typecheck, test, etc.) can run locally or in CI. Historically, these environments diverge—different versions, different configurations, different behaviors. The question: how do we ensure consistency?

---

## Decision

We require **uniform gate execution**: the same gates run locally and in CI, with the same inputs and expectations.

### Same Everywhere

- Gate execution logic and defaults must match **local and CI**
- CI invokes the same runner CLI as local
- No forked logic between local and CI paths

### Stable Interfaces

Each gate produces structured results:
- Status (pass/fail/blocked)
- Duration
- Artifacts (JUnit, SARIF, coverage)
- Logs

Prefer machine-readable outputs in addition to human logs.

### Exit Codes & Semantics

```
0 = pass
>0 = fail
```

The runner distinguishes "blocked" vs "failed" in its state model.

### Caching (Optional)

Allowed, but must not change semantics. Cache keys derive from inputs/artifacts so replays are consistent.

---

## Consequences

### Positive

- **Predictability** — Local pass means CI pass
- **Debugging** — Issues reproduced locally
- **Trust** — CI failures are real, not environment drift

### Negative

- **Environment setup** — Local must match CI (versions, deps)
- **Container overhead** — May need containers for true parity

---

## References

- `/AGENTS.md` — Section 5: Gates — Uniform Execution
- `/docs/gates.md` — Gate specification
