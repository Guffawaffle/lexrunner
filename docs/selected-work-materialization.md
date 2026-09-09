# Selected-work materialization

This internal pure conversion boundary in `src/runs/selected-work-materialization.ts`
constructs one WorkItem and existing AgentTaskPacket from an explicitly selected,
dependency-free Execution Plan 1.0.0 item. It is not registered as a CLI/MCP operation
and is not yet a user-facing journey. It performs no I/O, preparation or dispatch.

The caller supplies exact UTF-8 source text and its expected SHA-256 digest, selected
item ID, stable work/criterion IDs, repository/base identity and explicit packet
policy. Requests and artifacts are bounded to 256 KiB. Unknown versions, ambiguous
selection, dependent work, repository mismatch, invalid criteria and nonportable
packet content fail with bounded diagnostics. No requirements are invented.

Source descriptions, technical context and constraints are explicitly composed into
existing packet instructions. Scope, authority, verification and budget stay exactly
as supplied. These prose requirements do not become enforced runtime policy. Old
packet formats, hashing and callers remain unchanged; old source specs may omit the
optional context. The entire source byte digest remains distinct from the resulting
semantic packet hash, including when only source whitespace changes.

The returned correspondence binds source bytes, selected item, normalized WorkItem,
criterion mapping, run/attempt IDs and the actual constructed packet hash. Outcome
and work-plan references are explicitly supplied and unverified. Caller-supplied
digests establish consistency, not acceptance, freshness or trusted provisioning.

A later preparation adapter must compare the real returned packet hash and attempt
identities with this correspondence before claiming preparation binding. Actual worker
observation, receipts and verification remain separate. Nonempty dependencies are
unsupported in this first slice; the converter never declares them satisfied.

Validation uses actual project and packet schemas, including existing agent-work
schema fixtures. It establishes construction behavior, not live issue creation,
worker execution or outcome fulfillment. Publication and public-surface adoption
remain separate delivery steps.
