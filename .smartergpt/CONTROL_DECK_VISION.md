# Control Deck Vision — LexRunner as Starship Command Console

> **Status:** Vision Document (not roadmap)
> **Context:** Following Lex 1.0.0 release and "Control Deck" site branding
> **Purpose:** Channel inspiration into realistic, prioritized action
> **Current Version:** LexRunner 0.5.0 (3,327 tests passing)

---

## The Spark

The "Control Deck" branding evokes a starship command console — not an AI overlord, but a **sophisticated instrument panel** where:

- **Modes** are like helm configurations (cruise, tactical, docking)
- **Gates** are like pre-flight checklists and status checks
- **Policy surfaces** are like mission parameters and operational envelopes
- **Receipts** are like flight data recorders (black boxes)
- **Frames** are like navigation waypoints and context markers

LexRunner, in this metaphor, is the **helm system** — it doesn't command, it *orchestrates execution* based on the contracts and guardrails defined by the Control Deck (Lex).

---

## Current State (v0.5.0) — Much More Mature Than Expected

### Test Health
- **3,327 tests passing** (98.5% pass rate)
- **5 failing tests** (HIPAA encryption edge cases)
- **23 skipped** (performance/slow tests)
- **210 test files** total

### Open Issues: 54 Total

| Category | Count | Key Issues |
|----------|-------|------------|
| **Architecture/Epics** | ~10 | #426 (Tool-Grounded), #404 (Executor), #307 (Bundle Lex) |
| **Post-0.5.0 Features** | ~15 | #389-390 (Workflows), #355-359 (Idea/Project), #367 (Orchestration) |
| **Infrastructure** | ~10 | #370-375 (Canon/Loader), #344-345 (Frame alignment) |
| **Token Optimization** | ~5 | #376 (Token Suite) |
| **Merge-Weave** | ~8 | #335 (Execute v1), #328-332 (Gates/E2E) |
| **Housekeeping** | ~6 | #347 (Directory alignment), #340 (Dry-run) |

### What's Already Working
- ✅ MCP server (`mcp-server.mjs`)
- ✅ Plan validation and topo sort
- ✅ Gate execution framework
- ✅ Merge-weave dogfood scripts
- ✅ Behavior rules schema (just added)
- ✅ Keystone issue governance (just added)
- ✅ Two-track separation (`.smartergpt/runner/`)

---

## What LexRunner Could Become

### Near-Term Reality (v0.6.0, Q1 2025)

These are **already in motion** or blocked only by execution:

