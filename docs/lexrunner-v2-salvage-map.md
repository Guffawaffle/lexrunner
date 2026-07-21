# LexRunner v2 Salvage Map

> **Historical / superseded:** This inventory informed later in-place work but is not a current
> porting checklist. The proposed sibling v2 package was not created. Use the
> [canonical CLI/MCP surface](./architecture/canonical-cli-mcp-surface.md),
> [ADR-010](./adr/ADR-010-agent-work-orchestration-protocol.md), and current tests as authority.
>
> **Purpose:** Enumerate what should be carried from v1 to v2, what tests encode real contracts, and what stays in v1 only.
> **Status:** Historical superseded inventory
> **Date:** 2025-12-08

---

## 1. Core Primitives to Salvage

### 1.1 Topological Sort / DAG Execution

| Current Location        | Description                                      | v2 Destination    | Priority |
| ----------------------- | ------------------------------------------------ | ----------------- | -------- |
| `src/mergeOrder.ts`     | Kahn's algorithm with deterministic tie-breaking | `src/core/dag.ts` | **MUST** |
| Lines 1-146, ~150 lines | Clean, well-tested, no god-object coupling       | Direct port       | —        |

**Notes:**

- Already uses caching (`OperationCache`)
- Throws `CycleError`, `UnknownDependencyError` — compatible with AXError adapters
- Dependencies: `schema.ts` (Plan type), `performance.ts` (cache), `monitoring/metrics.ts`

### 1.2 AXError Infrastructure

| Current Location         | Description                                            | v2 Destination                     | Priority |
| ------------------------ | ------------------------------------------------------ | ---------------------------------- | -------- |
| `src/errors/index.ts`    | Re-exports from `@smartergpt/lex/errors` + error codes | `src/errors/index.ts`              | **MUST** |
| `src/errors/adapters.ts` | Domain-specific error adapters                         | `src/errors/adapters.ts` (curated) | **MUST** |

**Notes:**

- `adapters.ts` is 932 lines — too large. v2 should:
  - Keep: `gateFailedError`, `mergeConflictError`, `cycleDetectedError`, `planValidationError`
  - Migrate security adapters to separate module if security features kept
  - Remove: Weave-specific adapters if weave is simplified

**Curated list for v2:**

```typescript
// Core (MUST)
(gateFailedError,
  mergeConflictError,
  cycleDetectedError,
  unknownDependencyError,
  planValidationError,
  toAXError);

// MCP (MUST if MCP kept)
(mcpToolError, planNotFoundError, configInvalidError);

// Optional (if features kept)
(runNotFoundError, githubApiError, gitOperationError);
```

### 1.3 Frame Helpers

| Current Location        | Description                                  | v2 Destination             | Priority |
| ----------------------- | -------------------------------------------- | -------------------------- | -------- |
| `src/frames/types.ts`   | Frame type definitions, Zod schemas          | `src/adapters/lex.ts`      | **MUST** |
| `src/frames/emitter.ts` | `emitMergeWeaveFrame`, `emitGateFrame`, etc. | `src/adapters/lex.ts`      | **MUST** |
| `src/frames/storage.ts` | Local file storage                           | **DELETE** — use Lex store | —        |

**Notes:**

- Emitter logic is good; storage should delegate to Lex
- v2 should call `saveFrame()` from `@smartergpt/lex/store`

### 1.4 Receipt Helpers

| Current Location         | Description                                      | v2 Destination        | Priority |
| ------------------------ | ------------------------------------------------ | --------------------- | -------- |
| `src/receipts/schema.ts` | `ActionReceiptSchema`, `UncertaintyMarkerSchema` | `src/adapters/lex.ts` | **MUST** |
| `src/receipts/emit.ts`   | `emitActionReceipt`, `emitFailureReceipt`        | `src/adapters/lex.ts` | **MUST** |

**Notes:**

- Implements Disciplined Failure Pattern — essential for AX
- Consider whether receipts should be stored as specialized Frames in Lex

### 1.5 Canonical JSON

| Current Location            | Description                  | v2 Destination              | Priority |
| --------------------------- | ---------------------------- | --------------------------- | -------- |
| `src/util/canonicalJson.ts` | Deterministic JSON stringify | `src/util/canonicalJson.ts` | **MUST** |

**Notes:**

- Critical for determinism guarantee (AX 2.2)
- Tiny utility, direct port

### 1.6 Hash Utility

| Current Location   | Description   | v2 Destination     | Priority   |
| ------------------ | ------------- | ------------------ | ---------- |
| `src/util/hash.ts` | SHA256 helper | `src/util/hash.ts` | **SHOULD** |

**Notes:**

- Used for plan fingerprinting, lock files
- Tiny, no dependencies

### 1.7 CLI Exit Handling

