# Weave Contract (v0.2)

**Goal:** integrate as many PRs as possible into the integration branch in one pass, resolving conflicts proactively. Only skip when a clean, test-passing reconciliation can't be produced.

## Attempt order

1. Trivial merges (no overlap).
2. Mechanical weaves (safe, rule-based transforms).
3. Semantic weaves (small, explicit reconciliation commits).
4. If 1–3 fail → mark **Skipped: conflict**.

## Hard gates (non-negotiable)

- Existing tests must pass (hard fail).
- No disabling tests, no relaxing lints/types to "make it green."
- Determinism check at the end: build + format → zero diff.
- **Rollback guard**: If determinism check fails after merges, revert the last weave commit(s) and mark PRs as `needs-manual-weave`.

## Mechanical weave rules (safe auto-fixes)

- **Formatting-only conflicts** → reformat repository and re-stage.
- **Configuration files** (package.json, pyproject.toml, Cargo.toml, pom.xml, etc.):
  - **Deterministic unions**: Sort all keys alphabetically; maintain stable trailing newline.
  - **Key collisions**: When both change the same key, prefer the stricter/safer setting; if incomparable, keep superset + document in integration PR.
  - **Dependency versions**: prefer highest compatible in-range; regenerate dependency lockfiles with **pinned toolchain**.
  - **Build/task scripts**: Union all scripts with alphabetical sorting. If same key differs:
    - Try safe composition as `<existing> && <new>` (alphabetical by script name); if order matters, keep both with `:pr-<number>` suffixes.
    - If truly divergent: keep both with suffixed names (`taskName:pr-<number>`) and comment noting source PRs.
- **Generated artifacts** (schemas, API docs, type definitions, compiled assets) → re-generate from source, not hand-merged.
- **Documentation merges**:
  - Unify headings where possible; keep both bodies under single heading with sub-sections.
  - Preserve author attributions; ensure navigation/TOC renders cleanly.
- **Interface/API additions**:
  - **Back-compat first**: accept both if no naming collision.
  - **Name collisions with different meanings** → add alias/adapter, mark one as "compat" in documentation.
  - Must update documentation when adding compatibility layers + include integration tests for all entry points.

If mechanical rules resolve the conflict and gates pass → **Merged (mechanical)**.

## Semantic weave (narrow, auditable)

- **Allowed**: ≤30 LOC across ≤3 files, no behavior changes outside conflict scope.
  - Examples: reconcile renamed functions/methods, add overloads, widen types, adapt parameters, update imports.
- **Not allowed**: behavior changes outside conflict scope, feature toggles, or removing someone's change.
- **Required commit format**: `Weave: reconcile #X + #Y — <short reason>`
  - **Body**: List of files touched + rationale.
  - **Trailers**: `Co-authored-by` for both PR authors.
  - **Example**:

    ```
    Weave: reconcile #123 + #456 — function rename + caller update

    Files: src/module.{ext}, tests/module_test.{ext}
    Reason: PR #123 renamed processData → handleData; PR #456 added new caller

    Co-authored-by: Alice <alice@example.com>
    Co-authored-by: Bob <bob@example.com>
    ```

- **Exception handling**: Any semantic weave exceeding bounds must be labeled `weave:exception` and approved by a maintainer before merge.

If gates pass → **Merged (semantic)**.

## Skip criteria

Skip only when both of these are true:

- Mechanical rules can't produce a clean index **and** a minimal semantic patch would exceed the "tiny glue" boundary.
- Or, gates remain red after a semantic attempt (tests fail).

Mark **Skipped: conflict** or **Skipped: tests**, label the source PRs, and post a concise comment: what we tried, why it failed, and what's needed (e.g., "rebase onto integration branch" or "resolve semantic conflict in core module").

## Reporting (integration PR body)

**Integration PR Matrix** (required):

```
| PR | Status | Details | Weave Commit |
|----|--------|---------|-------------|
| #123 | Merged | Clean merge | - |
| #124 | Merged (mechanical) | package.json union, lockfile regen | - |
| #125 | Merged (semantic) | Import reconciliation | abc1234 |
| #126 | Skipped (conflict) | Manual rebase needed | - |
| #127 | Skipped (tests) | Tests failed after weave | def5678 |
```

Integration PR **must** include this matrix and attach plan/order/gate logs. For Skipped (tests), the weave commit is optional.

**PR Labeling** (automated):

- `weave:mechanical` - Applied mechanical rules
- `weave:semantic` - Required semantic patch
- `weave:exception` - Bounds exceeded, maintainer approved
- `needs-manual-weave` - Conflicts exceed weave bounds
- `needs-rebase` - Clean rebase will resolve

**Bot Comments** on affected PRs:

- What rule applied ("mechanical: config file key union" or "semantic: function signature reconciliation")
- What's needed ("rebase onto integration branch" or "resolve semantic conflict in core module")

**Attachments**: plan + order + gate logs + weave commit SHAs for audit trail.## Toolchain alignment (determinism prerequisite)

- **Lockfile stability**: Requires pinned toolchain versions between local and CI environments.
- **Required specification**: Version pinning appropriate to ecosystem (package.json engines, .python-version, .ruby-version, .go-version, etc.).
- **Verification**: Validation tooling must ensure local toolchain matches CI specification.
- **Pre-regeneration check**: Verify tool versions match CI (doctor step) or abort; do not regenerate lockfiles under mismatched toolchains.
- **Regeneration**: Only regenerate dependency lockfiles with verified matching toolchain.

## Risk guardrails

- Never delete user code to resolve conflicts.
- Never change repository policy files (linters, type checkers, security configs) to loosen checks.
- Limit semantic weaves to localized, reversible patches; anything broader should bounce back to the source PR.
- **Semantic bounds**: Enforce ≤30 LOC, ≤3 files limit strictly; exceeding bounds → skip with `needs-manual-weave` label.
- **Ecosystem respect**: Follow language-specific best practices for conflict resolution (e.g., import organization, dependency ranges, build tool conventions).
