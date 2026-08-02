# Native-host WorkspaceBoundary threat model

This document is normative for `WorkspaceBoundary` version `1.0.0`. It defines the path and
directory-object authority that native Linux and native Windows backends must provide. The
existing Linux implementation remains the reference guarantee until the shared runtime routing
work in #889 is complete.

## Security claim

For one live boundary lease, an operation authorized for a captured directory object cannot be
redirected to a different directory object by replacing, aliasing, or reparsing the caller's path.
Every authority-bearing child lookup starts from a held parent capability, every process path is
rendered from held capabilities by the backend, and identity ambiguity fails before a new effect.

A serialized identity or receipt is evidence, not authority. Live authority is an opaque
`WorkspaceBoundaryDirectoryCapability` owned by a `WorkspaceBoundaryLease`; it cannot be
reconstructed from a canonical path, volume/file ID, device/inode pair, digest, or stored Attempt
record.

## Explicit non-claims

The boundary does not:

- sandbox arbitrary code, hide host files, remove network access, or isolate credentials (#831);
- decide whether a gate or worker was granted execution, environment, artifact, or mutation
  authority (#835);
- own, limit, or reap process descendants after the boundary-launched process starts (#837);
- make mutually hostile processes under the same OS principal safe to share writable Git
  internals;
- prove the semantic safety of a Git command or file payload;
- make canonical hashes proof of helper provenance or live capability possession; or
- claim crash-durable Windows mutation or external restore until #892 lands and its claim bit is
  true.

## Attacker and trust model

Attacker-controlled inputs include repository content, Git metadata readable by the worker,
requested relative paths and names, persisted records that have not passed schema and digest
validation, CLI/MCP request bodies, process timing, and concurrent same-user path rename/reparse
attempts. A compromised repository may create symlinks, junctions, mount points, unexpected
case aliases, `.git` indirection, long paths, and processes that race every check.

Trusted components are the coordinator/store fencing transition, the production runtime resolver,
the selected backend implementation, the operating-system handle APIs, the exact signed Windows
helper artifact selected by the resolver, and Git only for the bounded operation it is explicitly
asked to perform. The npm package, helper manifest, and signing chain are distribution inputs that
must be verified before a Windows decision can report `ready`.

The host kernel, administrator, filesystem driver, release signing key, and code already running
with enough privilege to duplicate/close another process's handles are outside this boundary. A
malicious administrator or kernel can defeat it. Network filesystems are supported only after
backend-specific conformance proves stable identity, final-path, sharing, and durability semantics;
otherwise capability detection reports `unsupported_filesystem`.

## Current authority inventory

| Surface                             | Current Linux identity dependency                                                                                                                            | Contract destination                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Broker construction                 | Capture repository, `.git`, and allocation-root device/inode through component-wise `O_NOFOLLOW` opens                                                       | `resolve` then `acquire` root capabilities                         |
| Worktree create                     | Reopen roots, hold target ancestors, reserve the final child, run Git through `/proc/<pid>/fd`, and write the Attempt marker through held Git-admin identity | `openChild`, `createChild`, `assertCurrent`, `runProcess`          |
| Worktree observe                    | Hold repository/worktree identities while reading the Git registry, marker, HEAD, and status                                                                 | lease-scoped read and process operations                           |
| Worktree remove                     | Revalidate exact Attempt marker, branch, cleanliness, registry entry, and held target before removal; preserve ambiguity                                     | identity-bound mutation and receipt                                |
| Native-WSL preparation              | Hold source/native/staging/lock/quarantine identities, run source Git after preflight, and sync selection publication                                        | explicit projection resolver plus Linux boundary                   |
| Launch mapping                      | Recapture repository, allocation, and worktree device/inode and persist a digest-bound claim                                                                 | backend-neutral identity receipt in #891                           |
| Worker attach/heartbeat/end/status  | Revalidate the persisted mapping and current directory identities before lifecycle authority advances                                                        | resolve stored backend identity and recapture through its boundary |
| Receipt verification and acceptance | Revalidate the same mapping before verification or acceptance can advance                                                                                    | backend-neutral mapping verification                               |
| Workspace reconciliation/restore    | Reconstruct targets only from the durable lease, observe through the broker, and preserve identity ambiguity                                                 | acquire from durable lease lineage; reconcile receipts             |
| Fan-in/delivery authority           | Depends on accepted verification and canonical Attempt/lease/envelope evidence; it must not synthesize paths from adapter input                              | consume the already verified backend/mapping lineage               |

No production caller is moved in #887. #889 moves the existing Linux primitives behind the
interface without changing behavior. #891 migrates mapping consumers and runtime routing.

## Backend invariants

1. **Verified selection.** Production selects a backend from observed host capabilities. The only
   request choice is native discovery or an explicit projection profile.
2. **Held identity.** A directory capability is created from an open directory object and records
   its handle-derived stable identity and final canonical path.
3. **No-follow traversal.** Every existing component is opened relative to a held parent without
   following a symlink or disallowed reparse point.
4. **Held ancestors.** Ancestor capabilities remain live until the dependent operation completes.
5. **Replacement-resistant process binding.** The backend, not its caller, renders capability
   arguments. Linux uses descriptor paths. Windows retains rename/delete exclusion handles,
   revalidates identities, launches the process itself, and keeps the handles through process
   creation and lifetime.
6. **Fenced lease.** A boundary lease binds the coordinator lease ID/revision, owner, capability
   decision, backend, and roots. A stale or closed lease cannot start another effect.
7. **Truthful receipts.** Results distinguish `completed`, `rejected`, and `indeterminate`, plus
   `no_effect`, `effect_recorded`, and `effect_unknown`. Unknown effects never become success.
8. **Receipt/capability separation.** A receipt can be persisted and replayed for verification but
   cannot recreate the opaque live capability.

## Platform mechanics

### Linux native

The current implementation opens directories with `O_DIRECTORY | O_NOFOLLOW`, records device and
inode, checks filesystem type, holds each ancestor descriptor, obtains the final path through
procfs, and gives Git `/proc/<pid>/fd/<fd>` paths. A rename after final preflight may move the
authorized object, but it cannot redirect the in-flight command to a replacement; the next
operation fails because the configured path no longer names the captured identity. Native WSL
Linux filesystems use this same backend. DrvFS/9P remains rejected.

### Windows native

The helper opens directories with `CreateFileW`, `FILE_FLAG_BACKUP_SEMANTICS`, and
`FILE_FLAG_OPEN_REPARSE_POINT`. It derives volume/file identity and the normalized final path from
the held handle, inspects every reparse tag against an allowlist, and holds the complete ancestor
chain. Authority handles omit `FILE_SHARE_DELETE` whenever replacement exclusion is required.

Windows path comparison is case-insensitive, but identity is never lowercased path text. Drive,
UNC, and extended-length inputs normalize to the handle-derived final path and volume/file ID.
Device paths, unsupported namespaces, remote filesystems without proven semantics, ambiguous
case/final-path results, and unknown reparse tags fail closed. The helper launches Git or another
declared process only after rendering capability references itself and retains the authority
handles until that process exits.

The initial Windows backend may advertise `durable_directory_mutation: false`. It may not claim
crash-durable publication, destructive cleanup, or external restoration until #892 defines and
passes flush, atomic replace, sharing-violation, crash-injection, and reconciliation tests.

## Hostile-race conformance matrix

Every backend must run the shared semantic tests plus its primitive tests. A negative control must
demonstrably fail when the named protection is removed; a skipped negative control cannot support
a `ready` claim.

| Invariant               | Linux positive / negative control                                                                                                                          | Windows positive / negative control                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified selection      | Real procfs/native-filesystem probe selects Linux; injected platform input is rejected / remove procfs and require `unsupported`                           | Signed helper self-probe selects Windows with WSL absent / alter helper hash, signer, or protocol and require failure before helper use                                      |
| Held root identity      | Open and recapture the same device/inode / replace the configured root between capture and acquire                                                         | Open and recapture the same volume/file ID / rename and substitute the configured root before acquire                                                                        |
| No-follow traversal     | Real directory chain succeeds / insert a symlink at each component and require rejection                                                                   | Real directory chain succeeds / insert symlink, junction, mount point, and unknown reparse tag at each component and require rejection                                       |
| Held ancestor chain     | Rename an ancestor after open and prove the capability still names the original object / close an ancestor early and require conformance failure           | Attempt ancestor rename/delete while exclusion handles are held and observe denial / allow `FILE_SHARE_DELETE` or release an ancestor and require canary redirection failure |
| Final path and identity | Exact native spelling round-trips through procfs / alias or deleted/replaced path fails current-location assertion                                         | Drive, UNC, long-path, and case variants converge on one handle identity / device namespace, unsupported UNC filesystem, or mismatched final path fails closed               |
| Process binding         | Git receives only descriptor-derived repository/worktree paths / pass original path, swap it after preflight, and require the canary to expose redirection | Helper launches while exclusion handles remain held / launch from caller-rendered path or release handles before spawn and require canary redirection                        |
| Git admin containment   | Worktree `.git` target opens component-wise beneath held repository `.git` / external, relative, symlinked, or swapped gitdir is rejected                  | Worktree Git admin path resolves beneath held repository identity / junction, case alias to another volume, or swapped admin directory is rejected                           |
| Lease fencing           | Current coordinator revision performs; closed/stale revision rejects / replay a prior lease after close                                                    | Same shared semantic test through helper protocol / replay a prior capability ID after helper restart and require rejection                                                  |
| Truthful effects        | Successful read/mutation produces bound receipt / inject failure before and after mutation and prohibit success relabeling                                 | Same shared cases plus sharing violation / terminate helper at each protocol phase and require `effect_unknown` or recorded recovery state, never success                    |
| Durability claim        | Existing sync/rename paths pass crash tests where claimed / remove parent sync and require durability conformance failure                                  | Claim remains false until #892 / setting the claim true without the crash matrix must fail capability conformance                                                            |
| Explicit projection     | Native Linux remains selected unless a profile is explicitly requested / extra backend/platform request fields are rejected                                | Native Windows works with WSL absent / missing WSL affects only an explicitly requested projection and never native capability                                               |

## Crash and recovery boundaries

The Node client can die before acquire, while an operation is in flight, after the helper reports an
effect, or before the durable store records the receipt. The helper can die at the same phases.
Version 1 therefore requires operation IDs, coordinator lease lineage, bounded effect state, and
reconciliation-aware lease receipts. It does not by itself make a mutation durable.

#892 must persist mutation intent before effect, persist completion or rollback evidence after
effect, and prove external reconciliation. Until then, an indeterminate Windows mutation is
terminal for the current Attempt and destructive retry is forbidden. Existing stores, logs, and
Attempt records are never cleared as recovery.

## Residual risks

Same-principal code may mutate contents inside an already authorized writable directory, and Git
may interpret malicious repository content within that authority. Filesystem drivers may violate
documented identity or sharing semantics. Antivirus and indexers may cause bounded sharing
failures. A signed but vulnerable helper remains trusted code. These risks require containment,
command authority, process supervision, dependency/release controls, and platform conformance in
their owning issues; they are not hidden by the WorkspaceBoundary claim.
