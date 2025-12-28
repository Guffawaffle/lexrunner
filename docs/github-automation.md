# GitHub Automation Workflows

This document describes the automated GitHub Actions workflows for repository maintenance.

## Auto-delete Merged PR Branches

**Workflow:** `.github/workflows/auto-delete-merged-branches.yml`

### Purpose

Automatically deletes head branches after a PR is merged, reducing manual cleanup overhead during merge-weave operations.

### Behavior

When a PR is merged, the workflow:

1. **Checks eligibility** based on multiple safety rules
2. **Deletes the head branch** if all checks pass
3. **Logs the result** for audit purposes

### Safety Mechanisms

The workflow includes multiple safety guards to prevent accidental deletions:

#### 1. Merge Verification

- Only runs when `github.event.pull_request.merged == true`
- Closed-but-not-merged PRs are ignored

#### 2. Fork Protection

- Only deletes branches from the same repository
- Branches from forks are never deleted
- Check: `head.repo.full_name == github.repository`

#### 3. Default Branch Protection

- Never deletes the default branch (usually `main`)
- Check: `head.ref != base.repo.default_branch`

#### 4. Prefix Allowlist

- Only deletes branches matching approved prefixes:
  - `copilot/*` — Copilot-generated feature branches
  - `integration/umbrella-*` — Merge-weave umbrella branches
  - `feature/*` — Standard feature branches
- All other branch patterns are preserved

#### 5. Opt-out Mechanism

- PRs labeled with `keep-branch` are excluded
- Use this label when a branch needs to remain after merge

### Example Scenarios

#### ✅ Will Delete

- PR from `copilot/fix-bug-123` → **Deleted**
- PR from `integration/umbrella-20231215` → **Deleted**
- PR from `feature/new-api` → **Deleted**

#### ❌ Will NOT Delete

- PR from `develop` → **Preserved** (doesn't match prefix)
- PR from fork → **Preserved** (fork protection)
- PR with `keep-branch` label → **Preserved** (opt-out)
- Default branch → **Preserved** (default branch protection)
- Closed but not merged → **Preserved** (merge verification)

### Logging

The workflow provides detailed logging for each decision:

```
✅ Branch is eligible for deletion (matches allowed prefix)
✅ Successfully deleted branch: copilot/feature-123
```

Or:

```
❌ Skipping: Branch does not match allowed prefixes
ℹ️ Branch not deleted. Reason: no-matching-prefix
```

### Permissions

The workflow requires:

- `contents: write` — To delete git references

### Opt-out Instructions

To prevent branch deletion for a specific PR:

1. Add the `keep-branch` label to the PR before merging
2. The workflow will skip deletion and log the reason

### Manual Override

If the workflow fails to delete a branch, you can manually delete it:

```bash
# Using GitHub CLI
gh api --method DELETE "/repos/OWNER/REPO/git/refs/heads/BRANCH_NAME"

# Using git
git push origin --delete BRANCH_NAME
```

### Troubleshooting

**Branch not deleted:**

- Check the workflow run logs in the Actions tab
- Verify the branch matches an allowed prefix
- Confirm the PR was merged (not just closed)
- Check for `keep-branch` label

**Permission errors:**

- Ensure the workflow has `contents: write` permission
- Check branch protection rules (protected branches cannot be deleted)

### Related Documentation

- [AGENTS.md](../AGENTS.md) — Project operating principles
- [Merge Weave Quickstart](../MERGE_WEAVE_QUICKSTART.md) — Integration workflows
