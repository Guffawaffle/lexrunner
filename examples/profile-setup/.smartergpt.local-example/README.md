# Local Profile Example (.smartergpt.local)

This directory demonstrates the structure and contents of a local development profile.

## Purpose

The local profile (`.smartergpt.local/`) serves as:

- **Development workspace** - Personal or project-specific customizations
- **Write-enabled profile** - Runner can write artifacts (role: development)
- **Gitignored overlay** - Overrides tracked profile without conflicts

## Structure

```
.smartergpt.local/
├── profile.yml                       # REQUIRED (role: development)
├── intent.md                         # Local intent override
├── scope.yml                         # Local scope override
├── gates.yml                         # Local gates override
├── deps.yml                          # Local deps override
├── stack.yml                         # Local stack override
├── merge-policy.yml                  # Local merge policy override
├── pull-request-template.md          # Local PR template
├── allowed-commands.json             # Local security policy
├── *.md                              # Local documentation
│   ├── CROSS_REPO_DEPENDENCIES.md
│   ├── IMPLEMENTATION_STRATEGY.md
│   └── MEMORY_RETRIEVAL_GUIDE.md
├── prompts/                          # Custom prompt overlays
│   ├── README.md
│   ├── merge-weave-main.md
│   ├── merge-weave-light.md
│   └── kickoff-examples.md
├── runner/                           # Working directory (gitignored)
│   ├── plan.json
│   ├── snapshot.md
│   ├── cache/
│   └── logs/
└── deliverables/                     # Generated outputs (gitignored)
    └── weave-{timestamp}/
        ├── analysis.json
        ├── weave-report.md
        └── execution-log.md
```

## Configuration Files

### profile.yml (REQUIRED)

```yaml
# Required for local profile
role: development # Enables write operations
name: my-project-local
version: 1.0.0
projectType: typescript # Auto-detected by init-local

# Optional metadata
description: Local development profile
author: Your Name
created: 2025-11-13
```

**Key Field:**

- `role: development` - **REQUIRED** to enable write operations
- Without this, runner will refuse to write artifacts

### intent.md (Optional Override)

```markdown
# Local Development Intent

## Current Focus

- Testing merge-weave with specific PR set
- Debugging dependency resolution
- Iterating on prompt templates

## Local Goals

- Fix CI/CD pipeline issues
- Add new gate for security scanning
- Update documentation

## Notes

- Using Lex prompts via symlink
- Testing against staging environment
```

### scope.yml (Optional Override)

```yaml
version: 1
target: main
sources:
  - query: "is:pr is:open author:@me" # Local: only my PRs
selectors:
  include_labels:
    - "ready-to-merge"
    - "wip" # Local: include work-in-progress
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
  - name: typecheck
    run: npm run typecheck
    runtime: local
  - name: test
    run: npm test -- --reporter=verbose # Local: verbose output
    runtime: local
  - name: lint
    run: npm run lint
    runtime: local
  - name: security # Local: additional gate
    run: npm audit --audit-level=moderate
    runtime: local
```

## File-Level Override Behavior

The local profile uses **file-level overlay**, not merging:

```
If .smartergpt.local/scope.yml exists:
  ✅ Use .smartergpt.local/scope.yml (entire file)
  ❌ Ignore .smartergpt/scope.yml

If .smartergpt.local/scope.yml does NOT exist:
  ✅ Fall back to .smartergpt/scope.yml
```

**No merging** - entire file is replaced if override exists.

## Prompts Directory

### Custom Prompts

Create custom prompts in `.smartergpt.local/prompts/`:

```bash
mkdir -p .smartergpt.local/prompts

# Create custom prompt
cat > .smartergpt.local/prompts/my-custom-prompt.md << 'EOF'
---
name: my-custom-prompt
version: 1.0.0
description: Custom prompt for my workflow
---

# My Custom Prompt

Repository: {{repo_root}}
Date: {{today}}

## Instructions
...
EOF
```

### Prompt Overlays

Local prompts override tracked prompts:

```
If .smartergpt.local/prompts/create-project.md exists:
  ✅ Use local version
  ❌ Ignore tracked version

If .smartergpt.local/prompts/create-project.md does NOT exist:
  ✅ Fall back to .smartergpt/prompts/create-project.md
```

