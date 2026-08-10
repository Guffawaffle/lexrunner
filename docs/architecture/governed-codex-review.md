# Governed Codex review

This runtime is a deliberately read-only code-review profile, not the universal governed-agent
contract. Review-neutral task/profile and positive capability semantics—including recoverable
writes—are defined in [Governed task capabilities](governed-task-capabilities.md). The runtime now
expresses its task semantics through the generic `code-review` profile. Its existing executor grant
remains a compatibility transport, but it cannot release work unless the protected generic grant
and exact qualified adapter independently evaluate for the bound task.

Status: governed synthetic and exact committed repository-corpus review are available through the
persistent asynchronous CLI.

## Runtime shape

```text
running ADR-010 Attempt -> offered Delegation -> provider offer turn
                                                   |             |
                                                   NO          ACCEPT receipt
                                                   |             |
                                                   v             v
                                            terminal decline   durable host latch
                                                                  |
                                                                  v
                                                  generic task/grant/adapter evaluation
                                                                  |
                                                                  v
                                                        exact work authorization
                                                                  |
                                                                  v
                                                        idempotent continue gate
                                                                  |
                                                                  v
                                                      same-thread read-only review
                                                                  |
                                                                  v
protected raw frames -> durable safe events -> terminal result -> independent verifier receipt
```

The start adapter accepts only an already-running ADR-010 Attempt. It creates a real offered
Delegation and launches only the provider's offer phase. A detached supervisor performs one durable
recovery inventory when it starts. Each attached operation then waits on the provider event stream.
It does not poll process status or heartbeat a model worker.
Stopping the supervisor aborts only the observation client; it does not cancel or mark the durable
provider operation lost.

The provider pauses after its ACCEPT receipt. The host persists the Delegation acceptance and the
safe operation event, resolves the protected generic task and attenuated grant, evaluates the exact
qualified adapter and per-capability enforcement receipts, authorizes the exact `authorized_work`
invocation, and only then sends the compatibility authorization on stdin to `continue`. The legacy
read-only tool grant must describe exactly the same selected capability dimensions, so it cannot
bypass or silently expand the generic grant. If either the generic task or its execution binding is
absent, a legacy offer remains refusal-only: direct work is denied and `ACCEPT` is durably recorded
but cannot cross the continuation boundary. The root generic grant must also name the exact operator
principal in the protected authorization requirements; merely claiming operator issuance is not
sufficient. That gate is idempotent. Restart recovery replays it when a crash occurs after durable
ACCEPT but before continuation; it cannot invent an acceptance.

## Refusal

`NO` is terminal from either the still-offered refusal turn or an accepted continuation. A reason is
optional and, when volunteered, is protected evidence rather than CoordinationStore content. The
Delegation decline is latched before provider cancellation. No later provider event is accepted for
that operation.

## Evidence

The Stage 1 root is `%LOCALAPPDATA%\LexRunner\protected-evidence\stage1-v1`. Its Windows DACL is
protected and grants one inheritable Full Control rule to the current operator SID. A resident
operator-side helper re-attests that ACL and flushes directory metadata with a Win32 directory handle;
it has no evidence read or export command.

Raw frames use a length-delimited SHA-256 chain. A capture becomes complete only after seal and a
fresh read-back verification. Tamper, missing frames, overflow, elapsed-time overflow, sink failure,
and prohibited credential canaries fail closed. CoordinationStore receives only bounded references,
bindings, counters, and hashes. Reservation tokens and physical paths are never stored there.

The provider's mode-0600 JSONL spool exists only for crash recovery while the host capture is open.
Once a terminal event/result is durable and the Windows capture is complete or incomplete, the host
issues an opaque-handle `release`. The provider rejects release before terminality and then removes
the transient WSL copy. A host crash before that acknowledgement leaves the spool available for
restart attachment.

## Provider boundary

The host bridge accepts only disposable distribution names matching `lexrunner-attempt-<hex>`, invokes
an absolute provider executable with `wsl.exe --exec`, and never invokes a shell. Authorization and
attestation inputs use canonical JSON on stdin. Launch uses a binary stdin frame containing bounded
metadata followed by the prompt. Provider observation is JSONL and event-driven.

Codex 0.145 freezes a thread's tool inventory. The exact-thread two-phase protocol therefore exposes
the same granted read-only shell capability in both phases. Before acceptance, the task corpus is
absent, sensitive mounts and credentials are outside the tool sandbox, and qualification fails on
any tool event. After the host continuation gate, a fresh attested process resumes the exact thread
with either the synthetic corpus or a sealed repository corpus mounted read-only. A future Codex
release with dynamic tool-surface reduction may permit a genuinely voice-only offer without giving
up exact-thread continuity.

