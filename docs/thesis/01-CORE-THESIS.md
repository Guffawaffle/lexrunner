# 01 — Core Thesis: Coordination Cost Compression

> **TL;DR:** The value of a cognitive architecture lives in governance and shared language, not model capability. We're compressing coordination costs, not amplifying intelligence.

---

## The Central Claim

> **Governance, contracts, and shared language reduce the delta between models and make handoffs cheaper.**

This is the core insight that drives everything in this thesis. It's counterintuitive because the AI industry is obsessed with capability amplification — more parameters, longer context, better reasoning.

We're playing a different game.

---

## What We Mean by "Coordination Cost"

When multiple agents (human or AI) work on a shared problem, they incur costs:

| Cost Category          | Description                            | Example                                         |
| ---------------------- | -------------------------------------- | ----------------------------------------------- |
| **Onboarding**         | Getting a new participant up to speed  | "Let me explain the codebase structure..."      |
| **Re-synchronization** | Restoring context after interruption   | "Where were we? Oh right, the auth refactor..." |
| **Disambiguation**     | Clarifying terms, expectations, intent | "When you say 'module' do you mean ESM or..."   |
| **Verification**       | Confirming work meets expectations     | "Did you run the tests? Which tests?"           |
| **Recovery**           | Handling misunderstandings or errors   | "That's not what I meant, let me rephrase..."   |

In human teams, we reduce these costs through:

- Shared vocabulary (domain language)
- Written contracts (specs, ADRs)
- Established norms (commit style, review process)
- Institutional memory (wikis, runbooks)

**The same patterns work for AI agents.**

---

## The "Model Strength" Trap

The obvious approach to improving AI productivity is: use stronger models.

```
Stronger Model → Better Output → Higher Productivity
```

This works... until it doesn't.

### Problems with Capability-First Thinking

1. **Diminishing returns:** The jump from GPT-3 to GPT-4 was dramatic. The jump from GPT-4 to GPT-5 is incremental. We're on the flat part of the curve.

2. **Cost scaling:** Stronger models cost more per token. 10x improvement means 10x cost increase. The economics don't scale.

3. **Context amnesia:** Stronger models still reset between sessions. You pay the onboarding cost every single time.

4. **Prompt fragility:** Stronger models need more careful prompting. The coordination cost with the human goes up.

5. **Integration complexity:** Stronger models don't automatically integrate with your tooling, codebase, or workflow.

### The Alternative

What if we could:

- Make any reasonably capable model productive in our environment
- Reduce the cost of switching between models
- Preserve context across sessions
- Make expectations explicit and machine-readable
- Treat failures as data points, not disasters

That's coordination cost compression.

---

## The Portable Architecture

The architecture is "portable" in several senses:

### Portable Across Models

A well-governed agent session can be handed off between:

- GPT-4 and Claude
- Sonnet and Haiku
- Today's model and next year's model

The governance, contracts, and receipts travel with the session.

### Portable Across Providers

Nothing in the architecture is provider-specific:

- No OpenAI-specific features
- No Anthropic-specific memory
- No vendor lock-in

### Portable Across Sessions

Context survives session boundaries:

- Frames capture episodic memory
- Receipts record what happened
- Contracts define expectations

### Portable Across Repositories

The same primitives work in any codebase:

- Rule files travel with the repo
- Contracts are project-scoped
- Memory is workspace-local

---

## What the Architecture Actually Is

The Portable Cognitive Architecture consists of:

### 1. Governance Primitives

Machine-readable expectations that define:

- What the agent can do
- What it cannot do
- What it should do when uncertain
- How to record what happened

### 2. Role Definitions

Explicit scoping of agent capabilities:

- Senior: Plan, design, decide
- Mid: Implement, refactor
- Junior: Instrument, verify, lint

### 3. Contracts

Formal agreements between human and agent:

- Scope boundaries
- Acceptance criteria
- Uncertainty protocols
- Escalation paths

### 4. Receipts

Structured records of:

- Decisions made
- Actions taken
- Rationale provided
- Outcomes observed

### 5. Shared Language

Consistent terminology that:

- Reduces disambiguation cost
- Survives model switches
- Travels with the project

---

## Why This Works

### The "Shared Language as State" Principle

> The "state" of an agent session is the shared language, expectations, governance primitives, and receipts — not latent vectors or hidden cache.

When a model knows:

- What terms mean in this context
- What patterns are expected
- What constraints are in place
- What already happened

...it doesn't matter which model it is.

### The "Delta Reduction" Effect

Consider two models with capability levels:

- Model A: 85/100
- Model B: 75/100

Without governance:

- Effective output A: 60/100 (capability × coordination efficiency)
- Effective output B: 50/100

With governance:

- Effective output A: 80/100
- Effective output B: 70/100

**The governance raised both, but Model B got a bigger boost.** The delta between them shrunk.

This is why you can use cheaper models for simpler tasks without losing too much.

### The "Turn Cost" Economic Model

We've found that Turn Cost — the overhead of each interaction — is more economically important than token cost.

```
TurnCost = Latency + ContextReset + PromptRenegotiation + TokenBloat + AttentionSwitch
```

A high-token, low-turn workflow (agent does lots of work per interaction) beats a low-token, high-turn workflow (constant back-and-forth).

Governance reduces Turn Cost by:

- Reducing context reset (receipts)
- Reducing prompt renegotiation (contracts)
- Reducing disambiguation (shared language)

---

## What This Is Not

### Not Prompt Engineering

This is not about clever prompting tricks. Prompts are ephemeral; governance is structural.

### Not Fine-Tuning

We're not modifying the model. We're modifying the environment around the model.

### Not AGI

We're not claiming this produces general intelligence. We're claiming it produces reliable, economical agent collaboration on bounded tasks.

### Not Magic

This doesn't make bad models good. It makes good-enough models productive.

---

## The Practical Implication

If this thesis is correct, then:

1. **Investment priority:** Invest in governance infrastructure before chasing the latest model.

2. **Cost optimization:** Use capability-appropriate models for each task tier.

3. **Session design:** Design for low turns and high governance, not high prompts and low structure.

4. **Failure handling:** Treat failures as coordination breakdowns, not model failures.

5. **Portability:** Avoid vendor lock-in; governance should travel with the work.

---

## Open Questions

Things we don't know yet:

1. **Governance overhead:** At what point does governance cost exceed its benefits?

2. **Model floor:** What's the minimum model capability for this to work?

3. **Domain variance:** Do different domains (code, writing, analysis) need different governance patterns?

4. **Scaling limits:** Does this approach work for teams of 10 agents? 100?

5. **Adversarial settings:** What happens when an agent deliberately games the governance?

---

## Summary

The Portable Cognitive Architecture is not about making AI smarter. It's about making AI collaboration cheaper.

**Core insight:** Governance, contracts, and shared language reduce the delta between models and make handoffs cheaper.

**Key metric:** Turn Cost, not token cost.

**Key primitive:** The contract — explicit, machine-readable, project-scoped expectations.

**Key benefit:** Portability across models, providers, sessions, and repositories.

---

_Next: [02-TURN-COST.md](./02-TURN-COST.md) — Formal definition of Turn and Turn Cost_
