# Worker turn reconciliation

`reconcileWorkerTurn` is a pure, source-only assessment of a supplied evidence
snapshot. It reads no live store and changes no acknowledgment, lease, lifecycle,
verification or acceptance state. Its result explicitly says `supplied_snapshot`
and `verification: not_performed`.

The input includes a dispatch record, retained observations, available terminal
artifacts and the caller's capture disposition (`unknown`, `incomplete`, `drained`).
The caller must construct a consistent snapshot and include every relevant report
and capture failure. The [store snapshot collector](worker-evidence-snapshot.md)
provides one consistent database view; capture disposition remains a separate host
input. This function cannot detect omitted records, authenticate a
caller, establish artifact custody or prove that a capture declared drained was
complete. Drained means the caller has accounted for this capture queue; it does
not mean a complete task transcript exists. No result is merge eligibility or
authorization to execute or resend work.

The assessment validates record schemas, copied dispatch bindings, report hashes,
time consistency and artifact byte digests. Available artifacts must name the
reported worker, turn and terminal status. Malformed or internally inconsistent
snapshots throw fixed errors instead of producing a candidate. Byte and count
limits match the capture/journal limits; canonical identity domains are preserved.

A missing durable dispatch acknowledgment remains unresolved even if exactly one
late terminal report exists. Reconciliation does not manufacture an acknowledgment
after the live acknowledgment window closes. Different turn IDs, terminal outcomes
or terminal evidence digests remain conflicts. Timestamps and insertion order never
choose a winner. Multiple observations of identical evidence retain their distinct
provenance. Missing terminal artifacts and unknown/incomplete capture also block a
candidate. All applicable blockers are returned in stable order.

Only a matching acknowledged turn with a consistent, artifact-backed terminal
report and caller-declared drained capture yields `reported_terminal`. A candidate
can report `completed`, `failed` or `interrupted`; none means verified task success.
The returned evidence digest and observation IDs identify material for a subsequent
verifier. Referenced files, patches, commands and success criteria are not checked.

The deterministic snapshot digest includes dispatch metadata, sorted full observation
records, capture disposition and hashes of supplied artifact bytes. Reordering input
arrays does not change the result. Changed evidence or acknowledgment metadata does.
This digest is a comparison identity, not a signature, freshness proof or authority
receipt. Callers must rebuild the assessment when evidence changes and must not
reuse it as an execution grant.

Tests cover late reports, unavailable artifacts, contradictory trails, identical
evidence with multiple observers, malformed bindings/hashes, ordering, chronology
and bounds. Durable reconciliation decisions, qualified late-acknowledgment
resolution and verified task-receipt conversion remain separate
work. No live task, native qualification, public command, release or runtime change.
