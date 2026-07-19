# ADR-010: Agent Work Orchestration Protocol

**Status:** Proposed
**Date:** 2026-07-11
**Authors:** lexrunner team

---

## Context

LexRunner already has run-centric procedures, persisted state, task snapshots,
receipts, independent verification, gates, and merge-weave. Those pieces can
coordinate work products, but they do not yet define who owns a run, how a
worker attempt receives an isolated workspace, or how an unattended worker is
supervised from assignment through delivery.

We want two control modes:

- **Assisted:** a foreground developer chat controls the run and delegates
  implementation to background agents.
- **Headless:** a CLI controller accepts a work assignment and advances it to a
  verified delivery without a foreground chat.

These modes must share operational truth and safety contracts. Assisted mode is
the first dogfood surface, not a separate runner. It can prove delegation,
packets, receipts, verification, interruption, and delivery UX. It cannot prove
operating-system process supervision or unattended recovery; that boundary
must remain explicit.

STFC's background-agent worktree broker is proven prior art for the workspace
half of this model. It demonstrates bridge-owned lease creation, a pinned base
SHA, bounded file scope, distinct edit/Git/GitHub/runtime permissions, a lease
brief inside the worktree, registered-path and branch checks before cleanup,
dirty-worktree cleanup refusal, branch preservation, and an append-only event
history. LexRunner will adopt those semantics without depending on STFC's
PowerShell implementation or workspace layout.

This ADR defines the shared run/attempt protocol and its invariants. It does not
select a Jira SDK, a model, a prompt, or a particular worker vendor.

---

## Decision

LexRunner will own a source-neutral, revisioned orchestration protocol:

```text
WorkSource snapshot
        |
        v
     WorkItem
        |
        v
       Run ---------------- ControllerLease
        |
        +-- Attempt 1 ----- WorkspaceLease
        |       |-- AgentTaskPacket
        |       |-- ExecutionEnvelope
        |       |-- WorkerSession
        |       |-- AgentTaskReceipt
        |       `-- EngineVerification
        |
        `-- Attempt 2 ...
        |
        v
     Delivery
  commit -> push -> PR -> gates -> plan synthesis -> merge-weave
```

The shared engine is the protocol above, not a common worker-launch call.
Worker runtimes are replaceable executors. They do not own run state,
verification truth, authority policy, or merge authority.

### Ontology

#### WorkItem

A `WorkItem` is a normalized, source-neutral snapshot of desired work. Jira,
GitHub Issues, and future sources are adapters into this contract.

A WorkItem MUST record source identity, the source revision or observation time,
the requested outcome, acceptance criteria, and relevant immutable references.
Refreshing a mutable source produces a new WorkItem revision; it MUST NOT
silently alter an in-flight attempt.

#### Run

A `Run` is LexRunner's coordinated effort to deliver one WorkItem revision. It
holds the control mode, authority ceiling, lifecycle state, attempts, human
requests, verification results, and delivery status.

A run may change controllers and control modes through explicit transitions. A
run can begin headless, pause for a developer, continue assisted, and later
launch another headless attempt without changing the WorkItem.

#### Attempt

An `Attempt` is one worker try against one immutable packet and one pinned base
SHA. A retry creates a new attempt, packet binding, and workspace lease. Reusing
an existing worktree is an explicit resume of the same attempt, never an
implicit retry.

Every terminal Attempt is evaluated against the
[LexRunner durable-delta principle](../PRINCIPLES.md). A new Attempt that retries
earlier work MUST identify the inherited evidence and a meaningful changed
premise—evidence, strategy, inputs, environment, authority, worker/runtime, or
an explicit reason the same operation should now behave differently. A new
identifier alone is not a retry delta. Blind replay is repetition, not recovery.

The current orchestration schemas do not yet claim executable conformance with
durable-delta or retry-delta enforcement. Canonical attempt evidence is tracked
in #766 and #762; supervisor enforcement and reconciliation are tracked in
#801, #767, and #699. This ADR states the protocol invariant without silently
broadening a released schema.

#### ControllerLease

A `ControllerLease` is the first airlock. Exactly one live controller may
advance a run at a time. It binds a `runId`, controller kind, controller
instance, lease token, acquisition and heartbeat times, expiry, and the run
revision at acquisition.

An assisted-to-headless handoff releases or expires one controller lease before
another controller acquires it. A controller whose lease has expired MUST NOT
mutate the run, even if its process is still alive.

