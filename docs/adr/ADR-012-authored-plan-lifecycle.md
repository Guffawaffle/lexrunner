# ADR-012: Explicit Authored-plan Lifecycle and Trusted Evidence Projection

**Status:** Accepted — implementation pending
**Date:** 2026-08-29
**Authors:** lexrunner team

---

## Context

ADR-001 makes a frozen execution plan the sole integration-time plan input. LexRunner now resolves
that plan consistently and can produce strongly bound gate receipts plus a digest-indexed evidence
manifest. The current status surface deliberately reports those artifacts as
`authority: "unverified"`: caller-writable files can prove internal integrity, but a self-hash cannot
prove who was authorized to execute a gate or verify its outcome.

The remaining authored-plan lifecycle is fragmented. Callers can select a file, profile adapters can
resolve another file, generation is separate from import, and there is no ratified selection,
archive, or supersede contract. Adding an ambient active-plan directory or treating any valid
receipt as trusted would violate ADR-001 and permit hidden mutable state to change integration
truth.

This ADR defines the boundary needed by issue #865. It does not itself change production routing or
make current gate evidence authoritative.

## Decision

LexRunner separates immutable integration inputs from optional stateful coordination:

```text
optional coordination alias --resolve once--> immutable PlanArtifactReference
                                                 + explicit EvidenceArtifactReference
                                                 + current repository candidate
                                                               |
                                                               v
                                                    trusted verifier invocation
                                                       |                 |
                                              canonical audit receipt    opaque process-local
                                                                       verified projection
                                                                               |
                                                      +------------------------+------------------+
                                                      |                                           |
                                                   status                                  merge effect boundary
```

Integration services remain stateless. Every plan-consuming operation receives an immutable plan
artifact reference, or receives a coordination alias that an adapter resolves and freezes before
calling integration. Evidence is always an explicit input. Integration never scans directories,
reads an ambient selected-plan setting, or consults a mutable registry while making a decision.

### Plan artifact identity and reference

`ExecutionPlanArtifact_v1` is the immutable, content-addressed integration input. It consists of
exact canonical bytes plus a versioned, domain-separated canonicalization and hash profile. Its
identity binds artifact kind, contract and plan schema versions, digest algorithm and digest, byte
length, target, and bounded item summary. A path, URL, database key, timestamp, mutable object, or
target name is not an artifact identity.

The current `PlanArtifactIdentity` remains a compatible public projection while the stronger
artifact contract is introduced. `PlanArtifactReference_v1` adds transport and retrieval binding
without putting a physical path into semantic identity. It contains the complete artifact identity,
expected digest and byte length, a bounded adapter-owned retrieval reference, and separate scope
metadata when the authored plan is repository-specific.

Portable content identity and authority scope are distinct. Identical canonical plan bytes retain
one digest across machines, but a registration, selection, resolution, or evidence receipt also
binds tenant, workspace, repository identity, branch/ref namespace, and policy scope. Scope is not
salted into the portable plan digest merely to simulate authority.

Absolute paths, file handles, profile directories, and coordination row identifiers are adapter
details. They are not part of portable plan identity or public diagnostics.

Import has two distinct operations:

1. **Validate and canonicalize** opens one explicit bounded source, parses once, canonicalizes once,
   and returns the exact canonical bytes plus identity. The adapter must use a stable handle or an
   equivalent no-follow identity check across open, read, and final metadata verification. Path
   replacement, symlink/junction/reparse traversal, hard-link ambiguity, truncation, and concurrent
   mutation fail closed. The current separate `stat` then pathname `read` implementation does not
   yet satisfy this immutable-artifact claim.
2. **Register** optionally writes those exact canonical bytes to a coordination-owned append-only,
   content-addressed store, re-reads and verifies the persisted object, and returns its identity.
   Registration is idempotent by canonical digest and does not select the artifact.

Callers may validate without registering. Registration cannot modify or replace bytes already
stored under an identity. A digest collision or persisted-byte mismatch fails closed.

Repository-root and profile fallback remain backward-compatible adapter resolution. Neither is a
selected-plan registry or a source of ambient integration state.

### Optional selected-plan coordination state

