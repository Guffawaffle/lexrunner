# Plan Generation Guide

Comprehensive guide to generating execution plans from GitHub PRs and repository analysis.

## Overview

The `lex-pr plan` command provides powerful plan generation capabilities:

- **Configuration-based**: Generate plans from `.smartergpt/` configuration files
- **GitHub-powered**: Auto-discover PRs and generate plans from GitHub metadata
- **Dependency Resolution**: Automatic dependency parsing and validation
- **Cycle Detection**: Built-in circular dependency detection
- **Optimization**: Plan optimization for parallel execution

## Generation Modes

### 1. Configuration Files Mode

Generate plans from local configuration files in `.smartergpt/`:

```bash
lex-pr plan
```

**Input Files:**

- `scope.yml` - PR discovery rules
- `deps.yml` - Dependency relationships
- `gates.yml` - Quality gate configuration

**Output:**

- `plan.json` - Validated execution plan
- `snapshot.md` - Human-readable summary

### 2. GitHub Auto-Discovery Mode

Generate plans directly from GitHub repository analysis:

```bash
lex-pr plan --from-github
```

**How It Works:**

1. **Repository Validation**: Validates GitHub access and repository details
2. **PR Discovery**: Lists open PRs based on query/labels
3. **Dependency Parsing**: Extracts dependencies from PR descriptions
4. **Plan Generation**: Creates optimized execution plan
5. **Validation**: Validates dependencies and detects cycles

**PR Dependency Formats Supported:**

```markdown
# In PR description:

Depends-on: #123, #456
Depends: PR-123, PR-456
Requires: #123
```

See [Dependency Parser](./dependency-parser.md) for full format details.

## Policy Configuration

### Required Gates

Specify which gates must pass for each PR:

```bash
# Default gates
lex-pr plan --from-github  # Uses: lint,typecheck,test

# Custom gates
lex-pr plan --from-github --required-gates "lint,test,security-scan"

# No gates (empty list)
lex-pr plan --from-github --required-gates ""
```

### Max Workers

Control parallel execution:

```bash
# Default (2 workers)
lex-pr plan --from-github

# Custom worker count
lex-pr plan --from-github --max-workers 4

# Sequential execution
lex-pr plan --from-github --max-workers 1
```

### Target Branch

Specify merge target branch:

```bash
# Use repository default branch (auto-detected)
lex-pr plan --from-github

# Custom target branch
lex-pr plan --from-github --target develop
lex-pr plan --from-github --target release/v2.0
```

## Dependency Validation

### Cycle Detection

Automatically detect circular dependencies (enabled by default):

```bash
# Enable cycle detection (default)
lex-pr plan --from-github --validate-cycles

# Explicit validation
lex-pr plan --validate-cycles
```

**Example Cycle Error:**

```
❌ Plan validation failed: dependency cycle detected involving: PR-101, PR-102, PR-103
```

### Unknown Dependencies

Validates all dependencies exist in the plan:

```
❌ Plan validation failed: unknown dependency 'PR-999' for item 'PR-123'
```

## Plan Optimization

### Parallel Execution Levels

Show optimized execution order:

```bash
lex-pr plan --from-github --optimize
```

**Example Output:**

```
✓ Auto-discovered 5 PRs from GitHub
✓ Dependency validation passed (no cycles detected)
✓ Plan optimized for parallel execution: 3 levels
  Level 1: PR-100
  Level 2: PR-101, PR-102
  Level 3: PR-103, PR-104
```

### Execution Order Algorithm

Uses **Kahn's Algorithm** for topological sorting:

1. Items with no dependencies execute first
2. Items execute when all dependencies complete
3. Items at same level can execute in parallel
4. Deterministic ordering within levels (alphabetical)

## GitHub Search Queries

### Query Syntax

Use GitHub's search syntax to filter PRs:

```bash
# Open PRs with stack labels
lex-pr plan --from-github --query "is:open label:stack:*"

# PRs by specific author
lex-pr plan --from-github --query "is:open author:username"

# PRs updated recently
lex-pr plan --from-github --query "is:open updated:>2024-01-01"

# Combine multiple criteria
lex-pr plan --from-github --query "is:open label:feature author:dev1"
```

### Label Filtering

Filter by specific labels:

```bash
# Single label
lex-pr plan --from-github --labels "enhancement"

# Multiple labels (comma-separated)
lex-pr plan --from-github --labels "feature,priority-high"

# Stack labels
lex-pr plan --from-github --labels "stack:feature,stack:refactor"
```

