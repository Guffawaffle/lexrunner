# LexRunner v1 Summary — Freeze Candidate

> **Purpose:** Document the current state of LexRunner v1, its responsibilities, god-objects, and propose a legacy tag for freezing.
> **Status:** Phase 1 deliverable for Bluefield transition
> **Date:** 2025-12-08

---

## 1. Core Responsibilities (What v1 Actually Does)

LexRunner v1 fulfills **five core responsibilities**:

### 1.1 Plan Generation & Validation

- Generates execution plans from `.smartergpt/stack.yml` or GitHub PR discovery
- Computes topological order via Kahn's algorithm (`src/mergeOrder.ts`)
- Validates plans against Schema v1 (`src/schema.ts`)

### 1.2 Gate Execution & Policy Enforcement

- Runs gates (lint, typecheck, test, etc.) with retry logic (`src/gates.ts`)
- Applies policy-based requirements and flake detection
- Produces structured gate results with artifacts

### 1.3 Merge-Weave Orchestration

- Implements the weave state machine for PR integration (`src/weave/stateMachine.ts`)
- Handles conflict detection, preflight simulations
- Lock file management for concurrent operations

### 1.4 MCP Tool Surface

- Exposes read-only tools for external orchestrators (`src/mcp/server.ts`)
- Plan creation, gate execution, status queries
- Run lifecycle management (start, status, artifacts)

### 1.5 CLI Interface

- Commander-based CLI with 30+ commands (`src/cli.ts`)
- Audit, security, autopilot, orchestration features
- JSON output mode for machine consumption

---

## 2. God-Objects Identified

The following files exceed reasonable module size and conflate multiple concerns:

| File                     | Lines     | Concerns Conflated                                                                                                    |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/mcp/server.ts`      | **1,874** | MCP tool handlers, run management, GitHub integration, frame emission, environment checks, senior-dev executor wiring |
| `src/cli.ts`             | **1,137** | Argument parsing, error handling, command registration (30+ commands), output formatting, audit lifecycle             |
| `src/runs/manager.ts`    | **926**   | Run state machine, storage, artifact tracking, status building, index management                                      |
| `src/errors/adapters.ts` | **932**   | Every error adapter for every domain (gates, weave, security, GitHub, MCP, runs)                                      |
| `src/gates.ts`           | **829**   | Gate execution, retry logic, artifact collection, security scanning, flake reporting, frame emission                  |

### Additional Complexity Accretion

- **55,795 lines** of TypeScript in `src/` alone
- **150+ test files** covering features from core to edge cases
- **50+ src directories** including orphaned/experimental modules:
  - `src/ai/` — AI conflict strategies
  - `src/autopilot/` — 4-level autonomy system
  - `src/budget/` — Budget tracking
  - `src/hostility/` — Environment hostility scoring
  - `src/orchestration/` — Batch planning, conflict prediction
  - `src/procedures/` — YAML-driven procedure loading
  - `src/tiers/` — Tier assignment for PR prioritization

---

## 3. Responsibilities by Category

### MUST exist in v2 (Core Contract)

| Responsibility             | Current Location    | Rationale                      |
| -------------------------- | ------------------- | ------------------------------ |
| Topological DAG execution  | `mergeOrder.ts`     | Fundamental to merge pyramid   |
| Gate execution loop        | `gates.ts` (subset) | Must run gates uniformly       |
| AXError compliance         | `errors/index.ts`   | AX-CONTRACT v0.1 Guarantee 2.3 |
| Frame emission             | `frames/index.ts`   | AX-CONTRACT v0.1 Guarantee 2.5 |
| Receipt emission           | `receipts/index.ts` | Disciplined Failure Pattern    |
| Structured `--json` output | `cli/output.ts`     | AX-CONTRACT v0.1 Guarantee 2.1 |

### SHOULD delegate to Lex

| Responsibility    | Currently              | Should Be                   |
| ----------------- | ---------------------- | --------------------------- |
| Frame storage     | `frames/storage.ts`    | Lex memory store API        |
| Recall / search   | `executors/seniorDev/` | Lex `recall` command        |
| Rules resolution  | `rulesResolver.ts`     | LexSona `deriveConstraints` |
| Policy validation | `lexsona/client.ts`    | LexSona shadow governance   |

### SHOULD delegate to LexSona

| Responsibility        | Currently     | Should Be                   |
| --------------------- | ------------- | --------------------------- |
| Persona activation    | env vars only | LexSona `activate`          |
| Constraint derivation | ad-hoc        | LexSona `deriveConstraints` |
| Behavioral rules      | hardcoded     | LexSona rule storage        |

### CAN be removed or simplified

| Feature                  | Rationale                                         |
| ------------------------ | ------------------------------------------------- |
| 4-level autopilot system | Overengineered; v2 should use LexSona constraints |
| AI conflict strategies   | Experimental; not core to merge pyramid           |
| Budget tracking          | Belongs in caller/orchestrator, not runner        |
| Hostility scoring        | Nice-to-have, not essential                       |
| Tier assignment          | Over-abstracted prioritization                    |
| Interactive plan review  | UX feature, not AX-essential                      |

---

## 4. Existing AXError / Frame Infrastructure

### AXError (Good Foundation)

```typescript
// src/errors/index.ts — re-exports from @smartergpt/lex
export { AXErrorSchema, createAXError, wrapAsAXError, isAXError, AXErrorException } from "@smartergpt/lex/errors";

