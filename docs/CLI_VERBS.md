# CLI Verbs & Categories Contract

**Canonical Structure:** `lex-pr <category> <action> [--flags...]`

This document defines the stable vocabulary for lexrunner commands.

---

## Core Principle

Commands follow a **category-action** structure where:
- **Category** = domain noun (what area of the system)
- **Action** = shared verb (what operation to perform)

This makes commands discoverable, consistent, and self-documenting.

---

## Categories (Domain Nouns)

| Category | Purpose | Lifecycle Phase |
|----------|---------|-----------------|
| `fanout` | Worker/issue distribution | Pre-implementation |
| `weave` | Integration pipeline (merge pyramid) | Integration-time |
| `workspace` | `.smartergpt` profile/config lifecycle | Setup/maintenance |
| `gate` | Quality checks (lint, test, policy) | Validation |
| `security` | Security scanning and guardrails | Safety |
| `safety` | Safety framework (kill switches, rollback) | Safety |
| `audit` | Audit logging and compliance | Observability |
| `ax` | AX error compliance and reporting | Observability |

---

## Actions (Shared Verbs)

These verbs have **consistent semantics** across all categories:

| Verb | Semantics | Side Effects |
|------|-----------|--------------|
| `discover` | Find candidates from external sources (GitHub, filesystem, etc.) | Read-only |
| `analyze` | Compute structure, relationships, metadata | Read-only |
| `structure` | Rewrite/normalize upstream sources to match structured spec | **Writes** (e.g., GitHub issue bodies) |
| `assign` | Bind work items to workers/agents | **Writes** (GitHub assignees, labels) |
| `plan` | Generate or inspect integration plans (only under `weave`) | Read-only |
| `run` | Execute with side effects (gates, weaves, scans) | **Writes** (git, CI, GitHub) |
| `status` | Show current state | Read-only |
| `report` | Produce human/CI-readable summary | Read-only |
| `init` | Bootstrap workspace/config/profile | **Writes** (filesystem) |
| `doctor` | Validate configuration and environment health | Read-only |
| `migrate` | Port existing config/state to newer shape | **Writes** (filesystem) |

---

## Examples (Canonical Intent)

### Fanout Domain
```bash
lex-pr fanout discover   # Find issues eligible for fanout
lex-pr fanout analyze    # Build structured specs from issues
lex-pr fanout structure  # Update issue bodies to match specs
lex-pr fanout assign     # Deterministically assign issues to workers
lex-pr fanout report     # Summarize fanout run (who got what)
```

### Weave Domain
```bash
lex-pr weave discover    # Find PRs/branches for integration
lex-pr weave plan        # Generate/refresh execution plan (plan.json)
lex-pr weave run         # Execute merge pyramid with gates
lex-pr weave status      # Show gate/merge status per node
lex-pr weave report      # Emit integration report (Markdown/JSON)
```

### Workspace Domain
```bash
lex-pr workspace init    # Bootstrap .smartergpt.local
lex-pr workspace doctor  # Check workspace/profile health
lex-pr workspace migrate # Move old layout → new structure
lex-pr workspace status  # Summarize profiles, gates, config
```

### Gate Domain
```bash
lex-pr gate run <name>       # Execute a specific gate
lex-pr gate status [--item]  # Show gate results
lex-pr gate report           # Aggregate pass/fail, durations
```

### Security Domain
```bash
lex-pr security analyze   # Analyze SARIF, secrets, command usage
lex-pr security run       # Run configured scans
lex-pr security report    # Summarize findings
```

### Safety Domain
```bash
lex-pr safety doctor   # Validate safety framework config
lex-pr safety status   # Show kill switches, guardrails state
```

### Audit Domain
```bash
lex-pr audit report    # Summarize audit events
lex-pr audit status    # Show audit log health
```

### AX Domain
```bash
lex-pr ax report       # Summarize AXError usage, codes
lex-pr ax status       # Show AX compliance level
```

---

## Current State vs Canonical Mapping

This table maps **existing commands** to their **canonical category-action** representation:

| Current Command | Canonical Form | Notes |
|-----------------|----------------|-------|
| `orchestrate:analyze-issues` | `fanout analyze` | Issue analysis for parallelization |
| `orchestrate:assign-batch` | `fanout assign` | Deterministic worker assignment |
| `orchestrate:plan-batch` | `weave discover` + `weave plan` | PR discovery + plan generation |
| `orchestrate:predict-conflicts` | `weave analyze` | Conflict prediction for weave |
| `orchestrate:generate-deliverables` | `weave report` | Deliverable generation |
| `orchestrate:pinToolchain` | `workspace doctor` (or new category) | Toolchain validation |
| `init` | `workspace init` | Workspace bootstrap |
| `doctor` | `workspace doctor` | Health checks |
| `migrateProfile` | `workspace migrate` | Profile migration |
| `plan` | `weave plan` | Plan generation |
| `discover` | `weave discover` | PR discovery |
| `status` | `weave status` | Status reporting |
| `report` | `weave report` | Report generation |

---

## Implementation Strategy

### Phase 1: Contract & Documentation (This PR)
- ✅ Define canonical structure in this doc
- ✅ Update help text to mention canonical forms
- ✅ Create mapping file for current → canonical names

### Phase 2: Aliases & Deprecation Warnings (Future PR)
- Add canonical aliases (e.g., `lex-pr fanout analyze` as alias for `orchestrate:analyze-issues`)
- Add deprecation warnings to old command names
- Update all documentation to use canonical forms

### Phase 3: Hard Migration (Future Major Version)
- Remove deprecated command names
- Make canonical forms the only supported interface
- Update all examples, tests, docs

---

## Design Rationale

**Why category-action?**
1. **Discoverability**: `lex-pr --help` can group by category
2. **Consistency**: Same verbs mean the same thing everywhere
3. **Predictability**: Users can guess command names
4. **Extensibility**: New features fit cleanly into existing categories

**Why these specific verbs?**
- Chosen for **non-overlap** (each verb has distinct semantics)
- Cover the **full lifecycle** (read-only inspection → mutation → execution)
- Match **common patterns** in other CLIs (git, kubectl, etc.)

**Why not just use `plan` as a top-level verb?**
- "Plan" is too generic and appears in multiple contexts:
  - Planning work distribution (fanout)
  - Planning integration (weave)
  - Planning project structure (workspace)
- Making it a **noun** under specific categories removes ambiguity

---

## Questions & Answers

**Q: Why keep `orchestrate` for now instead of just renaming to `fanout`?**
A: Backward compatibility. This doc establishes the contract; actual renames happen in versioned phases.

**Q: Can I add new commands?**
A: Yes, but first:
1. Choose the appropriate **category**
2. Reuse an existing **action verb** if possible
3. Update this doc with the new mapping

**Q: What if my command doesn't fit any category?**
A: That's a signal to either:
- Create a new category (requires discussion/ADR)
- Refactor the command to fit existing categories
- Question whether the command belongs in the CLI at all

---

## References

- [`AGENTS.md`](../AGENTS.md) - Agent operating principles
- [`TERMS.md`](../docs/TERMS.md) - Canonical terminology
- [`README.md`](../README.md) - User-facing command examples