1. **Tool-Grounded Run-Centric Orchestration** (Epic #426)
   - `lexrunner.startRun`, `lexrunner.getStatus`, `lexrunner.submitDecision`
   - LLMs navigate procedures, don't invent workflows ad-hoc
   - Decision points are logged, validated, auditable
   - **Status:** Spec complete, 60-65% ready, ~6-10 weeks

2. **Executor Canonicalization** (#404)
   - Jordan-mode protocol: prep → stochastic → receipt
   - Guardrail enforcement, tool budgets, frame emission
   - **Status:** Architecture defined, most work is post-0.5.0

3. **Merge-Weave Execute v1** (#335)
   - Minimal-prompt, low-token execution
   - Gates & rollback, frames & metrics
   - **Status:** Subtasks defined (#328-332), ready to execute

### Medium-Term Aspirations (v0.7+, Q2 2025)

4. **Single-Issue Runner Mode** (#390)
   - Autonomous: issue → plan → execute → PR
   - Cost-optimized for mini models ($0.15/1M tokens)
   - One-step-back regression testing
   - **Status:** Detailed spec, depends on executor infrastructure

5. **Guided Workflow Tracks** (#389)
   - MCP responses include `nextOptions`, contextual prompts
   - Rails that help agents navigate, not stumble
   - **Status:** Conceptual, good integration with run-centric

6. **Full Orchestration** (#367)
   - Single command: issue study → fanout → monitor → merge-weave → review
   - Agent pool management, cost tracking
   - **Status:** Epic defined, significant build

### Stretch Goals (v1.0+)

7. **Atlas-Aware Merge Ordering**
   - Use Lex Atlas to predict merge conflicts
   - Reorder pyramid based on module adjacency

8. **LexSona Integration**
   - Rule injection from LexSona persona research
   - Adaptive guardrails based on learned patterns

---

## Honest Prioritization Framework

### Tier 1: Immediate (Fix the 5 failing tests)

- [ ] Fix HIPAA encryption test edge cases
- [ ] Ensure CI is fully green
- [ ] Clean up stale plan.json files in root

### Tier 2: Complete 0.5.0 → Ship

- [ ] Validate all MCP tools working
- [ ] Merge pending PRs (behavior rules, keystone governance)
- [ ] Tag and release 0.5.0

### Tier 3: Foundation for 0.6.0

- [ ] Complete #335 Merge-Weave Execute v1 subtasks
- [ ] Start #404 Executor Canonicalization
- [ ] Complete #426 Phase 1 (Core Contracts)

### Tier 4: Vision Features (0.7+)

- [ ] #390 Single-Issue Runner
- [ ] #389 Guided Workflow Tracks
- [ ] Full orchestration (#367)

---

## Channeling the Inspiration

### ✅ Yes: These ideas strengthen the project

1. **Control Deck branding is powerful** — instrument panel, not command hierarchy
2. **Tool-grounded runs** align with helm metaphor — agents navigate, don't invent
3. **Receipts as black boxes** — flight data recorder for auditability
4. **Gates as pre-flight checklists** — tangible mental model

### ⚠️ Caution: Watch for these patterns

1. **Adding vision features before Tier 2-3** — ship 0.5.0 first
2. **Pursuing LexSona now** — it's research, not production
3. **Renaming in code without tests** — Control Deck branding is site-only for now

### 🛑 Stop: These would hurt the project

1. **New epics before closing existing ones** — 54 open is enough
2. **Scope creep on "cool ideas"** — vision doc exists, execute it
3. **Breaking Two-Track Separation** — core stateless, workspace portable

---

## Recommended Next Steps

### Today
1. Fix the 5 failing HIPAA tests (or skip with reason)
2. Merge pending integration branches
3. Tag v0.5.0 release

### This Week
1. Close stale issues (mark backlog/wontfix where appropriate)
2. Triage 54 → ~30 active issues
3. Prioritize #335 subtasks for 0.6.0

### This Month
1. Complete Merge-Weave Execute v1
2. Start Executor Canonicalization
3. Write ROADMAP.md with versioned milestones

### This Quarter
1. Ship 0.6.0 (tool-grounded basics, executor infrastructure)
2. Ship 0.7.0 (Single-Issue Runner, Guided Workflows)
3. Plan 1.0.0 criteria

---

## The Honest Answer

**Is the "Control Deck" vision realistic for LexRunner?**

**Yes — and closer than expected.**

The codebase is much more mature than a stale clone suggested:
- v0.5.0 (not 0.1.0)
- 3,327 tests passing (not unknown)
- MCP server working
- Merge-weave dogfooding in progress

The right move is:
1. **Ship 0.5.0** — it's ready
2. **Execute Tier 2-3** — foundation before vision
3. **Use Control Deck as lens** — prioritize what serves the metaphor

The Control Deck isn't a feature to build — it's a **framing that makes the existing architecture more approachable**.

---

## Pass-Along for Future Sessions

When you (future Copilot in Lex/LexRunner) encounter this document:

1. **Check current state** — `npm test` and `gh issue list --state open | wc -l`
2. **Verify version** — `cat package.json | grep version`
3. **Don't add new vision** — this doc is the vision; execute it
4. **Close issues before opening** — every new issue should close 2

The goal is a stable, well-tested 0.6.0 that earns the "Control Deck" name.

---

*Document created: 2025-11-28*
*Author: Copilot (Claude Opus 4.5) during site refresh session*
*Reviewed by: [pending human review]*
*Based on: Fresh clone of lex-pr-runner v0.5.0*