An `active` or `selected` plan is optional coordination convenience, never integration truth. The
selection record contains a workspace/repository scope, immutable plan artifact reference, monotonic
revision, fencing token, mutation-idempotency key, selector identity, and observation time.

Every selection mutation requires the expected revision and a live coordination authority fence.
An integration adapter resolves the alias exactly once, records a durable resolution receipt with
the scope, alias revision/fence, and artifact reference, and passes only that immutable reference
downstream. The stateless core never receives an alias or coordination store. Later alias changes
cannot affect an in-flight status, gate, or merge decision. Selecting A, then B, then A again still
produces a new revision, preventing ABA confusion.

A bad explicit alias or reference fails without falling through to `latest`, a directory scan,
repository `plan.json`, or profile `plan.json`. Compatibility fallback is labeled as such and
snapshotted into an immutable reference before any authority-bearing work.

Archive and supersede preserve history:

- Archive is metadata and an event marking an immutable registered artifact unavailable for new
  selection. It never deletes or rewrites the artifact, revokes its prior evidence, declares it
  failed, or invalidates an already resolved in-flight reference. Archived artifacts remain readable
  by immutable identity for audit.
- Archiving a selected artifact fails unless the same revision-fenced transaction explicitly clears
  or repoints the selection.
- Supersede registers a new immutable artifact with a directional predecessor link. It never mutates
  the old artifact, selection, evidence, or in-flight reference.
- Retention cleanup may remove physical bytes only through a revision-fenced transactional tombstone
  that first prevents new selection, resolution, or reference acquisition. It then rechecks all
  durable references, waits or refuses while live resolution leases exist, and deletes only the
  exact file/object identity. Crash or rollback preserves either readable bytes or a durable
  fail-closed tombstone. Missing retained bytes fail closed; they are not reconstructed from a
  similarly named file.

A mutation key is scoped by tenant, workspace, repository, operation kind, and authorized actor.
The stored result binds that composite identity. A retry with the same scoped key and identical
payload returns the prior result. Cross-scope reuse or reuse with a different payload conflicts. A
stale revision or fence never succeeds because a retry is otherwise well formed.

### Evidence identity and satisfaction states

Every evidence reference names an exact artifact kind, digest, plan digest, item and gate or typed
requirement identity, candidate identity, producer claim, and verifier policy/version. A bundle may
select a bounded subset, but omission never satisfies an unmentioned required gate.

Status uses evidence-specific vocabulary:

```text
pending | satisfied | failed | not_applicable | stale | mismatched
```

`pending` means applicable evidence is absent. `not_applicable` must come from the authored plan,
not from evidence omission. `stale` means formerly applicable evidence no longer binds the current
candidate or retained premise. `mismatched` means the evidence names a different plan, item, gate,
definition, attempt, timeout, producer, verifier, or artifact. Stale or mismatched bundles project
nothing and return bounded failure diagnostics.

`unverified` is an authority classification, not a satisfaction state. Integrity-valid but
unverified evidence leaves an applicable requirement `pending`.

Verifier outcomes such as `inconclusive` and infrastructure failure are also orthogonal to
satisfaction. Status reports satisfaction, verifier/admissibility, eligibility, and mutation
authority separately; an observed or inconclusive pass can never render as merge-ready.

Issue #857 owns typed review, CI, artifact, manual, and decision evidence plus per-item
applicability. This ADR fixes their common identity and authority boundary without adding those
types to the command-gate slice.

Issue #855 owns batch-pyramid conversion. A converter may synthesize canonical execution-plan bytes
and pass them into this validate/import lifecycle, optionally registering the resulting immutable
artifact. Conversion does not own selection, archive, evidence authority, verifier trust,
eligibility, or integration truth.

### Trusted verification and authority

Integrity-valid caller evidence remains an observation. Re-reading and re-hashing a manifest plus
receipts cannot make them authoritative when the caller controls all those bytes and hashes. Such
evidence may populate a clearly typed observation-only projection/state for diagnostics, as current
`loadGateEvidence` does, but it can never enter the authority-bearing eligibility state or
`MergeEligibilityEvaluator`. The observation and authority types/APIs must be separated before any
trusted projection is wired.

