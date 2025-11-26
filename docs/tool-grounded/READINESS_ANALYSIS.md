# Tool-Grounded, Run-Centric Orchestration — Readiness Analysis

**Date:** 2025-11-26  
**Analyst:** eager-pm (with senior-dev understanding)  
**Spec:** `tool-grounded-run-centric.md` (v0.6.0+ Draft)

---

## Executive Summary

**Overall readiness: 60-65%** — LexRunner has substantial foundational infrastructure that maps naturally to the tool-grounded vision. The architecture is already moving in the right direction. Most work is about **wiring and renaming**, not fundamental redesign.

**Key finding:** The existing weave state machine, executor framework, gates infrastructure, and MCP server provide the skeleton. What's missing is the "run-centric" lifecycle wrapper that brings them together under the `lexrunner.*` MCP surface with `StatusResponse` and `NextOption` semantics.

---

## 1. Already Moving Towards This ✅

These components are **aligned with the spec** and need only minor wiring:

### 1.1 WeaveStateMachine (`src/weave/stateMachine.ts`)

**Current state:**
```typescript
export enum WeaveState {
  IDLE = 'idle',
  PLANNING = 'planning',
  COMPUTING_ORDER = 'computing_order',
  READY = 'ready',
  MERGING = 'merging',
  VALIDATING = 'validating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused'
}
```

**Alignment:**
- ✅ Explicit state machine with named states
- ✅ Event-driven transitions (`WeaveEvent` enum)
- ✅ Guard conditions support
- ✅ Pause/resume semantics
- ✅ Deterministic state tracking

**Gap:** States don't emit `nextOptions`. The machine tracks *what happened* but doesn't prescribe *what the model can do next*.

**Nudge needed:** Add a `getNextOptions(state: WeaveState): NextOption[]` mapping function.

---

### 1.2 Executor Framework (`src/executors/`)

**Current state:**
- `seniorDev/` executor with manifest, types, core logic
- Jordan-mode protocol: prep → stochastic → receipt
- Frame emission requirement
- Tool budget concept in manifest

**Alignment:**
- ✅ Three-phase execution model matches spec's lifecycle
- ✅ Manifest concept maps to `PersonaConfig`
- ✅ Frame emission is already required (receipt phase)
- ✅ Type definitions for inputs/outputs

**Gap:** Executors are executor-scoped (one PR review), not run-scoped (full merge-weave). The spec's `runId` concept wraps multiple executor invocations.

**Nudge needed:** Create `Run` lifecycle that orchestrates executors and tracks cross-step state.

---

### 1.3 Gates Infrastructure (`src/gates.ts`, `schemas/gate-report.schema.json`)

**Current state:**
- `executeGatesWithPolicy()` runs gates per item
- Gate reports have structured output (pass/fail, duration, artifacts)
- Policy-driven required/optional gates

**Alignment:**
- ✅ Uniform gate execution (local/CI parity goal)
- ✅ Structured artifacts per gate
- ✅ Policy configuration
- ✅ Schema versioning (`gate-report.schema.json`)

**Gap:** Gate failures don't produce `FailureHandlingPayload` with `recommendedActions` as `NextOption[]`.

**Nudge needed:** Wrap gate execution results in failure-handling pattern.

---

### 1.4 MCP Server (`mcp-server.mjs`)

**Current state:**
- stdio JSON-RPC 2.0 implementation (aligned with Lex)
- Tools: `plan.create`, `gates.run`, `merge.apply`, `local.init`, `profile.resolve`, `health`
- Senior-dev executor tools wired

**Alignment:**
- ✅ MCP surface exists and is functional
- ✅ Flat, namespaced tools (`plan.create` not `plan_create`)
- ✅ Aligned with LexBrain/LexMap architecture (see `DEPRECATED.md`)

**Gap:** 
- No `lexrunner.startRun` / `lexrunner.getStatus` / `lexrunner.submitDecision` / `lexrunner.listArtifacts`
- Current tools are one-shot, not run-scoped
- No `StatusResponse` return shape

**Strongly update needed:** Implement the 4 core `lexrunner.*` tools as the run-centric control surface.

---

### 1.5 Plan Schema (`schemas/plan.schema.json`)