#### WorkspaceLease

A `WorkspaceLease` is the second airlock. Exactly one live attempt may own a
worktree and branch. It binds the attempt, repository identity, base SHA,
branch, worktree identity, owning runtime, heartbeat and expiry, scope,
authority, and cleanup disposition.

Worktrees isolate working files, index state, untracked files, and branch
checkout state. They do not isolate remotes and refs, GitHub writes, tags,
releases, external runtimes, shared caches, secrets, or services. Those mutation
lanes require separate authority and remain coordinator-owned by default.

An expired clean lease may be released by reconciliation policy. An expired
dirty lease MUST be quarantined for inspection and MUST NOT be automatically
deleted. Cleanup MUST verify that the recorded path is still a registered
worktree for the expected repository and is still on the recorded branch.
The local broker's pathname-swap guarantees and fail-closed platform matrix are
specified in
[Agent worktree physical containment](../security/agent-worktree-containment.md).

#### AgentTaskPacket

An `AgentTaskPacket` is the portable, immutable, canonically hashed contract for
one attempt. It contains intent, acceptance criteria, repository-relative
scope, pinned repository/base identity, constraints, bounded context,
verification expectations, output contract, and budget.

The packet MUST NOT contain machine-local absolute paths, lease secrets, PIDs,
or runtime-specific session handles. Its hash MUST remain stable when the same
logical work is allocated to a different local worktree.

#### ExecutionEnvelope

An `ExecutionEnvelope` is the machine-local binding used to execute a packet.
It contains the attempt and lease identifiers, local project root, execution
root, worktree path, branch, Git runtime identity, host/runtime information,
sandbox configuration, allowed process capabilities, and worker-session
bootstrap data.

The envelope is not part of the packet hash. It is separately integrity-bound
to the attempt and lease.

`projectRoot` identifies the logical project presented to workspace tooling.
`executionRoot` identifies the process working directory from which commands
run. They MAY differ and MUST both be explicit when they do.

#### WorkerSession

A `WorkerSession` is a runtime-specific handle for one attempt: for example, a
native background-agent ID or an exact Codex session ID plus process identity.
It records launch, heartbeat, exit, cancellation, and reattachment information.
It is evidence about a worker process, not authority to mutate Run state.

#### AgentTaskReceipt

An `AgentTaskReceipt` is the worker's immutable claim about an attempt. It MUST
bind at least:

```text
workItemId / workItemRevision
runId / attemptId
packetHash
leaseId
workerRuntime / workerSessionId
observedBaseSha
resultSha and/or patchHash
outcome and exit reason
files touched
commands and verification claimed
start and completion times
```

LexRunner MUST reject a receipt from the wrong attempt, base, packet, lease, or
worker session. Receipt submission MUST be idempotent by receipt hash. A late
receipt after lease revocation is retained as audit evidence but cannot advance
the run without an explicit recovery decision.

Receipt v2 treats `files_touched`, `acceptance_criteria_addressed`,
`claimed_checks` (keyed by ID), `assumptions`, `blockers`, and
`human_action_request_ids` as duplicate-free canonical sets. Ingestion sorts
those fields before hashing. `commits` is ordered evidence and remains
order-sensitive. Addressed criteria and claimed checks MUST name entries in the
durable authoritative packet snapshot; receipt v2 has no implicit extra-check
lane. A future extra-check lane requires a versioned contract.

`AgentTaskReceipt_v2.patch_hash` uses the named `git-diff-binary-v1` profile. It
is produced with this exact recipe:

1. Create a new temporary index path and set `GIT_INDEX_FILE` to it for every
   command in this recipe.
2. Run `git read-tree <observed_base_sha>`.
3. Select only non-ignored untracked paths declared in
   `receipt.files_touched` with
   `git --literal-pathspecs ls-files --others --exclude-standard -z -- <path args>`.
   The path arguments are the individually supplied, validated repository-relative
   receipt paths; neither the shell nor Git reparses them as patterns.
4. Feed those exact NUL-delimited bytes to
   `git --literal-pathspecs add -N --pathspec-from-file=- --pathspec-file-nul`,
   using the same `GIT_INDEX_FILE`. Ignored and unlisted untracked files are
   excluded.
