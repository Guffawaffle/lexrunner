# Gate Attestation & Import Guide

## Overview

When gates are run manually (e.g., `npm run build && npm test`) outside of lexrunner, the results aren't automatically captured by the gate tracking system. This causes `merge_apply` to show 0 eligible PRs, even though the gates actually passed.

This guide explains how to use the new **gate attestation** and **import** commands to record gate results from external runs.

## Problem Statement

During merge-weave execution, you might:

1. Run gates manually in each repo (`npm run build && npm test`)
2. Fix test failures, commit, and push
3. Run `merge_apply --dry-run`
4. Get "0 items eligible to merge" even though everything passed

This happens because lexrunner's gate tracking system only sees results from `gates_run`, not manual terminal commands.

## Solution: Gate Attestation & Import

### Option 1: Gate Attestation (Recommended for Manual Runs)

Use `gate attest` to manually attest that gates have passed:

```bash
lex-pr gate attest \
  --item "pr-650" \
  --gates "build,test" \
  --reason "Verified manually - npm run build && npm test passed"
```

**Output:**

```
✅ Attested 2 gate(s) for item 'pr-650'
   Status: pass
   Reason: Verified manually - npm run build && npm test passed
   Files created:
     - .smartergpt/gate-results/pr-650-build.json
     - .smartergpt/gate-results/pr-650-test.json

💡 These gate results are now available for merge eligibility evaluation.
```

**Options:**

- `--item <name>`: Item name (e.g., PR number or branch name) - **Required**
- `--gates <names>`: Comma-separated list of gate names - **Required**
- `--reason <reason>`: Reason for attestation (for audit trail) - **Required**
- `--status <status>`: Gate status (`pass` or `fail`) - Default: `pass`
- `--out-dir <dir>`: Output directory - Default: `.smartergpt/gate-results`
- `--duration <ms>`: Duration in milliseconds - Default: `0`

### Option 2: Gate Import (For CI or External Systems)

Use `gate import` to import results from external sources:

```bash
lex-pr gate import \
  --item "pr-651" \
  --gate "build" \
  --status "pass" \
  --duration 5000 \
  --meta '{"ci_build_id":"12345","commit_sha":"abc123"}'
```

**Output:**

```
✅ Imported gate result for 'pr-651' - 'build'
   Status: pass
   Duration: 5000ms
   Output: .smartergpt/gate-results/pr-651-build.json

💡 This gate result is now available for merge eligibility evaluation.
```

**Options:**

- `--item <name>`: Item name - **Required**
- `--gate <name>`: Gate name - **Required**
- `--status <status>`: Gate status (`pass` or `fail`) - **Required**
- `--input <file>`: Input file to import (gate result JSON)
- `--duration <ms>`: Duration in milliseconds - Default: `0`
- `--out-dir <dir>`: Output directory - Default: `.smartergpt/gate-results`
- `--log <file>`: Path to log file to attach
- `--meta <json>`: Additional metadata as JSON string

## Gate Result Format

Gate results are stored as JSON files following the `GateReport` schema:

```json
{
  "schemaVersion": "1.0.0",
  "item": "pr-650",
  "gate": "build",
  "status": "pass",
  "duration_ms": 0,
  "started_at": "2026-01-02T08:00:00.000Z",
  "meta": {
    "attestation": "manual",
    "reason": "Verified manually - npm run build && npm test passed",
    "attested_by": "developer",
    "attested_at": "2026-01-02T08:00:00.000Z"
  }
}
```

## Integration with Merge Eligibility

### How It Works

1. **Create/Attest Gate Results**: Use `gate attest` or `gate import` to create gate result files
2. **Results are Stored**: Files are saved to `.smartergpt/gate-results/` (or custom directory)
3. **Merge Evaluation**: When `merge_apply` runs, it automatically loads gate results from the directory
4. **Eligibility Determined**: Items with passing required gates become eligible for merge

### Example Workflow

```bash
# 1. Run gates manually in each repo
cd repo-pr-650
npm run build && npm test

# 2. Attest the results
lex-pr gate attest \
  --item "pr-650" \
  --gates "build,test" \
  --reason "Verified manually - all tests passed"

# 3. Repeat for other PRs
cd ../repo-pr-651
npm run lint
lex-pr gate attest \
  --item "pr-651" \
  --gates "lint" \
  --reason "Linter passed"

# 4. Check merge eligibility
lex-pr weave merge-order  # Shows items eligible for merge

# 5. Apply merge (dry run first)
lex-pr merge --dry-run
```

## Advanced Usage

### Importing from CI

If you have CI results in a standardized format:

```bash
# Import from GitHub Actions or similar
lex-pr gate import \
  --item "pr-650" \
  --gate "ci-build" \
  --status "pass" \
  --duration 120000 \
  --meta '{"ci_system":"github-actions","run_id":"123456","workflow":"CI"}' \
  --log build.log
```

### Batch Attestation

For multiple PRs:

```bash
# Create a script to attest all PRs
for pr in 650 651 652; do
  lex-pr gate attest \
    --item "pr-$pr" \
    --gates "build,test,lint" \
    --reason "Wave 2 execution - verified manually"
done
```

### Attesting Failures

Document why a gate failed:

```bash
lex-pr gate attest \
  --item "pr-999" \
  --gates "security-scan" \
  --status "fail" \
  --reason "Known CVE-2024-12345 - will fix in next PR"
```

## Troubleshooting

### "0 items eligible to merge" after attestation

**Check:**

1. Ensure gate result files were created in the correct directory
2. Verify item names match plan.json
3. Confirm all required gates are attested (check plan policy)

```bash
# List created gate results
ls -la .smartergpt/gate-results/

# Validate a gate result file
lex-pr gate-report validate .smartergpt/gate-results/pr-650-build.json
```

### Gate results not loaded

The MCP server and merge commands automatically look for gate results in:

- `.smartergpt/gate-results/` (default)
- Custom directory specified in profile

Make sure your gate results are in the expected location.

## Best Practices

1. **Always provide a reason**: The `--reason` flag creates an audit trail for manual attestations
2. **Use consistent item naming**: Match the item names in your plan.json exactly
3. **Document CI integration**: When importing from CI, include build IDs and commit SHAs in metadata
4. **Validate before merging**: Always run `merge --dry-run` first to check eligibility
5. **Store gate results**: Keep gate result files in version control for traceability

## Related Commands

- `lex-pr gate execute` - Run gates using lexrunner (automatic tracking)
- `lex-pr gate-report validate` - Validate gate result files
- `lex-pr weave report` - Aggregate and display gate reports
- `lex-pr merge` - Apply merge operations based on gate eligibility

## See Also

- [Merge Weave Quick Start](../MERGE_WEAVE_QUICKSTART.md)
- [Gate Report Schema](../src/schema/gateReport.ts)
- Issue #[number] - Gate result import feature
