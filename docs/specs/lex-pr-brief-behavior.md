# `lex-pr brief` Behavior Contract

> **Status:** Draft
> **Author:** Lex (Chief Architect) + Opie (Implementation Advisor)
> **Date:** 2025-11-27

## Purpose

The `lex-pr brief` command translates messy natural language or issue references into structured Task Briefs that reduce token usage and improve LLM effectiveness.

## Command Signature

```bash
lex-pr brief [options] [input...]

# From natural language
lex-pr brief "merge-weave all open PRs, keep tokens low"

# From issue references
lex-pr brief --issues 463,464,465,466,467

# From PR discovery
lex-pr brief --discover --state open

# Interactive mode
lex-pr brief --interactive
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `--issues` | `number[]` | GitHub issue numbers to include |
| `--prs` | `number[]` | GitHub PR numbers to include |
| `--discover` | `boolean` | Auto-discover PRs using scope.yml rules |
| `--state` | `open\|closed\|all` | Filter for discovery (default: open) |
| `--branch` | `string` | Target branch (default: main) |
| `--output` | `string` | Output path (default: stdout + save to briefs/) |
| `--no-save` | `boolean` | Don't save to briefs directory |
| `--template` | `string` | Custom template path |
| `--recall` | `boolean` | Include prior decisions from Lex memory |
| `--json` | `boolean` | Output as JSON instead of markdown |
| `--interactive` | `boolean` | Prompt for missing fields |

## Processing Pipeline

```
┌─────────────────┐
│   Input         │  Natural language, issue IDs, PR IDs, or discovery
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Resolve       │  Expand issues → PRs, fetch metadata from GitHub
│   Scope         │  Determine files touched, dependencies
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Recall        │  Query Lex memory for prior decisions on:
│   Context       │  - Same branch/module
│                 │  - Same PR authors
│                 │  - Similar task patterns
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Infer         │  Parse NL for constraints:
│   Constraints   │  - "keep tokens low" → budget: minimize
│                 │  - "no fan-outs" → governance rule
│                 │  - "end of month" → timing pressure
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Generate      │  Emit Task Brief (markdown or JSON)
│   Brief         │  Save to .smartergpt.local/runner/briefs/
└─────────────────┘
```

## Scope Resolution

### From Issues
```bash
lex-pr brief --issues 463,464,465
```

1. Fetch issue metadata: `gh issue view <n> --json title,body,labels`
2. Find linked PRs: `gh pr list --search "closes #<n>"`
3. For each PR, get files: `gh pr view <n> --json files`
4. Aggregate into scope

### From PRs
```bash
lex-pr brief --prs 463,464,465
```

1. Fetch PR metadata directly
2. Get files changed per PR
3. Check dependencies (from PR body `Depends-on:` syntax)

### From Discovery
```bash
lex-pr brief --discover --state open
```

1. Run `lex-pr discover` with current scope.yml
2. Filter by state
3. Resolve as if `--prs` were passed

## Constraint Inference

The command parses natural language for common constraint patterns:

| Pattern | Inferred Constraint |
|---------|---------------------|
| "keep tokens low" | `Budget: minimize token usage` |
| "end of month" | `Budget: minimize CI usage` |
| "no fan-outs" | `Governance: no new agent assignments` |
| "quick" / "fast" | `Quality: speed over thoroughness` |
| "thorough" / "careful" | `Quality: thoroughness over speed` |
| "rate limited" | `Constraints: batch operations, avoid parallel calls` |

## Lex Memory Integration

When `--recall` is enabled (default: true if Lex is configured):

```bash
# Query prior decisions for the branch/module
lex recall --branch main --module "src/runs" --limit 5
```

Extracts:
- Recent conflict resolutions
- Naming conventions established
- Patterns applied

Formats as `## Prior Decisions` section.

## Output Examples

### Default (stdout + save)
```bash
$ lex-pr brief "merge-weave PRs 463-467, keep tokens low"

📋 Task Brief generated: .smartergpt.local/runner/briefs/2025-11-27-merge-weave-prs-463-467.md

# Task Brief: Merge-Weave PRs 463-467

## Objective
Merge PRs #463-467 to main, resolve conflicts, verify gates locally.

## Scope
- Repos: lex-pr-runner
- Branch: main
- PRs: #463, #464, #465, #466, #467
- Files likely touched: src/runs/*.ts, src/procedures/*.ts, docs/*.md

## Constraints
- Budget: minimize token usage

## Context Files (read if needed)
- /srv/lex-mcp/lex-pr-runner/src/store/CONTRACT.md
- /srv/lex-mcp/lex-pr-runner/AGENTS.md

## Prior Decisions
(none recalled)

## Exit Criteria
- [ ] All PRs merged
- [ ] Gates passing
- [ ] Pushed to origin
```

### JSON Mode
```bash
$ lex-pr brief --json --prs 463,464,465

{
  "schemaVersion": "0.1.0",
  "title": "Merge PRs 463, 464, 465",
  "objective": "Merge PRs #463, #464, #465 to main",
  "scope": {
    "repos": ["lex-pr-runner"],
    "branch": "main",
    "prs": [463, 464, 465],
    "filesLikelyTouched": ["src/runs/*.ts"]
  },
  "constraints": [],
  "contextFiles": [
    "/srv/lex-mcp/lex-pr-runner/AGENTS.md"
  ],
  "priorDecisions": [],
  "exitCriteria": [
    "All PRs merged",
    "Gates passing"
  ]
}
```

## Storage Structure

```
.smartergpt.local/
└── runner/
    └── briefs/
        ├── 2025-11-27-merge-weave-prs-463-467.md
        ├── 2025-11-27-version-alignment.md
        └── archive/
            └── 2025-11-20-wave1-merge.md
```

## Integration with Persona Workflows

### Eager PM
```bash
# Generate brief for fan-out planning
lex-pr brief --discover --state open --template eager-pm

# Output includes "Hot Path" identification for Senior Dev handoff
```

### Senior Dev
```bash
# Generate brief with full context recall
lex-pr brief --prs 463-467 --recall --template senior-dev

# Output includes Prior Decisions and Context Files for merge-weave
```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No PRs/issues found | Error: "No items to include in brief" |
| GitHub API failure | Warn + continue with partial data |
| Lex recall failure | Warn + continue without prior decisions |
| Invalid NL (can't parse) | Prompt interactively or error |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Brief generated successfully |
| 1 | No items found / invalid input |
| 2 | GitHub API error (partial brief may exist) |
| 3 | File write error |

## Future Extensions

1. **Template library:** Pre-built templates for common tasks
2. **Brief chaining:** Reference prior brief in new brief
3. **Validation:** Check exit criteria are measurable
4. **Copilot integration:** Direct paste into Copilot chat via API
5. **Diff mode:** Compare two briefs for scope drift

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2025-11-27 | Initial draft from Opie/Lex session |
