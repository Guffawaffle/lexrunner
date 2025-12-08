# LexRunner v2 Contract

> **Purpose:** Define what LexRunner v2 is, what it does, what it guarantees, and what it does not do.
> **Status:** Draft for Guff sign-off
> **Date:** 2025-12-08
> **Version:** Draft 0.1

---

## 1. Purpose

**LexRunner v2 is a thin, AX3-compliant DAG executor that reads Lex contracts, runs gates, and emits Frames/Receipts under LexSona-derived constraints.**

In one sentence:
> Runner v2 is the **execution engine** of the Lex constitution. It does not store memory, derive rules, or hold state beyond a single run. It orchestrates tools and reports outcomes.

### Metaphor

```
Lex = Constitution + Memory (stores Frames, resolves policy, provides recall)
LexSona = Behavioral Constraints (personas, rules, constraint derivation)
LexRunner v2 = Government (executes DAGs, enforces constraints, emits receipts)
```

Runner v2 is **stateless between runs**. All persistent state lives in Lex.

---

## 2. Inputs

### 2.1 Required Inputs

| Input | Source | Description |
|-------|--------|-------------|
| **Plan** | `plan.json` or generated | The DAG of items to execute (Schema v2) |
| **Lex connection** | `LEX_DB_PATH` or API | Memory store for Frames, Receipts, Recall |

### 2.2 Optional Inputs

| Input | Source | Default | Description |
|-------|--------|---------|-------------|
| CLI flags | `argv` | — | `--json`, `--dry-run`, `--profile-dir`, etc. |
| LexSona persona | `LEXSONA_PERSONA` | none | Active persona for constraint derivation |
| Environment | `process.env` | — | `GITHUB_TOKEN`, `ALLOW_MUTATIONS`, etc. |
| Config files | `.smartergpt/` | discovery | `stack.yml`, `gates.yml`, `scope.yml` |

### 2.3 Input Precedence

```
CLI flags > Environment > Config files > Lex defaults
```

All precedence is **explicit and documented**. No hidden overrides.

---

## 3. Outputs

### 3.1 Guaranteed Artifacts

| Artifact | When | Format | AX Guarantee |
|----------|------|--------|--------------|
| **Exit code** | Always | `0 \| 1 \| 2` | 2.1 Structured Output |
| **Structured output** | `--json` | JSON | 2.1 Structured Output |
| **AXError** | On failure | JSON | 2.3 Recoverable Errors |
| **Frame** | Run completion | Lex Frame | 2.5 Frame Emission |
| **Receipt** | Actions taken | Lex Receipt | Disciplined Failure |

### 3.2 Exit Code Semantics

| Code | Meaning | Recovery |
|------|---------|----------|
| `0` | Success | — |
| `1` | Operational failure (gate failed, merge conflict) | Retry or fix |
| `2` | Contract violation (schema error, policy block) | Fix input |

### 3.3 Frame Emission Contract

Every completed run emits **at least one Frame** containing:

```typescript
{
  type: "execution",
  workflow: "merge-weave" | "gate-run" | "plan-create",
  outcome: "success" | "partial" | "failed",
  summary_caption: string,
  module_scope: string[],
  status_snapshot: {
    next_action: string,
    blockers?: string[],
    merge_blockers?: string[]
  }
}
```

Frames are stored via Lex memory store, not local files.

---

## 4. AX3 Guarantees

LexRunner v2 commits to AX-CONTRACT v0.1 guarantees:

### 4.1 Structured Output (Guarantee 2.1)

| Requirement | v2 Implementation |
|-------------|-------------------|
| `--json` flag on all data-emitting commands | Enforced by CLI framework |
| MCP tools return JSON | All tools return structured responses |
| Machine format ≥ human format | JSON contains all info prose would have |

**Violation surfaces as:** Build-time check; missing `--json` fails lint.

### 4.2 Deterministic Preparation (Guarantee 2.2)

| Requirement | v2 Implementation |
|-------------|-------------------|
| Same inputs → same plan | Canonical JSON, sorted iteration, no timestamps in keys |
| Same inputs → same gate list | Order derived from topo sort (stable) |
| No hidden randomness | Explicit seed if randomness ever needed |

**Violation surfaces as:** Determinism tests fail; CI gate blocks merge.

### 4.3 Recoverable Errors (Guarantee 2.3)

