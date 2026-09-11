# Worker observation journal

The opt-in memory and SQLite observation stores extend the dispatch store with
immutable, caller-reported observations. They retain evidence after a worker is
lost or a lease expires, without relaxing the live-session gates on claims and
acknowledgments. They never change Run, Attempt, lease, worker-session, dispatch
acknowledgment, verification, acceptance or merge eligibility state.

Each observation must match an existing dispatch's session, claim, request hash
and worker identity. The store copies attempt, run, packet and envelope bindings
from that dispatch. A claimed dispatch does not prove that the provider received
the request. An observer ID is a provenance label, not authenticated identity.
These internal APIs require a trusted host to control ingestion; they are not a
public unauthenticated endpoint or an executor qualification mechanism.

The report contains a provider turn ID, reported kind (`acknowledged`, `completed`,
`failed` or `interrupted`), evidence digest and summary. The digest identifies
caller-selected evidence; this slice neither retains the underlying artifact nor
verifies its existence, authenticity or conclusions. The separate
[terminal capture API](worker-turn-evidence.md) atomically retains a notification
artifact and its derived observation; generic report insertion retains its original
caller-supplied semantics. `observationHash` hashes the
canonical input report for replay comparison. It is not a signature or independent
integrity root. Copied dispatch bindings and the original recorded time remain in
the immutable journal record.

Observation IDs are scoped to a session. Exact replay returns the original record
and recorded time, even at capacity. Reusing an ID with changed content rejects
the write. Contradictory reports with distinct IDs are retained, including reports
about turns that differ from an existing dispatch acknowledgment. Neither insertion
order nor timestamps select a winning outcome. A later reconciliation/verification
step must assess those conflicts explicitly.

`observedAt` and `recordedAt` are supplied by the host caller, not authenticated
provider clocks. Observation time cannot precede the dispatch claim, and recorded
time cannot precede observation time. Reports may arrive out of order. Replay does
not replace the original recorded time. These consistency checks do not prove
clock accuracy or liveness.

There are at most 128 entries per session and 8,192 UTF-16 code units per summary.
New observation and observer IDs are limited to 256 code units. Canonical session,
worker and provider turn identities preserve the existing unrestricted domains;
this is not a total-byte quota. Capacity failure is explicit and does not evict
history. The future ingestion layer must apply transport byte budgets and provide
an explicit overflow/recovery path rather than silently dropping events.

SQLite writes use the shared `BEGIN IMMEDIATE` transaction for dispatch lookup,
replay/conflict/capacity checks and insertion. Migration 18 adds only the journal
table, with a composite primary key and restrictive foreign key to dispatches.
Read-only reopen preserves inspection without running migrations. Memory returns
detached records and serializes each journal read/append without an intervening
await. Neither adapter promotes a report into authority.

Tests cover late reports, conflicting turns, replay after response loss, independent
SQLite connections, read-only reopen, input/time/capacity rejection, detached reads
and opaque identities. These are controlled store tests. Terminal notification
capture is implemented separately as described above. Live conformance, verified
result receipts, late-turn reconciliation and qualified native workspace preparation
remain follow-up work before live dogfood.
No CLI/MCP command, default store or installed runtime changes in this slice.
