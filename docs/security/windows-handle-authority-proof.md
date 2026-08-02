# Native Windows handle-authority proof

Issue #888 validates the kernel and deployment assumptions behind the `windows-native`
`WorkspaceBoundary`. It is a proof-only executable and does not participate in production runtime
selection.

## Proven claim

On a native Windows NTFS volume, a live process can hold a root and its ancestor chain by directory
handle, derive stable volume/file identity and final paths from those handles, reject junctions,
exclude rename/delete replacement, run capability-relative file and Git probes, and release all
authority when the broker process exits. Persisted identity evidence and stale capability data do
not recreate authority.

The proof does not claim arbitrary command containment, mutation durability, production helper
integrity, or release-signer trust. ReFS, UNC paths, device namespaces, and volume aliases fail
before mutation until each has separate conformance evidence.

## Reproduction

Run from native Windows. The optional unsupported root must identify a real non-NTFS filesystem;
it is not a test override.

```powershell
cd proofs\windows-workspace-boundary
.\verify.ps1
# Optional additional fail-closed control on a real non-NTFS volume:
.\verify.ps1 -UnsupportedRoot R:\existing-directory
```

The script uses the pinned .NET 8 SDK to build and publish a self-contained `win-x64` NativeAOT
executable. It runs the published hostile suite and writes ignored artifacts under `artifacts/`:

- `proof-receipt.json`: digested capability, case, and cleanup evidence with no capability token;
- `signing-receipt.json`: proof that a disposable copy accepted an Authenticode signature and that
  changing a hashed byte produces `HashMismatch`.

The signing test never writes to a certificate store and never trusts the ephemeral signer.
Production releases still require an approved Authenticode identity, manifest digest, protocol
version, and architecture check.

## Hostile matrix

| Protection              | Positive observation                                                                    | Negative control                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Handle identity         | Case, `..`, and extended local paths converge on one volume/file ID                     | Durable identity evidence cannot prevent substitution after handles close                      |
| Filesystem capability   | NTFS succeeds                                                                           | The actual ReFS checkout is identified from a handle and rejected before mutation              |
| Rename/delete exclusion | Root and ancestor rename/delete fail while operational handles omit `FILE_SHARE_DELETE` | Allowing delete sharing redirects the caller path while the handle retains the original object |
| Reparse policy          | A junction is identified by handle tag and rejected                                     | Following the junction redirects direct file and Git probes outside the grant                  |
| Bounded operations      | Capability-rendered in-root file and Git probes succeed                                 | Rooted and parent-traversal arguments fail with `containment_violation`                        |
| Lease fencing           | A current private-pipe capability performs an identity assertion                        | Killing the broker releases handles; a new session rejects the prior capability                |

No case uses WSL, Docker, administrator mode, or developer-mode symlink privileges. Junctions are
created inside an isolated NTFS temporary root using ordinary same-user permissions.

## Kernel findings

1. `FILE_READ_ATTRIBUTES` alone is insufficient for the exclusion claim on the tested kernel. The
   authority handle must request `FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES`, use
   `FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT`, and omit `FILE_SHARE_DELETE`.
2. Every ancestor must remain open for the lease. Once handles close, a valid identity digest is
   evidence only and cannot stop component replacement.
3. Process binding may render a canonical DOS path only while the helper retains all exclusion
   handles through child creation and exit. Caller-rendered authority paths remain forbidden.
4. NativeAOT publishing succeeds even when the shell omits `OS=Windows_NT` if MSBuild derives the
   property with `MSBuild::IsOSPlatform('Windows')`. Runtime/platform routing remains detection
   based.

## Protocol recommendation for #890

The production helper should be one bounded child per Node client over inherited private pipes.
Use length-prefixed canonical JSON rather than the proof's JSON-lines transport, with a 4 KiB
control-frame limit and explicit larger bounded payload frames for file content and process output.

The first frame must bind protocol version, helper artifact identity, architecture, process ID,
and a fresh 256-bit session nonce. Lease capabilities must be random, scoped to that session,
coordinator lease revision, owner, root identity set, allowed verbs, and expiry. They remain only in
private pipe traffic and memory; receipts contain digests and lineage, never capability bytes or
raw native handles.

Every request is a strict tagged union. Unknown fields, operations, versions, rooted paths, `..`,
unbound directories, stale sessions, and oversized frames fail before effect. The helper renders
all filesystem and process paths from live capabilities, retains authority handles for the complete
operation, and emits start plus terminal receipts with `no_effect`, `effect_recorded`, or
`effect_unknown`. Broker death invalidates the entire session. #837 must own process-tree lifetime;
#892 must define durable mutation and reconciliation before that claim can become true.
