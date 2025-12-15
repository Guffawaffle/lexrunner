# Autopilot Levels

The lexrunner supports graduated automation levels (0-4) for merge-weave execution, allowing teams to incrementally adopt automation while maintaining safety and control.

## Overview

Autopilot levels define the degree of automation in merge-weave operations:

| Level | Name | Description | GitHub Operations |
|-------|------|-------------|-------------------|
| 0 | Report Only | Generate plans and artifacts only | None |
| 1 | Artifact Generation | Create integration plans and previews | None |
| 2 | PR Annotations | Post comments and update status | Read + Comment |
| 3 | Integration Branches | Create branches and open PRs | Read + Write |
| 4 | Full Automation | Complete end-to-end merge-weave | Read + Write + Merge |

## Level 0: Report Only

**Purpose**: Safe plan generation and validation without side effects.

**Capabilities**:
- Generate `plan.json` from configuration
- Validate dependency graphs
- Compute merge order (topological sort)
- Create `snapshot.md` with plan summary
- Run gates and collect results
- Generate execution reports

**Use Cases**:
- CI/CD validation
- Development environment testing
- Plan review before execution
- Dry-run mode for all operations

**CLI Flags**:
```bash
lex-pr execute --max-level 0 --dry-run
lex-pr merge --max-level 0
```

**Safety**: No GitHub API calls, no git operations, no side effects.

## Level 1: Artifact Generation

**Purpose**: Create detailed execution plans and merge previews.

**Capabilities** (all Level 0 plus):
- Generate integration branch plans
- Create merge preview artifacts
- Write detailed execution logs
- Generate conflict analysis reports
- Produce gate result summaries

**Use Cases**:
- Pre-merge analysis
- Integration planning
- Conflict prediction
- Artifact archiving for audit

**CLI Flags**:
```bash
lex-pr execute --max-level 1
lex-pr merge --max-level 1 --branch-prefix "integration/"
```

**Safety**: Still no GitHub interactions, only local artifact generation.

## Level 2: PR Annotations

**Purpose**: Provide automated status updates and feedback on PRs.

**Capabilities** (all Level 1 plus):
- Post status comments on PRs
- Update PR status checks
- Add labels based on gate results
- Generate formatted status tables
- Update PR descriptions with execution status

**Use Cases**:
- Automated PR feedback
- Status tracking in GitHub
- Team visibility into gate results
- Integration with PR workflows

**CLI Flags**:
```bash
lex-pr execute --max-level 2 --comment-template /path/to/template.md
lex-pr merge --max-level 2
```

**GitHub Permissions Required**:
- `pull_requests: read`
- `pull_requests: write` (for comments)
- `statuses: write` (for status checks)

**Safety**: Read-only git operations, no merges performed.

## Level 3: Integration Branches

**Purpose**: Automated creation of integration branches and PRs.

**Capabilities** (all Level 2 plus):
- Create integration branches
- Perform merge operations
- Open integration PRs with `--open-pr`
- Run gates on integration branches
- Update integration PR status

**Use Cases**:
- Automated integration testing
- Merge preview in real branches
- Pre-merge validation with full CI
- Parallel integration attempts

**CLI Flags**:
```bash
lex-pr merge --max-level 3 --open-pr --branch-prefix "integration/"
lex-pr execute --max-level 3 --open-pr
```

**GitHub Permissions Required**:
- All Level 2 permissions
- `contents: write` (for branch creation)
- `pull_requests: write` (for PR creation)

**Safety**: Creates branches and PRs but does not finalize merges to target branch.

## Level 4: Full Automation

**Purpose**: Complete end-to-end merge-weave with finalization.

**Capabilities** (all Level 3 plus):
- Finalize successful integrations
- Merge integration PRs to target branch
- Close superseded PRs with `--close-superseded`
- Cleanup integration branches
- Complete automation pipeline

**Use Cases**:
- Fully automated merge pyramids
- Continuous integration workflows
- Scheduled batch processing
- Production merge automation

**CLI Flags**:
```bash
lex-pr merge --max-level 4 --open-pr --close-superseded --execute
lex-pr execute --max-level 4 --close-superseded
```

**GitHub Permissions Required**:
- All Level 3 permissions
- `contents: write` (for merging)
- `pull_requests: write` (for closing PRs)

**Safety**: Full automation. Use with caution and ensure proper testing at lower levels first.

## CLI Flags Reference

### Core Flags