There are two valid authority paths:

1. A governed executor runs the gate inside the current process under an independently authorized
   execution profile and returns an invocation-local opaque projection for the exact unchanged
   candidate. The integration service never queries mutable Attempt, Run, lease, or coordination
   state; any governed authority is resolved before integration into that invocation-local
   capability.
2. A separate status or merge process verifies an authenticated verifier receipt whose exact trust
   root, scope, and policy are embedded in the immutable plan or pinned there by the exact digest of
   an immutable authority snapshot. The signing capability is isolated from the gate and caller by
   its governed execution boundary.

The same-process `ExecutionState` produced directly by governed execution may support an immediate
eligibility preview. Once reduced to JSON or caller-writable files, that authority is lost. It does
not become reusable status evidence.

For cross-process use, a trusted application service independently verifies the authenticated
receipt and all explicitly referenced protected evidence. It does not sign or bless a caller's
interpretation of arbitrary paths and hashes. It validates, at minimum:

- exact plan identity and expected canonical bytes;
- evidence manifest and receipt digests;
- tenant/workspace/repository/ref scope; item and canonical gate definition; attempt and retry
  lineage; effective command/argv/cwd/environment profile; timeout; timing; and outcome bindings;
- repository identity plus complete candidate identity before and after evidence reads;
- duplicate, conflicting, partial, oversized, replaced, or escaped evidence; and
- the verifier identity/version plus binary, configuration, policy, trust-root epoch, signature, and
  authority profile authorized by the frozen plan's exact trust policy or immutable authority
  snapshot; and
- the explicit plan-authorized revocation proof, monotonic sequence, trusted evaluation interval,
  and signature.

The service returns two different products:

1. a canonical, bounded verification receipt for audit; and
2. a service-private, invocation-local verified capability for the current operation.

The receipt hash makes serialized evidence tamper-evident. The authorized signature establishes
cross-process provenance only within its frozen plan scope. A valid signature from an unlisted or
incorrectly scoped signer remains unverified. An ambient keyring, caller-provided key, producer
signature, self-hash, or mutable global signer registry is insufficient.

Deserialized receipts still do not directly populate eligibility state. The verified capability is
non-exported and non-constructible outside its issuer, nominally branded by service-private state,
and checked against an issuer-owned registry. It binds verifier invocation/operation ID plus the
complete eligibility snapshot. It is one-shot or explicitly lease-bounded, cannot cross CLI/MCP or
JSON transport, and is invalid after consumption, effect completion, verifier scope exit, or any
candidate, pinned-policy, revocation-sequence, or validity-deadline premise change. A structurally
identical caller object is rejected.

Only the capability returned by the current trusted verifier invocation after signature, scope,
evidence, and candidate checks may create authority-bearing eligibility state. When the plan has no
applicable pinned verifier trust policy, status remains pending.

New positive verifier trust, key rotation, or broader policy requires a new immutable plan or a new
immutable positive-authority snapshot referenced by that plan. Negative revocation does not grant or
retarget authority and must remain able to fail closed for an already-authored plan.

The plan therefore pins the identity and policy of an authorized revocation authority. Every
admissibility decision and final merge consumes an explicit immutable, signed
`VerifierRevocationSnapshot_v1` or non-revocation proof from that authority. It binds the subject
key/policy, monotonic epoch/sequence, statement digest, trusted `checkedAt` and `validUntil`, and
signature. It may only deny or stale previously frozen positive authority. It cannot grant a key,
select a plan, replace evidence, or expand scope.

The required revocation input is resolved once into the eligibility snapshot. Final mutation obtains
or validates a still-current proof and fails when it is missing, expired, revoked, or superseded by
a newer signed sequence. Historical evidence remains attributable to its old plan, but a compromised
or revoked issuer cannot remain admissible merely because an older signature is cryptographically
valid. Conflicting evidence fails closed. Policy selects an explicit evidence set and attempt; it
never uses any-pass-wins, newest timestamp, filesystem order, or highest attempt number.

