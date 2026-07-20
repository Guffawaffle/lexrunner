# Headless Supervisor and Fail-Forward Retry

> **Status:** Implemented application boundary; public CLI/MCP exposure remains tracked separately
>
> **Primary issue:** [#801](https://github.com/Guffawaffle/lexrunner/issues/801)

LexRunner's headless supervisor advances durable ADR-010 state; it does not treat a live process,
provider session, or log stream as orchestration truth. On every pass it reconstructs each Attempt
from the persisted Run, workspace lease, launch binding, packet, worker session, receipt,
verification, and acceptance records, then compares that state with workspace and worker
observations before choosing one bounded action.

## Reconciliation contract

The supervisor:

- acquires the fenced controller lease before mutation;
- processes at most the configured number of Attempts concurrently;
- reconciles expired or controller-mismatched workspace leases before lifecycle progression;
- negotiates the selected worker adapter before launch;
- supplies stable operation IDs to launch and cancellation ports so uncertain delivery can be
  retried without repeating the provider-side effect;
- resumes heartbeat, terminal observation, receipt submission, engine verification, and strict
  acceptance from durable state after restart;
- distinguishes explicit cancellation from worker loss;
- uses capped exponential backoff and a fixed Attempt budget; and
- emits compact action/outcome/status results by default, with reasons and store failures only when
  diagnostics are requested.

No supervisor action performs Git integration, GitHub mutation, signing, or release delivery. Those
remain separately brokered authority lanes after accepted verification.

## Fail-forward Attempts

A later Attempt for the same WorkItem revision must atomically persist an
`AttemptRetryDelta_v1`. The delta binds the immediate terminal Attempt to the new Attempt, names at
least one changed premise (or an explicit policy exception), and may inherit only evidence whose
identity and canonical hash the store can verify.

Receipt and verification references are currently verifiable. Artifact, observation, and deviation
reference kinds are reserved for future canonical evidence stores and therefore fail closed today.
An identifier, prose claim, log, or transcript is not inherited evidence by itself.

Prior Attempts remain immutable. A useful failure may inform a later retry, but it never becomes
accepted evidence retroactively.

## Revision identities

Three revisions deliberately answer different questions:

- the active workspace lease revision fences the supervisor's current mutation;
- the worker session revision fences the current session record; and
- a receipt's workspace revision records the lease revision at worker attachment.

Normal workspace heartbeats can advance the first value without changing the third. Verification
therefore checks its authorization against current lease/session revisions while checking receipt
provenance against the session's attachment revision.

## Proof surface

The executable suite covers deterministic planning at every lifecycle boundary, explicit
cancellation, heartbeat loss, bounded backoff, retry exhaustion, blind-retry rejection, immutable
prior Attempts, and memory/SQLite retry-delta parity. The restart integration injects a controller
failure after provider launch but before attachment and proves that stable redelivery creates one
external launch, then resumes heartbeat, receipt collection, verification, and acceptance.

Adapter conformance supplies lifecycle loss/cancellation/teardown coverage. Workspace lifecycle,
launch-envelope, receipt, verification, and coordination store suites retain their independent stale
lease, observation mismatch, duplicate-delivery, and compare-and-set fault matrices.

The repeatable published-package topology, packet-owned preparation receipt, fault-injected
inspection, containment-safe reap, and parallel-suite isolation proof are documented in
[Ecosystem provisioning and dogfood harness](ecosystem-dogfood.md). Broader native host/reboot
fault injection remains separate release evidence rather than a claim made by this application
boundary.
