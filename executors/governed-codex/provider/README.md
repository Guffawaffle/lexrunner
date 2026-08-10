# Disposable WSL2 governed Codex provider

This provider supports the checked-in synthetic corpus and host-exported, exact committed repository
corpora. Its public protocol is `inspect`, `prepare`, `prepare-repository`, `discard-repository`,
`attest`, `launch`, `observe`, `continue`, `cancel`, `collect`, and `release`; `worker` and `finalize`
are internal systemd entry points.

Codex 0.145 freezes a thread's tool inventory, so the phase-one offer and resumed phase expose the
same read-only shell capability. Phase one has an empty corpus and qualification fails if any tool
event occurs before the decision. `NO` immediately emits a terminal decline. `ACCEPT` permits a
durable accepted receipt, but the provider remains paused until the host has latched that receipt,
authorized the exact work invocation, and calls `continue` with the original authorization on stdin.
Only then can a second, freshly attested process resume the exact Codex thread with the selected
sealed corpus mounted read-only. The resumed agent may still answer exactly `NO`; otherwise the provider and
the independent Windows verifier both validate the final response against the authorized JSON
Schema included in the resumed prompt. The schema is not imposed as a Codex process-level output
constraint because that would make bare `NO` unreachable. The outer bubblewrap view hides Windows
mounts, provider state, credential seeds, homes,
`/run`, and local IPC. The image replaces WSL's `/mnt/wsl` resolver symlink with a root-owned regular
`/etc/resolv.conf` before `/mnt` is hidden. A transient user service owns the process cgroup with
`KillMode=control-group`; its
`ExecStopPost` records cancellation or loss if the worker cannot do so itself.

A root-owned `/etc/codex/requirements.toml` constrains Codex to read-only/never-approve operation and
adds an admin-enforced deny-read rule for the per-Attempt Codex home. Codex itself can load its
credential and session state; sandboxed shell descendants cannot read them. The requirements-file
hash is part of the executor configuration attestation.

`governed_repository_corpus_exporter.py` is a separate root-owned, fixed-argv boundary. It accepts
only a canonical bounded request on stdin, verifies native repository/allocation/worktree directory
identities and the Attempt marker, requires a clean committed descendant of the bound base, and uses
sanitized `/usr/bin/git` object reads to produce regular-file bytes plus the exact binary patch. It
disables replacement-object resolution, rejects `refs/replace`, cryptographically verifies every
file against its candidate-tree blob object ID, and preserves that binding in the sealed manifest.
It never exports `.git`, repository configuration, remotes, credentials, symlinks, gitlinks,
special files, or working-tree dirt.
`prepare-repository` independently validates the framed hashes and seals the resulting candidate,
patch, and metadata. `discard-repository` is idempotent only for an unreferenced sealed corpus;
operation-bound corpora remain until terminal `release`.
Qualification also fails unless the provider's attested Git executable is exactly `/usr/bin/git`,
the fixed executable used by the repository exporter; test-only path overrides cannot qualify a
repository-review image. Legacy qualification manifests without the execution-profile binding are
rejected and must be replaced by a fresh live qualification before the upgraded provider can run.

`observe` replays a provider-only, mode-0600 event spool and then blocks on inotify. The Windows host
must persist each raw frame to the operator-only protected evidence store before publishing its safe
coordination event. The spool is restart recovery material, not admissible evidence by itself.
After the terminal event and result are durably recorded and the Windows capture is terminal, the
host calls `release` to delete the transient WSL copy. A pre-terminal release fails closed.
If the worker cannot start before a provider handle is returned, the provider stops any partially
created user unit, removes the unreachable spool, and deletes the sealed corpus only when no other
operation references it.

The executable fails closed unless a root-owned qualification manifest names every required denial
control with strong evidence references. Creating that manifest is a separate canary step; installing
the provider alone does not qualify an environment.

`qualification_canary.py` exercises the exact installed image. A root caller can pipe its successful
report into `install_qualification.py`, together with the two hashes from a freshly verified Windows
protected-evidence capture. The report and installer bind the exact provider, Codex, bubblewrap,
repository exporter, Git executable, and Git version. The installer recomputes installed hashes and
writes a 24-hour manifest plus root-readable qualification evidence. These tools qualify the
provider image; they do not accept repository-review inputs themselves.