For repository review, the runtime reopens the authoritative Attempt, active workspace lease,
immutable task packet, immutable launch envelope, and exact native path mapping. A root-owned,
fixed-argv exporter then requires a clean native-Linux Git worktree whose committed candidate HEAD
descends from and differs from the bound base. It reads regular-file bytes from Git objects, emits
the exact base-to-candidate binary patch, verifies every file byte sequence against the blob object
ID recorded by the candidate tree, and carries those IDs into the independently rehashed manifest.
It rejects untracked or ignored dirt, symlinks, gitlinks, special modes, replacement directory
identities, external Git admin state, and non-canonical paths. Repository config, remotes, `.git`,
credentials, and working-file contents are never placed in the corpus.

The provider independently rehashes and seals the framed corpus under its private state root. Only
the sealed candidate, patch, and bounded metadata enter `/workspace`, read-only, after durable
ACCEPT. A failed pre-launch path discards an unreferenced sealed corpus; a referenced corpus cannot
be discarded and is removed only with its terminal operation spool.

Repository review requires a current qualification manifest whose execution-profile hash binds the
installed provider, repository exporter, Git executable and version, Codex, bubblewrap, managed
requirements, and two-phase feature set. Pre-profile manifests fail closed after upgrade.

Repository invocation authorization and durable operation creation each query the Attempt, active
workspace lease, immutable envelope, and task-packet bindings inside the same SQLite transaction as
their authorization event or operation insert. The post-ACCEPT work authorization repeats that
guard before the provider can resume with the sealed corpus. If a lease changes while the
action-free offer process starts, operation creation fails and cancels/releases that process. The
independent verifier separately requires the bound lease to remain active and at least as current
as the launch-envelope revision.

The resumed prompt includes the authorized result schema, but Codex is not process-constrained by
`--output-schema`: a process-level object schema would make the agent's bare `NO` unreachable. If
the agent proceeds, the provider validates its final JSON before classifying the claim. The
independent Windows verifier replays the protected frame chain, proves the same-thread ACCEPT and
thread-binding receipt, rejects work before the host's durable ACCEPT receipt, and validates the
final JSON again. Only its immutable receipt can elevate the status projection to `admissible`; the
provider result is persisted as `inadmissible`.

The verifier does not receive or reconstruct raw prompt bytes. The durable task offer names the
exact generic `GovernedTaskSpec` hash. That protected task binds the `code-review` input/output
contracts, objective, model provider, sealed-corpus read scope, budgets, and independent verifier.
The verifier reconstructs the expected profile from the prompt hash, output-schema hash, and
independently attested corpus identity, then requires an exact task hash and offer-provider match.
The generic verifier dispatches outcome interpretation through that exact profile/verifier binding;
only the `code-review` profile maps its own `PASS`/`BLOCK` vocabulary to coordination outcomes, and
it treats `PASS` with any blocking finding as invalid. Generic provider claims, results, status
projections, and independent receipts carry a bounded profile-owned outcome identifier rather than
enumerating review verdicts; the receipt accepts it only after the exact profile verifier succeeds.
Duration and output limits are independently cross-checked against the authorization requirements;
evidence bytes and tool-call limits are cross-checked against the durable evidence reservation. The
verifier then measures the independently read capture lifetime, final output bytes, total protected
evidence bytes, and completed tool events and rejects any exact task-budget overrun.
Prompt transport and hashing therefore remain inside the attested host/provider launch trusted base;
independent raw-prompt reconstruction is not claimed. For repository review, the verifier also
reopens the Attempt, lease, packet, envelope, and path mapping and requires their hashes and
identities to match the protected corpus receipt.

The qualified executor currently requires all of the following:

- exact authorization-to-executor/environment/workspace attestation hashes;
- `jsonl-stdin` executor protocol;
- a protected evidence capture bound to the same authorization;
- `corpus_kind: synthetic` or an exact provider-sealed `repository` corpus;
- for repository review, exact Attempt/lease/packet/envelope/path, candidate-tree, patch, task-offer,
  prompt, and output-schema bindings;
- model output marked inadmissible until an independent verifier accepts the capture.

## CLI surface

Available now:

```text
lex-pr attempt delegation synthetic ...
lex-pr attempt delegation status ...
lex-pr attempt review start --database-path <db> --run-id <run> --attempt-id <running-attempt> \
  --distribution <lexrunner-attempt-hex> --environment-id <id> --objective <text> \
  --prompt <file|-> [--repository] --json
lex-pr attempt review status --database-path <db> --operation-id <id> --json
lex-pr attempt review verify --database-path <db> --operation-id <id> \
  --verification-id <id> --json
lex-pr attempt review supervise --database-path <db> --operation-id <id> \
  --distribution <lexrunner-attempt-hex> --json
```

`start` returns after spawning the detached event-driven supervisor. `supervise` is the explicit
restart/recovery entry point. `verify` never accepts an evidence path; it re-attests and reads the
fixed operator-only evidence root internally. Without `--repository`, `start` retains the bounded
synthetic corpus used by the protocol canaries. With `--repository`, it fails closed unless the
Attempt has the complete clean committed native-WSL lifecycle binding described above.
