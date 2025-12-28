# ADR-001: Plan.json as Frozen Runtime Input

**Status:** Accepted
**Date:** 2025-11-25
**Authors:** lexrunner team

---

## Context

The runner needs to compute dependency order, execute gates, and merge PRs. The question: what should its input be?

Options considered:

1. **Live GitHub API** — Query PRs in real-time
2. **Issue descriptions** — Parse from GitHub Issues
3. **Frozen file** — Single JSON file that captures all needed state

---

## Decision

We adopt `plan.json` as the **single frozen runtime input** at integration time.

### Scope Clarification

- **Integration-time (Runner):** `plan.json` is the **only** input the runner reads to compute order and merges.
- **Development-time (Issues & Coding):** Implementation agents (humans/Copilot) use Issue descriptions, specs, and project principles to do the work. The runner does not constrain this phase.

### Runner Contract

```typescript
// Runner reads only plan.json
const plan = loadPlan("./plan.json");

// Runner never reads:
// - GitHub Issues directly
// - .smartergpt/ at runtime
// - Environment variables for logic (only for credentials)
```

### Plan Generation (Out of Scope)

A separate **plan generator** tool/workflow transforms Issues/PR graph into `plan.json`. This is explicitly out of scope for the runner.

---

## Consequences

### Positive

- **Deterministic** — Same `plan.json` → same decisions (modulo external state)
- **Replayable** — Can re-run with same input for debugging
- **Auditable** — Plan is a durable artifact
- **Decoupled** — Plan generation can evolve independently

### Negative

- **Two-step process** — Generate plan, then run
- **Staleness risk** — Plan can diverge from live PR state
- **Not real-time** — Changes to PRs require re-generation

---

## References

- `/AGENTS.md` — Section 2: Runner Contract
- `/docs/TERMS.md` — Plan definition