Authority remains layered: observation, verifier/admissibility receipt, policy eligibility decision,
and separately authorized merge mutation are distinct. A manual override is its own audited bypass
receipt and never masquerades as `PASS`. LexThority or an equivalent policy authority owns actual
authority decisions; a gate name, configured persona, coordination record, or verifier assertion
does not.

### Status and merge share one authority boundary

Status and execute-mode merge consume the same immutable eligibility snapshot and verified
projection contract. The eligibility decision receipt binds the plan, scope, alias-resolution
revision, candidate, selected evidence, and exact pinned verifier-policy or authority-snapshot
digest plus the explicit revocation snapshot/proof digest, sequence, `checkedAt`, and `validUntil`.
Coordination store state is not an integration input.
Status may display
unverified observations alongside pending eligibility, but it cannot elevate them. Execute-mode
merge must freshly verify or consume a still-live opaque projection at the final effect boundary,
then recheck expected base/target refs, candidate, artifact and evidence bytes, policy/trust epoch,
decision revision, explicit negative-only revocation proof, and authority fence before preparing or
resuming mutations. Positive policy/trust uses the exact plan-pinned digest, never an ambient current
grant epoch or store revision. The plan-authorized revocation proof may only deny or stale that
positive authority. Any change makes the decision stale. Merge never re-resolves a newly selected
alias inside the in-flight decision.

Dry-run merge may report order and pending evidence without mutation. Mutation authorization is
necessary but not sufficient: a clean worktree and generic execute permission cannot replace
verified eligibility.

### Failure, retry, and idempotency

Factual verification is deterministic for one semantic premise. Its identity binds the plan,
repository/candidate, evidence artifact digests, bounded selection, verifier identity,
implementation, and pinned policy/authority-snapshot digest. Repeating that same premise is
idempotent.

Admissibility and eligibility are separate decisions over the factual verification. Their identity
also binds the exact plan-defined expiry premise, selected policy inputs, and explicit revocation
snapshot/proof digest and sequence. Every decision and invocation-local capability carries trusted
`checkedAt` and `validUntil`; it is rejected at or after expiry, including at the final effect
boundary. A changed positive trust policy or authority snapshot requires a new plan, while a newer
negative revocation proof creates a new decision and can only deny. A cached green decision cannot
survive either change or its validity deadline.

Three retry contracts remain distinct:

1. Repeating factual verification under the same premise is idempotent and creates no new
   eligibility state.
2. A plan-defined command-gate retry creates a new immutable gate receipt/ordinal bound to its
   predecessor and frozen command, environment, timeout, and authority profile. It is not
   automatically an ADR-010 Attempt.
3. A governed orchestration retry creates a new ADR-010 Attempt bound to its immediate predecessor,
   inherited evidence, and meaningful retry delta or explicit policy exception.

An alias, plan, candidate, or gate-definition change creates a new integration decision rather than
silently reusing a retry. Failures leave a bounded durable receipt when safe, name a stable reason
code, and never partially project a bundle. Crash recovery repeats fresh verification from explicit
immutable references; it does not infer success from a temporary file, prior log, or incomplete
receipt.

All reads and outputs are bounded. Public diagnostics exclude commands, output bodies, credentials,
absolute paths, raw plan/evidence bytes, and host-sensitive identifiers. Limits, truncation, and
omission are explicit rather than silently broadening reads.

Clock age alone does not establish freshness. Candidate equality, evidence identity, producer or
authority revision, and any plan-defined expiry establish whether evidence remains current.

Retries remain bounded by plan and policy. A retry cannot weaken the command, environment, timeout,
required gates, verifier, or authority. Failure, timeout, infrastructure error, and inconclusive
remain distinct, and later success does not erase prior evidence. Duplicate identical submission is
a no-op; the same request or receipt identity with different bytes is corruption; late stale
attempts remain audit evidence but cannot advance state.

## Security invariants

1. One integration invocation resolves one immutable plan identity exactly once.
2. Alias revision changes cannot alter an in-flight decision.
3. Evidence is accepted only through an explicit reference plus expected digest; there are no
   ambient scans.
4. Plan, candidate, item, gate definition, attempt, timeout, outcome, producer, and verifier
   identities must agree.
