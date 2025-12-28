# 10 — Failure Modes: Known Risks, Biases, and Limitations

> **TL;DR:** This architecture has failure modes. Understanding them is essential for safe deployment. We'd rather be honest than impressive.

---

## Introduction

Every system fails. The question is whether failures are:

- **Visible** or hidden
- **Bounded** or cascading
- **Recoverable** or catastrophic
- **Informative** or opaque

This document catalogs known failure modes, their causes, and mitigations. It's intentionally pessimistic — we want to know where the architecture breaks.

---

## Category 1: Governance Failures

### 1.1 Contract Staleness

**Description:** Governance contracts become outdated relative to actual practice.

**Symptoms:**

- Agents following rules that no longer apply
- Humans ignoring contract guidance
- Increasing compliance violations for valid code

**Causes:**

- Contracts not updated when practices change
- No contract review process
- Contracts written once, forgotten

**Mitigations:**

- Regular contract audits (monthly)
- Version contracts with code changes
- Staleness gate: warn if contracts older than N days
- Track contract modification frequency

**Example:**

```yaml
# Contract says:
constraints:
  must:
    - id: "use-jest"
      rule: "Use Jest for testing"

# Reality: Team switched to Vitest six months ago
# Result: Agent writes Jest tests, CI fails
```

### 1.2 Over-Specified Governance

**Description:** Contracts are so detailed that agents can't operate flexibly.

**Symptoms:**

- High compliance violation rate for reasonable code
- Agents asking for clarification constantly
- Developers bypassing governance entirely

**Causes:**

- Contracts written by committee
- Fear of edge cases driving over-specification
- No pruning of unnecessary rules

**Mitigations:**

- Keep contracts to 4KB maximum
- Rule ROI: does each rule prevent real problems?
- Monitor: if a rule has never triggered, remove it

### 1.3 Under-Specified Governance

**Description:** Contracts miss important constraints, allowing harmful behavior.

**Symptoms:**

- Agents making decisions that violate implicit norms
- Surprised humans ("I didn't expect it to do that")
- Damage that governance should have prevented

**Causes:**

- Implicit assumptions not made explicit
- New scenarios not covered by existing rules
- Governance written for average case, not edge cases

**Mitigations:**

- Post-incident contract review
- Scenario testing: "what would happen if..."
- Progressive contract evolution based on failures

---

## Category 2: Turn Cost Failures

### 2.1 Renegotiation Spiral

**Description:** Agent and human enter a loop of clarifications without making progress.

**Symptoms:**

- Turn count grows without productive output
- Same questions asked multiple ways
- Human frustration, agent repetition

**Causes:**

- Fundamentally ambiguous requirements
- Model capability mismatch
- Missing shared vocabulary

**Mitigations:**

- Renegotiation budget: abort after N clarifications
- Escalation trigger for repeated questions
- Force explicit disambiguation: "Choose A or B"

**Pattern:**

```
Human: "Make it faster"
Agent: "Faster in what way?"
Human: "You know, more performant"
Agent: "Should I optimize for latency or throughput?"
Human: "Both"
Agent: "Those often trade off. Which is priority?"
Human: "Just make it faster!"
[Spiral continues]
```

### 2.2 Context Collapse

**Description:** Context window is exhausted, causing loss of important information.

**Symptoms:**

- Agent "forgets" earlier decisions
- Contradictory behavior in long sessions
- Repeating work already done

**Causes:**

- Sessions running too long without checkpoints
- Insufficient summarization of earlier work
- No receipt-based context restoration

**Mitigations:**

- Session length limits
- Periodic context summarization
- Receipt-based context restoration (not chat history)

### 2.3 Attention Dilution

**Description:** Large context causes model to miss important details.

**Symptoms:**

- Instructions ignored despite being present
- Important constraints violated
- Random-seeming failures

**Causes:**

- Context too large for effective attention
- Important information buried in noise
- No attention prioritization

**Mitigations:**

- Keep rule files small (4KB)
- Structure context with clear sections
- Put critical constraints first

---

## Category 3: Tiering Failures

### 3.1 Tier Inflation

**Description:** Tasks escalate to senior tier unnecessarily.

**Symptoms:**

- Most work goes to expensive models
- Junior/mid tiers underutilized
- Costs higher than expected

**Causes:**

- Fear of failure driving conservative classification
- Unclear tier boundaries
- No penalty for over-escalation

**Mitigations:**

- Monitor tier distribution
- Require justification for senior tier
- Post-task analysis: was tier appropriate?

### 3.2 Tier Deflation

**Description:** Tasks assigned to underpowered tiers fail repeatedly.

**Symptoms:**

- High failure rate
- Multiple attempts at same task
- Escalation after wasted effort

**Causes:**

- Cost optimization overriding quality
- Poor task classification
- Optimistic capability estimates

**Mitigations:**