| Current Location         | Description                      | v2 Destination           | Priority   |
| ------------------------ | -------------------------------- | ------------------------ | ---------- |
| `src/cli/exitHandler.ts` | `CLIExitSignal`, signal handlers | `src/cli/exitHandler.ts` | **MUST**   |
| `src/cli/output.ts`      | `writeJsonOutput`                | `src/cli/output.ts`      | **MUST**   |
| `src/cli/flags.ts`       | `parseGlobalFlags`               | `src/cli/flags.ts`       | **SHOULD** |

**Notes:**

- Exit discipline is important for AX (predictable exit codes)
- JSON output mode is AX 2.1 requirement

### 1.8 Weave State Machine (Selective)

| Current Location            | Description                                | v2 Destination      | Priority   |
| --------------------------- | ------------------------------------------ | ------------------- | ---------- |
| `src/weave/stateMachine.ts` | State transitions for weave                | `src/core/weave.ts` | **SHOULD** |
| `src/weave/types.ts`        | `WeaveState`, `WeaveEvent`, `WeaveContext` | `src/core/weave.ts` | **SHOULD** |

**Notes:**

- State machine pattern is good
- v2 should simplify: fewer states, clearer transitions
- Lock file logic may not be needed if runs are truly stateless

---

## 2. Spec-Level Tests to Salvage

### 2.1 MUST PORT — Behavioral Contracts

| Test File                         | Behavior Protected                            | Priority                    |
| --------------------------------- | --------------------------------------------- | --------------------------- |
| `tests/mergeOrder.test.ts`        | Kahn's algorithm correctness, cycle detection | **MUST PORT**               |
| `tests/ax-error-adapters.spec.ts` | AXError shape compliance                      | **MUST PORT**               |
| `tests/canonicalJson.test.ts`     | Deterministic JSON output                     | **MUST PORT**               |
| `tests/deterministic-*.test.ts`   | Same input → same output                      | **MUST PORT**               |
| `tests/weave-contract.test.ts`    | Weave behavioral guarantees                   | **MUST PORT**               |
| `tests/mcp-contracts.spec.ts`     | MCP schema validation                         | **MUST PORT** (if MCP kept) |
| `tests/schema.test.ts`            | Plan schema validation                        | **MUST PORT**               |
| `tests/receipts.spec.ts`          | Receipt emission                              | **MUST PORT**               |

### 2.2 NICE TO PORT — Useful Coverage

| Test File                         | Behavior Protected          | Priority         |
| --------------------------------- | --------------------------- | ---------------- |
| `tests/gates.test.ts`             | Gate execution, retry logic | **NICE TO PORT** |
| `tests/execution-plan-v1.test.ts` | Plan loading                | **NICE TO PORT** |
| `tests/executionState.test.ts`    | State tracking              | **NICE TO PORT** |
| `tests/mergeEligibility.test.ts`  | Merge decision logic        | **NICE TO PORT** |
| `tests/error-handling.test.ts`    | Error classification        | **NICE TO PORT** |
| `tests/cli-json.spec.ts`          | JSON output mode            | **NICE TO PORT** |
| `tests/cli-determinism.spec.ts`   | CLI determinism             | **NICE TO PORT** |

### 2.3 LEGACY ONLY — Do Not Port

| Test File                             | Reason to Leave              |
| ------------------------------------- | ---------------------------- |
| `tests/autopilot-*.spec.ts`           | Autopilot removed in v2      |
| `tests/ai-conflict-strategy*.spec.ts` | Experimental feature         |
| `tests/budget-tracker.spec.ts`        | Budget tracking removed      |
| `tests/hostility/*.spec.ts`           | Hostility scoring removed    |
| `tests/interactive-*.spec.ts`         | Interactive features removed |
| `tests/governance-*.spec.ts`          | Governance/audit separate    |
| `tests/audit-*.spec.ts`               | Audit separate concern       |
| `tests/security-*.spec.ts`            | Security may be separate     |
| `tests/tiers.spec.ts`                 | Tier system removed          |
| `tests/conflictPredictor.spec.ts`     | Experimental feature         |
| `tests/conflictClustering*.spec.ts`   | Experimental feature         |

---

## 3. Things That Stay in v1 Only

### 3.1 Modules to Leave Behind

| Module                        | Reason                                             |
| ----------------------------- | -------------------------------------------------- |
| `src/autopilot/`              | Over-engineered; replace with LexSona personas     |
| `src/ai/`                     | Experimental AI strategies                         |
| `src/budget/`                 | Belongs in caller/orchestrator                     |
| `src/hostility/`              | Nice-to-have, not essential                        |
| `src/tiers/`                  | Over-abstraction                                   |
| `src/interactive/`            | Not AX-first                                       |
| `src/orchestration/` (most)   | Batch planning, conflict prediction — experimental |
| `src/planner/fileAnalysis.ts` | Too complex, not core                              |
| `src/audit/`                  | Separate concern (may become its own tool)         |

### 3.2 Commands to Leave Behind