5. Candidate identity is captured before and after verification; any change rejects the bundle.
6. Duplicate, conflicting, partial, stale, mismatched, replaced, or path-escaped evidence fails
   closed and projects nothing.
7. Producer claims never become verifier findings.
8. Serialized receipts never become an authoritative projection merely by being valid or signed by
   an unauthorized or incorrectly scoped key.
9. Missing verifier authority leaves status pending and blocks execute-mode merge.
10. Status and merge use the same eligibility semantics; neither can bypass the other.
11. Archive and supersede preserve immutable history and cannot silently change selection.
12. A failed verification leaves no partial authority-bearing eligibility-state update.
13. Portable content equality never substitutes for tenant, repository, candidate, or policy scope.
14. Append-only artifacts remain retained while selected, in flight, or referenced by evidence,
    decisions, or audit history.
15. A protected signer independently observes governed execution; it cannot serve as an oracle over
    caller-supplied pass claims.
16. Cross-process verifier trust comes only from the immutable plan or its exact immutable
    authority-snapshot reference; integration never queries mutable Attempt or coordination state.
17. Invocation-local verified capabilities are issuer-private, non-serializable, call-bound, and
    rejected after consumption or premise invalidation.
18. Eligibility and mutation decisions bind the exact pinned trust-policy digest and are never
    reinterpreted against an ambient current positive-grant policy.
19. A plan-authorized explicit revocation proof may only deny or stale frozen positive authority;
    missing, expired, revoked, or superseded proof blocks final mutation.
20. Eligibility capabilities and decisions expire at their trusted `validUntil` and are rechecked at
    the effect boundary.

## Exact claim and non-claims

After the implementation slices below pass, LexRunner may claim that merge eligibility advances
only from a fresh trusted projection bound to one immutable plan, current candidate, explicit
evidence set, and either plan-pinned authenticated verifier trust or a direct invocation-local
governed execution capability.

This ADR does not claim that current caller evidence is trusted, that hashes establish provenance,
that all gate execution is contained, that non-command evidence exists, that a selected alias is
required, that external checks or remote refs are deterministic, or that a signature alone grants
merge authority. Cross-process receipts are reusable only under the authenticated, scoped, exact
plan-pinned trust policy defined here. Issue #835 owns gate execution
authority and containment dependencies; issue #857 owns heterogeneous evidence; issue #837 owns
descendant cleanup.

## Dependency-ordered implementation slices

1. Add `PlanArtifactReference_v1` and bounded adapter resolution while preserving the current
   identity and explicit-file behavior.
2. Add the independent coordination-owned immutable registry and revision-fenced selection service
   with shared memory/SQLite conformance tests.
3. Add archive and supersede semantics on that registry, including selected-artifact rejection or
   atomic revision-fenced clear/repoint.
4. Add the minimal command-gate evidence policy, plan-pinned positive verifier
   trust/authority-snapshot contract, and plan-authorized negative-only revocation proof required by
   #865. This does not add heterogeneous evidence or imply an executor exists.
5. Extract the shared pure evidence validator and add the authenticated verifier receipt, strict
   schema, signature/scope checks, stable semantic ID, and hostile anti-forgery/TOCTOU tests.
6. Add the trusted verifier service and unforgeable invocation-local capability while preserving the current
   `authority: "unverified"` observation lane.
7. Route the same eligibility contract through status and execute-mode merge prepare/resume
   boundaries. The authenticated-receipt path can be tested independently of a LexRunner-owned
   executor.
8. Expose explicit inputs and bounded results consistently through CLI, SDK MCP, and the published
   MCP server.
9. Under #835 and its authority/containment dependencies, add governed gate execution whose verifier
   signing capability is unavailable to gate code and callers. Until then, LexRunner cannot claim
   its local gate executor produces reusable authoritative receipts.
10. Under #857, extend the common policy and verifier for typed per-item applicability and
    heterogeneous evidence without weakening the command-gate boundary.

Each slice requires independently testable schemas and application services. A later slice cannot
weaken or bypass an earlier authority boundary.

## Required acceptance and fault matrix

The lifecycle is not complete until executable tests cover:

- source path replacement, reparse/symlink traversal, hard-link ambiguity, truncation, and mutation
  during import;
