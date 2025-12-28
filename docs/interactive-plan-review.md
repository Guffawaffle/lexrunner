# Interactive Plan Review Guide

This guide covers the interactive plan review feature, which provides human-in-the-loop validation and modification of merge plans before execution.

## Overview

Interactive plan review allows you to:

- **Review** generated plans with visual dependency graphs
- **Edit** plans interactively with built-in validation
- **Approve/Reject** plans with reasons and metadata
- **Compare** different plan versions
- **Track** plan history for audit and rollback

## Quick Start

### Basic Review

```bash
# Generate a plan
lex-pr plan --from-github --out ./artifacts

# Review the plan interactively
lex-pr plan-review ./artifacts/plan.json
```

### Non-Interactive Approval

```bash
# Auto-approve for CI/CD pipelines
lex-pr plan-review plan.json --non-interactive --output approved-plan.json
```

## Interactive Review Workflow

### 1. Plan Summary

When you start a review, you'll see:

```
📋 Plan Review

Target Branch: main
Total Items: 4
Schema Version: 1.0.0

Items:
  1. feature-a
  2. feature-b (depends on: feature-a)
  3. feature-c (depends on: feature-a)
  4. feature-d (depends on: feature-b, feature-c)
```

### 2. Dependency Graph

ASCII visualization of dependencies:

```
🔗 Dependency Graph:

  feature-a (no dependencies)
  feature-b ← feature-a
  feature-c ← feature-a
  feature-d ← feature-b, feature-c
```

### 3. Merge Order

Computed execution levels:

```
📊 Merge Order:

  Level 1: feature-a
  Level 2: feature-b, feature-c
  Level 3: feature-d

  Total levels: 3
```

### 4. Review Actions

Choose an action:

```
📝 Options:
  [a] Approve plan
  [r] Reject plan
  [e] Edit plan
  [v] View plan details
  [d] Show diff (if modified)
  [q] Quit without saving
```

## Editing Plans

### Add Items

1. Select `[e]` Edit plan
2. Choose `[1]` Add item
3. Enter item name: `feature-e`
4. Enter dependencies (comma-separated): `feature-d`

The system validates:

- ✅ No duplicate names
- ✅ Dependencies exist
- ✅ No cycles created

### Remove Items

1. Select `[e]` Edit plan
2. Choose `[2]` Remove item
3. Select item number to remove

The system validates:

- ✅ No other items depend on it

### Modify Dependencies

1. Select `[e]` Edit plan
2. Choose `[3]` Modify item dependencies
3. Select item number
4. Enter new dependencies (comma-separated)

The system validates:

- ✅ Dependencies exist
- ✅ No self-dependencies
- ✅ No cycles created

### Change Target Branch

1. Select `[e]` Edit plan
2. Choose `[5]` Change target branch
3. Enter new target branch name

## Approval Workflow

### Approve Plan

```
Choose action: a

✅ Plan approved
```

If modified:

```
✅ Plan approved

📝 Changes made:
  - Added item 'feature-e' with dependencies: feature-d
  - Modified dependencies for 'feature-b' from [feature-a] to []
```

### Reject Plan

```
Choose action: r
Rejection reason: Missing security review gate

❌ Plan rejected
Reason: Missing security review gate
```

## Plan Comparison

Compare two plan versions:

```bash
lex-pr plan-diff original-plan.json modified-plan.json
```

Output:

```
📊 Plan Comparison

Plan 1: original-plan.json
Plan 2: modified-plan.json

Target Branch: main → develop

Added Items:
  + feature-e
    deps: feature-d

Removed Items:
  - feature-c

Modified Items:
  ~ feature-b
    deps: [feature-a] → []
```

## History Tracking

### Save Plan Versions

Enable history tracking:

```bash
lex-pr plan-review plan.json \
  --save-history \
  --profile-dir .smartergpt.local \
  --output approved-plan.json
```

This creates a version in `.smartergpt.local/runner/plan-history/default.history.json`:

```json
{
  "versions": [
    {
      "version": 1,
      "timestamp": "2024-01-15T10:30:00.000Z",
      "plan": { ... },
      "approved": true,
      "changes": ["Added item 'feature-e'"],
      "author": "user@example.com"
    }
  ],
  "current": 1
}
```

### Restore Previous Version

Plan history is stored in JSON format and can be manually inspected or restored using standard JSON tools.

## Advanced Usage

### CI/CD Integration

```bash
#!/bin/bash
# Review plan in CI pipeline

lex-pr plan --from-github --json > plan.json

# Auto-approve if CI_APPROVED is set
if [ "$CI_APPROVED" = "true" ]; then
  lex-pr plan-review plan.json --non-interactive --output approved-plan.json
  exit $?
else
  echo "Manual review required"
  exit 1
fi
```

### Team Review Workflow

1. **Generate plan**: `lex-pr plan --from-github --out ./review`
2. **Team lead reviews**: `lex-pr plan-review ./review/plan.json --save-history`
3. **Compare with previous**: `lex-pr plan-diff ./review/plan.json ./approved/plan.json`
4. **Approve and save**: Select `[a]` and specify output file

### Diff-Based Review