5. With that same index, run exactly
   `git -c core.quotePath=true diff --no-color --no-ext-diff --no-textconv
--no-relative --binary --full-index --no-renames --src-prefix=a/
--dst-prefix=b/ <observed_base_sha> --`.
6. Compute SHA-256 over the exact stdout bytes without decoding, line-ending
   conversion, or trailing-newline normalization.

The patch hash is a worker claim about result identity. It is distinct from
`receipt_hash`, which is the canonical hash of the complete validated receipt,
and neither is engine verification.

#### EngineVerification

`EngineVerification` is evidence collected by LexRunner or a policy-authorized
gate executor. The worker's verification is only a claim. LexRunner selects the
declared command, environment, timeout, expectations, and evidence format, then
records its own result.

Verification outcomes are:

```text
pass | fail | inconclusive | infrastructure_error | cancelled
```

Evidence SHOULD include base and result SHAs, command, working directory,
environment fingerprint, exit code, output hashes or bounded excerpts,
duration, retry count, artifacts, and gate determinism class. A discrepancy
between a receipt and engine evidence creates a trust-gap record.

Verification is **engine-owned**, not universally deterministic. External
services, tests, and CI systems may still be nondeterministic.

Durable verification uses two fenced steps. `beginAttemptVerification` binds a
verification ID to the current Run, Attempt revision, packet snapshot,
WorkspaceLease revision, WorkerSession revision, and receipt hash, then advances
the Attempt to `verifying`. Only completion under that exact authorization may
persist `AgentEngineVerification_v2` and advance to `verified`, `rejected`, or
`inconclusive`. Generic Attempt transitions cannot manufacture these states.

`AgentEngineVerification_v2` identifies an independently observed HEAD and/or
canonical patch, the workspace-observation hash, packet-declared and explicit
engine-extra check lanes, command/environment/output identities, bounded
excerpts, duration, retry count, determinism class, and named trust-gap reasons.
The immutable verification hash covers the canonical complete record. A passing
verification must include every packet-declared check; extra checks never
masquerade as packet declarations.

#### Delivery

`Delivery` is the coordinator-owned process that turns a verified result into a
commit, push, pull request, gates, and eventual integration candidate. Delivery
MUST NOT begin from an unverified or inconclusive result unless an explicit,
audited authority policy permits an override.

Workers have no push, signing, PR, merge, release, or operational-state
authority by default. The coordinator constructs or selects the delivery
commit and performs authorized side effects.

#### HumanActionRequest

An operation requiring a person becomes a persisted `HumanActionRequest`, not
an indefinitely suspended terminal prompt. Examples include scope approval,
authentication, commit signing, push approval, and merge approval.

The request MUST include its action, resource, rationale, expected run revision,
relevant base/result SHAs, expiry when applicable, and required authority. The
human response is a separate receipt. LexRunner MUST recheck all preconditions
before consuming it, so approval for one revision or commit cannot authorize a
different one.

For initial signing support, workers produce changes and LexRunner verifies
them; the coordinator then asks for human action and constructs/signs the final
delivery commit. A blocked TTY is an implementation failure, not the protocol.

### Control Modes

Control mode belongs to the Run. Worker runtime belongs to the Attempt.

| Concern               | `assisted`                      | `headless`                             |
| --------------------- | ------------------------------- | -------------------------------------- |
| Controller            | Foreground chat/orchestrator    | LexRunner CLI supervisor               |
| Worker launch         | Host-native background agent    | Supervised non-interactive CLI process |
| Decisions             | Developer plus controller       | Policy, authority, and human requests  |
| Run/attempt contracts | Shared                          | Shared                                 |
| Receipts/verification | Shared                          | Shared                                 |
| Recovery proof        | Protocol and controller handoff | OS process and restart reconciliation  |

Control mode is not a new autopilot level. Existing autopilot levels describe
integration and merge side-effect authority. A run may use either control mode
at any existing autopilot level permitted by policy.

### Effective Authority

Authority is computed for each attempted action:

```text
effective authority =
    caller permissions
  intersection workspace policy
  intersection run authority ceiling
  intersection task capabilities
  intersection worker-runtime ceiling
  intersection active human grants
```

Explicit denial wins. Workers and receipts cannot expand this set. A controller
MUST recompute it immediately before each side effect and MUST persist the
inputs and decision. Workspace leases distinguish at least edit, Git, GitHub,
external-runtime, secret, signing, and release permissions.

### Concurrency and Revisioning

