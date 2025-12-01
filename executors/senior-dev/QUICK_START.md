# Senior Dev Executor — Quick Start

Get up and running with the Senior Dev executor in 5 minutes.

## Prerequisites

- Node.js 20 LTS
- `lex-pr-runner` installed
- Lex CLI available (optional, for memory features)
- GitHub CLI (`gh`) authenticated

## 1. Run a PR Review

### Via CLI

```bash
# Prepare context for PR #42
lexrunner senior-dev prepare-context --pr 42

# Output: Artifacts written to /tmp/senior-dev-review-42-...
```

### Via MCP

```json
{
  "tool": "senior-dev.prepare_context",
  "arguments": {
    "pr_number": "42"
  }
}
```

## 2. Recall Context from Memory

```bash
# Recall reviews for a specific module
lexrunner senior-dev recall-context --module src/gates

# Recall by developer
lexrunner senior-dev recall-context --developer alice

# Recall patterns
lexrunner senior-dev recall-context --pattern
```

## 3. Capture a Review Frame

After completing a review, persist it to Lex memory:

```bash
lexrunner senior-dev capture-frame \
  --pr 42 \
  --module src/gates \
  --summary "Gate validation improvements" \
  --next-action "Merge after CI passes" \
  --severity should-fix
```

## 4. Choose a Mode

The executor supports four modes. Select based on your goal:

| Mode | When to Use |
|------|-------------|
| `triage` | Quick scan before deep dive |
| `deep_review` | Full code review with findings |
| `pattern_mining` | Looking for recurring issues |
| `mentorship` | Tracking developer growth |

Example with mode selection:

```bash
lexrunner senior-dev review --pr 42 --mode deep_review
```

## 5. Understand the Output

### Prep Phase Output

```json
{
  "executor": "senior-dev",
  "phase": "deterministic-prep",
  "pr_number": "42",
  "artifacts": {
    "pr_metadata": "pr-metadata.json",
    "diff": "changes.diff",
    "lint": "lint-output.txt",
    "typecheck": "typecheck-output.txt",
    "tests": "test-output.txt"
  },
  "modules_detected": ["src/gates", "src/weave"]
}
```

### Frame Output

```json
{
  "executor": "senior-dev",
  "phase": "frame-capture",
  "frame_payload": {
    "reference_point": "PR-42 review src/gates",
    "summary_caption": "Gate validation improvements",
    "module_scope": ["src/gates"],
    "status_snapshot": {
      "next_action": "Merge after CI passes"
    }
  },
  "success": true
}
```

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for design details
- Explore [MEMORY_INTEGRATION.md](./MEMORY_INTEGRATION.md) for frame patterns
- Check [examples/](./examples/) for full workflow examples

## Troubleshooting

### "lex command not found"

Memory features require the Lex CLI. Install it or skip recall/capture:

```bash
lexrunner senior-dev prepare-context --pr 42 --skip-recall
```

### "gh: command not found"

The GitHub CLI is required for PR metadata. Install and authenticate:

```bash
gh auth login
```

### Tests timing out

Skip tests for faster iteration:

```bash
lexrunner senior-dev prepare-context --pr 42 --skip-tests
```
