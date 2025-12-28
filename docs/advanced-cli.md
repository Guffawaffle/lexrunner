# Advanced CLI Features - Power User Guide

This guide covers advanced CLI features for power users including interactive modes, advanced querying, bulk operations, and automation tools.

## Interactive Plan Viewer

The interactive plan viewer provides a terminal-based UI for exploring and navigating plans with filtering capabilities.

### Usage

```bash
# Open interactive viewer
lex-pr view plan.json

# Start with a filter
lex-pr view plan.json --filter "feature"

# Hide dependencies by default
lex-pr view plan.json --no-deps

# Hide gates by default
lex-pr view plan.json --no-gates
```

### Keyboard Navigation

- **↑/↓** - Navigate up/down through items
- **/** - Enter filter mode (type text and press Enter)
- **d** - Toggle dependency display
- **g** - Toggle gate display
- **q** - Quit viewer

### Features

- Navigate through plan items with arrow keys
- Filter items by name in real-time
- View dependencies and gates inline
- See merge level for each item
- Color-coded display for better readability

## Advanced Query Language

The query command provides a powerful way to analyze and filter plan data using a SQL-like query language.

### Query Syntax

```
field operator value [AND field operator value]
```

**Supported Operators:**

- `eq` - Equal to
- `ne` - Not equal to
- `contains` - String contains
- `in` - Value in array
- `gt` - Greater than
- `lt` - Less than
- `gte` - Greater than or equal
- `lte` - Less than or equal

### Examples

```bash
# Find all items at merge level 1
lex-pr query plan.json "level eq 1"

# Find items with specific name pattern
lex-pr query plan.json "name contains feature"

# Find items with more than 2 dependencies
lex-pr query plan.json "depsCount gt 2"

# Find items with no gates
lex-pr query plan.json "gatesCount eq 0"

# Complex queries with AND
lex-pr query plan.json "level eq 1 AND depsCount eq 0"

# Output as JSON
lex-pr query plan.json "level eq 1" --format json

# Output as CSV
lex-pr query plan.json "level eq 1" --format csv

# Save to file
lex-pr query plan.json "level eq 1" --output results.json --format json
```

### Built-in Queries

```bash
# Show plan statistics
lex-pr query plan.json --stats

# Show root nodes (no dependencies)
lex-pr query plan.json --roots

# Show leaf nodes (no dependents)
lex-pr query plan.json --leaves

# Filter by specific level
lex-pr query plan.json --level 1
```

### Available Fields

- `name` - Item name
- `level` - Merge level (computed)
- `deps` - Array of dependencies
- `depsCount` - Number of dependencies
- `gates` - Array of gates
- `gatesCount` - Number of gates
- `dependents` - Array of items that depend on this item
- `dependentsCount` - Number of dependents

### Output Formats

- **table** (default) - Human-readable table format
- **json** - Structured JSON output
- **csv** - Comma-separated values

## Bulk Operations

Perform operations on multiple items at once using filtering and selection.

### Batch Merge

```bash
# Merge specific items
lex-pr merge plan.json --batch --items "item1,item2,item3" --execute

# Merge all items at specific levels
lex-pr merge plan.json --batch --levels "1,2" --execute

# Merge items matching a query
lex-pr merge plan.json --batch --filter "level eq 1" --execute

# Preview batch merge (dry-run is default)
lex-pr merge plan.json --batch --levels "1,2"
```

### Selective Retry

Retry failed gates with filtering:

```bash
# Show all failed gates
lex-pr retry --dry-run

# Retry all failed gates
lex-pr retry

# Retry specific items
lex-pr retry --items "item1,item2"

# Retry with filter
lex-pr retry --filter "integration"

# Custom state directory
lex-pr retry --state-dir .smartergpt.local/runner

# JSON output
lex-pr retry --json
```

## Shell Completion

Generate shell completion scripts for bash and zsh.

### Installation

#### Bash

```bash
# Generate and save completion script
lex-pr completion bash > /usr/local/etc/bash_completion.d/_lex-pr

# Or add to ~/.bashrc
echo 'eval "$(lex-pr completion bash)"' >> ~/.bashrc
source ~/.bashrc
```

#### Zsh

```bash
# Generate and save completion script
lex-pr completion zsh > /usr/local/share/zsh/site-functions/_lex-pr

# Or add to ~/.zshrc
echo 'eval "$(lex-pr completion zsh)"' >> ~/.zshrc
source ~/.zshrc
```

### Usage

After installation, use Tab to complete:

```bash
lex-pr <TAB>          # Shows available commands
lex-pr plan --<TAB>   # Shows plan command options
lex-pr query <TAB>    # Shows available plan files
```

## Configuration Profiles

Manage multiple workspace configurations with profiles.

### Profile Structure

Profiles are directories containing workspace configuration:

```
.smartergpt/              # Example/tracked profile
.smartergpt.local/        # Local/development profile
.smartergpt.ci/           # CI-specific profile
```

### Using Profiles

```bash
# Use default profile
lex-pr plan

# Override with specific profile
lex-pr plan --profile-dir .smartergpt.local

# Environment variable
export LEX_PR_PROFILE_DIR=.smartergpt.local
lex-pr plan

# Initialize local profile
lex-pr init-local
```

### Profile Resolution Order

1. `--profile-dir` command-line option
2. `LEX_PR_PROFILE_DIR` environment variable
3. `.smartergpt.local/` (if exists)
4. `.smartergpt/` (default)

## Advanced Reporting

Enhanced reporting with custom formats and filtering.

### Custom Report Formats

```bash
# Generate markdown report
lex-pr report gate-results --format markdown > report.md

# Generate JSON report
lex-pr report gate-results --format json > report.json

# Generate HTML report (if supported)
lex-pr report gate-results --format html > report.html
```

### Filtering Reports

```bash
# Filter by status
lex-pr report gate-results --status failed

# Filter by item
lex-pr report gate-results --item "feature-a"

# Combine filters
lex-pr report gate-results --status failed --item "feature"
```

## Power User Shortcuts

### Command Chaining

Use shell operators to chain commands:

```bash
# Plan, execute, and merge in sequence
lex-pr plan --from-github && \
lex-pr execute plan.json && \
lex-pr merge plan.json --execute

# Conditional execution
lex-pr execute plan.json && echo "Gates passed" || echo "Gates failed"
```

### Quick Analysis

```bash
# Check plan health
lex-pr query plan.json --stats | grep "Root Nodes"

# Find problematic items
lex-pr query plan.json "depsCount gt 5" --format table

# Count items per level
for i in {1..10}; do
  count=$(lex-pr query plan.json --level $i --format json | jq '.count')
  echo "Level $i: $count items"
done
```

### Automation Scripts

Create scripts for common workflows:

```bash
#!/bin/bash
# auto-merge.sh - Automated merge workflow

# Validate environment
lex-pr doctor || exit 1

# Generate plan
lex-pr plan --from-github --json > plan.json

# Check plan health
stats=$(lex-pr query plan.json --stats --format json)
roots=$(echo $stats | jq '.stats.rootNodes')

if [ "$roots" -eq 0 ]; then
  echo "Error: No root nodes found"
  exit 1
fi

# Execute gates
lex-pr execute plan.json || exit 1

# Merge level by level
for level in $(seq 1 10); do
  items=$(lex-pr query plan.json --level $level --format json | jq -r '.count')

  if [ "$items" -gt 0 ]; then
    echo "Merging level $level ($items items)..."
    lex-pr merge plan.json --batch --levels "$level" --execute || break
  fi
done

echo "Merge workflow complete"
```

## Best Practices

### Performance Optimization

1. **Use filters early** - Filter at query time rather than processing all items
2. **Batch operations** - Use bulk commands instead of loops when possible
3. **JSON output** - Use `--json` for programmatic processing
4. **State management** - Use custom state directories for isolation

### Workflow Patterns

#### Progressive Merge

Merge one level at a time with validation:

```bash
for level in {1..5}; do
  lex-pr query plan.json --level $level --stats
  read -p "Merge level $level? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    lex-pr merge plan.json --batch --levels "$level" --execute
  fi
done
```

#### Health Monitoring

Continuous monitoring during execution:

```bash
watch -n 5 'lex-pr status plan.json | grep -E "(Eligible|Failed)"'
```

#### Selective Retry Pattern

Retry only specific types of failures:

```bash
# Retry only lint failures
lex-pr retry --filter "lint"

# Retry only specific items
failed_items=$(lex-pr status plan.json --json | jq -r '.items[] | select(.status=="failed") | .name' | paste -sd,)
lex-pr retry --items "$failed_items"
```

## Troubleshooting

### Common Issues

**Interactive viewer not working:**

- Ensure terminal supports TTY mode
- Check for conflicting readline configurations
- Try running in a different terminal emulator

**Query syntax errors:**

- Check operator spelling (eq, ne, contains, etc.)
- Ensure field names are correct
- Use quotes for string values with spaces

**Batch operations failing:**

- Verify filter syntax with `--dry-run` first
- Check that items exist in plan
- Ensure dependencies are satisfied

**Completion not working:**

- Verify completion script is sourced
- Check shell configuration file is loaded
- Restart shell after installation

### Debug Mode

Enable verbose output for troubleshooting:

```bash
# Human-readable logs
lex-pr --log-format human plan --from-github

# JSON logs for parsing
lex-pr --log-format json plan --from-github | jq
```

## See Also

- [CLI Reference](./cli.md) - Complete command reference
- [Quickstart Guide](./quickstart.md) - Getting started
- [Query Examples](./query-examples.md) - More query examples
- [Automation Recipes](./automation-recipes.md) - Common automation patterns
