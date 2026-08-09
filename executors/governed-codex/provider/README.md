# Disposable WSL2 governed Codex provider

This provider is intentionally limited to the checked-in synthetic corpus. Its public protocol is
`inspect`, `prepare`, `attest`, `launch`, `observe`, `cancel`, `collect`, and `release`; `worker` and
`finalize` are internal systemd entry points.

Codex 0.145 freezes a thread's tool inventory, so the phase-one offer and resumed phase expose the
same read-only shell capability. Phase one has an empty corpus and qualification fails if any tool
event occurs before the decision. `NO` immediately emits a terminal decline. `ACCEPT` permits a
second, freshly attested process to resume the exact Codex thread with the synthetic corpus mounted
read-only. The authorized JSON Schema is mounted as a separate read-only file and passed to the
exact resumed turn with `--output-schema`; the provider also validates the final response
independently. The outer bubblewrap view hides Windows mounts, provider state, credential seeds, homes,
`/run`, and local IPC. The image replaces WSL's `/mnt/wsl` resolver symlink with a root-owned regular
`/etc/resolv.conf` before `/mnt` is hidden. A transient user service owns the process cgroup with
`KillMode=control-group`; its
`ExecStopPost` records cancellation or loss if the worker cannot do so itself.

A root-owned `/etc/codex/requirements.toml` constrains Codex to read-only/never-approve operation and
adds an admin-enforced deny-read rule for the per-Attempt Codex home. Codex itself can load its
credential and session state; sandboxed shell descendants cannot read them. The requirements-file
hash is part of the executor configuration attestation.

`observe` replays a provider-only, mode-0600 event spool and then blocks on inotify. The Windows host
must persist each raw frame to the operator-only protected evidence store before publishing its safe
coordination event. The spool is restart recovery material, not admissible evidence by itself.
After the terminal event and result are durably recorded and the Windows capture is terminal, the
host calls `release` to delete the transient WSL copy. A pre-terminal release fails closed.

The executable fails closed unless a root-owned qualification manifest names every required denial
control with strong evidence references. Creating that manifest is a separate canary step; installing
the provider alone does not qualify an environment.

`qualification_canary.py` exercises the exact installed image. A root caller can pipe its successful
report into `install_qualification.py`, together with the two hashes from a freshly verified Windows
protected-evidence capture. The installer recomputes installed hashes and writes a 24-hour manifest
plus root-readable qualification evidence. These are qualification tools, not a repository-review
launch surface.
