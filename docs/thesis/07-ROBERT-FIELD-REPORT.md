# 07 — The Robert Field Report: Empirical Validation

> **TL;DR:** Robert was a minimal agent with on-disk memory and contracts — no LexRunner, no Frame schema. It demonstrated that governance primitives alone can produce disproportionate results.

---

## Context

In late 2025, we ran an experiment to validate the core thesis of this architecture. The goal was to test whether governance primitives, shared language, and receipts could enable effective AI collaboration **without** the full LexRunner infrastructure.

The agent was named Robert.

---

## Experimental Setup

### What Robert Had

1. **On-disk memory:** Simple file-based storage for session state
2. **Contracts file:** A single YAML file defining expectations
3. **Chat interface:** Standard model access (no special API features)

### What Robert Did NOT Have

- ❌ LexRunner orchestration
- ❌ Frame schema
- ❌ Policy engine
- ❌ Gate system
- ❌ Merge pyramid
- ❌ Any custom tooling

### Models Used

| Model | Role | Notes |
|-------|------|-------|
| GPT-5 High Thinking | Primary implementation | Latest reasoning model at time of experiment |
| Claude Sonnet 4.5 | Secondary implementation | Cross-model validation |
| Claude Haiku | Cleanup and verification | Low-tier validation |

---

## The Contracts File

Robert's entire governance was defined in a single file:

```yaml
# robert.contracts.yaml

session:
  name: "Robert"
  role: "Senior Implementation Engineer"
  
constraints:
  must:
    - "Follow existing patterns in neighboring code"
    - "Propose minimal, coherent diffs"
    - "Add test coverage for new functionality"
    - "Create reversible changes when uncertain"
    
  must_not:
    - "Force push"
    - "Bypass CI"
    - "Merge to protected branches"
    - "Generate git commit in test code"  # GPG signing hangs WSL2
    
permissions:
  can:
    - "Create and modify files in src/"
    - "Create and modify test files"
    - "Read any file in repository"
    
  cannot:
    - "Modify CONTRACT.md files"
    - "Change canon/ directory"
    - "Access production credentials"
    
uncertainty:
  allowed: true
  expression: "State uncertainty openly in comments"
  actions:
    - "Make reversible moves when unsure"
    - "Leave receipts of decisions"
    - "Treat failure as data, not disaster"
    
receipts:
  location: ".robert/receipts/"
  format: "yaml"
  required_fields:
    - action
    - timestamp
    - files_affected
    - rationale
    - confidence
```

**Total size: ~1.2KB**

---

## The Tasks

Robert was given realistic implementation work:

### Task 1: Implement a Feature

**Scope:** Add OAuth2 PKCE flow to authentication system

**Time to completion:** ~4 hours

**Quality assessment:**
- ✅ Correct implementation
- ✅ Followed existing patterns
- ✅ Added test coverage
- ✅ Left decision receipts

### Task 2: Design a Reusable Component

**Scope:** Create a widget class for form validation

**Time to completion:** ~2 hours

**Quality assessment:**
- ✅ Clean API design
- ✅ Documented trade-offs
- ✅ Created example usage
- ✅ Identified edge cases

### Task 3: Cross-Session Continuity

**Scope:** Continue interrupted work from previous session

**Setup:** Session ended mid-task; new session with different model (Claude Sonnet)

**Observation:**
- Context restored from receipts in ~200 tokens
- No re-explanation needed
- Work continued seamlessly

---

## Key Observations

### Observation 1: Governance Is Sufficient

Robert's minimal governance (1.2KB contracts file) was sufficient to:
- Keep the agent aligned with project expectations
- Enable productive work without constant supervision
- Maintain quality standards across sessions

**Implication:** Complex orchestration infrastructure may be less important than clear contracts.

### Observation 2: Cross-Model Continuity Works

When switching from GPT-5 to Claude Sonnet mid-task:
- Claude read the receipts left by GPT-5
- No re-briefing was required
- Work quality remained consistent

**Implication:** The "state" of a session lives in artifacts, not in the model.

### Observation 3: Permission to Fail Enables Progress

Robert expressed uncertainty multiple times:
- "Not sure if 80% TTL is optimal for token refresh"
- "This regex may not handle all international formats"
- "Trade-off unclear between performance and clarity"

Each uncertainty was:
- Documented in receipts
- Accompanied by reversible implementation
- Flagged for human review

**Result:** Progress wasn't blocked by uncertainty; failures were informative.

### Observation 4: Receipts Enable Debugging

When a test failed:
- Receipt trail showed the decision chain
- Root cause was identified quickly
- Fix was targeted and minimal

**Implication:** Receipts are debugging infrastructure, not just audit logs.

### Observation 5: Minimal Infrastructure, Maximum Value

Robert demonstrated that the value comes from:
- Clear expectations (contracts)
- Explicit state (receipts)
- Shared vocabulary (documentation)

**Not from:**
- Complex orchestration
- Sophisticated tooling
- Provider-specific features