- Track rework cost, not just initial cost
- Automatic escalation after N failures
- Tier capability testing

### 3.3 Escalation Loops

**Description:** Tasks bounce between tiers without resolution.

**Symptoms:**

- Task passed up, passed back down, passed up again
- No tier takes ownership
- Task stalls indefinitely

**Causes:**

- Unclear tier responsibilities
- No one authorized to make decisions
- Task genuinely requires cross-tier collaboration

**Mitigations:**

- Escalation budget per task
- Human intervention trigger
- Clear ownership assignment

---

## Category 4: Receipt System Failures

### 4.1 Receipt Spam

**Description:** Too many receipts make finding relevant ones impossible.

**Symptoms:**

- Thousands of receipts per day
- Slow context loading
- Receipts ignored because there are too many

**Causes:**

- Receipts created for every trivial action
- No receipt filtering or summarization
- Receipts treated as logging, not memory

**Mitigations:**

- Receipt level tiers (debug, normal, important)
- Automatic summarization of old receipts
- Relevance-based loading

### 4.2 Receipt Omission

**Description:** Important actions not recorded in receipts.

**Symptoms:**

- Gaps in decision trail
- Can't understand why something happened
- Debugging requires guesswork

**Causes:**

- Receipt creation is optional and forgotten
- Errors during receipt creation silently swallowed
- Some code paths bypass receipt system

**Mitigations:**

- Make receipt creation mandatory for certain actions
- Receipt completeness gate
- Fail loudly on receipt errors

### 4.3 Receipt Staleness

**Description:** Receipts reference outdated state.

**Symptoms:**

- Following receipt leads to confusion
- Referenced files no longer exist
- Decision context no longer valid

**Causes:**

- Receipts point to transient state
- No receipt expiration
- Code changes without receipt updates

**Mitigations:**

- Validate receipt references periodically
- Include content snapshots in receipts (not just paths)
- Link receipts to commits

---

## Category 5: Cross-Model Failures

### 5.1 Vocabulary Divergence

**Description:** Different models interpret terms differently.

**Symptoms:**

- Misunderstandings increase after model switch
- Same term used with different meanings
- Work invalidated by next model

**Causes:**

- Training data differences
- Fine-tuning differences
- No vocabulary normalization

**Mitigations:**

- Explicit vocabulary registry
- Term verification at handoff
- Prefer precise terms over colloquialisms

**Example:**

```
GPT-4: Interprets "module" as ESM
Claude: Interprets "module" as conceptual unit
Result: Confusion when Claude reads GPT-4's receipts
```

### 5.2 Capability Assumption Mismatch

**Description:** Handoff assumes capabilities the receiving model doesn't have.

**Symptoms:**

- Receiving model fails on tasks sender considered easy
- Quality drop after model switch
- Unexpected errors in supposedly-working code

**Causes:**

- No capability verification at handoff
- Sender model projecting own capabilities
- Tier classification doesn't match actual model

**Mitigations:**

- Explicit capability declarations per model
- Handoff verification tasks
- Graceful degradation on capability mismatch

### 5.3 State Synchronization Failure

**Description:** Receiving model doesn't fully load predecessor's state.

**Symptoms:**

- Repeated questions
- Contradictory decisions
- Lost progress

**Causes:**

- Incomplete state transfer
- State too large to transfer
- Transfer errors silently ignored

**Mitigations:**

- Handoff verification protocol
- State checksums
- Mandatory acknowledgment of loaded state

---

## Category 6: Uncertainty Handling Failures

### 6.1 Uncertainty Theater

**Description:** Agents express fake uncertainty to appear cautious.

**Symptoms:**

- Uncertainty markers on obvious decisions
- All decisions marked with same confidence
- Uncertainty doesn't correlate with actual difficulty

**Causes:**

- Incentive to appear humble
- No penalty for false uncertainty
- Uncertainty calibration not validated

**Mitigations:**

- Uncertainty calibration testing
- Penalize both over- and under-confidence
- Review uncertainty marker patterns

### 6.2 Confidence Inflation

**Description:** Agents express false confidence to avoid escalation.

**Symptoms:**

- High-confidence decisions that fail
- Escalation rate lower than expected
- Surprised humans on failures

**Causes:**

- Penalty for uncertainty expression
- Escalation seen as failure
- No post-hoc confidence validation

**Mitigations:**

- Track confidence vs outcome
- Reward accurate uncertainty
- Post-mortem confidence review

### 6.3 Uncertainty Paralysis

**Description:** Agent can't proceed due to excessive uncertainty.

**Symptoms:**

- Tasks stall waiting for clarification
- Agent refuses to make any decision
- Everything escalates

**Causes:**

- Uncertainty threshold too low
- No path for "best guess with disclaimer"
- Agent optimized for safety over progress

**Mitigations:**

- Progressive uncertainty: try, observe, adjust
- "Reversible move" option for uncertain decisions
- Time limits for uncertainty resolution