// src/errors/adapters.ts — domain-specific adapters
export { gateFailedError, mergeConflictError, cycleDetectedError, ... };
```

**Assessment:** Solid. Re-use in v2.

### Frames (Good Foundation)

```typescript
// src/frames/index.ts
export { emitMergeWeaveFrame, emitExecutorFrame, emitGateFrame, emitProcedureFrame };
export { storeFrame, readFrame, listFrameIds };
```

**Assessment:** Good structure, but storage is local. v2 should delegate to Lex memory store.

### Receipts (Good Foundation)

```typescript
// src/receipts/index.ts
export { emitActionReceipt, emitFailureReceipt, emitDeferredReceipt };
export { ActionReceiptSchema, UncertaintyMarkerSchema };
```

**Assessment:** Implements Disciplined Failure Pattern. Keep schema, unify emission with Lex.

---

## 5. Current CLI Surface (Commands)

High-value commands to preserve semantically:

| Command                  | Purpose                         | v2 Treatment      |
| ------------------------ | ------------------------------- | ----------------- |
| `lex-pr plan create`     | Generate plan from stack/GitHub | Core              |
| `lex-pr gates run`       | Execute gates for plan          | Core              |
| `lex-pr merge apply`     | Apply merge operations          | Core              |
| `lex-pr status`          | Show plan/run status            | Core              |
| `lex-pr discover`        | Discover PRs from GitHub        | Core              |
| `lex-pr doctor`          | Environment diagnostics         | Keep (simplified) |
| `lex-pr schema validate` | Validate config files           | Keep              |
| `lex-pr config show`     | Display config precedence       | Keep              |

Lower-priority commands:

| Command                | Purpose                 | v2 Treatment         |
| ---------------------- | ----------------------- | -------------------- |
| `lex-pr autopilot`     | 4-level automation      | Rethink via LexSona  |
| `lex-pr execute`       | Run arbitrary executors | Rethink              |
| `lex-pr orchestrate *` | Batch planning          | Evaluate need        |
| `lex-pr senior-dev`    | PR review executor      | Extract to procedure |
| `lex-pr governance-*`  | Audit features          | Evaluate need        |

---

## 6. Proposed Legacy Tag

**Proposed tag name:** `lexrunner-v1-final`

**Rationale:**

- Communicates finality without "legacy" stigma
- Avoids version number confusion with npm version (currently `0.5.0`)
- Clear semantic: "This is the last v1, v2 is the future"

**Alternative considered:** `lexrunner-v1-legacy-1.0.0`

- Pro: Explicit "legacy" label
- Con: Implies a 1.0.0 release that never happened

**Recommended tag:** `lexrunner-v1-final` or `v1-freeze-2025-12`

---

## 7. Summary

LexRunner v1 proved the merge-pyramid concept and demonstrated AX-first design patterns. However:

- **God-objects** have accreted beyond maintainability
- **Responsibilities** are conflated (runner does too much)
- **LexSona integration** is shallow (env vars only)
- **Lex integration** is partial (AXError yes, memory no)

v2 should:

- Start from the AX-CONTRACT guarantees as requirements
- Delegate memory/recall to Lex
- Delegate constraints/personas to LexSona
- Keep only: DAG execution, gate running, frame/receipt emission
- Be thin enough that the god-objects cannot recur

---

## Appendix: File Size Distribution

```
Top 20 files by line count:
   1874 src/mcp/server.ts
   1137 src/cli.ts
    932 src/errors/adapters.ts
    926 src/runs/manager.ts
    829 src/gates.ts
    791 src/commands/merge.ts
    698 src/planner/fileAnalysis.ts
    662 src/security/compliance.ts
    658 src/audit/emitter.ts
    627 src/autopilot/safety/SafetyFramework.ts
    625 src/commands/execute.ts
    607 src/executors/seniorDev/core.ts
    572 src/commands/governanceReport.ts
    549 src/runs/failures.ts
    533 src/audit/signing.ts
    525 src/store/sqlite/run-store.ts
    512 src/security/secrets.ts
    511 src/commands/doctor.ts
    506 src/github/client.ts
```

Total: **55,795 lines** in `src/`

---

_Document prepared by Opie (Senior Dev) for Guff review._
_Next: Phase 2 — v2 Contract draft_