### Draft PRs

```bash
# Exclude drafts (default)
lex-pr plan --from-github

# Include drafts
lex-pr plan --from-github --include-drafts
```

## Output Modes

### Default Mode

Writes plan files to output directory:

```bash
lex-pr plan --from-github --out ./artifacts
```

**Generated Files:**

- `plan.json` - Canonical execution plan
- `snapshot.md` - Human-readable summary

### JSON Mode

Output only plan JSON to stdout:

```bash
lex-pr plan --from-github --json > plan.json
```

**Use Cases:**

- Piping to other tools
- CI/CD integration
- Programmatic processing

### Dry Run Mode

Preview without writing files:

```bash
lex-pr plan --from-github --dry-run
```

**Output:**

```
Dry run - would generate:
📁 .smartergpt/runner/plan.json (2431 bytes)
📁 .smartergpt/runner/snapshot.md (1847 bytes)

Plan Summary:
- Target: main
- Items: 5
- Max Workers: 2
- Required Gates: lint, typecheck, test
```

## Examples

### Basic Workflow

```bash
# 1. Generate plan from GitHub
lex-pr plan --from-github --json > plan.json

# 2. Validate plan
lex-pr validate plan.json

# 3. Compute merge order
lex-pr merge-order plan.json

# 4. Execute (dry run)
lex-pr merge plan.json --dry-run

# 5. Execute (real)
lex-pr merge plan.json --execute
```

### Custom Policy

```bash
lex-pr plan --from-github \
  --required-gates "lint,test,build,deploy" \
  --max-workers 3 \
  --target production \
  --optimize
```

### Filtered Discovery

```bash
# High-priority features only
lex-pr plan --from-github \
  --query "is:open label:priority-high" \
  --labels "feature" \
  --required-gates "security-scan,performance-test"
```

### Stack-based Workflow

```bash
# Discover all PRs in a stack
lex-pr plan --from-github \
  --query "is:open label:stack:auth-refactor" \
  --include-drafts \
  --optimize \
  --out ./stack-plans
```

## Integration with CI/CD

### GitHub Actions

```yaml
- name: Generate Plan
  run: |
    lex-pr plan --from-github \
      --github-token ${{ secrets.GITHUB_TOKEN }} \
      --json > plan.json

- name: Validate Plan
  run: lex-pr validate plan.json

- name: Upload Plan
  uses: actions/upload-artifact@v7
  with:
    name: execution-plan
    path: plan.json
```

### Script Integration

```bash
#!/bin/bash
set -e

# Generate plan with error handling
if ! plan=$(lex-pr plan --from-github --json 2>/dev/null); then
  echo "❌ Plan generation failed"
  exit 1
fi

# Parse and validate
echo "$plan" | jq '.' > plan.json
lex-pr validate plan.json

echo "✅ Plan generated successfully"
```

## Troubleshooting

### Common Issues

**Issue: Circular dependency detected**

```bash
# Review dependencies
lex-pr plan --from-github --optimize --dry-run

# Fix: Update PR descriptions to remove cycles
```

**Issue: Unknown dependency**

```bash
# Check if referenced PR exists
gh pr list

# Fix: Update dependency references or include PR in query
```

**Issue: No PRs discovered**

```bash
# Check query syntax
lex-pr plan --from-github --query "is:open" --dry-run

# Try without filters
lex-pr plan --from-github --include-drafts
```

### Validation Checks

1. **Repository Access**: Ensure GitHub token has repo access
2. **PR Descriptions**: Verify dependency format in PR bodies
3. **Labels**: Check label names match exactly (case-sensitive)
4. **Cycles**: Review dependency graph for circular references

## Best Practices

1. **Use Descriptive PR Titles**: Helps with plan readability
2. **Document Dependencies**: Use standard formats in PR descriptions
3. **Label Consistently**: Use predictable label patterns (e.g., `stack:feature-name`)
4. **Validate Early**: Run with `--dry-run` first
5. **Optimize Plans**: Use `--optimize` to visualize execution levels
6. **Version Control Plans**: Commit generated `plan.json` for reproducibility

## See Also

- [CLI Reference](./cli.md) - Complete CLI documentation
- [Dependency Parser](./dependency-parser.md) - Dependency format details
- [Schemas](./schemas.md) - Plan JSON schema reference
