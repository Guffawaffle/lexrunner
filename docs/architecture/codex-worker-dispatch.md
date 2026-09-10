# Foreground Codex dispatch bridge

Status: explicit application composition over an injected, already-connected
transport. No launcher, public CLI/MCP command, default runtime, or qualified
native workspace profile is enabled here. Tests use a controlled transport and
synthetic lifecycle evidence; they do not execute a model task.

`CodexWorkerDispatcher` constructs one `turn/start` request from the persisted
canonical packet and envelope, targeting the attached session's worker ID. There
are no caller-supplied prompt, model, cwd or sandbox overrides. The request uses
the documented [Codex app-server turn/start shape](https://learn.chatgpt.com/docs/app-server).
The entire serialized request is bounded to256KiB before claiming; returned turn
identities are opaque nonempty strings bounded to4096UTF-8 bytes at this transport
boundary. These limits do not change the underlying lifecycle ID domains.

Before calling the transport, the bridge:

1. Validates the stored packet hash, envelope and session identities.
2. Repeats adapter negotiation using the session's durable adapter binding and
   recorded trust-gap acceptance, and checks the enforcement summary matches.
3. Obtains a fresh per-session dispatch claim bound to the exact request digest.
4. Obtains a fresh packet-derived `external_runtime` decision from the existing
   authority service, persisting only the action class and request hash.
5. Checks the dispatch initiation window against the observed controller and
   workspace lease expiry, then calls the supplied transport once.

The response wait is bounded by that window and30seconds. Timeout requests
best-effort abort; it does not prove cancellation, stop an accepted model turn,
or establish revocation of an external effect already in flight. This retains
the existing direct-operation broker semantics, not process containment. The
injected transport is trusted same-process code and must not retry internally,
substitute another thread, or enqueue a request after its initiation deadline.
The host must bind and qualify that connection and its sandbox before real use.

A repeated claim with no acknowledgement returns `reconciliation_required`.
A repeated acknowledged claim returns the retained turn ID without calling the
transport. Provider failure, timeout or malformed acknowledgement retain delivery
uncertainty. A failed acknowledgement write returns the observed turn ID but does
not claim durable acknowledgement. The current store rejects late writes after
the session/lease becomes invalid; late observations need a separate reconciliation
path. Neither branch retransmits the task automatically.

Claim/authority persistence failures also return uncertainty without sending.
Denied authority consumes no provider effect, but the claim remains retained;
this conservative slice cannot recycle it for another send. A later Attempt
must follow normal loss/retry/changed-premise rules. Receipt collection, engine
verification and acceptance remain separate; a turn acknowledgement proves none
of them.

The foreground host remains responsible for wait-only creation, canonical
attachment through the shared service, qualified workspace preparation, appropriate
adapter enforcement/trust-gap acceptance, and transport lifecycle management.
This module neither upgrades accepted trust gaps to enforcement nor turns the
dispatch store into a new authority source. Native preparation and a real one-task
dogfood run remain outstanding integration evidence.

Run the bounded bridge checks with:

```sh
npx vitest run tests/runs/codex-worker-dispatch.spec.ts --maxWorkers=1
```
