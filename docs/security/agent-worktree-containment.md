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