- concurrent selection compare-and-swap, A-to-B-to-A revision fencing, idempotent replay, and stale
  fences, including cross-scope mutation-key reuse;
- select/archive and select/supersede races, archive while in flight, archived evidence reads, and
  retention refusal while referenced;
- concurrent reference acquisition versus GC, plus crash between tombstone and exact-object delete;
- alias changes between resolve and gate, status and merge, and restart/recovery;
- cross-tenant, repository, candidate, plan, item, gate, attempt, timeout, and policy replay;
- coherent caller forgery/re-hashing, signer-oracle requests, unauthorized or revoked verifier
  keys/configuration, and trust-epoch rotation;
- fabricated structural capability objects, cross-call substitution, double consumption,
  post-return retention, and attempted JSON/CLI/MCP transport;
- candidate/base/ref/policy mutation after a verified pass and immediately before merge;
- revocation or non-revocation proof expiry between status and merge, a newer signed revocation
  sequence, missing final-effect proof, and trusted-clock deadline crossing;
- conflicting pass/fail evidence, explicit multi-attempt selection, and retry-delta enforcement;
- CLI, SDK MCP, and published MCP parity with bounded privacy-safe diagnostics; and
- restart persistence plus shared in-memory/SQLite coordination conformance. Future durable adapters
  must pass the same behavior suite before claiming parity.

## Migration and rollback

Existing explicit plan files and v1 unverified evidence remain readable. They continue to report
observations but remain unable to advance eligibility. New reference and verifier contracts are
additive until every CLI/MCP consumer supports them.

Rollback may remove new coordination conveniences or trusted-verifier routing, but it must return
to pending/unverified behavior. It must not reinterpret serialized verification receipts as
authority, rewrite registered artifacts, or delete retained history.

## Consequences

### Positive

- Authored plans gain one coherent lifecycle without weakening ADR-001.
- Status and merge can eventually consume real evidence without trusting caller-controlled JSON.
- Selection remains useful coordination state without becoming hidden integration truth.
- Archive, supersede, retry, and recovery preserve auditable identity.

### Negative

- Fresh verification adds latency and explicit inputs to status and merge.
- Opaque process-local authority cannot be cached or transported as ordinary JSON.
- Coordination selection requires revision fencing and retention accounting.
- Cross-process reuse remains unavailable until the authenticated-signer path is implemented and
  proven. LexRunner-owned receipt issuance additionally requires governed execution under #835.

## Alternatives considered

### Re-hash caller evidence and trust it

Rejected. A caller can coordinate the manifest, receipt, and hashes. Integrity is not provenance or
execution authority.

### Let status consume validated evidence while merge remains unchanged

Rejected. It would create inconsistent truth and leave the effect boundary bypassable.

### Make a selected-plan alias the default integration input

Rejected. Mutable ambient state could silently change decisions and would contradict ADR-001.

### Store integration truth in the coordination database

Rejected. Coordination may store immutable artifacts and aliases, but integration consumes only
resolved immutable references and explicit evidence.

### Trust any locally signed verifier receipt

Rejected. Ambient keys and caller-selected signers are not authorized by the frozen plan. A
protected signer that merely signs caller-supplied pass claims is still a forgery oracle.

## References

- [Issue #865](https://github.com/Guffawaffle/lexrunner/issues/865) — authored-plan lifecycle
- [Issue #855](https://github.com/Guffawaffle/lexrunner/issues/855) — batch-pyramid conversion
- [Issue #857](https://github.com/Guffawaffle/lexrunner/issues/857) — per-item and non-command evidence
- [Issue #835](https://github.com/Guffawaffle/lexrunner/issues/835) — gate execution authority
- [Issue #837](https://github.com/Guffawaffle/lexrunner/issues/837) — descendant cleanup
- [ADR-001](./ADR-001-plan-json-frozen-input.md) — frozen integration input
- [ADR-010](./ADR-010-agent-work-orchestration-protocol.md) — governed Attempt verification
- [LexRunner Principles](../PRINCIPLES.md) — durable and retry deltas
- [LexRunner 2.0.0 release boundary](../releases/2.0.0.md) — unverified evidence observation