- `--max-level <0-4>`: Maximum autopilot level (default: 0)
- `--dry-run`: Preview operations without execution (default: true)
- `--execute`: Actually perform operations (disables dry-run)

### Level 2+ Flags

- `--comment-template <path>`: Path to custom PR comment template
  - Requires: `--max-level 2` or higher
  - Default: Uses built-in template

### Level 3+ Flags

- `--open-pr`: Open pull requests for integration branches
  - Requires: `--max-level 3` or higher
- `--branch-prefix <prefix>`: Prefix for integration branch names
  - Default: `integration/`
  - Example: `weave/`, `merge-pyramid/`

### Level 4 Flags

- `--close-superseded`: Close superseded PRs after successful integration
  - Requires: `--max-level 4`

## Validation Rules

The CLI enforces the following validation rules to ensure safe operation:

1. **Level Range**: `--max-level` must be 0-4
2. **Integer Values**: Level must be an integer (no fractions)
3. **Flag Dependencies**:
   - `--open-pr` requires `--max-level 3` or higher
   - `--close-superseded` requires `--max-level 4`
   - `--comment-template` requires `--max-level 2` or higher

### Example Validation Errors

```bash
# Error: Invalid level
$ lex-pr merge --max-level 5
Configuration Error: Invalid autopilot configuration: must be at most 4

# Error: Flag requires higher level
$ lex-pr merge --max-level 2 --open-pr
Configuration Error: --open-pr requires --max-level 3 or higher

# Error: Flag requires highest level
$ lex-pr merge --max-level 3 --close-superseded
Configuration Error: --close-superseded requires --max-level 4
```

## Examples

### Development Workflow (Level 0-1)

```bash
# 1. Generate and validate plan
lex-pr plan --dry-run

# 2. Review plan
cat .smartergpt/runner/plan.json

# 3. Execute gates in dry-run mode
lex-pr execute --max-level 0 --dry-run

# 4. Generate detailed artifacts
lex-pr execute --max-level 1 --artifact-dir ./artifacts
```

### CI/CD Integration (Level 2)

```bash
# Post status to PRs from CI
lex-pr execute \
  --max-level 2 \
  --comment-template .github/pr-status-template.md \
  --artifact-dir ./gate-results

# Use custom branch for status updates
lex-pr merge \
  --max-level 2 \
  --plan ./plan.json \
  --json > results.json
```

### Integration Testing (Level 3)

```bash
# Create integration branches and PRs
lex-pr merge \
  --max-level 3 \
  --open-pr \
  --branch-prefix "integration/test-" \
  --execute

# Review integration PRs before finalizing
gh pr list --label "integration"
```

### Production Automation (Level 4)

```bash
# Full automation with all features
lex-pr merge \
  --max-level 4 \
  --open-pr \
  --close-superseded \
  --branch-prefix "weave/" \
  --execute

# Monitor progress
lex-pr status --json
```

## Safety Recommendations

1. **Start Low**: Begin with Level 0-1 to understand behavior
2. **Test Incrementally**: Validate each level in a test environment
3. **Use Dry-Run**: Always test with `--dry-run` first
4. **Review Artifacts**: Check generated files before proceeding
5. **Monitor Closely**: Watch Level 3-4 operations carefully
6. **Have Rollback Plans**: Be prepared to revert if issues occur

## Integration with GitHub Actions

Example workflow using autopilot levels:

```yaml
name: Merge Pyramid

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:
    inputs:
      level:
        description: 'Autopilot level (0-4)'
        required: true
        default: '2'

jobs:
  merge-weave:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Generate plan
        run: npx lex-pr plan --from-github
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Execute with autopilot
        run: |
          npx lex-pr execute \
            --max-level ${{ github.event.inputs.level || '2' }} \
            --open-pr \
            --artifact-dir ./gate-results
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: gate-results
          path: ./gate-results
```

## Future Enhancements

Potential future capabilities under consideration:

- **Level 5**: AI-assisted semantic conflict resolution
- **Adaptive Levels**: Automatically adjust based on success rate
- **Rollback Automation**: Automatic revert on gate failures
- **Parallel Execution**: Run multiple integration branches simultaneously
- **Conflict Resolution**: Interactive prompts for semantic patches

## See Also

- [CLI Reference](./cli.md) - Complete CLI documentation
- [Merge Weave Analysis](./merge-weave-analysis.md) - Design and architecture
- [Examples](../examples/) - Example configurations and workflows
