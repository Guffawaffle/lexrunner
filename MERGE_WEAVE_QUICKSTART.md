# Merge-Weave Quickstart Guide

**Get up and running with merge-weave in 5 minutes.**

## What is Merge-Weave?

Merge-weave is LexRunner's workflow for merging multiple parallel PRs into a single integration branch. It:

1. **Discovers** open PRs from GitHub
2. **Plans** merge order based on dependencies
3. **Validates** with quality gates (lint, typecheck, tests)
4. **Merges** PRs in topological order

## Prerequisites

- Node.js 20+ installed
- GitHub repository with open PRs
- `GITHUB_TOKEN` environment variable set (for API access)

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

## Quick Start: CLI Workflow

### Step 1: Discover Open PRs

Find all open PRs in your repository:

```bash
lex-pr weave discover
```

**Example Output:**

```
📋 Discovered 3 Pull Request(s)

🟢 OPEN #42: Add user authentication
       https://github.com/org/repo/pull/42
       Labels: feature, ready-to-merge

🟢 OPEN #43: Fix navigation bug
       https://github.com/org/repo/pull/43
       Labels: bugfix, ready-to-merge

🟢 OPEN #44: Update dependencies
       https://github.com/org/repo/pull/44
       Labels: maintenance

Next step:
  lex-pr weave plan --from-github --output plan.json
```

**Pro tip:** Use `--suggest` to get AI-powered dependency suggestions:

```bash
lex-pr weave discover --suggest
```

### Step 2: Generate Merge Plan

Create a merge plan from discovered PRs:

```bash
lex-pr weave plan --from-github --output plan.json
```

**Example Output:**

```
✅ Plan generated successfully

   File: plan.json
   Items: 3
   Target: main

Next steps:
  1. Review: lex-pr plan-review plan.json
  2. Dry-run: lex-pr weave apply --plan plan.json --dry-run
  3. Execute: lex-pr weave apply --plan plan.json
```

**Optional filters:**

```bash
# Only PRs with specific labels
lex-pr weave plan --from-github --labels ready-to-merge feature

# Exclude specific PRs
lex-pr weave plan --from-github --exclude-prs 44
```

### Step 3: Dry-Run (Preview)

See what would happen without making changes:

```bash
lex-pr weave apply --dry-run
```

**Example Output:**

```
🔍 Merge-Weave Dry Run

Plan: plan.json
Items: 3
Target: main

Execution Order (topological):

  Level 1:
    - PR-42
    - PR-43
  Level 2:
    - PR-44

Gates to run:
  - lint
  - typecheck
  - test

To execute:
  lex-pr weave apply --plan plan.json
```

### Step 4: Execute Merge-Weave

Run quality gates and prepare for merge:

```bash
lex-pr weave apply
```

**Example Output:**

```
🚀 Executing Merge-Weave

Plan: plan.json
Items: 3

Running gates...

✅ PR-42: passed
✅ PR-43: passed
✅ PR-44: passed

✅ All gates passed!

Merge pyramid ready to execute.

Next step:
  lex-pr merge --plan plan.json --execute
```

### Step 5: Merge PRs (Optional)

After gates pass, merge the PRs:

```bash
lex-pr merge --plan plan.json --execute
```

## Quick Start: MCP Workflow

For AI assistants using Model Context Protocol:

### Discovery

```typescript
const prs = await mcp.call_tool("discover", {
  owner: "myorg",
  repo: "myrepo",
  state: "open",
});
```

### Planning

```typescript
const planResult = await mcp.call_tool("plan.create", {
  fromGithub: true,
  owner: "myorg",
  repo: "myrepo",
  labels: ["ready-to-merge"],
});
```

### Execution via Run Manager

```typescript
// Start a merge-weave run
const run = await mcp.call_tool("lexrunner.startRun", {
  procedure: "merge-weave-main",
  repo: "myorg/myrepo",
  mode: "senior-dev",
});

// Check status
const status = await mcp.call_tool("lexrunner.getStatus", {
  runId: run.runId,
});

// List artifacts
const artifacts = await mcp.call_tool("lexrunner.listArtifacts", {
  runId: run.runId,
});
```

## Common Scenarios

### Scenario 1: Merge PRs with Specific Labels

```bash
# Discover
lex-pr weave discover --json > discovered.json

# Plan with label filter
lex-pr weave plan --from-github --labels ready-to-merge feature

# Execute
lex-pr weave apply
```

### Scenario 2: Exclude Draft PRs

```bash
# Plan without drafts
lex-pr weave plan --from-github --no-include-drafts
```

### Scenario 3: Skip Gates (Not Recommended)