| Requirement | v2 Implementation |
|-------------|-------------------|
| Errors have stable codes | `ErrorCodes` enum from Lex |
| Errors have `nextActions[]` | Every AXError adapter provides at least one |
| Exit codes are documented | See §3.2 |

**Violation surfaces as:** AXError missing `nextActions` fails schema validation.

### 4.4 Memory and Recall (Guarantee 2.4)

| Requirement | v2 Implementation |
|-------------|-------------------|
| Recall before major decisions | `lex recall` called at run start |
| Search keywords, reference_point, summary_caption | Delegated to Lex |
| Case-insensitive search | Lex responsibility |

**Violation surfaces as:** Integration test: recall finds known Frame.

### 4.5 Frame Emission (Guarantee 2.5)

| Requirement | v2 Implementation |
|-------------|-------------------|
| Merge-weave emits Frame | `emitMergeWeaveFrame()` |
| Gate runs emit Frame | `emitGateFrame()` |
| Executor runs emit Frame | `emitExecutorFrame()` |
| Frames stored in Lex | Via `@smartergpt/lex/store` |

**Violation surfaces as:** Missing Frame fails post-run validation.

---

## 5. Non-Goals (What v2 Does NOT Do)

### 5.1 Explicit Exclusions

| Non-Goal | Rationale |
|----------|-----------|
| **Store Frames locally** | Lex is the memory store |
| **Define personas or rules** | LexSona is the constraint engine |
| **Manage GitHub state** | Runner uses GitHub API, doesn't own it |
| **Provide human UX polish** | AX-first; human UX is separate concern |
| **Support arbitrary config formats** | Only Lex contract surface (lex.yaml, stack.yml, gates.yml) |
| **Run as a daemon/server** | Stateless per-run; MCP adapter is separate entry |
| **Budget/cost tracking** | Belongs in caller, not runner |
| **Interactive prompts** | Deterministic; no TTY assumptions |

### 5.2 Delegations

| Responsibility | Delegated To | Interface |
|----------------|--------------|-----------|
| Frame storage | Lex | `saveFrame()`, `searchFrames()` |
| Recall | Lex | `lex recall "topic"` or API |
| Constraint derivation | LexSona | `deriveConstraints(context)` |
| Persona management | LexSona | `activate(personaId)` |
| Rule learning | LexSona → Lex | `recordCorrection()` |

---

## 6. Extension Model

### 6.1 How New Workflows Are Added

New workflows are added by:

1. **Defining a procedure** in `lex.yaml` or `procedures/*.yml`
2. **Registering gates** in `gates.yml`
3. **Creating a plan** that references the procedure

Runner v2 does **not** get new CLI commands for every workflow. Instead:

```bash
# Generic execution of any procedure
lex-pr run --procedure merge-weave-main --plan plan.json
lex-pr run --procedure pr-review --pr 123
```

### 6.2 How New Tools Are Integrated

Tools (MCP or otherwise) are integrated by:

1. **Declaring the tool** in scope (e.g., `scope.yml` lists allowed tools)
2. **Using the tool** in gate commands or procedure steps
3. **No runner code changes** required

### 6.3 How Constraints Evolve

Constraints evolve through LexSona, not Runner:

```bash
# Learn a new rule
lexsona rules learn "Always run typecheck before test"

# Derive constraints for current context
lexsona constraints derive --domain lex-pr-runner
```

Runner consumes constraints; it does not define them.

---

## 7. Architecture Constraints

### 7.1 Module Boundaries

```
src/
  core/           # DAG execution, plan handling
    dag.ts        # Topological sort, execution loop
    plan.ts       # Plan loading, validation
    gates.ts      # Gate execution (simplified)

  adapters/       # External integrations
    lex.ts        # Lex memory store adapter
    lexsona.ts    # LexSona constraint adapter
    github.ts     # GitHub API adapter
    mcp.ts        # MCP tool adapter

  cli/            # CLI entry point
    index.ts      # Commander setup, minimal
    commands/     # One file per command (thin)

  errors/         # AXError re-exports and adapters

  mcp/            # MCP server (separate entry point)
    server.ts     # Thin, delegates to core
```

### 7.2 Size Limits

