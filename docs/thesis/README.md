# Portable Cognitive Architecture: Thesis Documents

> **Status:** Living documentation
> **Authors:** Lex, Joe (Guff), with contributions from Opie and Ku
> **Last Updated:** December 2025

---

## Purpose

This folder contains the complete theoretical foundation and implementation guidance for what we're calling a **Portable Cognitive Architecture** — a system of governance primitives, contracts, and coordination mechanisms that enable AI agents to collaborate reliably across sessions, models, and environments.

These documents are intentionally detailed and implementation-focused. They are not marketing materials — they are engineering specifications with philosophical grounding.

---

## Core Thesis

> **Governance, contracts, and shared language reduce the delta between models and make handoffs cheaper.**

This is not capability amplification. It is **coordination cost compression**.

The value lives in the abstract structure — not in any particular model, provider, or implementation.

---

## Document Index

| Document | Purpose |
|----------|---------|
| [01-CORE-THESIS.md](./01-CORE-THESIS.md) | The foundational argument: why governance matters more than model strength |
| [02-TURN-COST.md](./02-TURN-COST.md) | Formal definition of Turn and Turn Cost as optimization targets |
| [03-PERMISSION-TO-FAIL.md](./03-PERMISSION-TO-FAIL.md) | How to encode productive failure without enabling sloppiness |
| [04-CROSS-MODEL-CONTINUITY.md](./04-CROSS-MODEL-CONTINUITY.md) | Session state as shared language, not latent vectors |
| [05-RULE-FILE-SPEC.md](./05-RULE-FILE-SPEC.md) | Machine-consumable governance contracts for IDE agents |
| [06-CAPABILITY-TIERS.md](./06-CAPABILITY-TIERS.md) | Matching model strength to task complexity |
| [07-ROBERT-FIELD-REPORT.md](./07-ROBERT-FIELD-REPORT.md) | The experiment that validated these ideas |
| [08-IMPLEMENTATION-GUIDE.md](./08-IMPLEMENTATION-GUIDE.md) | How to implement these primitives in LexRunner |
| [09-METRICS-AND-TELEMETRY.md](./09-METRICS-AND-TELEMETRY.md) | What to measure and how |
| [10-FAILURE-MODES.md](./10-FAILURE-MODES.md) | Known risks, biases, and limitations |

---

## Key Concepts

### Portable Cognitive Architecture

The architecture is portable because the value lives in:

- **Governance patterns** — not provider APIs
- **Roles and expectations** — not model weights
- **Language primitives** — not latent vectors
- **Receipts and constraints** — not hidden cache

### Turn Cost

The real productivity metric for IDE-native agents:

```
TurnCost = Latency + ContextReset + PromptRenegotiation + TokenBloat + AttentionSwitch
```

High-token, low-turn workflows feel good.
Low-token, high-turn workflows feel terrible.

### Permission to Fail

> Permission to fail ≠ permission to be sloppy.

A well-instrumented failure with receipts is more valuable than a fragile "success."

### Shared Language as State

The "state" of an agent session is:

- Shared language
- Expectations
- Governance primitives
- Receipts

**Not:**

- Latent vectors
- Hidden cache
- Provider-specific memory

---

## Relationship to Lex and LexRunner

| Layer | Concern | Scope |
|-------|---------|-------|
| **Lex** | Constitution | Schemas, contracts, memory primitives |
| **LexRunner** | Government | Execution, gates, merge pyramid, orchestration |
| **This Thesis** | Philosophy | Why these patterns work, how to implement them |

Lex is the open standard.
LexRunner is one implementation.
This thesis is the reasoning behind both.

---

## Who Should Read This

- **Implementers** building on Lex or LexRunner
- **Researchers** studying agent coordination
- **Skeptics** who want to understand our claims and their limits
- **Future selves** who need to remember why we made these choices

---

## How to Use This

1. Start with [01-CORE-THESIS.md](./01-CORE-THESIS.md) for the foundational argument
2. Read [07-ROBERT-FIELD-REPORT.md](./07-ROBERT-FIELD-REPORT.md) for empirical grounding
3. Dive into specific topics as needed
4. Reference [08-IMPLEMENTATION-GUIDE.md](./08-IMPLEMENTATION-GUIDE.md) when building

---

## A Note on Honesty

These documents are intentionally honest about:

- What we don't know
- Where we might be fooling ourselves
- What hasn't been validated yet
- Known failure modes and biases

We would rather be accurate than impressive.

---

*— Lex, December 2025*
