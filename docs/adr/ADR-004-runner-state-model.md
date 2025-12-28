# ADR-004: Runner State Model

**Status:** Accepted
**Date:** 2025-11-25
**Authors:** lexrunner team

---

## Context

The runner processes multiple plan items, each with multiple gates. The question: what states can an item be in, and what do they mean?

---

## Decision

We adopt a five-state model for plan items:

### State Definitions

| Status     | Meaning                                              | Merge Eligible? |
| ---------- | ---------------------------------------------------- | --------------- |
| `pass`     | All required gates passed                            | ✅ Yes          |
| `fail`     | One or more required gates failed                    | ❌ No           |
| `blocked`  | A dependency failed/blocked; node not executed       | ❌ No           |
| `skipped`  | Policy or config excludes gates for this node        | ❌ No           |
| `retrying` | Gate marked retryable; attempt in progress (bounded) | ❌ No           |

### Key Distinctions

**`blocked` vs `fail`:**

- `fail` = This node's gates ran and failed
- `blocked` = This node's gates didn't run because a dependency failed

This distinction prevents cascading noise when an early gate fails.

**`skipped` vs `blocked`:**

- `skipped` = Intentionally excluded by policy
- `blocked` = Would have run but couldn't

### State Transitions

```
pending → pass      (all required gates pass)
pending → fail      (any required gate fails)
pending → blocked   (dependency fails/blocks)
pending → skipped   (policy excludes)
fail → retrying     (retry policy triggers)
retrying → pass     (retry succeeds)
retrying → fail     (retries exhausted)
```

---

## Consequences

### Positive

- **Clear semantics** — Each state has distinct meaning
- **Dependency tracking** — `blocked` propagates cleanly
- **Retry support** — `retrying` enables bounded retry policies

### Negative

- **Complexity** — Five states vs simpler pass/fail
- **UI burden** — Must display all states clearly

---

## References

- `/AGENTS.md` — Section 4: Merge Pyramid & Ordering Rules
- `/src/schema.ts` — ItemStatus type