| Command                 | Reason                               |
| ----------------------- | ------------------------------------ |
| `lex-pr autopilot`      | Replaced by LexSona                  |
| `lex-pr senior-dev`     | Should be a procedure, not hardcoded |
| `lex-pr execute`        | Replaced by `lex-pr run`             |
| `lex-pr orchestrate *`  | Over-abstraction                     |
| `lex-pr governance-*`   | Separate concern                     |
| `lex-pr audit *`        | Separate concern                     |
| `lex-pr security *`     | Separate concern                     |
| `lex-pr idea`           | Not core                             |
| `lex-pr create-project` | Not core                             |

### 3.3 Features to Leave Behind

| Feature                        | Reason                          |
| ------------------------------ | ------------------------------- |
| 4-level autopilot              | Use LexSona constraints instead |
| Safety framework               | Over-engineered; simplify       |
| AI conflict strategies         | Experimental                    |
| Conflict prediction/clustering | Experimental                    |
| Budget tracking                | Not runner's job                |
| Tier assignment                | Over-abstraction                |
| Interactive plan review        | Not AX-first                    |
| Deliverables generator         | Separate tool                   |

---

## 4. Lex/LexSona Integration Points

### 4.1 What v2 Imports from Lex

```typescript
// Error infrastructure
import { AXErrorSchema, createAXError, wrapAsAXError } from "@smartergpt/lex/errors";

// Frame storage (v2 should use this instead of local storage)
import { saveFrame, searchFrames, getFrameById } from "@smartergpt/lex/store";

// Recall
import { recallFrames } from "@smartergpt/lex/memory";

// Types
import { FrameSchema, Frame } from "@smartergpt/lex/types";
```

### 4.2 What v2 Imports from LexSona

```typescript
// Constraint derivation
import { deriveConstraints } from "@smartergpt/lexsona";

// Persona management
import { activatePersona, getActivePersona } from "@smartergpt/lexsona";

// Connection
import { connect as connectLexSona } from "@smartergpt/lexsona";
```

### 4.3 Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LexRunner v2                              │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ CLI      │    │ Core     │    │ MCP      │              │
│  │ Entry    │───▶│ (DAG,    │◀───│ Server   │              │
│  │          │    │  Gates)  │    │          │              │
│  └──────────┘    └────┬─────┘    └──────────┘              │
│                       │                                     │
│         ┌─────────────┼─────────────┐                       │
│         ▼             ▼             ▼                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Lex      │  │ LexSona  │  │ GitHub   │                  │
│  │ Adapter  │  │ Adapter  │  │ Adapter  │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │             │             │                         │
└───────┼─────────────┼─────────────┼─────────────────────────┘
        │             │             │
        ▼             ▼             ▼
   @smartergpt/   @smartergpt/   @octokit/
      lex           lexsona         rest
```

---

## 5. Migration Utilities Needed

### 5.1 Plan Migration

```bash
# Convert v1 plan to v2 format
lex-pr migrate-plan v1-plan.json > v2-plan.json
```

### 5.2 Config Migration

```bash
# Convert .smartergpt/ v1 configs to v2
lex-pr migrate-config --dir .smartergpt
```

### 5.3 Test Migration

For each MUST PORT test:

1. Copy test file to `tests/v2/`
2. Update imports to v2 paths
3. Adjust assertions for v2 behavior
4. Remove v1-specific setup

---

## 6. Summary Statistics

| Category                       | Count           | Action            |
| ------------------------------ | --------------- | ----------------- |
| **Core primitives to salvage** | 8 modules       | Port with cleanup |
| **MUST PORT tests**            | 8 files         | Port directly     |
| **NICE TO PORT tests**         | 8 files         | Port if time      |
| **LEGACY ONLY tests**          | 15+ files       | Leave in v1       |
| **Modules to leave**           | 10+ directories | Do not port       |
| **Commands to leave**          | 10+ commands    | Do not port       |

---

## 7. Salvage Execution Order

Recommended order for porting:

1. **Foundation:**
   - `errors/index.ts` + curated adapters
   - `util/canonicalJson.ts`
   - `util/hash.ts`

2. **Core:**
   - `core/dag.ts` (from `mergeOrder.ts`)
   - `core/plan.ts` (schema v2 + loading)
   - `core/gates.ts` (simplified gate execution)

3. **Adapters:**
   - `adapters/lex.ts` (frames, receipts, recall)
   - `adapters/lexsona.ts` (constraints)
   - `adapters/github.ts` (API client)

4. **CLI:**
   - `cli/exitHandler.ts`
   - `cli/output.ts`
   - `cli/flags.ts`
   - `cli/commands/*.ts` (thin wrappers)

5. **MCP (if kept):**
   - `mcp/server.ts` (thin, delegate to core)

6. **Tests:**
   - Port MUST PORT tests first
   - Add v2-specific tests as features land

---

_Document prepared by Opie (Senior Dev) for Guff review._
_Next: Phase 4 — Migration Plan_
