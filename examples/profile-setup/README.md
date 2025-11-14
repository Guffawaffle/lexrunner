# Profile Setup Examples

This directory contains example configurations for setting up lex-pr-runner workspaces.

## Directory Structure

```
examples/profile-setup/
├── README.md                        # This file
├── .smartergpt-example/             # Tracked profile example
├── .smartergpt.local-example/       # Local profile example
├── cross-repo-prompts/              # Cross-repo prompts examples
└── .gitignore.template              # Gitignore template
```

## Quick Start

### 1. Initialize Local Profile

```bash
# From your project root
lex-pr init

# This creates .smartergpt.local/ with:
# - profile.yml (role: development)
# - Config files at root (intent.md, scope.yml, gates.yml)
# - runner/ directory for working artifacts
```

### 2. Verify Structure

```bash
lex-pr doctor

# Expected output:
# ✓ .smartergpt.local: all expected files present
# ✓ Profile role: development
# ✓ Prompts resolved from: .smartergpt.local/prompts
```

### 3. Customize Configuration

Edit config files at profile root:

```bash
# Edit project goals
vim .smartergpt.local/intent.md

# Configure PR discovery
vim .smartergpt.local/scope.yml

# Set up quality gates
vim .smartergpt.local/gates.yml
```

## Structure Examples

### Minimal Setup (`.smartergpt.local/`)

```
.smartergpt.local/
├── profile.yml              # role: development, projectType: nodejs
├── intent.md                # Project goals
├── scope.yml                # PR discovery rules
└── gates.yml                # Quality gates
```

### Full-Featured Setup

```
.smartergpt.local/
├── profile.yml
├── intent.md
├── scope.yml
├── deps.yml
├── gates.yml
├── stack.yml
├── merge-policy.yml
├── pull-request-template.md
├── prompts/                 # Custom prompts
│   ├── README.md
│   └── custom-weave.md
├── runner/                  # Working directory
│   ├── plan.json
│   ├── cache/
│   └── logs/
└── deliverables/            # Generated outputs
    └── weave-{timestamp}/
```

### Tracked Example Profile (`.smartergpt/`)

```
.smartergpt/
├── intent.md                # Example intent
├── scope.yml                # Example scope
├── gates.yml                # Example gates
├── prompts/                 # Canon prompts
│   ├── create-project.md
│   └── idea.md
└── schemas/                 # JSON schemas
    └── *.schema.json
```

## Cross-Repository Prompts

### Pattern 1: Environment Variable

```bash
# Point to another repo's prompts
export LEX_PROMPTS_DIR=/srv/lex-mcp/lex/.smartergpt/prompts

# Use in your workflow
lex-pr plan --from-github
```

**When to use:**
- CI/CD with centralized prompts
- Testing prompt changes
- Multiple repositories sharing prompts

### Pattern 2: Symlink (Development)

```bash
# Create symlink to shared prompts
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts

# Verify
ls -la .smartergpt.local/prompts
# lrwxrwxrwx ... prompts -> ../../lex/.smartergpt/prompts
```

**When to use:**
- Side-by-side development
- Automatic prompt updates
- No environment setup needed

### Pattern 3: Copy and Customize

```bash
# Copy prompts for customization
cp -r ../lex/.smartergpt/prompts .smartergpt.local/

# Edit your copy
vim .smartergpt.local/prompts/merge-weave-main.md
```

**When to use:**
- Customizing prompts for your project
- Offline development
- Versioned prompt snapshots

## File Templates

### `profile.yml`

```yaml
role: development
projectType: nodejs
```

**Fields:**
- `role`: `development` (local), `example` (tracked), or `local` (custom)
- `projectType`: Auto-detected or manual (`nodejs`, `python`, `rust`, `go`)

### `intent.md`

```markdown
# Project Intent

## Goals
- [Your primary goal]
- [Secondary goal]
- [Additional objectives]

## Success Criteria
- All tests pass
- Code coverage > 80%
- No security vulnerabilities
- Documentation updated

## Scope
[Define what's in/out of scope for this project]
```

### `scope.yml`

```yaml
version: 1
target: main
sources:
  - query: "is:pr is:open"
selectors:
  include_labels:
    - "ready-to-merge"
    - "stack:*"
  exclude_labels:
    - "do-not-merge"
    - "wip"
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

### `gates.yml`

```yaml
version: 1
gates:
  - name: lint
    run: npm run lint
    runtime: local
    required: true

  - name: typecheck
    run: npm run typecheck
    runtime: local
    required: true

  - name: test
    run: npm test
    runtime: local
    required: true
    coverage:
      threshold: 80

  - name: e2e
    run: npm run e2e
    runtime: container
    required: false
```

## Prompts with Token Expansion

### Example Prompt (`prompts/status-report.md`)

```markdown
---
name: status-report
version: 1.0.0
description: Generate project status report
---

# Project Status Report — {{today}}

**Repository:** {{repo_root}}
**Branch:** {{branch}}
**Commit:** {{commit}}

## Current State

[Generated content here]

## Generated At
{{now}}
```

**Tokens expanded at runtime:**
- `{{today}}` → `2025-11-13`
- `{{repo_root}}` → `/srv/lex-mcp/lex-pr-runner`
- `{{branch}}` → `main`
- `{{commit}}` → `a1b2c3d4e5f6...`
- `{{now}}` → `2025-11-13T14-30-45-123`

## Validation

### Check Your Setup

```bash
# Run diagnostics
lex-pr doctor

# List effective config
lex-pr config list

# Show resolved prompts
export DEBUG=lex-pr:prompts
lex-pr plan --from-github
```

### Common Issues

**Profile not found:**
```bash
# Ensure .smartergpt.local/ exists
lex-pr init

# Or use explicit override
lex-pr plan --profile-dir ./custom-profile
```

**Prompts not found:**
```bash
# Check prompts directory
ls .smartergpt.local/prompts/
ls .smartergpt/prompts/

# Or set explicit path
export LEX_PROMPTS_DIR=/path/to/prompts
```

## Related Documentation

- [Profile Resolution](../../docs/profile-resolution.md) - Profile precedence rules
- [Prompts Configuration](../../docs/prompts.md) - Comprehensive prompts guide
- [SmartGPT Structure v1](../../docs/specs/smartergpt-structure-v1.md) - Complete specification
- [Quickstart Guide](../../docs/quickstart.md) - Getting started
- [FAQ](../../FAQ.md) - Common questions

## See Also

- `.smartergpt-example/` - Example tracked profile
- `.smartergpt.local-example/` - Example local profile
- `cross-repo-prompts/` - Cross-repo usage examples
- `.gitignore.template` - Gitignore template for workspaces