### Cross-Repo Prompts

Use symlink or environment variable:

```bash
# Symlink to another repo's prompts
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts

# Or use environment variable
export LEX_PROMPTS_DIR=/path/to/lex/.smartergpt/prompts
```

## Working Directory

The `runner/` directory contains working artifacts only:

```
.smartergpt.local/runner/
├── plan.json           # Generated execution plan
├── snapshot.md         # State snapshot
├── cache/              # Ephemeral cache data
├── logs/               # Execution logs
│   ├── gates.log
│   └── merge.log
├── bin/                # Temporary binaries
└── wt/                 # Work tree
```

**All gitignored** - never commit working artifacts.

## Deliverables

Generated outputs are placed in `deliverables/`:

```
.smartergpt.local/deliverables/
├── weave-20251113-143045/
│   ├── analysis.json
│   ├── weave-report.md
│   ├── execution-log.md
│   └── gate-predictions.json
└── weave-20251113-150234/
    └── [another weave run]
```

**Timestamped** - multiple runs don't conflict.
**Gitignored** - local outputs only.

## Initialization

### Automated (Recommended)

```bash
# Initialize with auto-detection
lex-pr init-local

# Creates .smartergpt.local/ with:
# - profile.yml (role: development, auto-detected projectType)
# - Copies of config files from .smartergpt/ as templates
# - Empty prompts/ directory
```

### Manual

```bash
# Create directory
mkdir -p .smartergpt.local

# Create profile.yml (REQUIRED)
cat > .smartergpt.local/profile.yml << 'EOF'
role: development
projectType: typescript
name: my-project-local
version: 1.0.0
EOF

# Copy config templates (optional)
cp .smartergpt/intent.md .smartergpt.local/
cp .smartergpt/scope.yml .smartergpt.local/
cp .smartergpt/gates.yml .smartergpt.local/

# Edit as needed
vim .smartergpt.local/scope.yml
```

## Gitignore

**ALWAYS** add `.smartergpt.local/` to `.gitignore`:

```gitignore
# Local development profile
.smartergpt.local/
```

This prevents:

- ❌ Accidental commits of personal config
- ❌ Merge conflicts between developers
- ❌ Leaking sensitive information
- ❌ Polluting repository with local artifacts

## Write Protection

With `role: development`, the runner can:

- ✅ Write to `runner/` directory (plan.json, cache, logs)
- ✅ Write to `deliverables/` directory (reports, analysis)
- ❌ Write to config files (intent.md, scope.yml, etc.) - manual only

If you accidentally set `role: example`:

```
WriteProtectionError: Cannot write to profile with role=example
Operation: write deliverables
```

Fix by updating `profile.yml`:

```yaml
role: development # Change from "example"
```

## Customization Workflow

### 1. Start with Tracked Defaults

```bash
# Initialize local profile
lex-pr init-local

# Verify
lex-pr doctor
# Output: using profile: /path/.smartergpt.local (role: development)
```

### 2. Override Specific Files

```bash
# Copy and customize
cp .smartergpt/scope.yml .smartergpt.local/
vim .smartergpt.local/scope.yml

# Runner automatically uses override
lex-pr plan --from-github
```

### 3. Add Custom Files

```bash
# Add local documentation
cat > .smartergpt.local/IMPLEMENTATION_STRATEGY.md << 'EOF'
# Implementation Strategy

## Phase 1
- Set up local environment
- Test with small PR set

## Phase 2
- Expand to full PR scope
- Integrate with CI/CD
EOF
```

### 4. Test Changes

```bash
# Test locally
lex-pr plan --from-github
lex-pr execute plan.json --dry-run

# Verify artifacts
ls .smartergpt.local/runner/
ls .smartergpt.local/deliverables/
```

## Related Documentation

- [SmartGPT Structure v1 Spec](../../../docs/specs/smartergpt-structure-v1.md)
- [Profile Setup Guide](../README.md)
- [Profile Resolution](../../../docs/profile-resolution.md)
- [Cross-Repository Prompts](../cross-repo-prompts/README.md)
