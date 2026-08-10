# Governed task capabilities

Governance is not synonymous with read-only execution. The reusable boundary is a task-bound,
attenuating capability grant around an agent that remains free to choose how it achieves the
objective within that authority.

The current governed code-review runtime is one deliberately read-only task profile. Its denial
controls and `PASS`/`BLOCK` output are not the general agent contract.

## Generic initiation boundary

Every governed task composes the same lifecycle:

1. an ADR-010 Attempt owns the workspace and durable lifecycle;
2. a profile binds the input contract, output contract, and independent verifier by hash;
3. a positive capability ceiling declares the most authority the task may receive;
4. a selected worker receives an offer and may answer `ACCEPT` or `NO`;
5. after `ACCEPT`, an attenuated grant is checked against the ceiling before work is released;
6. the executor emits bounded events and protected evidence for independent verification.

The caller supplies only the Attempt, Delegation, task-spec hash, and authority-grant hash. A trusted
host grant authority resolves aligned protected task/grant chains, authorizes the root operator
issuer, and supplies the protected accepted offer. The evaluator rechecks every identity and hash,
binds the selected task hash and grant hash to that offer, verifies its worker provider against the
task-authorized provider, and requires the selected grant to be active at the explicit authorization
instant. Caller-supplied task, grant, provider, or offer bodies are never authority.

Every delegated link passes the shared exact-subset attenuation evaluator. It must also carry a
granted `nested_delegation` capability whose effect hash exactly binds the protected child task's
canonical capability ceiling. A child therefore cannot claim authority its parent did not hold or
authority excluded by the parent's child-ceiling decision.

The caller likewise selects only an adapter identity and version; a trusted host qualification
authority resolves the exact manifest and an active qualification receipt bound to its hash and
protected evidence. It must also resolve one protected enforcement receipt per granted capability.
Each receipt binds the manifest, adapter qualification, complete capability hash, scope hash, effect
policy hash, achieved enforcement level, evidence, and validity window. Missing, duplicated, stale,
or mismatched receipts fail closed by capability ID. A coarse authority dimension or caller-supplied
authority matrix is never enough to prove an owned write scope, rollback path, external consequence,
runtime containment, or sensitive-data policy.

`NO` is universal Delegation behavior. A task profile cannot require a rationale or reinterpret
refusal as a failed task result.

All four generic budget dimensions are authorization, not suggestions. Duration and output limits
must match the execution requirements; evidence bytes and tool calls must match the durable capture
reservation. Independent verification measures the sealed capture and refuses admissibility after
any overrun, even when the provider reports successful completion.

## Positive capability model

Absence from the capability ceiling is denial, but declared capabilities are real permission—not
advisory labels. Each capability binds an authority dimension, opaque capability identity, protected
scope hash, minimum enforcement level, and effect policy.

Effect policies distinguish:

- `observation`: no mutation is represented;
- `workspace_mutation`: writes are confined to an Attempt-owned scope with a bound discard or
  snapshot-restore path;
- `external_effect`: the consequence scope is bound, together with either a compensating action or
  explicit acceptance that the effect is irreversible;
- `runtime_execution`: an agent may freely use a runtime inside a bound containment profile;
- `sensitive_data_access`: secret scope and the required handling policy are both bound;
- `delegation`: child work is constrained by a bound child-authority ceiling.

The dimension-to-effect mapping is total. Filesystem reads are observation only; filesystem writes
are recoverable workspace mutations; Git writes distinguish workspace recovery from external
effects; GitHub writes, network access, signing, and release are externally consequential; external
runtimes bind containment; secrets bind sensitive-data handling; and nested Delegations bind their
child ceiling. An unrelated effect class is rejected rather than interpreted optimistically.

## Write-capable executor qualification

The generic contract makes writes representable; it does not make an unqualified backend safe. A
write-capable executor profile must separately demonstrate:

- an isolated, Attempt-owned writable root while host and credential roots remain outside it;
- kernel-enforced scope matching the capability and packet write scopes;
- a snapshot or disposable-workspace rollback path usable by a separate controller process;
- before/after filesystem and Git identity evidence bounded to the operation;
- cancellation and descendant reaping without losing the recovery path;
- brokered, separately scoped credentials and network access when those capabilities are present;
- explicit handling for durable external effects that rollback cannot undo.

The desired freedom lives inside the qualified boundary: arbitrary problem-solving and tool choice
are welcome when the outer environment enforces the declared effects. Command allowlists alone are
not treated as a conformant sandbox.

## Migration boundary

The governed review path now creates and durably verifies a `code-review` profile over the generic
task contract; it does not add write exceptions to review schemas. After durable `ACCEPT` and before
task continuation, the operation service resolves the protected task, operator-issued attenuated
grant, accepted offer, adapter qualification, and per-capability enforcement receipts through the
generic evaluators. The legacy read-only executor grant remains only a compatibility transport and
must match the generic grant's selected dimensions. Review output interpretation likewise lives in
the bound profile, not the generic independent verifier. A second non-review profile must now prove
that the protocol, operation store, supervisor, refusal behavior, and evidence store require no
task-specific changes.