**Current state:**
- Schema v1 with nodes, dependencies, gates, policy
- Topological ordering concept
- Admin override and block-on rules

**Alignment:**
- ✅ Plan as frozen integration input
- ✅ Dependency graph model
- ✅ Policy attachment
- ✅ Schema versioning

**Gap:** Plan is consumed but doesn't track run-time progress (which nodes executed, which blocked).

**Nudge needed:** Add `plan.progress` section or separate progress artifact.

---

### 1.6 Orchestration Module (`src/orchestration/`)

**Current state:**
- Conflict prediction and graph building
- MIS batch computation
- Agent assignment for batches
- Conflict clustering

**Alignment:**
- ✅ Batch planning infrastructure
- ✅ Dependency graph semantics
- ✅ Determinism checks

**Gap:** This is the compute layer; it doesn't expose run-lifecycle or decision points.

**Already good:** This remains internal; the spec doesn't require changing it.

---

### 1.7 Autopilot Levels (`src/autopilot/`)

**Current state:**
- 4 levels of autonomy (level1 → level4)
- Safety checks, artifact generation
- Deliverables output

**Alignment:**
- ✅ Progressive autonomy model
- ✅ Safety guards

**Gap:** Autopilot operates by level, not by procedure/mode combination.

**Nudge needed:** Map autopilot levels to procedure config or persona `forbidden` rules.

---

## 2. Gentle Nudges 🔧

These components need **minor adjustments** to align with the spec:

### 2.1 Convert WeaveState to StatusResponse

**Current:** `WeaveStateMachine` returns state enum.  
**Needed:** Return `StatusResponse` object with `state`, `summary`, `nextOptions`, `progress`, `context`.

**Implementation:**
```typescript
function getStatus(sm: WeaveStateMachine): StatusResponse {
  const state = sm.getCurrentState();
  const ctx = sm.getContext();
  return {
    runId: ctx.runId,
    state: state,
    mode: ctx.mode,
    procedure: ctx.procedure,
    summary: summarize(state, ctx),
    progress: buildProgress(ctx),
    nextOptions: getNextOptions(state, ctx),
    context: ctx.metadata,
    riskFlags: ctx.riskFlags ?? [],
    blockers: ctx.blockers ?? []
  };
}
```

**Effort:** ~2-3 days

---

### 2.2 Add PersonaConfig Loading

**Current:** Executors have inline mode configs.  
**Needed:** Load `PersonaConfig` from JSON/YAML files, attach snapshot to `StatusResponse.persona`.

**Files to create:**
- `src/personas/seniorDev.json`
- `src/personas/eagerPm.json`
- `src/personas/loader.ts`

**Effort:** ~1-2 days

---

### 2.3 Failure → NextOption Wrapping

**Current:** Gate failures throw errors or return status.  
**Needed:** Return `FailureHandlingPayload` with `recommendedActions: NextOption[]`.

**Example:**
```typescript
if (gateResult.status === 'fail') {
  return {
    error: { code: 'GATE_FAILED', message: '...', retryable: isRetryable(gate) },
    recommendedActions: [
      { action: 'retry_gate', requiresLLMDecision: false },
      { action: 'skip_gate', requiresLLMDecision: true, prompt: '...' },
      { action: 'abort_run', requiresLLMDecision: false }
    ]
  };
}
```

**Effort:** ~2-3 days

---

### 2.4 Artifact NDJSON Emission

**Current:** Artifacts are JSON files in output directories.  
**Needed:** Add `decisions.ndjson`, `failures.ndjson`, `weave_log.ndjson` formats.

**Effort:** ~1-2 days (straightforward file writing)

---

### 2.5 Issue #389 Update

**Issue:** "Transform MCP from simple I/O to guided workflow tracks with contextual prompts"

**Status:** This issue is **already aligned** with tool-grounded thinking! It proposes:
- Workflow state in responses
- Contextual prompts
- Decision points

**Nudge:** Update issue description to reference `tool-grounded-run-centric.md` spec and align vocabulary:
- "workflow.phase" → "state"
- "availableActions" → "nextOptions"
- "decisions" → decision points with `requiresLLMDecision`

**Action:** Keep open, update with spec reference, mark as "foundation for LR-060/061"

---

