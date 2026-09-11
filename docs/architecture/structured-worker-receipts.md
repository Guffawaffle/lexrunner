# Structured worker receipt delivery

This source-only, opt-in bridge composes the existing receipt, worker-session and
verification application services. It does not introduce a verifier, accept work,
release resources, qualify a workspace or enable a public worker command.

## Protocol and evidence

`codexReceiptRequest` adds the input JSON Schema for `AgentTaskReceipt_v2` as
`turn/start.outputSchema`, and supplies the worker-session binding in the task
instructions. The full request, including schema and instructions, is covered by
the existing durable dispatch digest and authority decision. Existing requests
without this contract cannot be retroactively attributed to it. Schema generation
does not encode every semantic refinement; local receipt parsing is mandatory.

The owned connection captures complete `item/completed` notifications whose item
is an `agentMessage` with phase `final_answer`. It never scrapes commentary,
concatenates deltas or extracts a receipt from `turn/completed.items`. That list
may be partial. Null or unrecognized phases do not produce a receipt. The final
item's entire text must parse as one receipt JSON object; Markdown fences,
malformed JSON and invalid claims remain evidence but cannot be delivered.

The current [App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes `outputSchema` and completed-item notifications. Generated bindings from
the installed Codex 0.145.0 expose `TurnStartParams.outputSchema`,
`ItemCompletedNotification` with thread/turn IDs, and `ThreadItem.agentMessage`
with text and phase. This is protocol/schema evidence, not a successful model
turn or proof that a particular model accepts the generated schema.

Call `persistNextReceiptCapture` with the original dispatch binding to persist
each queued message. The queue removes it only after successful storage, keeping
its capture ID, observation ID, timestamp and exact notification bytes across a
retry. It can persist after child exit while the parent remains alive. A parent
crash before persistence loses volatile data and requires explicit recovery; it
never authorizes a new model send. The receipt queue is capped at 128 messages or
2 MiB; individual frames retain the existing 1 MiB limit. Overflow fails the
connection and preserves already captured messages.

Memory and SQLite stores retain immutable receipt-source records with dispatch,
session, worker, packet, envelope, source-byte digest and record digest. SQLite
migration 20 adds `worker_receipt_evidence`. A session can retain at most 128 source
records or 8 MiB of raw source notifications, in addition to the existing terminal
evidence budget. Exact observation replay returns the original record; changed
bytes under that ID are rejected. Distinct observations are retained, including
conflicting final messages. Reads return detached data; combined receipt/terminal
snapshots use one synchronous memory view or SQLite read transaction.

## Delivery and recovery

`WorkerReceiptDeliveryService.deliver` requires an explicit capture disposition.
Only a reconciled, acknowledged, reported-completed turn with exactly one valid
receipt-source record proceeds. Missing or multiple sources, contradictory turns,
unknown/incomplete capture, malformed claims and mismatched bindings block it.
The service reconstructs the exact structured request from canonical packet and
envelope data and checks its dispatch digest. It validates the receipt's packet
references and identities before requesting any lifecycle effect.

The durable source record is the recovery input. Its record digest is recorded in
the canonical session's exit reason when the existing worker-session application
service ends that session. The receipt application service then submits the
unchanged parsed claim with the resulting session revision and current controller
credentials. A completed claim stops at `verification_pending`.

| Failure point                               | Recovery                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Before durable capture                      | Missing source blocks delivery; do not resend the turn                                                       |
| Capture committed, response lost            | Retry the same observation; storage returns exact replay                                                     |
| Before session end                          | Revalidate evidence and current authority, then request the end                                              |
| Session end committed, response lost        | Require the matching source marker and expected next session revision; submit without another end            |
| Receipt submission committed, response lost | Read the exact receipt and matching source marker; return retained submission metadata without mutation      |
| Controller expires before submission        | Canonical submission rejects expired credentials; historical timestamps cannot revive authority              |
| Conflicting evidence appears later          | Reassessment blocks subsequent delivery/verification calls; already recorded effects remain historical facts |

Recovery uses fresh time for new mutations, not a frozen authorization timestamp.
A new service instance and reopened SQLite database can reconstruct the result.
Matching receipt contents from an unrelated submission are insufficient without
the source marker. Returned provenance identifies source observation/item/turn,
dispatch request, source/record/receipt digests and the assessed terminal snapshot.
It is content linkage inside the trusted host, not cryptographic provider identity
or an independent bootstrap trust root.

`verify` is a separate explicit operation. It rechecks current source evidence and
the durable submission, binds the requested receipt ID/hash, and calls the supplied
existing `AgentWorkAttemptVerificationService.run`. That service owns authorization,
workspace observation and packet checks; failures are returned unchanged. Delivery
does not automatically invoke verification or acceptance.

## Limits of the evidence

Capture disposition is a host assertion, not inferred from a database snapshot or
queue count. The host must establish its capture is settled before delivery. A
snapshot does not prevent later ingestion or revoke effects already authorized;
there is no atomic transaction spanning capture, session end, submission and
external verification. Existing lifecycle fencing and revision checks still apply.
The session-end record does not prove OS-resource cleanup or remote cancellation.
Failed/interrupted provider turns remain retained evidence requiring explicit
resolution; this bridge does not translate them into successful session ends.

Portable tests use real memory/SQLite stores with explicit store-contract adapters
in place of the applications' path checks. They exercise raw capture, provenance,
conflicts, unchanged verification failures and lost responses, including SQLite
close/reopen after committed end/submission. Connection tests use a fake stdio
child. Qualified native preparation, real receipt path validation and a live model
trial remain required before claiming end-to-end native worker execution.
