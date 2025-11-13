# Example Local Profile Structure

This directory demonstrates a typical local profile (`.smartergpt.local/`) for development.

## Purpose

The local profile serves as:
- **Working configuration** for your development environment
- **Override layer** for tracked profile settings
- **Write location** for runner artifacts

## Key Characteristics

- **Development role**: `role: development`
- **Gitignored**: Never committed to repository
- **Writable**: Runner can write artifacts here
- **Customizable**: Override any tracked config

## Structure

```
.smartergpt.local/
├── profile.yml                       # Profile metadata
├── intent.md                         # Local intent override
├── scope.yml                         # Local scope override
├── deps.yml                          # Local deps override
├── gates.yml                         # Local gates override
├── pull-request-template.md          # Local template override
├── prompts/                          # Local prompt overlays
│   ├── README.md
│   ├── merge-weave-main.md
│   └── custom-workflow.md
├── runner/                           # Working directory
│   ├── plan.json                     # Generated plan
│   ├── snapshot.md                   # State snapshot
│   ├── cache/                        # Ephemeral cache
│   └── logs/                         # Execution logs
└── deliverables/                     # Generated outputs
    └── weave-{timestamp}/
        ├── weave-report.md
        └── execution-log.md
```

## Configuration Files

### profile.yml (Required)

```yaml
role: development
projectType: nodejs
```

**Fields:**
- `role`: Must be `development` for local profiles
- `projectType`: Auto-detected or manual

### intent.md (Optional Override)

```markdown
# Local Development Intent

## Current Focus
- Working on Issue #123: Add prompts precedence
- Testing cross-repo prompt sharing
- Validating token expansion

## Local Goals
- Complete PR #387
- Update documentation
- Add integration tests
```

### scope.yml (Optional Override)

```yaml
version: 1
target: main
sources:
  - query: "is:pr is:open author:@me"  # Only my PRs
selectors:
  include_labels:
    - "wip"                             # Include WIP locally
    - "ready-to-merge"
  exclude_labels:
    - "do-not-merge"
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

### gates.yml (Optional Override)

```yaml
version: 1
gates:
  - name: lint
    run: npm run lint
    runtime: local
    required: false              # Relaxed for local dev

  - name: typecheck
    run: npm run typecheck
    runtime: local
    required: true

  - name: test
    run: npm test -- --watch     # Watch mode locally
    runtime: local
    required: true
```

## Prompts

Local prompt overlays in `prompts/`:

### Custom Workflow Prompt

```markdown
---
name: custom-workflow
version: 1.0.0
description: Personal workflow automation
---

# My Custom Workflow — {{today}}

Repository: {{repo_root}}
Branch: {{branch}}

[Your custom workflow content]
```

### Prompt Precedence

When loading `merge-weave-main`:

1. Check `.smartergpt.local/prompts/merge-weave-main.md` first (local)
2. Fall back to `.smartergpt/prompts/merge-weave-main.md` (tracked)
3. Or use `LEX_PROMPTS_DIR` if set

## Working Directory (`runner/`)

### Generated Files

- `plan.json` - Resolved merge plan
- `snapshot.md` - Current state snapshot
- `cache/` - Temporary cache files
- `logs/` - Execution logs (retained)

### Example Plan

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "PR-387",
      "title": "Add prompts precedence",
      "dependsOn": [],
      "gates": ["lint", "typecheck", "test"]
    }
  ]
}
```

## Deliverables

Generated outputs in `deliverables/weave-{timestamp}/`:

- `weave-report.md` - Summary report
- `execution-log.md` - Detailed execution log
- `pr-comments/` - PR comment drafts
- `artifacts/` - Additional artifacts

## Usage

### Initial Setup

```bash
# Initialize local profile
lex-pr init

# Verify structure
lex-pr doctor
```

### Customization

```bash
# Copy tracked config for customization
cp .smartergpt/gates.yml .smartergpt.local/

# Edit local copy
vim .smartergpt.local/gates.yml

# Local version now takes precedence
```

### Cross-Repo Prompts

```bash
# Method 1: Environment variable
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts

# Method 2: Symlink
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts

# Method 3: Copy
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
```

### Running Workflows

```bash
# Plan discovers local scope
lex-pr plan --from-github

# Execute with local gates
lex-pr gates run

# Output goes to .smartergpt.local/runner/ and deliverables/
```

## Cleanup

```bash
# Clean working artifacts
rm -rf .smartergpt.local/runner/cache/*
rm -rf .smartergpt.local/runner/tmp/*

# Keep logs
ls -la .smartergpt.local/runner/logs/

# Archive old deliverables
mv .smartergpt.local/deliverables/weave-2025* ~/archive/
```

## Notes

- **Always gitignored**: Never commit `.smartergpt.local/`
- **Profile role matters**: Only `development` and `local` roles allow writes
- **Override selectively**: Copy only configs you need to customize
- **Prompts precedence**: Local prompts override tracked prompts
- **Token expansion**: All prompts support `{{today}}`, `{{branch}}`, etc.

## Related

- [Profile Resolution](../../../docs/profile-resolution.md)
- [Prompts Configuration](../../../docs/prompts.md)
- [SmartGPT Structure v1](../../../docs/specs/smartergpt-structure-v1.md)