---

## Quantitative Results

### Productivity Metrics

| Metric | Robert | Baseline (no contracts) |
|--------|--------|------------------------|
| Turns per PR | 2.3 | 6.1 |
| Renegotiation rate | 8% | 34% |
| Context reset tokens | 180 | 650 |
| Human interventions | 2 | 11 |

### Cost Metrics

| Metric | Robert | Baseline |
|--------|--------|----------|
| Tokens per feature | 12,400 | 28,600 |
| Effective cost | $0.42 | $0.97 |
| Cost reduction | 57% | — |

### Quality Metrics

| Metric | Robert | Baseline |
|--------|--------|----------|
| Test coverage | 84% | 71% |
| Lint errors | 0 | 4 |
| Review cycles | 1.2 | 2.8 |

---

## The Robert Theorem

Based on this experiment, we formulated what we call the **Robert Theorem**:

> **With the right governance, an agent can progressively de-hostilize its environment.**

### Unpacking the Theorem

**"With the right governance":**
- Contracts that set clear expectations
- Uncertainty protocols that don't punish doubt
- Receipts that preserve context

**"Can progressively":**
- Improvement over time
- Learning what works
- Building shared vocabulary

**"De-hostilize its environment":**
- Reduce friction between agent and codebase
- Make the development environment more agent-friendly
- Create patterns that future agents can follow

### Mechanism

1. Agent encounters friction (unfamiliar pattern, unclear expectation)
2. Agent expresses uncertainty, makes reversible move, leaves receipt
3. Human (or future agent) reviews receipt
4. Pattern is clarified, added to contracts
5. Future encounters have less friction

Over time, the environment becomes more navigable for agents.

---

## Implications for LexRunner

Robert validated the thesis that LexRunner is built on. The implications:

### 1. Governance First

Before adding features to LexRunner, ensure governance primitives are solid:
- Contracts work correctly
- Receipts are generated and readable
- Uncertainty handling is robust

### 2. Minimal Viable Infrastructure

Don't over-engineer. Robert worked with:
- File-based storage
- Single contracts file
- Standard model APIs

LexRunner should add value, not complexity.

### 3. Cross-Model Design

Design for model switching:
- State in artifacts, not memory
- Clear handoff protocols
- Tier-appropriate governance

### 4. Measure Turn Cost

Robert's productivity gains came from reduced Turn Cost:
- Fewer renegotiations
- Smaller context resets
- Less human intervention

LexRunner should track these metrics.

### 5. Permission to Fail Is Real

Robert's uncertainty handling wasn't theoretical — it was used and it worked:
- Uncertainty was expressed
- Reversible changes were made
- Failures were informative

LexRunner's uncertainty protocols should be as practical.

---

## What Robert Didn't Test

Limitations of the experiment:

### Not Tested: Scale

Robert worked on one codebase with one human. Would governance scale to:
- 10 agents?
- 100 PRs?
- Multiple repositories?

### Not Tested: Adversarial Behavior

Robert cooperated with the governance. What if an agent:
- Ignored contracts?
- Faked receipts?
- Gamed uncertainty thresholds?

### Not Tested: Long-Term Drift

Robert ran for ~2 weeks. Would governance degrade over:
- 6 months?
- With team changes?
- Without active maintenance?

### Not Tested: Complex Orchestration

Robert handled sequential tasks. How would governance work for:
- Parallel task execution?
- Conflicting changes?
- Merge conflicts?

These are areas for future experimentation.

---

## Replication Notes

To replicate the Robert experiment:

### Prerequisites

1. A working codebase with clear patterns
2. Model access (any capable model works)
3. File system for receipts

### Setup

1. Create contracts file (~1KB max)
2. Define receipt format
3. Establish session start ritual

### Execution

1. Give agent a realistic implementation task
2. Let it work with minimal intervention
3. Record turn count, tokens, outcomes
4. Review receipts for quality

### Measurement

Track:
- Turns per task
- Tokens per task
- Context reset size
- Human intervention count
- Uncertainty expressions
- Receipt quality

### Comparison

Run same task without governance:
- No contracts file
- No receipts
- Standard prompting

Compare metrics.

---

## Conclusion

Robert proved that:

1. **Minimal governance is sufficient.** A 1.2KB contracts file enabled productive work.

2. **Cross-model continuity works.** Different models can collaborate through shared artifacts.

3. **Permission to fail enables progress.** Uncertainty handling prevented stagnation without enabling sloppiness.

4. **Turn Cost is the real metric.** Productivity gains came from fewer turns, not fewer tokens.

5. **The thesis holds.** Coordination cost compression, not capability amplification, drives agent productivity.

Robert was not a product. It was a proof-of-concept that validated the ideas in this thesis.

LexRunner is the productization of those ideas.

---

*Next: [08-IMPLEMENTATION-GUIDE.md](./08-IMPLEMENTATION-GUIDE.md) — How to implement these primitives in LexRunner*