## 3. Strongly Updated 🔨

These components need **significant rework** or new implementation:

### 3.1 `lexrunner.*` MCP Surface (LR-060)

**Current:** No run-centric tools.  
**Needed:** Full implementation of:
- `lexrunner.startRun` – create run, return runId + initialStatus
- `lexrunner.getStatus` – return `StatusResponse`
- `lexrunner.submitDecision` – validate against `responseSchema`, update state
- `lexrunner.listArtifacts` – list/retrieve run artifacts

**This is the primary new work.** Estimate: ~3-5 days per tool (12-20 days total for the surface).

**Create new issues:**
- **LR-060**: MCP surface implementation (startRun, getStatus, submitDecision, listArtifacts)
- **LR-061**: StatusResponse + NextOption contracts
- **LR-062**: Decision point validation and decisions.ndjson emission

---

### 3.2 Run Lifecycle Manager

**Current:** No persistent run concept.  
**Needed:** `RunManager` that:
- Creates run with unique `runId`
- Stores run state (in-memory or `.lexrunner/runs/`)
- Tracks progress across state transitions
- Manages run lifecycle: created → planning → executing → completed/failed

**Create new issue:**
- **LR-063**: Run lifecycle manager implementation

---

### 3.3 Procedure Library

**Current:** Merge-weave is hardcoded; no procedure abstraction.  
**Needed:** Procedure definitions as config:
```yaml
# procedures/merge-weave-main.yaml
schemaVersion: "1.0.0"
id: "merge-weave-main"
states: [planning, gated, weaving, completed, failed]
transitions:
  planning: { PLAN_READY: gated }
  gated: { GATES_PASSED: weaving, GATES_FAILED: decision_gate_failure }
  ...
decisionPoints:
  - state: decision_gate_failure
    requiresLLMDecision: true
    prompt: "Gates failed. Retry, skip, or abort?"
```

**Create new issues:**
- **LR-066**: Procedure library and loader
- **LR-067**: `merge-weave-main` procedure definition
- **LR-068**: `pr-review` procedure definition

---

### 3.4 Tool-Grounded Mode Enforcement

**Current:** No system-level instruction for tool-grounded modes.  
**Needed:** When `mode: "senior-dev"` or `mode: "tool-grounded"`:
- Log violations when model calls git/gh directly during a run
- Emit to `failures.ndjson`
- Possibly refuse or warn

**This is the "lock" the spec describes.** Once a run is active, orchestration flows through `lexrunner.*`.

**Create new issue:**
- **LR-065**: Tool-grounded mode enforcement and violation logging

---

## 4. Obsolete / Should Close 🚫

These issues are **superseded by the tool-grounded spec** or should be re-scoped:

### 4.1 Issue #389 (Concept: Guided Workflow Tracks)

**Verdict: DO NOT CLOSE — but update significantly.**

This issue was the *precursor* to tool-grounded thinking. It should:
- Be updated to reference `tool-grounded-run-centric.md`
- Become a meta-issue linking to LR-060 through LR-068
- Mark as "design complete, implementation tracked elsewhere"

---

### 4.2 MCP `DEPRECATED.md` Note

**Current:** `src/mcp/DEPRECATED.md` says the TypeScript MCP server is deprecated in favor of `mcp-server.mjs`.

**Verdict:** The deprecation was correct for alignment with Lex architecture. However:
- The new `lexrunner.*` tools should be implemented in `mcp-server.mjs`
- The TypeScript types in `src/mcp/types.ts` are still useful for schema definitions
- Keep the deprecation note but add: "New tool-grounded tools (lexrunner.*) are implemented here."

---

### 4.3 Single Issue Runner Epic (#390)

**Verdict: Keep open, but recognize overlap.**

The Single Issue Runner concept has significant overlap with tool-grounded:
- Both use run-centric execution
- Both have state machines and idempotency
- Both track artifacts and decisions

**Recommendation:** 
- SIR could become a **procedure** within the tool-grounded framework
- Open a new issue to reconcile SIR with tool-grounded (`sir` as a procedure alongside `merge-weave-main`, `pr-review`)

---

### 4.4 Executor Canonicalization Epic (#404)

**Verdict: Keep open, but recognize it's foundational for tool-grounded.**

