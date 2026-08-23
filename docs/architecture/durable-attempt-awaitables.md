# Durable Attempt awaitables

## Decision

LexRunner calls the durable contract an **Attempt awaitable**. Product surfaces may describe the
experience as an agent promise, but the implementation uses four terms with narrower meanings:

- **awaitable**: the durable, one-result contract;
- **watch**: one fenced host observation of that contract;
- **completion**: the immutable terminal event and stable delivery identity; and
- **continuation**: a consumer-specific action taken after delivery.

“Wait” remains the process-bound AXF operation. “Subscription” is not used because an Attempt
awaitable has one terminal result rather than an open stream. “Promise” is not used as the contract
name because language promises are normally process-local and cannot express restart recovery.

## Ownership boundary

AXF owns external observation:

- descriptor validation and kind-specific semantics;
- exact subject identity, such as repository plus head SHA;
- bounded observation, provider polling, and deadline outcomes;
- host-provided authority; and
- normalized `axf/await-result/v1` evidence.

LexRunner owns orchestration durability:

- registration against a live Attempt and optional WorkerSession;
- persistence, restart inventory, observation fencing, and cancellation;
- immutable terminal latching;
- targeted completion routing; and
- at-least-once delivery with a stable idempotency key.

This state belongs to the ADR-010 coordination service. It is not an integration-time input and the
stateless merge runner must never consult it when evaluating a frozen `plan.json`.

## Existing mechanisms and why they are not overloaded

Durable Attempts and WorkerSessions already provide the target identity. The governed Attempt
asynchronous supervisor already demonstrates the right event-driven shape: one recovery inventory
read followed by a provider-owned asynchronous signal, with no model-driven polling. Attempt
awaitables reuse that pattern.

Worker heartbeats answer a different question: whether a launched worker is alive. They do not
represent an exact external condition and are not a completion queue. The current worker runtime
adapter also has no provider-neutral “inject message and resume this exact session” operation.
Consequently, the completion notifier is an explicit port rather than an invented claim that every
worker can already be resumed.

## Contracts

Registration persists the exact credential-free AXF descriptor:

```json
{
  "schemaVersion": "axf/awaitable/v1",
  "kind": "github.required-checks",
  "subject": {
    "repository": "owner/repository",
    "headSha": "0123456789abcdef0123456789abcdef01234567"
  },
  "condition": {
    "type": "all-required-checks-terminal",
    "requiredChecks": [{ "source": "check-run", "name": "Windows" }]
  }
}
```

The durable record additionally binds:

- `awaitable_id`, `attempt_id`, and optional `worker_session_id`;
- canonical descriptor hash;
- absolute `deadline_at`;
- revision and monotonically increasing observer fencing token;
- optional active observer lease;
- immutable terminal result and result hash; and
- delivery ID, completion hash, attempt count, and delivery status.

AXF terminal data retains its original schema. LexRunner admits it to durable storage only through
a closed, kind-specific descriptor and evidence schema, then wraps it to identify whether the
terminal outcome came from AXF or from durable orchestration:

```json
{
  "schema_version": "1.0.0",
  "provider": "github.required-checks",
  "outcome": "satisfied",
  "source": "observer",
  "observed_at": "2026-08-12T12:00:00.000Z",
  "observer_result": {
    "schemaVersion": "axf/await-result/v1",
    "provider": "github.required-checks",
    "outcome": "satisfied",
    "terminal": true,
    "durability": "process-bound",
    "authorityModel": "host-provided",
    "underlyingCancellation": false,
    "effectiveDeadlineMs": 600000,
    "observationCount": 4,
    "evidence": {
      "repository": "owner/repository",
      "headSha": "0123456789abcdef0123456789abcdef01234567",
      "pullRequestNumber": null,
      "requiredChecks": [
        {
          "source": "check-run",
          "name": "Windows",
          "appSlug": "github-actions",
          "state": "completed",
          "conclusion": "success",
          "terminal": true,
          "successful": true
        }
      ]
    }
  }
}
```

LexRunner-originated results are deliberately limited to `deadline` and `cancelled`, with reason
codes `deadline_elapsed` and `operator_cancelled`. Cancelling the awaitable stops observation; it
does not claim to cancel GitHub Actions or any other underlying operation.

The completion delivered to a continuation target contains the stable `delivery_id`, target
Attempt/session, descriptor hash, terminal result and hash, and terminal timestamp. Consumers must
deduplicate by `delivery_id`.