```bash
# Emergency merge bypass (use with caution!)
lex-pr weave apply --skip-gates
```

## Configuration

### Required Gates

Gates are defined in `.smartergpt/gates.yml`:

```yaml
gates:
  - name: lint
    run: npm run lint
    required: true

  - name: typecheck
    run: npm run typecheck
    required: true

  - name: test
    run: npm test
    required: false
```

### Integration Branch

By default, merge-weave creates an integration branch named `integration/weave-{timestamp}`. You can customize this in your plan.

## Failure Recovery

### Gate Failures

If gates fail:

```bash
# Check which gates failed
lex-pr status plan.json

# Fix issues and retry
lex-pr retry --filter failed

# Re-run gates
lex-pr weave apply
```

### Merge Conflicts

If merge conflicts occur:

```bash
# Use conflict resolution tools
lex-pr merge --plan plan.json --resolve-policy minimal-hunk

# Or manual resolution
git status
# ... resolve conflicts ...
git add .
git commit
```

### Plan Issues

If plan validation fails:

```bash
# Validate plan schema
lex-pr schema validate plan.json

# Review dependencies
lex-pr merge-order plan.json

# Edit plan manually or regenerate
lex-pr plan-review plan.json
```

## Troubleshooting

### "Could not detect GitHub repository"

**Cause:** Not in a git repository with GitHub remote.

**Solution:**

```bash
# Option 1: Run from git repository
git remote -v

# Option 2: Specify explicitly
lex-pr weave discover --owner myorg --repo myrepo
```

### "No pull requests found"

**Cause:** No PRs match filters or you don't have permissions.

**Solution:**

```bash
# Check PR state filter
lex-pr weave discover --state all

# Verify GitHub token has correct scopes
echo $GITHUB_TOKEN | cut -c1-10
```

### "Plan file not found"

**Cause:** Plan not generated or wrong path.

**Solution:**

```bash
# Generate plan first
lex-pr weave plan --from-github --output plan.json

# Or specify correct path
lex-pr weave apply --plan custom-plan.json
```

### "GITHUB_TOKEN not set"

**Cause:** Missing authentication token.

**Solution:**

```bash
# Set token
export GITHUB_TOKEN=ghp_your_token_here

# Or create .env file
echo "GITHUB_TOKEN=ghp_your_token_here" > .env
```

## Best Practices

1. **Always dry-run first:**

   ```bash
   lex-pr weave apply --dry-run
   ```

2. **Review plan before execution:**

   ```bash
   lex-pr plan-review plan.json
   ```

3. **Use dependency suggestions:**

   ```bash
   lex-pr weave discover --suggest
   ```

4. **Label PRs consistently:**
   - `ready-to-merge` - PR is ready for merge-weave
   - `blocked` - PR has dependencies or issues
   - `feature` - New functionality
   - `bugfix` - Bug fixes

5. **Don't skip gates:**
   - Gates ensure code quality
   - Only skip in emergencies

## Next Steps

- **Read full guide:** [MERGE_WEAVE_USAGE_GUIDE.md](./MERGE_WEAVE_USAGE_GUIDE.md)
- **Setup workspace:** [docs/MERGE_WEAVE_SETUP.md](./docs/MERGE_WEAVE_SETUP.md)
- **Understand procedures:** [procedures/merge-weave-main.yaml](./procedures/merge-weave-main.yaml)
- **MCP integration:** [README.mcp.md](./README.mcp.md)

## Complete Example

Here's a complete workflow from start to finish:

```bash
# 1. Set up authentication
export GITHUB_TOKEN=ghp_your_token_here

# 2. Discover open PRs
lex-pr weave discover --suggest

# 3. Generate plan from PRs with labels
lex-pr weave plan --from-github \
  --labels ready-to-merge \
  --output plan.json

# 4. Review the plan
lex-pr plan-review plan.json

# 5. Dry-run to see execution order
lex-pr weave apply --dry-run

# 6. Execute gates
lex-pr weave apply

# 7. If gates pass, merge PRs
lex-pr merge --plan plan.json --execute

# 8. Check final status
lex-pr status plan.json
```

**Time to completion:** ~5-10 minutes depending on gate execution time.

## Summary

✅ **Discovered** PRs with `lex-pr weave discover`  
✅ **Planned** merge order with `lex-pr weave plan --from-github`  
✅ **Validated** with `lex-pr weave apply --dry-run`  
✅ **Executed** gates with `lex-pr weave apply`  
✅ **Merged** PRs with `lex-pr merge --plan plan.json --execute`

You now have a working merge-weave workflow! 🚀
