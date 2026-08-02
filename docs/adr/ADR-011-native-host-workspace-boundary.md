# ADR-011: Native-host WorkspaceBoundary

**Status:** Accepted
**Date:** 2026-08-01
**Authors:** lexrunner team

---

## Context

LexRunner's physical worktree boundary is currently Linux-specific. It derives authority from
held directory descriptors, device/inode identity, no-follow traversal, procfs descriptor paths,
and native-filesystem checks. Native Windows currently fails closed and the optional WSL
projection path is consequently treated as a prerequisite in several callers.

String canonicalization, `realpath`, or a pre-spawn identity check cannot provide parity: another
same-user process can replace a checked path before Git consumes it. Native Windows requires a
handle-owning implementation, while persisted paths and identities must remain evidence rather
than reusable authority.

The complete threat model, current authority inventory, and hostile-race conformance matrix are in
[Native-host WorkspaceBoundary threat model](../security/workspace-boundary-threat-model.md).

## Decision

LexRunner will introduce the versioned `WorkspaceBoundary` contract in
`src/workspaces/workspace-boundary.ts`. Version `1.0.0` separates:

- a capability decision produced by the runtime resolver;
- digest-bound, backend-specific directory identity evidence;
- an opaque live lease and directory capabilities that cannot be serialized;
- capability-rendered process arguments, so callers cannot supply an authority path;
- operation and lease receipts with explicit lineage and effect state; and
- bounded, versioned errors that distinguish no effect, recorded effect, and unknown effect.

Production runtime selection accepts only `{ mode: "native" }` or
`{ mode: "explicit_projection", profile_id }`. Native selection probes the actual host and
backend artifact. It does not accept a platform, backend, test, or environment override. Tests may
construct backends directly as conformance fixtures, but cannot change the production resolver's
decision. WSL projection is optional and selected only by explicit configuration; Windows native
operation never probes WSL as a prerequisite.

### Windows implementation technology

The native Windows boundary will be a small out-of-process **.NET NativeAOT helper** using
`SafeHandle` plus narrow P/Invoke definitions for the required Win32 APIs. The Node parent starts
one bounded child over inherited private pipes; the helper is not a globally addressable service.
The helper owns directory handles, validates capability/lease IDs, renders bound process paths,
launches Git, and retains the required handles for the child lifetime.

| Candidate         | Decision factors                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| .NET NativeAOT    | Selected. Self-contained single-file deployment without an installed runtime; mature `SafeHandle`, Win32, process, signing, and Windows test support; no Node ABI coupling. The cost is RID-specific artifacts and explicit P/Invoke review. |
| Rust              | Viable but not selected. Strong ownership and good Win32 bindings, but adds a second systems-language toolchain and a larger maintenance/signing burden for this repository without improving the required OS semantics.                     |
| Node native addon | Rejected. It puts the expanded native trusted computing base inside the orchestration process, couples releases to Node/V8 ABI and toolchain variants, and turns native memory faults into coordinator failure.                              |

Release builds will produce architecture-specific, self-contained artifacts. Each production
artifact is Authenticode-signed and listed by digest and protocol version in the package release
manifest. The resolver verifies presence, digest, signature, architecture, protocol, and helper
self-probe before returning `ready`. Development-unverified helpers can be inspected but cannot
advertise a ready production capability. Distribution must not depend on an install-time download
or on WSL.

The #888 proof confirmed this selection on native Windows. A self-contained `win-x64` NativeAOT
executable builds and runs without an installed application runtime. A disposable copy can be
Authenticode-signed and its embedded signature and hash enforcement validated without trusting
the ephemeral development signer. Production capability detection must still verify the release
signer and manifest digest; the proof signature is never production authority.

The proof also revised one handle detail: a metadata-only `FILE_READ_ATTRIBUTES` directory handle
did not exclude rename of the exact directory on the tested Windows/NTFS kernel. Authority handles
therefore request `FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES`, use
`FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT`, and omit `FILE_SHARE_DELETE`.
Negative controls demonstrated caller-path redirection when that operational access/share
combination, held ancestors, or no-follow validation was removed.

### Exact claim

For a live boundary lease, a capability-bound filesystem or process operation cannot be redirected
to a substituted directory object through path replacement, aliasing, symlink/reparse traversal,
or caller-rendered path text. Ambiguous identity, unsupported semantics, stale leases, unavailable
helpers, and unknown effects fail closed.

### Non-claims

This decision does not claim arbitrary command containment, filesystem secrecy, credential or
network isolation, gate authorization, descendant-process ownership, safe same-principal sharing
of writable Git internals, or crash-durable Windows mutation. #831 owns structural Attempt
containment, #835 owns gate/environment/artifact authority, #837 owns process trees, and #892 owns
mutation durability and external recovery. WorkspaceBoundary receipts are inputs to those systems,
not substitutes for them.

## Versioning

The schema and semantic contract use SemVer.

- Patch versions may clarify messages or add optional receipt metadata without changing a claim.
- Minor versions may add an operation, error/reason code, or optional capability claim while all
  existing v1 inputs and guarantees retain their meaning.
- Major versions are required to change identity semantics, weaken or redefine a claim, make a
  field required, alter digest domains, or change lifecycle/effect interpretation.

Backends declare their implementation and protocol versions separately from the contract version.
Resolvers reject unsupported major protocol versions. Canonical digests are domain-separated by
contract major version and receipt kind.

## Migration and rollback

#887 adds the contract and documents the target behavior but changes no production routing, store,
or existing Attempt record. #889 wraps the Linux implementation and must pass every existing Linux
hostile-race test before callers move. #891 adds a backend-neutral native-host execution mapping
while retaining read/verify support for the existing `native_linux` v1 mapping and native-WSL
records.

Persisted records are never rewritten in place merely because a new backend is installed. New
Windows Attempts use the new mapping version; existing Linux and projection Attempts retain their
original bytes and digest lineage. Rollback may make new Windows Attempts non-executable by an
older binary, but it must leave them inspectable/preserved and must not delete, reinterpret, or
repair their stores. A later binary can resume only after capability, lease, mapping, and
reconciliation checks succeed.

## Linux non-regression rule

The shared interface is not permission to replace descriptor-relative Linux operations with
canonical path strings. `O_DIRECTORY | O_NOFOLLOW`, device/inode checks, held ancestors, procfs
descriptor paths, filesystem rejection, immediate pre-spawn identity checks, and current negative
controls remain mandatory. Any shared-conformance abstraction that cannot express those semantics
is rejected rather than used to narrow the Linux guarantee.

## Consequences

- Windows can become a first-class native host without WSL.
- The Windows helper expands the trusted computing base, release matrix, signing work, and
  protocol compatibility surface.
- Callers must use opaque capabilities and backend-rendered arguments rather than paths as
  authority.
- Unsupported filesystems and unavailable/unverified helpers remain hard failures.
- Durability and broader containment claims stay visibly false until their separate conformance
  work passes.

## Proof evidence

The reproducible proof, hostile cases, machine-readable receipt format, and production protocol
recommendations are documented in
[Native Windows handle-authority proof](../security/windows-handle-authority-proof.md). The proof
is intentionally separate from production routing: passing it does not make the development
helper eligible for a `ready` capability decision.
