# LexRunner Principles

> **Status:** Normative design guidance
>
> **Applies to:** orchestration, receipts, verification, recovery, delivery, and ecosystem boundaries

## Leave the work better than you found it

Every execution should advance the work or improve the position of whoever continues it.

This principle adapts a family mantra from Joseph Gustavson's mother:
“Leave a room better than you found it.” Its provenance is part of the principle, not generic
product language.

For LexRunner, the operational form is:

> **Successful executions advance the work. Failed executions improve the next attempt.**

This is cumulative intelligence: an execution does not become valuable merely because a worker ran
or a log exists. Its value must survive the execution as an inspectable improvement to the work.

## Precise terms

### Fail forward

To **fail forward** is to preserve a failure's lesson in a form that can change a later decision or
attempt. Failure is not automatically progress. A failure with no retained lesson is loss, and the
system should say so honestly.

The _Re:Zero_ “Return by Death” analogy is explanatory lineage, not a protocol dependency: another
attempt matters because the learning survives the reset. The cost of failure remains real.

### Durable delta

A **durable delta** is an inspectable change left by a terminal execution. At least one of these may
qualify when it is bound to the work and usable by a successor:

- an artifact or recovery point;
- independently observable evidence;
- a decision with rationale;
- an eliminated hypothesis;
- narrowed uncertainty;
- or an actionable escalation with explicit next steps.

Activity, token spend, an unverified worker claim, or an unbounded transcript is not a durable delta
by itself. A log qualifies only when it is retained as bounded evidence that can support a decision,
verification, recovery, or retry.

### Retry delta

A **retry delta** is the meaningful, recorded premise that differs from the previous attempt. It may
be new evidence, a changed strategy or input, a repaired environment, a different authority grant,
a different worker/runtime selection, or a reason the same operation is now expected to behave
differently.

A retry without a retry delta is blind replay. LexRunner must not describe blind replay as recovery.
It should reject it, require an explicit policy exception, or record honestly that the system is
repeating rather than learning.

## Design-review test

For any execution path, ask:

> **After this execution ends—even if it fails—is the work better positioned than before it began,
> and what evidence proves that?**

If the answer cannot name an inspectable durable delta, the path does not yet satisfy this principle.
If a retry cannot name its changed premise, it is repetition rather than fail-forward behavior.

## Evidence chain

The principle does not weaken LexRunner's distinction between claims and truth:

1. A worker receipt records what the worker claims happened.
2. Canonical receipt sets preserve relevant attempt evidence, including unsuccessful work.
3. Engine verification records independently observed outcomes.
4. Reconciliation compares durable state with external reality before repeating side effects.
5. Recovery or retry records the inherited evidence and the changed premise.
6. Delivery advances only from accepted verification or an explicit, audited override.

A successful exit without accepted evidence may still leave useful information, but it is not a
verified delivery. A failed exit may improve the next attempt, but it is not retroactively a
success.

## Ecosystem responsibilities

The principle is shared conceptually without blurring repository ownership:

| Component     | Responsibility                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Lex**       | Preserve deliberate, high-signal work continuity so later sessions can recover what mattered without replaying transcripts. |
| **LexRunner** | Ensure attempts, verification, recovery, and integration advance the work or improve the next attempt.                      |
| **AXF**       | Expose bounded capabilities and structured outcomes without silently expanding authority or agent context.                  |
| **Lex-MCP**   | Transport the applicable Lex surface into MCP hosts without inventing storage, identity, or authorization semantics.        |
| **LexSona**   | Derive reviewed behavioral constraints and guidance without becoming an execution authority.                                |

Receipts, engine verification, reconciliation, recovery, and delivery are LexRunner responsibilities;
they are not separate ecosystem products.

## Executable obligations

This document defines design invariants. It does not silently change persisted schemas. The
corresponding executable work and proof surfaces are tracked explicitly:

- [#766](https://github.com/Guffawaffle/lexrunner/issues/766): canonical receipt sets and durable packet references;
- [#762](https://github.com/Guffawaffle/lexrunner/issues/762): immutable engine verification persistence;
- [#767](https://github.com/Guffawaffle/lexrunner/issues/767): incomplete launch-envelope reconciliation;
- [#699](https://github.com/Guffawaffle/lexrunner/issues/699): merge-weave resume from persisted state;
- [#794](https://github.com/Guffawaffle/lexrunner/issues/794): runtime-enforced authority ceilings;
- [#801](https://github.com/Guffawaffle/lexrunner/issues/801): implemented headless reconciliation,
  fail-forward supervision, and memory/SQLite retry-delta enforcement;
- [#802](https://github.com/Guffawaffle/lexrunner/issues/802): evidence-preserving fan-out/fan-in; and
- [#799](https://github.com/Guffawaffle/lexrunner/issues/799): fault-injected ecosystem dogfood and durable-delta acceptance.

Adaptive model budgeting in [#760](https://github.com/Guffawaffle/lexrunner/issues/760) remains a
later consumer of engine-owned evidence; it must not infer value from worker claims alone.

## Non-goals

- Claiming every failure is valuable.
- Retrying until a desired answer appears.
- Treating more workers or more context as progress by itself.
- Preserving full conversations when a bounded artifact or decision is sufficient.
- Weakening verification, authority, or reproducibility to manufacture a successful outcome.
