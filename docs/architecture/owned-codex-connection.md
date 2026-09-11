# Owned Codex connection (development surface)

`src/runs/owned-codex-connection.ts` implements the transport interface consumed by
the Codex worker dispatcher. It owns one native stdio child and creates one idle,
ephemeral, read-only session. Returned cwd, thread identity, approval policy and
optional requested model must match before the connection is returned. Caller
adapter labels identify the proposed binding; they do not qualify the host.

The executable, workspace and Codex home are explicit absolute paths. No shell is
used, argv is fixed, and environment forwarding uses an allowlist. The caller owns
selection and protection of those paths, executable and configuration. This is
ordinary development launch code, not an independent bootstrap root, authenticated
installation, sandbox attestation or protected native workspace preparation.

Only `turn/start` for the owned thread is exposed. Per-turn settings overrides are
rejected. The connection attempts at most one send; abort, timeout or connection
loss never triggers replay. The dispatcher still owns durable claims and authority
decisions. Possession of this transport alone is not permission to dispatch work.

Shutdown closes stdin, waits three seconds, then attempts to kill only the owned
child and waits another three seconds. Its disposition reports whether child exit
was observed and whether execution may have started. It does not prove descendant
cleanup or cancellation of accepted remote work. Bootstrap cleanup uncertainty is
an explicit error.

Protocol output is bounded to 1 MiB per frame and 8 MiB per stream over the entire
connection. Unexpected responses, server requests, premature execution and changed
thread identity terminate the connection. Notifications retain only bounded method
counts, and stderr retains only byte counts. Terminal turn notifications additionally
enter an explicit bounded evidence queue; see [terminal event capture](worker-turn-evidence.md).
The caller must persist that queue explicitly. It does not establish task completion
or a verified task receipt. Long-running sessions that exceed the bounds fail explicitly.

Run the idle native probe with `npx tsx scripts/probe-owned-codex-connection.ts`
followed by an absolute Codex executable path and a **new** absolute output directory.
The probe creates an isolated home and workspace, sends no model turn, checks the
wrong-thread guard and unchanged sentinel, and writes a hash-bound `receipt.json`.
It does not copy authentication. Echoed read-only settings and a stable sentinel
are bounded observations, not enforcement proof. Qualified preparation, durable
receipt verification and late-observation reconciliation remain prerequisites for
the intended live dogfood path. No public CLI/MCP command or default provider is
activated by this source-only slice.
