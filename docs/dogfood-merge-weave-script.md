# Dogfood Merge-Weave Script

## Overview

The `scripts/dogfood-merge-weave.sh` script provides a parameterized, repo-agnostic wrapper around `lex-pr-runner` commands for executing merge-weave workflows. It automates the complete workflow from plan generation to merge execution and reporting.

## Features

- **Flexible Plan Sources**: Load from a plan file or discover PRs from GitHub
- **Parameterized Configuration**: Customize repository path, artifacts location, and execution mode
- **Automated Workflow**: Runs validation gates, analyzes merge order, and executes merges
- **Rich Output**: Generates JSON artifacts, markdown reports, and user-friendly console output
- **Error Handling**: Gracefully handles validation failures and provides clear error messages

## Installation

The script is located at `scripts/dogfood-merge-weave.sh` and requires:
- Bash shell
- `lex-pr-runner` CLI (installed globally or via npm)
- `jq` (optional, for enhanced plan summaries)

## Usage

```bash
./scripts/dogfood-merge-weave.sh [options]
```

### Options

#### Repository Options
- `--repo <path>` - Path to repository (default: current directory)

#### Plan Source Options (choose one)
- `--plan <path>` - Path to plan.json file
- `--from-github` - Discover PRs from GitHub using filters

#### GitHub Discovery Options (used with --from-github)
- `--owner <name>` - GitHub repository owner
- `--repo-name <name>` - GitHub repository name
- `--base <branch>` - Base branch (default: main)
- `--labels <labels>` - Comma-separated list of labels to filter PRs
- `--query <query>` - Custom GitHub search query

#### Output Options
- `--artifacts <dir>` - Artifacts output directory (default: ./artifacts/dogfood-<timestamp>)
- `--integration-branch <name>` - Custom integration branch name (default: auto-generated)

#### Execution Options
- `--dry-run` - Preview operations without executing (default)
- `--execute` - Actually perform merge operations
- `--cleanup` - Clean up integration branches after execution
- `--verbose` - Enable verbose output

#### Other Options
- `-h, --help` - Show help message

## Examples

### Dry Run with Existing Plan File

Preview merge operations without executing:

```bash
./scripts/dogfood-merge-weave.sh --plan merge-weave-dogfood.json --dry-run
```

### Execute from GitHub Discovery

Discover PRs from GitHub and execute merge:

```bash
./scripts/dogfood-merge-weave.sh \
  --from-github \
  --owner myorg \
  --repo-name myrepo \
  --labels "ready-to-merge" \
  --execute
```

### Execute with Custom Configuration

Use a custom repository and artifacts directory:

```bash
./scripts/dogfood-merge-weave.sh \
  --repo /srv/my-project \
  --plan plan.json \
  --artifacts ./output/dogfood-run \
  --execute \
  --cleanup
```

### Discover and Preview PRs

Preview PRs from GitHub without merging:

```bash
./scripts/dogfood-merge-weave.sh \
  --from-github \
  --owner octocat \
  --repo-name hello-world \
  --base main \
  --dry-run \
  --verbose
```

### Execute with Verbose Output

Get detailed output during execution:

```bash
./scripts/dogfood-merge-weave.sh \
  --plan merge-weave-dogfood.json \
  --execute \
  --verbose
```

## Workflow Steps

The script executes the following workflow:

1. **Plan Generation/Validation**
   - If `--from-github`: Discovers PRs from GitHub and generates plan.json
   - If `--plan`: Validates existing plan file (continues even if validation fails for older formats)

2. **Gate Validation**
   - Runs local gates: lint, typecheck
   - Optionally runs tests (only in execute mode)

3. **Merge Analysis**
   - Computes merge order and dependencies
   - Generates merge-order.json artifact

4. **Merge Execution**
   - Dry-run: Previews merge operations without executing
   - Execute: Performs actual merge operations

5. **Report Generation**
   - Generates markdown report with full details
   - Saves all artifacts to timestamped directory

## Output Artifacts

All artifacts are saved to the artifacts directory (default: `./artifacts/dogfood-<timestamp>/`):

- `plan.json` - Generated plan (if using --from-github)
- `merge-order.json` - Computed merge order and dependencies
- `dry-run.json` - Dry-run preview (if in dry-run mode)
- `merge-results.json` - Merge execution results (if in execute mode)
- `dogfood-report.md` - Comprehensive markdown report

## Exit Codes

- `0` - Success
- `1` - Error (missing arguments, invalid configuration, merge failure, etc.)

## Error Handling

The script handles errors gracefully:

- **Schema Validation Failures**: Continues with a warning (useful for older plan formats)
- **Merge Preview Warnings**: In dry-run mode, continues even if merge preview has warnings
- **Missing Dependencies**: Checks for required tools and provides clear error messages

## Integration with CI/CD

The script can be used in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run dogfood merge-weave
  run: |
    ./scripts/dogfood-merge-weave.sh \
      --from-github \
      --owner ${{ github.repository_owner }} \
      --repo-name ${{ github.event.repository.name }} \
      --labels "auto-merge" \
      --execute \
      --cleanup
```

## Troubleshooting

### Script fails with "lex-pr command not found"

The script automatically falls back to `npm run cli` if `lex-pr` is not in PATH. Ensure you're running from the repository root or install `lex-pr-runner` globally.

### Schema validation failures

The script continues execution even if plan validation fails. This is normal for older plan formats. Check the artifacts directory for detailed error messages.

### Merge conflicts

In execute mode, the script will stop if merge conflicts occur. Resolve conflicts manually and re-run with `--resume` (if supported by the lex-pr merge command).

### Permission denied errors

Ensure the script is executable:
```bash
chmod +x scripts/dogfood-merge-weave.sh
```

## Related Documentation

- [Merge Weave Usage Guide](../MERGE_WEAVE_USAGE_GUIDE.md)
- [lex-pr-runner README](../README.md)
- [Plan Schema Documentation](../schemas/)

## Contributing

When modifying the script:
1. Update the help text and this documentation
2. Add test cases in `tests/dogfood-merge-weave-script.spec.ts`
3. Test with both plan file and GitHub discovery modes
4. Ensure backward compatibility with existing plan formats
