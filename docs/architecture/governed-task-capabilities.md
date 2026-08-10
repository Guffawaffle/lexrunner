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

Grant evaluation also requires the grant to be active at the explicit authorization instant and the
selected adapter to meet every granted capability's enforcement floor. An `unenforced` authority
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
- `delegation`: child work is constrained by a bound child-authority ceiling.

Filesystem writes cannot masquerade as observation. Git writes must identify whether they are
recoverable workspace changes or durable external effects. GitHub writes, signing, and release
authority always declare external-effect semantics.

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