The first slice allowlists AXF's `github.required-checks` provider. Its descriptor and normalized
evidence shapes are mirrored as closed schemas; a new provider is not durable until LexRunner adds
and tests another explicit schema. This prevents arbitrary provider JSON from becoming a secret
storage channel. Payloads are also structurally and byte bounded, unknown fields are rejected, and
credential-shaped fields and high-confidence credential values are rejected recursively.
Known credential forms are detected even when embedded inside otherwise allowlisted public names,
repository identities, or opaque identifiers. Credentials are supplied by the observer host at
execution time and are never placed in the descriptor, result, event, or completion record.

When `worker_session_id` is supplied, registration atomically requires both a live Attempt and a
nonterminal WorkerSession bound to that Attempt. Attempt-only registration remains available for a
continuation host that routes through an Attempt inbox instead of a live session.

## Lifecycle

| From                                | Event                                 | To                 | Durable effect                                            |
| ----------------------------------- | ------------------------------------- | ------------------ | --------------------------------------------------------- |
| none                                | register                              | `registered`       | Bind exact target, descriptor hash, and deadline.         |
| `registered`                        | claim watch                           | `observing`        | Issue a lease and increment the fencing token.            |
| `observing`                         | host interruption                     | `registered`       | Release the lease without manufacturing cancellation.     |
| `observing`                         | lease expires and another host claims | `observing`        | Replace the lease and increment the fence.                |
| live                                | operator cancellation                 | `cancelled`        | Atomically latch result plus pending completion.          |
| `observing`                         | AXF terminal result                   | terminal outcome   | Atomically latch result plus pending completion.          |
| live at elapsed wall-clock deadline | recovery                              | `deadline`         | Latch a LexRunner-owned deadline plus pending completion. |
| terminal/pending                    | delivery begins                       | unchanged          | Increment the durable delivery attempt count.             |
| terminal/pending                    | consumer acknowledges                 | terminal/delivered | Record delivery acknowledgement.                          |

Terminal statuses are `satisfied`, `terminal_failed`, `deadline`, `cancelled`, `subject_drift`, and
`observation_error`. A terminal status never returns to a live status.

## Restart and failure semantics

- **Crash after registration:** startup recovery claims the unobserved record.
- **Crash during AXF wait:** a replacement host inventories the live record. If its lease is still
  active, the host schedules one wake at the exact persisted expiry rather than polling. It then
  receives a higher fencing token; the stale host can no longer commit a result.
- **Host shutdown:** cooperative shutdown aborts AXF and releases the lease. AXF `cancelled` is
  treated as an interrupted watch, not as semantic cancellation of the durable awaitable.
- **Crash while recording terminal state:** the result and pending delivery are one store mutation;
  neither can exist alone.
- **Notifier failure:** the live supervisor retries with capped exponential backoff; the completion
  remains pending for restart recovery throughout.
- **Crash after notifying but before acknowledgement:** the same completion may be delivered again
  with the same `delivery_id`.
- **Crash after acknowledgement:** the completion is not selected for delivery again.
- **Competing hosts:** revision checks and fenced observation leases prevent two observers from
  latching different terminal results. Notification remains explicitly at-least-once.

Exactly-once delivery across LexRunner and an external model/session host would require a shared
transaction that those systems do not have. The honest contract is at-least-once delivery plus
consumer idempotency.

## First implementation slice

The initial slice contains:

- strict Zod schemas and credential rejection in
  `src/runs/attempt-awaitable-contract.ts`;
- in-memory and SQLite stores, migration 016, immutable events, revisions, fencing, and outbox state;
- `AttemptAwaitableSupervisor`, with non-blocking registration, one-read restart recovery,
  cooperative shutdown, cancellation, terminal latching, and replayable notification with capped
  retry backoff;
- a provider-neutral observer port and continuation notifier port; and
- a no-shell AXF CLI observer for `global.wait.external`, with the published
  `global.await.external` compatibility alias available only by explicit configuration.

The slice intentionally stops at the notifier port. It does not claim that an arbitrary Codex or
other model session can already be resumed. A subsequent host adapter must implement idempotent
delivery to a concrete resumable session or Attempt inbox and must acknowledge only after that host
durably accepts the stable delivery ID. Until then, LexRunner can durably observe and queue the
targeted completion, but cannot truthfully promise model re-entry.