LexRunner adopts **one logical writer per run, enforced by a renewable
ControllerLease, plus storage-level optimistic concurrency**.

Every Run has a monotonically increasing `revision`. Every mutation MUST:

1. present the active controller lease token;
2. present `expectedRevision`;
3. present a caller-generated mutation ID for idempotent retry;
4. validate a legal lifecycle transition;
5. atomically append the authoritative event and advance the revision; and
6. fail without partial mutation when the lease or revision is stale.

The `CoordinationStore` is orchestration operational truth. Its persistence
provider MUST support atomic controller lease acquisition and an atomic
compare-and-swap transaction that commits the next state and authoritative
event together. Retrying the same mutation ID MUST return the committed result;
reusing it with different content MUST fail. Temp-file-plus-rename JSON protects
against torn files but does not satisfy this concurrency contract.

The existing frozen `RunStore` remains an integration record store for gate
outcomes and legacy receipts. It MUST NOT be used to authorize or advance the
orchestration lifecycle.

Canonical orchestration state MUST use a versioned schema envelope and MUST be
validated before commit and after read. Corrupt or unknown state fails closed;
it is never repaired from a potentially stale JSON projection.

The store MUST preserve an append-only event history. Human-readable state
files under `.lexrunner/runs` MAY be materialized projections, but they are not
independently writable truth. CLI and MCP surfaces MUST call the same
application services; neither surface may implement lifecycle transitions
directly.

The initial local provider SHOULD be transactional SQLite with revision checks.
Other providers are conforming only if they pass the same lease, CAS,
idempotency, and crash-recovery contract tests.

### Cross-Runtime Root and Worktree Identity

An absolute path is not a portable workspace identity. The same checkout can be
seen as `D:\dev\repo` by Windows and `/mnt/d/dev/repo` by WSL. A worktree created
by one Git runtime may appear missing or prunable to another.

Therefore:

- packet paths are repository-relative;
- the execution envelope records `projectRoot`, `executionRoot`, host runtime,
  Git runtime, and runtime-specific worktree path;
- repository and worktree identity are verified using Git metadata, expected
  branch, and pinned base, not path text alone;
- one declared Git runtime owns a lease's create/status/cleanup lifecycle; and
- cross-runtime takeover requires an explicit path mapping and successful
  identity reconciliation before mutation.

The first implementation MUST NOT infer Windows/WSL path equivalence by string
rewriting.

---

## Lifecycle Expectations

### Run

```text
created -> planning -> ready -> executing -> verifying -> delivering -> completed
   |          |         |          |            |             |
   +----------+---------+----------+------------+-------------+
                         may enter:
              awaiting_human | paused | blocked | failed | cancelled
```

- `completed`, `failed`, and `cancelled` are terminal unless an explicit
  recovery operation creates a new revision with an audited reason.
- `awaiting_human`, `paused`, and `blocked` retain a recorded resume target.
- Only a controller holding the active lease may advance the Run.
- `delivering` requires an accepted `pass` verification or an authorized
  override.

### Attempt and WorkerSession

```text
prepared -> leased -> launching -> running -> receipt_submitted -> verifying
    |         |          |           |              |               |
    |         |          |           |              +-> rejected ----+
    |         |          |           +-> blocked / failed / cancelled
    |         |          +-> launch_failed
    |         +-> expired -> quarantined
    +-> cancelled

verifying -> verified -> accepted
          -> rejected
          -> inconclusive
```

- Each attempt has exactly one immutable packet hash and pinned base SHA.
- At most one nonterminal WorkerSession belongs to an Attempt.
- `accepted` requires engine verification and policy acceptance.
- Retrying any terminal or rejected Attempt creates a new Attempt.
- A retry records inherited evidence and a meaningful changed premise; otherwise
  it is rejected, explicitly excepted by policy, or identified as blind replay.
- An expired dirty workspace enters `quarantined`; it is not silently reused or
  removed.

### Human Action

```text
requested -> presented -> satisfied -> consumed
     |           |            |
     +-----------+------------+-> expired | rejected | invalidated
```

- `consumed` requires unchanged preconditions and matching Run revision.
- A changed result SHA, authority set, or relevant Run state invalidates the
  request.

---

## Required Invariants

