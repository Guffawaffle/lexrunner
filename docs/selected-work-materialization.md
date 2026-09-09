# Selected-work materialization

The shared conversion boundary in `src/runs/selected-work-materialization.ts`
constructs one WorkItem and existing AgentTaskPacket from an explicitly selected,
dependency-free Execution Plan 1.0.0 item. It is exposed through `attempt materialize` and MCP `materialize_attempt_input`.
The pure conversion performs no I/O, preparation or dispatch. CLI input reads are
explicit; saving stdout is a separate caller-selected write.

The caller supplies exact UTF-8 source text and its expected SHA-256 digest, selected
item ID, stable work/criterion IDs, repository/base identity and explicit packet
policy. Requests and artifacts are bounded to 256 KiB. Unknown versions, ambiguous
selection, dependent work, repository mismatch, invalid criteria and nonportable
packet content fail with bounded diagnostics. No requirements are invented.

Source descriptions, technical context and constraints are explicitly composed into
existing packet instructions. Scope, authority, verification and budget stay exactly
as supplied. These prose requirements do not become enforced runtime policy. Old
packet formats, hashing and callers remain unchanged; old source specs may omit the
optional context. The entire source byte digest remains distinct from the resulting
semantic packet hash, including when only source whitespace changes.

The returned correspondence binds source bytes, selected item, normalized WorkItem,
criterion mapping, run/attempt IDs and the actual constructed packet hash. Outcome
and work-plan references are explicitly supplied and unverified. Caller-supplied
digests establish consistency, not acceptance, freshness or trusted provisioning.

A later preparation adapter must compare the real returned packet hash and attempt
identities with this correspondence before claiming preparation binding. Actual worker
observation, receipts and verification remain separate. Nonempty dependencies are
unsupported in this first slice; the converter never declares them satisfied.

Validation uses actual project and packet schemas, including existing agent-work
schema fixtures. It establishes construction behavior, not live issue creation,
worker execution or outcome fulfillment. Publication and public-surface adoption
remain separate delivery steps.

## Materialize, then prepare explicitly

This surface is available in the published 2.3.0 release. Install
`@smartergpt/lexrunner@2.3.0` before following these commands.
Existing 2.2.0 installations do not expose this operation.

```sh
lexrunner attempt materialize --input examples/selected-work-input.json --json
```

[The complete example](../examples/selected-work-input.json) uses illustrative identities
and source bytes. It demonstrates materialization only; replace them with the selected
real artifact, expected digest, identities and explicit policy before preparation.

The input is the complete `SelectedWorkInputJsonSchema` advertised by MCP: inline
project artifact text and its digest, supplied outcome/work-plan references, selected
item and stable criterion IDs, repository/base, capture time and explicit packet
policy. A successful result contains `preparationInput`, `correspondence`, and the
remaining required field names. It contains no controller credentials or guessed host.

Retain the correspondence, review the returned requirements/policy and construct a
full preparation request by adding your explicitly authorized `runtime`, `envelope`
and `attempt` lifecycle inputs to `preparationInput`. Keep `expectedPacketHash`.
Then, only with authority for preparation's workspace/database effects:

```sh
lexrunner attempt prepare --input reviewed-preparation.json --json
```

Preparation checks `expectedPacketHash` before opening its runtime/store and compares
the actual returned packet as well. Changing instructions, criteria, identity or
policy requires a new materialization and review; do not remove the expected hash to
bypass a mismatch. A post-preparation mismatch reports affected attempt references
and requires inspection because effects may already exist. No automatic retry occurs.

The new expected hash is optional for legacy request compatibility, not optional for
this bound handoff. Older strict request parsers reject the new field; upgrade rather
than stripping it. Materialization works with MCP mutations disabled. `prepare_attempt`
retains its existing ALLOW_MUTATIONS gate; enabling that gate is a separate authority
decision. A successful preparation binds packet/envelope resources, not worker launch.

## Continue with a foreground host

The next result is an attached session and a durable worker claim. This is a manual
integration contract for a host that can supply the real worker session and lifecycle
observations. LexRunner's built-in `lexrunner.host-assisted` adapter does **not** spawn
or dispatch a worker. Without such a host, stop at the prepared bundle.

Preparation and attachment also require a supported workspace boundary. Native Windows
preparation is not supported by the currently shipped boundary; the development native
fixture is not a substitute. Do not strip bindings, switch hosts implicitly or install
a service to make these examples pass.

Retain the full successful preparation response privately. It contains lifecycle
credentials and host paths. In the shared CLI/MCP handler shape, require both `ok: true`
and `result.ok: true` with `result.outcome: "launch_bundle_ready"`. Call that returned
`result` the **bundle** below. Keep its packet hash equal to the retained correspondence.
The [worker request schemas](../src/runs/agent-work-worker-adapters.ts) and
[receipt request schema](../src/runs/agent-work-attempt-receipt-adapters.ts) are the
complete contracts; the field map below explains where their values come from.

### Attach before dispatching the task

The foreground host must first create a **wait-only** worker that cannot start
repository work, obtain its real opaque session identity, then attach it. Dispatch
the bundle's exact packet only after attachment succeeds. A task-bearing spawn
followed by best-effort attachment does not satisfy this sequence. Do not fabricate
an ID from the examples or assume an arbitrary host implements this handshake.

Construct a request with the original explicit `runtime` and an `attach` object:

| Attach field                                         | Source                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runId`, `expectedRunRevision`                       | `bundle.lifecycle.run.runId`, `.revision`                                                                                                            |
| `controller`                                         | Only `runId`, `controllerId`, `leaseId`, `fencingToken` from the live controller lease; the initial values are in `bundle.lifecycle.controllerLease` |
| `attemptId`, `expectedAttemptRevision`               | `bundle.lifecycle.attempt.attemptId`, `.revision`                                                                                                    |
| `workspaceLeaseId`, `expectedWorkspaceLeaseRevision` | `bundle.lifecycle.workspace.leaseId`, `.revision`                                                                                                    |
| `envelope`                                           | The exact `bundle.envelope`, without rewriting hashes or paths                                                                                       |
| `workerSessionId`, `worker.workerId`                 | Stable lifecycle session ID and real opaque worker identity supplied by the host; retain their association                                           |
| `worker.backend`, optional `worker.model`            | Actual host identity; the built-in assisted manifest requires backend `host-subagent`                                                                |
| `worker.startedAt`, `mutation.now`                   | Observed host start and current mutation time; start must fall between envelope creation and attachment, within the lease                            |
| `mutation.mutationId`                                | Stable unique ID for this exact mutation; preserve it for an exact replay                                                                            |
| `adapter`                                            | Explicit adapter selection described below                                                                                                           |

The built-in adapter selection uses schema `1.0.0`, ID `lexrunner.host-assisted`,
version `1.0.0` and mode `assisted_attach`. Its `accepted_trust_gaps` list must be an
explicit operator decision for the packet and host. For example, a packet allowing
edits needs both filesystem read and write enforcement assessed. Listing a gap
acknowledges it; it does not enforce scope or grant permission. Missing required
acknowledgements or unsupported capabilities must stop attachment.

After reviewing the request and authorizing its database/workspace observation effects:

```sh
lexrunner attempt worker attach --input reviewed-attach.json --json
```

Require `ok: true` **and** `result.updated: true` before host dispatch. An outer
`ok: true` can contain a rejected lifecycle mutation such as `identity_mismatch`.
Retain the returned attempt and worker-session revisions. If attachment fails or its
result is uncertain, keep the worker quiescent, inspect status and reconcile the
exact operation; do not send the task speculatively. Host cancellation and recovery
remain the host's responsibility, not a side effect of recording a failed mutation.

### Record observations, then submit the worker claim

Use the existing commands with reviewed request files:

```sh
lexrunner attempt worker heartbeat --input reviewed-heartbeat.json --json
lexrunner attempt worker end --input reviewed-end.json --json
lexrunner attempt receipt submit --input reviewed-receipt.json --json
```

Heartbeat and end requests contain `databasePath` and a `heartbeat` or `end` object.
Carry the same run/controller/attempt/lease/session identities, but use the latest
returned revisions for each mutation, including `expectedWorkerSessionRevision`.
If another actor changes state or a lease expires, reconcile first; do not guess
revision increments or copy stale preparation revisions. End additionally records
the observed terminal `status` and `exit`. Each mutation requires `result.updated`.
These are controller-submitted observations, not an independent process monitor.

Receipt submission contains `databasePath` and `submission`: current identity/revision
preconditions, controller credential, `mutation`, and an `AgentTaskReceipt_v2` claim.
Build that claim from the actual packet, attached session and observed result:

| Receipt data                                                                 | Source                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run, work item/revision, attempt, packet ID/hash and base SHA                | The prepared packet; packet hash must still match retained materialization correspondence                                                                  |
| Workspace lease ID/revision and worker runtime/session ID                    | The attached session; receipt `workspace_lease_revision` is its attachment revision, while outer `expectedWorkspaceLeaseRevision` fences the current lease |
| Addressed criteria                                                           | IDs from the packet's criteria and retained correspondence; list only those the worker claims to have addressed                                            |
| Final HEAD or canonical patch hash, files and commits                        | Actual observed result, following the [ADR-010 receipt identity contract](adr/ADR-010-agent-work-orchestration-protocol.md)                                |
| Outcome, exit reason, summary, checks, blockers, assumptions, times and cost | Bounded worker/host evidence; do not invent passed checks or measured costs                                                                                |

Require `ok: true` and `result.submitted: true`. Retain the returned receipt ID/hash,
attempt revision and disposition. `verification_pending` is a persisted claim awaiting
verification; it is not accepted work. The correspondence remains a caller-retained
link to supplied source identity, not an authenticated outcome or plan acceptance.

### Verify independently and reassess

`lexrunner attempt verification run --input reviewed-verification.json --json` executes
the immutable packet's checks and observes result identity. It needs current lifecycle
preconditions plus the submitted receipt ID/hash, a new verification ID and distinct
begin/complete mutation IDs. Authorize those command and database effects separately.
Require `result.recorded`, then inspect the actual outcome and trust gaps; recording
failed or inconclusive verification is still a successful persistence operation.

Policy acceptance is a further operation (`attempt acceptance apply`), followed by
separate review/integration and outcome reassessment. A completed worker, submitted
receipt, or passing check alone does not establish fulfillment. See the
[verification request schemas](../src/runs/agent-work-attempt-verification-adapters.ts).

### Reproducible evidence and limits

The selected-work composition case in
[the receipt adapter suite](../tests/runs/agent-work-attempt-receipt-adapters.spec.ts)
materializes authored criteria, prepares a real temporary Git/SQLite workspace,
rejects a wrong attachment packet hash, attaches, writes deterministic fixture output,
records end, observes its patch identity, rejects a mismatched receipt and persists
and replays the correct claim. Its helpers show the complete request shapes above.
The test uses fabricated **fixture** identities and launches no agent; they are not
values to copy into a real request. This evidence covers application composition,
not provider dispatch, protected-host acceptance or outcome fulfillment.
