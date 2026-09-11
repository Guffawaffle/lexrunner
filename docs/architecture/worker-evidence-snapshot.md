# Consistent worker evidence snapshots

The opt-in memory and SQLite observation stores implement
`getWorkerEvidenceSnapshot(sessionId)`. It returns the retained dispatch record,
all observations for that session and all retained terminal notification artifacts,
or `null` if there is no dispatch. It does not hide contradictory reports or
manufacture missing artifacts. Returned values are detached from store state.

Memory collection uses a synchronous protected dispatch read and copies the journal
and artifacts without an intervening await. SQLite performs all reads inside one
deferred read transaction, including on read-only connections. A concurrent WAL
writer may commit while collection is in progress; all returned data remains from
the view established by the first read. The collector does not enable WAL or change
database configuration. In other supported journal modes normal SQLite locking
applies. No schema migration or writer lock is introduced by collection itself.

The snapshot contains stored data, not a verified result. Reconciliation still
validates copied bindings, report hashes, artifact hashes and event consistency.
Missing artifacts remain absent and become explicit blockers in that assessment.
Existing store count and artifact budgets apply to API-created data; this collector
is not a new database-corruption repair or trust mechanism.

The snapshot intentionally has no capture disposition. Database consistency cannot
prove that the native queue is empty, that all provider output was captured, or
that the parent survived long enough to persist it. The host must supply that
separate input when calling `reconcileWorkerTurn`; use `unknown` unless it has an
appropriate observation. Even `drained` does not establish complete task evidence
or verified success. A snapshot is historical once collected; subsequent writes
require another collection/assessment when current evidence is needed.

Tests exercise memory scheduling, detached values, conflicts, missing artifacts,
and a real independent SQLite writer commit between the snapshot's dispatch and
journal reads. A read-only WAL reader retains the old whole view, while its next
snapshot sees the committed acknowledgment, observation and artifact together.
This is controlled local evidence, not qualified custody or a live worker trial.

Collection and pure reconciliation can now be composed directly. The existing
[receipt and verification route](worker-receipt-boundary.md) defines the next
boundary; provider receipt delivery, authoritative late-turn resolution, live
terminal conformance and qualified native workspace preparation remain separate
work. No public command, default store, release, runtime upgrade or execution grant.