1. Exactly one controller may advance a Run.
2. Exactly one live Attempt may own a workspace lease.
3. Every Attempt is bound to one immutable packet and base SHA.
4. Every receipt belongs to exactly one Attempt and WorkerSession.
5. Receipt submission is idempotent; workers submit claims, not truth.
6. Only LexRunner records EngineVerification and operational state.
7. Workers cannot increase their own authority.
8. Delivery cannot begin from an unverified result without an audited override.
9. Human approval is scoped to explicit, revalidated preconditions.
10. Dirty orphaned workspaces are preserved or quarantined, never silently
    destroyed.
11. Run mutations are lease-bound, revision-checked, and append-only audited.
12. Assisted and headless control use the same WorkItem, Attempt, receipt,
    verification, authority, and delivery contracts.
13. Every terminal execution identifies an inspectable durable delta or records
    that the orchestration failed to leave the work better positioned.
14. Every retry identifies inherited evidence and a meaningful retry delta;
    a new Attempt identifier alone is insufficient.

---

## Compatibility

### `plan.json` Integration Invariant

This protocol operates during work intake and implementation. It does not
change ADR-001 or the integration runner's frozen-input contract.

```text
WorkItem -> Run/Attempts -> verified PRs -> plan generator -> frozen plan.json
                                                           -> integration runner
```

At integration time, the runner still consumes only `plan.json`. It MUST NOT
read WorkItems, CoordinationStore state, worker sessions, source issues, or
`.smartergpt/`. Plan synthesis remains a separate boundary.

The orchestration service may be stateful through its explicit CoordinationStore
adapter; the packageable integration core remains stateless with respect to
work coordination.

### ADR-007

ADR-007 remains accepted and unchanged for bounded repair tasks.
`TaskSnapshot_v1` and `TaskReceipt_v1` remain supported because their required
failure evidence and anchored target hunks are valuable for that procedure.

General work introduces contracts alongside them:

```text
WorkItem_v1
AgentTaskPacket_v1
ExecutionEnvelope_v1
AgentTaskReceipt_v1 (legacy general-work claim)
AgentTaskReceipt_v2 (durable general-work ingestion claim)
AgentEngineVerification_v1
AgentEngineVerification_v2 (durable receipt-v2 engine evidence)
```

`AgentTaskReceipt_v1` remains readable for compatibility but is not accepted by
the durable general-work ingestion path. `AgentTaskReceipt_v2` extends ADR-007's
epistemic model—snapshot as contract, receipt as claims, engine as verifier—while
binding claims to Run, Attempt, WorkspaceLease, WorkerSession, packet, base SHA,
and a committed and/or uncommitted result identity. Existing `task` commands may
remain compatibility aliases for ADR-007 repair flows; `work`, `run`, and
`attempt` are the durable orchestration nouns.

`AgentEngineVerification_v1` remains the legacy general-work verification
contract and can identify only an optional verified HEAD. Durable
`AgentTaskReceipt_v2` verification uses the explicitly versioned
`AgentEngineVerification_v2`, including patch-only result identity; v1 is not
silently broadened.

---

## Headless Supervisor Proof Boundary

Assisted dogfooding can prove packet sufficiency, scope boundaries, subagent
handoff, receipt binding, claim/evidence disagreement, verification, controller
handoff, human-request UX, and delivery policy.

It does not prove:

- process-tree death, signals, cancellation, or resource ceilings;
- worker heartbeat loss and session reattachment;
- coordinator crash or machine reboot reconciliation;
- orphaned or dirty worktrees;
- expired credentials, authentication loss, or blocked TTY prompts;
- sandbox escape detection; or
- exact-session resume after supervisor restart.

The headless worker adapter therefore includes a separately tested supervisor.
It MUST use a stable non-interactive interface, bind the exact persisted runtime
session ID, capture structured events and terminal status, manage the entire
process tree, enforce time/resource bounds, avoid interactive prompts, and
reconcile Run, Attempt, WorkerSession, process, and worktree state after restart.

Before headless mode is production-capable, fault injection MUST cover at
least: worker death, controller death, duplicate or late receipts, stale leases,
dirty worktrees, revoked authority, source drift, interrupted human action,
credential loss, and reboot reconciliation.

---

## Staged Rollout

### Stage 0: Contracts and fixtures

- Define WorkItem, Run, Attempt, packet, envelope, receipt, verification,
  authority, lease, and human-action schemas.
- Add canonical hashing and golden fixtures.
- Preserve ADR-007 contracts unchanged.

