# Fanout Templates Documentation

Fanout templates enable **deterministic follow-up issue creation** after PR merges by scanning diffs for patterns and automatically generating issues.

## Overview

After merging a PR, common follow-up work patterns emerge:
- New MCP tool → create integration test issue
- New error code → document in error-codes.md
- New CLI command → add to QUICK_START.md

With fanout templates, these patterns become **D1 deterministic**:
1. Template defines a regex pattern and target files
2. Scanner matches patterns against PR diff
3. Generator creates issues with substituted values

## Quick Start

```bash
# View configured templates
lexrunner weave fanout show

# Validate template file
lexrunner weave fanout validate

# Preview issues from sample data
lexrunner weave fanout preview --sample

# Scan a specific PR (requires GitHub API)
lexrunner weave fanout scan --pr 123
```

## Configuration

Templates are defined in `.smartergpt/fanout-templates.yml`:

```yaml
version: 1

templates:
  - id: new-mcp-tool-test
    description: "Create integration tests for new MCP tools"
    trigger:
      pattern: 'tools\.push\(\{\s*name:\s*[''"]([^''"]+)[''"]'
      files:
        - "**/tools.ts"
        - "**/mcp/tools.ts"
      captures:
        tool_name: "$1"
      requires_judgment: false
    issue:
      title: "test: Add integration tests for {tool_name} MCP tool"
      labels:
        - testing
        - mcp
      body: |
        ## Summary
        Add integration tests for the new `{tool_name}` MCP tool.
        
        ## Context
        Added in PR #{pr_number} ({pr_title}).
        
        ## Acceptance Criteria
        - [ ] Happy path test
        - [ ] Error handling test
        - [ ] Edge case coverage
      repo: same
    priority: 100
    enabled: true
```

## Schema Reference

### Template Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique template identifier |
| `description` | string | No | Human-readable description |
| `trigger` | object | Yes | When to create issues |
| `issue` | object | Yes | Issue template |
| `priority` | number | No | Higher runs first (default: 100) |
| `enabled` | boolean | No | Toggle template (default: true) |

### Trigger Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pattern` | string | Required | Regex to match in diff |
| `files` | string[] | `["**/*"]` | Glob patterns for files to check |
| `captures` | object | None | Named capture mappings |
| `requires_judgment` | boolean | `false` | If true, marks as D2 |

### Issue Template

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | Required | Issue title with placeholders |
| `labels` | string[] | `[]` | Labels to apply |
| `assignees` | string[] | `[]` | GitHub usernames |
| `body` | string | Required | Markdown body with placeholders |
| `repo` | string | `"same"` | Target repo: `"same"` or `"owner/repo"` |

## Placeholder Substitution

Templates support `{placeholder}` syntax for dynamic values:

### PR Context
| Placeholder | Description |
|-------------|-------------|
| `{pr_number}` | PR number |
| `{pr_title}` | PR title |
| `{pr_url}` | Full PR URL |
| `{pr_author}` | PR author username |
| `{repo_owner}` | Repository owner |
| `{repo_name}` | Repository name |
| `{branch_name}` | Source branch |
| `{date}` | Current date (ISO) |

### Match Context
| Placeholder | Description |
|-------------|-------------|
| `{matched_file}` | File where match occurred |
| `{matched_line}` | Line number |
| `{matched_text}` | The matched text |
| `{group1}`, `{group2}`, ... | Regex capture groups |

### Custom Captures
Define named captures in the trigger:
```yaml
captures:
  tool_name: "$1"
  description: "$2"
```

Then use `{tool_name}` in templates.

## Determinism Levels

### D1 Templates (requires_judgment: false)
- Pattern matching is deterministic
- Issue creation is automatic
- No human review needed

### D2 Templates (requires_judgment: true)
- Match identified, but confirmation required
- Human reviews before issue creation
- Used for ambiguous patterns (e.g., API changes)

## Integration with Merge-Weave

Fanout templates integrate with the merge-weave workflow:

```yaml
# merge-weave-policy.yml
fanout:
  suggestions:
    enabled: true
    triggers:
      - type: new_mcp_tool
        pattern: 'tools\.push'
        suggest: "Integration tests needed"
```

The planner generates `detect_fanout_trigger` interventions that use these templates.

## Built-in Templates

The default `.smartergpt/fanout-templates.yml` includes:

| Template ID | Pattern | Determinism |
|-------------|---------|-------------|
| `new-mcp-tool-test` | MCP tool registration | D1 |
| `new-error-code-docs` | Error code definitions | D1 |
| `new-cli-command` | CLI command registration | D1 |
| `cross-repo-api-change` | Export changes in index.ts | D2 |
| `new-zod-schema` | Zod schema exports | D1 |
| `new-intervention-type` | Intervention type additions | D2 |

## Best Practices

1. **Specific Patterns**: Write precise regex to avoid false positives
2. **File Filters**: Limit files to reduce scan time
3. **D2 for Ambiguity**: Use `requires_judgment: true` when unsure
4. **Unique IDs**: Each template needs a unique `id`
5. **Priority Tuning**: Critical templates should have higher priority

## Troubleshooting

### Pattern Not Matching
- Test regex at regex101.com
- Check file glob patterns
- Ensure pattern matches single lines (multi-line not supported)

### Too Many Matches
- Add more specific file patterns
- Refine regex to be more precise
- Use `requires_judgment: true` for review

### Duplicate Issues
- Matches are deduplicated by template ID
- Multiple matches → one issue per template