The executor work (EXE-001 through EXE-013) provides:
- Manifest schema → maps to `PersonaConfig`
- Jordan-mode protocol → maps to run lifecycle phases
- Frame emission → maps to artifact/receipt requirements

**Recommendation:**
- These issues are **prerequisites** for tool-grounded personas
- Add cross-reference: "Required for tool-grounded persona loading (LR-063)"

---

## 5. Implementation Roadmap

Based on this analysis, here's the recommended sequencing:

### Phase 0: Spec Finalization (Done)
- ✅ `tool-grounded-run-centric.md` created
- ✅ `tool-grounded-a-view-from-the-inside.md` created
- ✅ Readiness analysis (this document)

### Phase 1: Core Contracts (LR-060/061)
1. **LR-060**: Implement `lexrunner.startRun`, `lexrunner.getStatus` in `mcp-server.mjs`
2. **LR-061**: Define `StatusResponse` and `NextOption` Zod schemas
3. **LR-063**: Create `RunManager` for run lifecycle

**Depends on:** Nothing, can start immediately  
**Effort:** ~2-3 weeks

### Phase 2: Decision Points (LR-062/064)
1. **LR-062**: Implement `lexrunner.submitDecision` with validation
2. **LR-064**: Implement failure → `FailureHandlingPayload` wrapping
3. Add `decisions.ndjson` and `failures.ndjson` emission

**Depends on:** Phase 1  
**Effort:** ~1-2 weeks

### Phase 3: Personas (LR-063 continued)
1. Create `PersonaConfig` schema
2. Load persona configs from files
3. Attach persona snapshot to `StatusResponse`

**Depends on:** Executor work (#404)  
**Effort:** ~1 week

### Phase 4: Procedures (LR-066/067/068)
1. **LR-066**: Procedure library and loader
2. **LR-067**: `merge-weave-main` procedure
3. **LR-068**: `pr-review` procedure

**Depends on:** Phases 1-3  
**Effort:** ~2-3 weeks

### Phase 5: Enforcement (LR-065)
1. Tool-grounded mode enforcement
2. Violation logging
3. System-level instruction documentation

**Depends on:** Phases 1-4  
**Effort:** ~1 week

### Phase 6: Artifacts (LR-069)
1. **LR-069**: `lexrunner.listArtifacts` implementation
2. Artifact type schemas
3. Integration with existing gate reports

**Depends on:** Phase 1  
**Effort:** ~1 week (can parallelize with Phase 2)

---

## 6. Summary Table

| Component | Status | Action | Effort |
|-----------|--------|--------|--------|
| WeaveStateMachine | ✅ Aligned | Add `nextOptions` mapping | 2-3d |
| Executor Framework | ✅ Aligned | Wire to run lifecycle | 1-2d |
| Gates Infrastructure | ✅ Aligned | Add failure handling | 2-3d |
| MCP Server | 🔧 Nudge | Implement `lexrunner.*` | 12-20d |
| Plan Schema | ✅ Aligned | Add progress tracking | 1-2d |
| Orchestration | ✅ Aligned | No changes needed | - |
| Autopilot | 🔧 Nudge | Map levels to procedures | 2-3d |
| Run Lifecycle | 🔨 New | Implement RunManager | 3-5d |
| Procedure Library | 🔨 New | Full implementation | 10-15d |
| Persona Loading | 🔧 Nudge | Create loader and files | 3-5d |
| Enforcement | 🔨 New | Violation logging | 3-5d |
| Artifacts | 🔧 Nudge | Add NDJSON + list tool | 3-5d |

**Total estimated effort:** 6-10 weeks for full implementation

---

## 7. Recommended Next Steps

1. **Create the LR-060 through LR-069 issues** in the issue tracker
2. **Update Issue #389** with spec reference and mark as design-complete
3. **Add cross-references** to executor issues (#404-#417)
4. **Start with LR-060** (lexrunner.startRun) — it forces all the design decisions early
5. **Dogfood with senior-dev** — use the new tools for a real PR review to validate

---

*This analysis was produced by analyzing the lex-pr-runner codebase against the tool-grounded-run-centric.md specification, with the understanding that this is a foundational shift in how LLMs interact with orchestration infrastructure.*