```bash
# Generate new plan
lex-pr plan --from-github --out ./new-plan

# Compare with previous approved plan
lex-pr plan-diff ./approved/plan.json ./new-plan/plan.json

# Review if changes detected (exit code 1)
if [ $? -eq 1 ]; then
  lex-pr plan-review ./new-plan/plan.json --output ./approved/plan.json
fi
```

## Validation Rules

The interactive review enforces these validation rules:

### Item Names

- ✅ Must be unique
- ❌ Cannot duplicate existing names

### Dependencies

- ✅ Must reference existing items
- ❌ Cannot create cycles
- ❌ Cannot reference non-existent items
- ❌ Cannot self-reference

### Removal

- ✅ Can remove items with no dependents
- ❌ Cannot remove items that other items depend on

### Target Branch

- ✅ Any valid git branch name
- ℹ️ No validation against actual repository branches

## Best Practices

### 1. Review Before Execution

Always review plans before executing gates:

```bash
lex-pr plan --from-github --out ./artifacts
lex-pr plan-review ./artifacts/plan.json --output ./artifacts/approved-plan.json
lex-pr execute ./artifacts/approved-plan.json
```

### 2. Save History for Audit

Track all plan changes:

```bash
lex-pr plan-review plan.json \
  --save-history \
  --profile-dir .smartergpt.local
```

### 3. Use Diff for Changes

Compare before and after:

```bash
lex-pr plan-diff before.json after.json --json | jq .hasChanges
```

### 4. Non-Interactive in CI

Use non-interactive mode in automated pipelines:

```bash
lex-pr plan-review plan.json --non-interactive
```

### 5. Team Annotations

Use rejection reasons for team communication:

```
Choose action: r
Rejection reason: Needs security review for feature-x
```

## Troubleshooting

### Plan Validation Errors

**Error**: "Unknown dependency 'feature-x' for item 'feature-y'"

- **Fix**: Remove the dependency or add 'feature-x' to the plan

**Error**: "Dependency cycle detected involving: feature-a, feature-b"

- **Fix**: Break the cycle by removing one of the circular dependencies

### Interactive Mode Not Working

**Issue**: CLI exits immediately without prompts

- **Check**: Ensure you're not using `--non-interactive` flag
- **Check**: stdin is available (not running in background job)

### History Not Saving

**Issue**: History file not created

- **Check**: `--save-history` flag is set
- **Check**: Profile directory exists and is writable
- **Check**: Not using a read-only example profile

## Related Commands

- [`lex-pr plan`](./cli.md#plan) - Generate plans from configuration or GitHub
- [`lex-pr plan-diff`](./cli.md#plan-diff) - Compare two plans
- [`lex-pr merge-order`](./cli.md#merge-order) - Show execution order
- [`lex-pr execute`](./cli.md#execute) - Execute plan gates
- [`lex-pr autopilot`](./autopilot-levels.md) - Automated execution levels

## Examples

### Example 1: Basic Review and Approval

```bash
$ lex-pr plan-review plan.json

📋 Plan Review

Target Branch: main
Total Items: 3
Schema Version: 1.0.0

Items:
  1. feature-a
  2. feature-b (depends on: feature-a)
  3. feature-c (depends on: feature-b)

🔗 Dependency Graph:

  feature-a (no dependencies)
  feature-b ← feature-a
  feature-c ← feature-b

📊 Merge Order:

  Level 1: feature-a
  Level 2: feature-b
  Level 3: feature-c

  Total levels: 3

📝 Options:
  [a] Approve plan
  [r] Reject plan
  [e] Edit plan
  [v] View plan details
  [d] Show diff (if modified)
  [q] Quit without saving

Choose action: a

✅ Plan approved
```

### Example 2: Edit and Approve

```bash
Choose action: e

✏️  Edit Options:
  [1] Add item
  [2] Remove item
  [3] Modify item dependencies
  [4] Modify item gates
  [5] Change target branch
  [6] Done editing

Choose edit action: 1
Item name: feature-d
Dependencies (comma-separated, or empty): feature-c

✓ Plan updated
Target Branch: main
Total Items: 4
Schema Version: 1.0.0

Items:
  1. feature-a
  2. feature-b (depends on: feature-a)
  3. feature-c (depends on: feature-b)
  4. feature-d (depends on: feature-c)

Choose edit action: 6

Choose action: a

✅ Plan approved

📝 Changes made:
  - Added item 'feature-d' with dependencies: feature-c
```

### Example 3: Diff Two Plans

```bash
$ lex-pr plan-diff old-plan.json new-plan.json

📊 Plan Comparison

Plan 1: old-plan.json
Plan 2: new-plan.json

Target Branch: main → develop

Added Items:
  + feature-d
    deps: feature-c

Modified Items:
  ~ feature-b
    deps: [feature-a] → [feature-a, feature-x]
```

## See Also

- [CLI Reference](./cli.md) - Complete CLI documentation
- [Autopilot Levels](./autopilot-levels.md) - Automation levels guide
- [Schema Documentation](./schema.md) - Plan schema reference
- [Quick Start Guide](./quickstart.md) - Getting started tutorial
