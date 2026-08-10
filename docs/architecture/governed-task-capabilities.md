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
host grant authority resolves the exact protected task plus the complete grant chain and authorizes
the root operator issuer. The evaluator rechecks every identity and hash, requires the selected grant
to be active at the explicit authorization instant, and verifies every delegated link with the
shared attenuation evaluator. Caller-supplied task or grant bodies are never authority, and a child
cannot claim a capability its protected parent did not hold.

The caller likewise selects only an adapter identity and version; a trusted host qualification
authority resolves the exact manifest and an active qualification receipt bound to its hash and
protected evidence. A caller-supplied authority matrix is never enforcement evidence. The resolved
adapter must meet every granted capability's enforcement floor, so an `unenforced` authority
dimension cannot be converted into permission by accepting a task.

`NO` is universal Delegation behavior. A task profile cannot require a rationale or reinterpret
refusal as a failed task result.

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

The existing governed review path remains on its read-only v1 authorization contract. It should be
migrated by introducing a `code-review` task profile over the generic task contract, not by adding
write exceptions to review schemas. A second non-review profile must prove that the protocol,
operation store, supervisor, refusal behavior, and evidence store require no task-specific changes.