| Module | Max Lines | Rationale |
|--------|-----------|-----------|
| Any single file | 400 | Prevents god-objects |
| `core/dag.ts` | 200 | Focused on one thing |
| `cli/commands/*.ts` | 100 | Thin wrappers |
| `mcp/server.ts` | 300 | Tool dispatch only |

### 7.3 Dependency Rules

```
core/ → adapters/   ✓ (core uses adapters)
adapters/ → core/   ✗ (adapters don't import core)
cli/ → core/        ✓ (CLI calls core)
mcp/ → core/        ✓ (MCP calls core)
* → errors/         ✓ (anyone can use errors)
* → @smartergpt/lex ✓ (Lex is a peer)
* → @smartergpt/lexsona ✓ (LexSona is a peer)
```

---

## 8. CLI Surface (v2)

### 8.1 Core Commands

```bash
# Plan management
lex-pr plan create [--from-github] [--json]
lex-pr plan validate <file>
lex-pr plan show [--json]

# Execution
lex-pr run --plan <file> [--procedure <name>] [--dry-run] [--json]
lex-pr gates run [--plan <file>] [--only <gate>] [--json]

# Status
lex-pr status [--run-id <id>] [--json]
lex-pr doctor [--json]

# Configuration
lex-pr config show [--json]
```

### 8.2 Removed/Changed from v1

| v1 Command | v2 Status | Rationale |
|------------|-----------|-----------|
| `lex-pr merge apply` | Subsumed into `run` | Merge is part of weave procedure |
| `lex-pr autopilot` | Removed | Use LexSona personas |
| `lex-pr senior-dev` | Removed | Define as procedure |
| `lex-pr orchestrate *` | Removed | Over-abstraction |
| `lex-pr governance-*` | Removed | Audit is separate concern |
| `lex-pr execute` | Replaced by `run` | Single execution entry |

---

## 9. Schema Changes (v1 → v2)

### 9.1 Plan Schema v2

```typescript
// Changes from v1:
// - schemaVersion: "2.x.y"
// - procedure reference instead of inline gates
// - explicit Lex/LexSona integration fields

const PlanV2 = z.object({
  schemaVersion: z.string().regex(/^2\.\d+\.\d+$/),
  procedure: z.string(),           // e.g., "merge-weave-main"
  items: z.array(PlanItemV2),
  policy: PolicyV2,
  lex: z.object({
    recall: z.boolean().default(true),  // Recall before run?
    emit_frame: z.boolean().default(true)
  }).optional()
});
```

### 9.2 Backward Compatibility

- v2 runner will **not** run v1 plans directly
- Migration tool: `lex-pr migrate-plan v1-plan.json > v2-plan.json`
- v1 runner remains tagged and usable for legacy workflows

---

## 10. Testing Contract

### 10.1 Required Test Categories

| Category | Purpose | Example |
|----------|---------|---------|
| Determinism | Same input → same output | `determinism.spec.ts` |
| AXError shape | Errors have code + nextActions | `ax-error.spec.ts` |
| Frame emission | Runs emit Frames | `frame-emission.spec.ts` |
| Recall integration | Can find known Frames | `recall.spec.ts` |
| Exit codes | Correct codes for scenarios | `exit-codes.spec.ts` |

### 10.2 Test Size Limits

- Unit tests: < 50 lines each
- Integration tests: < 200 lines each
- No test should require real GitHub API (mock or skip)

---

## 11. Open Questions for Guff

Before implementation begins, clarification requested on:

1. **Top 2-3 workflows for v2 initial scope?**
   - Suggested: merge-weave, single-gate-run, plan-create
   - Others deferred to v2.1+

2. **Breaking changes tolerance?**
   - v2 is a new major version; can we freely reshape CLI/schema?
   - Or must we provide compat shims?

3. **CLI name:**
   - Keep `lex-pr` / `lex-pr-runner`?
   - Or rename to `lexrun` / `lex run`?

4. **MCP server fate:**
   - Keep as separate entry point?
   - Merge into CLI (`lex-pr serve --mcp`)?

---

## Signatures

**Guff (Human)**
[pending review]

**Opie (Claude Opus 4 — Senior Dev)**
I have drafted this contract based on reconnaissance of v1 and the AX-CONTRACT v0.1 requirements. It represents my best understanding of what v2 should be. I commit to revising based on Guff's feedback.

[signed Opie ✶]
Date: 2025-12-08

---

*Next: Phase 3 — Salvage Map*
