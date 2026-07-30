# Agent worktree physical-containment boundary

`NodeGitWorktreeBroker` treats a worktree allocation as a directory identity,
not merely as an absolute path string. This boundary exists because a lexical
containment check followed by a pathname-based Git command has an unavoidable
time-of-check/time-of-use window.

## Guarantee

At broker construction, LexRunner opens the repository root, its `.git`
directory, and the allocation root component by component with Linux
`O_DIRECTORY | O_NOFOLLOW`. It records each directory's device and inode. A
later operation must reopen the same identities before it can continue.

For each operation, LexRunner:

1. opens every existing target ancestor through an already anchored parent;
2. rejects symlinks, missing intermediate ancestors, root replacement, and
   identity changes;
3. reserves a missing final create target through its anchored parent;
4. checks immediately before process creation that every held identity is still
   named at the captured native path; and
5. gives Git only `/proc/<broker-pid>/fd/<fd>` paths plus explicit anchored
   `--git-dir` and `--work-tree` arguments.

Marker reads and exclusive marker creation use the anchored worktree Git
administration directory. Observation/status and removal use the anchored
worktree and repository identities. A substitute path installed before process
creation is rejected. A swap after the final process preflight cannot redirect
the command to the substitute because Git receives the held directory
descriptor identity, not the original pathname.

Directory identity is the authorization unit for the duration of an operation.
If an attacker renames that authorized directory after the final preflight, the
in-flight command may continue on the same directory object under its new name;
it will not follow the replacement pathname. A subsequent operation fails
closed because the configured path no longer names the captured identity.

This boundary does not make mutually hostile processes running as the same OS
principal safe to share writable Git internals. A process authorized to mutate
the contents of the anchored repository `.git` directory remains inside the
trusted repository boundary.

## Read-only capability preflight

Run `lex-pr attempt preflight --input <file|-> --json`, or call MCP
`preflight_attempt_containment`, before constructing a WorkItem or Attempt packet. Both adapters
call `AgentWorkContainmentCapabilityService`; the operation does not open SQLite, invoke Git,
create a directory, branch, marker, worktree, or acquire mutation authority.

The request contains only the repository/runtime binding needed by the physical boundary:

```json
{
  "runtime": {
    "repositoryId": "repo-identity",
    "repositoryRoot": "/native/repository",
    "worktreeRoot": "/native/lexrunner-worktrees",
    "gitRuntime": "wsl-ubuntu",
    "pathComparison": "case-sensitive"
  }
}
```

Results use one of three capability states:

- `native_ready` — procfs plus all repository, repository-Git, and worktree-root identities were
  verified on a supported native Linux filesystem;
- `broker_required` — native Windows or a WSL DrvFS/9P path requires the identity-anchored
  native-WSL projection tracked by #867 and its #872–#875 delivery stack; or
- `unsupported` — the runtime, path syntax, root relationship, directory identity, or filesystem
  could not satisfy the boundary.

Stable reason codes and next-action identifiers are machine-readable. Path status distinguishes
`identity_verified`, `filesystem_verified`, `syntactic_only`, `unverified`, and `not_checked`.
The response never echoes a path or low-level OS message. Its `bindingDigest` binds the result to
the exact repository ID, paths, Git runtime, and comparison declaration without exposing those
values.

`broker_required` is not a containment override. It stops local allocation and directs the caller
to provision a native-WSL projection, then rerun preflight. The versioned request, observation,
manifest, receipt, and path-mapping contracts are defined by #872. They do not themselves grant
provisioning authority: execution-envelope enforcement and operator surfaces remain separately
gated by #874 and #875.

The projection request binds repository identity, the declared Windows and WSL views, native
projection/worktree roots, dirty and HEAD policies, and one full Git object ID. A projection
manifest is selectable only when its canonical request, source observation, repository, commit,
path roles, and native directory identities all agree. Stale, interrupted, invalid, and
conflicting inventory states produce an explicit pure plan; none is silently repaired or treated
as a usable checkout. The mapped source must not overlap either native root in either direction;
validation rejects that topology before any native control directory can be opened or created.

## Broker-owned native-WSL projection

`NativeWslProjectionEngine` reads the declared mapped source but publishes only committed Git
state to the native roots. Source observation runs with interactive credentials, system/global
Git configuration, optional index locks, and shell interpretation disabled. Git receives a
fixed, explicit environment allowlist rather than a merge with the broker process environment,
so ambient object directories, alternates, repository selectors, and command-scoped config
cannot cross the boundary. Each command checks the mapped source directory device and inode
immediately before process creation; replacement or remote-identity drift fails closed. Source
dirt is observed according to request policy and is never copied into the native repository.

The transport uses `git clone --no-local --no-hardlinks --no-checkout --no-tags`. The engine
checks out only the requested full commit in detached mode, removes the source remote and moving
local branches, and rejects object alternates. Git command evidence contains action names,
canonical argument/output hashes, bounded exit and duration facts, and no source path or Git
output.

Native mutation remains inside procfs-anchored projection, staging, lease, allocation, and
quarantine roots. An exact ready manifest is reverified against the request, repository HEAD and
cleanliness, directory identities, and lack of alternates before reuse. Preparation publishes by
atomic directory renames only after manifest construction and identity checks. Owned interrupted
staging is removed on retry; stale, invalid, partially published, or ownership-ambiguous state is
quarantined rather than selected or overwritten. If the initial ownership marker cannot be
durably written, the engine removes the exact-created staging directory before returning; if
identity-safe removal cannot be proven, the residue is quarantined or rejected as a conflict.
Only a `prepared` or `reused` result carries the verified `NodeGitWorktreeBroker`.

This engine does not relax the same-principal limitation above. It also does not confer Attempt
authority. Launch preparation binds a selected manifest and its `prepared` or `reused` receipt
into exactly one execution-envelope mapping. That mapping includes repository/base/host/runtime,
projection and mapping digests, the native repository and allocation root, and the final brokered
worktree identity. Native-only Attempts emit the equivalent explicit native mapping.

Worker attachment and later heartbeat/status, receipt, verification, acceptance, and fan-in
boundaries all consume the persisted canonical mapping; no adapter derives a replacement from
path strings or ambient mounts. Authority-bearing boundaries recheck the current native directory
identities, while public status exposes only bounded mapping state, kind, and digest. Previously
stored v1 envelopes with an empty mapping list remain parseable for migration but cannot authorize
a new lifecycle operation.

## Platform matrix

| Runtime                                                                | Behavior                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Linux on a native, case-sensitive filesystem                           | Supported through procfs directory descriptors.                                              |
| WSL2 with repository and worktree roots on its native Linux filesystem | Supported by the same Linux boundary.                                                        |
| WSL DrvFS/9P Windows mounts (for example `/mnt/c`)                     | Rejected at construction.                                                                    |
| Linux runtimes declared case-insensitive                               | Rejected at construction.                                                                    |
| macOS                                                                  | Rejected until an equivalent descriptor-relative process boundary is implemented and tested. |
| Native Windows                                                         | Rejected until an equivalent handle-relative process boundary is implemented and tested.     |

The repository root, repository `.git` directory, allocation root, and every
existing target ancestor must be real directories with symlink-free native
paths. Unsupported or ambiguous configurations fail before any broker Git
command runs. Runtime identity changes return `containment_violation`; an
unsupported platform or filesystem prevents broker construction.