### Stage 1: Revision-safe state and workspace leases

- Introduce the RunStore transaction and event contract.
- Add controller leases, Attempt records, workspace allocation, heartbeat,
  expiry, reconciliation, and dirty-worktree quarantine.
- Port STFC broker semantics into a cross-platform Node implementation.

### Stage 2: Shared CLI and MCP lifecycle services

- Expose `work`, `run`, and `attempt` operations through shared application
  services.
- Complete run and handoff CLI/MCP parity without duplicating state logic.
- Make all machine-facing output bounded and JSON-safe.

### Stage 3: Assisted vertical slice

- Import one bounded real WorkItem.
- Acquire controller and workspace leases.
- Emit the packet/envelope and let a foreground controller launch a native
  background agent.
- Submit the attempt-bound receipt, independently verify it, and produce a
  coordinator-owned delivery.
- Test controller interruption and assisted/headless handoff semantics.

Native assisted launch uses a quiescent attachment handshake. The foreground
controller first spawns the background agent with a wait-only bootstrap that
forbids repository mutation, records the opaque native session ID through the
WorkerSession attachment operation, and only then dispatches the task packet.
This ordering prevents work from beginning before its durable Attempt and lease
binding exists; a task-bearing spawn followed by best-effort attachment is not
an accepted assisted launch.

### Stage 4: Headless supervisor

- Add the first non-interactive CLI worker adapter.
- Persist exact session/process identity and structured events.
- Implement cancellation, timeout, restart reconciliation, and explicit human
  action requests.

### Stage 5: Fault injection and authority expansion

- Prove all supervisor failure cases listed above.
- Expand delivery permissions only after audit evidence supports it.
- Add additional WorkSource and WorkerRuntime adapters against the same
  contracts.

---

## Consequences

### Positive

- Assisted experimentation directly hardens the headless protocol.
- Source systems and worker runtimes remain replaceable adapters.
- Two exclusive leases prevent duplicate coordination and workspace ownership.
- Portable packets can be replayed across hosts and worktrees.
- Claims, evidence, human action, and authority decisions remain auditable.
- STFC's working broker semantics reduce speculative workspace design.

### Negative

- Run persistence must become transactional rather than best-effort JSON.
- Controller and workspace reconciliation add distributed-systems complexity.
- A safe headless supervisor is a substantial subsystem, not a launch adapter.
- Quarantining dirty orphans consumes disk and requires operator UX.
- Separate packet and execution contracts add schema and migration work.

### Neutral

- Assisted mode is expected to require developer intervention initially; those
  interventions are protocol-learning evidence.
- Existing autopilot levels remain unchanged because they answer a different
  authority question.
- Jira support is an adapter choice after the shared contracts exist.

---

## Alternatives Considered

### Build separate assisted and headless runners

Rejected. Separate state, receipt, and verification paths would drift and make
assisted dogfooding poor evidence for autonomous execution.

### Treat headless mode as replacing `spawn_agent` with a CLI call

Rejected. The packet adapter may be small, but process supervision, recovery,
credentials, TTY behavior, and orphan reconciliation are distinct safety work.

### Let each CLI or MCP invocation write Run JSON directly

Rejected. Atomic rename does not prevent two writers from overwriting the same
revision, and surface-specific transitions would diverge.

### Put local paths in the portable packet

Rejected. Paths change by attempt and runtime, destabilize packet hashes, and
cannot express Windows/WSL identity safely.

### Let workers own delivery

Rejected for the initial system. Worktree isolation does not isolate GitHub,
signing, release, or runtime side effects. Delivery remains coordinator-owned
and authority-gated.

---

## References

- ADR-001: Plan.json as Frozen Runtime Input
- ADR-003: Gate Uniform Execution
- ADR-004: Runner State Model
- ADR-007: Task Snapshot Contract
- [LexRunner Principles](../PRINCIPLES.md): cumulative intelligence, durable delta,
  retry delta, and principle provenance
- [Orchestration Primitives](../architecture/orchestration-primitives.md): Ecosystem 3.1
  `adopt | adapt | defer | reject` research record
- STFC `docs/AGENT_WORKTREE_BROKER.md`: executable workspace-lease prior art
- STFC `docs/AGENT_ORCHESTRATION.md`: bridge/background-agent authority model
- LexRunner issues #367, #390, #699, #706, #709, #766, #762, #767, and #801
