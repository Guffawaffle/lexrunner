# Governed Codex review

Status: synthetic-only provider integration. Repository-corpus launch is deliberately unreachable.

## Runtime shape

```text
Delegation offer -> ACCEPT / NO latch -> exact authorization
                                         |
                                         v
operator-only evidence reservation -> provider launch by stdin
                                         |
                                         v
provider AsyncIterable -> protected raw frame -> safe operation event
                                         |
                                         v
terminal wake-up -> fresh evidence verification -> result pending/recorded
```

The supervisor performs one durable recovery inventory when it starts. Each attached operation then
waits on the provider event stream. It does not poll process status or heartbeat a model worker.
Stopping the supervisor aborts only the observation client; it does not cancel or mark the durable
provider operation lost.

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
any tool event. After `ACCEPT`, a fresh attested process resumes the exact thread with only the
synthetic corpus mounted read-only. A future Codex release with dynamic tool-surface reduction may
permit a genuinely voice-only offer without giving up exact-thread continuity.

The resumed review receives the authorized result schema through a separate read-only bubblewrap
mount and Codex's `--output-schema` option. The provider then validates the final JSON again before
classifying its task outcome.

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
lex-pr attempt review status --database-path <db> --operation-id <id> --json
```

There is no public governed review launch command yet. The provider now passes the synthetic
systemd/cgroup, outer-bubblewrap, exact-resume, output-schema, protected-evidence, cancellation, and
descendant-reaping exercise, but its verdict remains `inadmissible` until an independent verifier
accepts the protected capture. Public asynchronous launch also needs the durable Delegation
acceptance and Attempt-operation lifecycle wired to the real provider rather than a diagnostic
script. Repository-corpus launch remains a separate, deliberately unreachable policy transition.
