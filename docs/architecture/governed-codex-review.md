# Governed Codex review

Status: synthetic-only provider integration. Repository-corpus launch is deliberately unreachable.

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
safe operation event, authorizes the exact `authorized_work` invocation, and only then sends the
original authorization on stdin to `continue`. That gate is idempotent. Restart recovery replays it
when a crash occurs after durable ACCEPT but before continuation; it cannot invent an acceptance.

## Refusal

`NO` is terminal. A reason is optional and, when volunteered, is protected evidence rather than
CoordinationStore content. The Delegation decline is latched before provider cancellation. No later
provider event is accepted for that operation.

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
with only the synthetic corpus mounted read-only. A future Codex release with dynamic tool-surface reduction may
permit a genuinely voice-only offer without giving up exact-thread continuity.

The resumed prompt includes the authorized result schema, but Codex is not process-constrained by
`--output-schema`: a process-level object schema would make the agent's bare `NO` unreachable. If
the agent proceeds, the provider validates its final JSON before classifying the claim. The
independent Windows verifier replays the protected frame chain, proves the same-thread ACCEPT and
thread-binding receipt, rejects work before the host's durable ACCEPT receipt, and validates the
final JSON again. Only its immutable receipt can elevate the status projection to `admissible`; the
provider result is persisted as `inadmissible`.

The verifier does not receive or reconstruct raw prompt bytes. Prompt transport therefore remains
inside the attested host/provider launch trusted base at this stage; independent exact-prompt
reconstruction is not claimed.

The qualified executor currently requires all of the following:

- exact authorization-to-executor/environment/workspace attestation hashes;
- `jsonl-stdin` executor protocol;
- a protected evidence capture bound to the same authorization;
- `corpus_kind: synthetic`;
- model output marked inadmissible until an independent verifier accepts the capture.

The adapter rejects `corpus_kind: repository` before provider launch.

## CLI surface

Available now:

```text
lex-pr attempt delegation synthetic ...
lex-pr attempt delegation status ...
lex-pr attempt review start --database-path <db> --run-id <run> --attempt-id <running-attempt> \
  --distribution <lexrunner-attempt-hex> --environment-id <id> --objective <text> \
  --prompt <file|-> --json
lex-pr attempt review status --database-path <db> --operation-id <id> --json
lex-pr attempt review verify --database-path <db> --operation-id <id> \
  --verification-id <id> --json
lex-pr attempt review supervise --database-path <db> --operation-id <id> \
  --distribution <lexrunner-attempt-hex> --json
```

`start` returns after spawning the detached event-driven supervisor. `supervise` is the explicit
restart/recovery entry point. `verify` never accepts an evidence path; it re-attests and reads the
fixed operator-only evidence root internally. Repository-corpus launch remains a separate,
deliberately unreachable policy transition.