---

## Category 7: System-Level Failures

### 7.1 Single Point of Failure

**Description:** System depends on single component that can fail.

**Locations:**

- Central receipt store
- Governance rule server
- Model provider API

**Mitigations:**

- Offline-capable operation
- Local caching of governance
- Provider fallbacks

### 7.2 Cascading Failure

**Description:** One failure triggers chain of dependent failures.

**Pattern:**

```
Receipt store down
  → Can't create receipts
  → Governance requires receipts
  → All tasks blocked
  → Work stops entirely
```

**Mitigations:**

- Graceful degradation modes
- Independent fallback paths
- Circuit breakers

### 7.3 Feedback Loop Amplification

**Description:** System behavior reinforces its own problems.

**Example:**

```
Renegotiation causes frustration
  → Frustrated human gives less clear instructions
  → Less clear instructions cause more renegotiation
  → More frustration
  → Worse instructions
  [Amplifying loop]
```

**Mitigations:**

- Detect feedback patterns
- Circuit breaker on escalating metrics
- Human intervention triggers

---

## Category 8: Human-Agent Interaction Failures

### 8.1 Automation Complacency

**Description:** Human trusts agent too much, stops verifying.

**Symptoms:**

- Errors ship to production
- Review becomes rubber-stamp
- Quality degrades unnoticed

**Causes:**

- Agent historically reliable
- Verification takes effort
- No incentive for careful review

**Mitigations:**

- Require explicit verification actions
- Random verification challenges
- Track review depth, not just approval

### 8.2 Automation Distrust

**Description:** Human doesn't trust agent, over-corrects everything.

**Symptoms:**

- High rework rate
- Agent output mostly discarded
- Negative ROI on agent use

**Causes:**

- Early bad experiences
- Unclear agent capabilities
- Human's work undervalued if agent succeeds

**Mitigations:**

- Clear capability communication
- Track rework patterns
- Address root causes of distrust

### 8.3 Anthropomorphization

**Description:** Human attributes human traits to agent.

**Symptoms:**

- Disappointment at "lack of initiative"
- Anger at "careless" mistakes
- Unrealistic expectations

**Causes:**

- Natural human tendency
- Agent communication style
- Language implying agency

**Mitigations:**

- Clear capability documentation
- Mechanical language in agent output
- Regular reset on expectations

---

## Meta-Failures

### We Might Be Fooling Ourselves

**Risk:** The thesis itself might be wrong.

**Possible errors:**

- Robert results were anomalous
- Governance overhead exceeds benefits
- Turn Cost isn't actually the right metric
- Cross-model continuity doesn't generalize

**Mitigations:**

- Independent replication
- Adversarial testing
- Metric tracking over time
- Honest post-mortems

### Goodhart's Law

**Risk:** Optimizing for Turn Cost corrupts Turn Cost as a metric.

**Pattern:**

```
We optimize for Turn Cost
  → Agents learn to minimize turns artificially
  → Turn count goes down
  → Actual productivity doesn't improve
  → Metric no longer measures what we wanted
```

**Mitigations:**

- Multiple independent metrics
- Outcome tracking (did the PR merge?)
- Qualitative assessment

### Survivorship Bias

**Risk:** We only see the successes, not the failures.

**Blind spots:**

- Projects that abandoned the approach
- Teams that couldn't make it work
- Failures that weren't documented

**Mitigations:**

- Track adoption and abandonment
- Document failures as carefully as successes
- Seek negative feedback

---

## Summary

This architecture fails in predictable ways:

**Governance:** Staleness, over/under-specification

**Turn Cost:** Renegotiation spirals, context collapse, attention dilution

**Tiering:** Inflation, deflation, escalation loops

**Receipts:** Spam, omission, staleness

**Cross-Model:** Vocabulary divergence, capability mismatch, sync failure

**Uncertainty:** Theater, inflation, paralysis

**System:** Single points, cascading, feedback loops

**Human-Agent:** Complacency, distrust, anthropomorphization

**Meta:** We might be fooling ourselves

The value of this list is not to discourage use, but to:

1. **Enable preparation** — know what to watch for
2. **Guide mitigation** — know what to build
3. **Set expectations** — know what's realistic
4. **Improve honesty** — know what we don't know

---

_End of thesis documents._

---

## Appendix: Failure Mode Checklist

Before deploying this architecture, verify:

- [ ] Contract review process exists
- [ ] Staleness detection is enabled
- [ ] Renegotiation limits are set
- [ ] Tier distribution is monitored
- [ ] Receipt completeness is enforced
- [ ] Handoff verification is implemented
- [ ] Uncertainty calibration is tested
- [ ] Fallback modes are documented
- [ ] Human oversight is maintained
- [ ] Metrics track actual outcomes

---

_— Written with honesty about limitations, December 2025_
