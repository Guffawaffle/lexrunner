# Worker dispatch bookkeeping

Status: additive coordination store slice. No CLI/MCP command, provider dispatch,
default-store replacement, or native workspace qualification is enabled by it.

`InMemoryWorkerDispatchStore` and `SqliteWorkerDispatchStore` extend the canonical
workspace lifecycle store. Claim and acknowledgement operations validate the current
controller fence, Run/Attempt/workspace/session revisions, live workspace lease,
attached active session and packet hash in the same synchronous critical section
as the write. SQLite uses its existing `BEGIN IMMEDIATE` transaction boundary.

One session has one dispatch slot. The claim preserves packet/envelope identity,
backend worker identity, request digest, controller fence and workspace revision.
The caller supplies the request digest; this store does not construct or authorize
the provider request. A fresh claim returns `newlyClaimed: true`. Replaying the
same claim returns `newlyClaimed: false`; changing its claim ID or request digest
cannot allocate another slot. Claim IDs are scoped to a session, not global
provider idempotency keys or workspace mutation IDs.

The acknowledgement adds the observed provider turn ID. It cannot replace an
earlier, conflicting turn ID. Missing acknowledgement means uncertain delivery,
not proof of no execution. SQLite reopen preserves both the claim and any later
acknowledgement. Store results are detached values; callers cannot mutate records
through returned object references.

Both mutations require a currently live canonical binding, including replays.
Late acknowledgement after session termination or lease expiration is rejected;
retaining late external observations requires a separately reviewed reconciliation
path. Reading the retained record remains available after lifecycle termination.
The store does not mark a worker lost, replace its identity or create retry Attempts.

This is coordination evidence, not a send grant. The provider boundary must still
enforce attachment-before-task, consume a newly obtained dispatch claim under its
authority lifetime, and reconcile uncertain effects without blind retransmission.
Database fencing alone cannot revoke an external request already in flight.
Neither claim nor acknowledgement proves completion, verification or acceptance.

The additive SQLite table is installed only when constructing the writable dispatch
store. Its inline migration is version17; read-only construction does not migrate.
No runtime `.smartergpt/` lookup or change to frozen integration plans is introduced.

Verification: `npx vitest run tests/store/worker-dispatch-store.spec.ts --maxWorkers=1`.
Tests use synthetic lifecycle records and disposable databases. They do not launch
workers, create Git worktrees, demonstrate actual multi-process contention or prove
qualified native custody. Two connections exercise serialized claim visibility;
reopen exercises recovery after an unacknowledged claim.
