# Profile Setup Examples

Complete examples for setting up lexrunner profiles with tracked and local configurations.

## Overview

This directory contains templates and examples for:
- Tracked profile (`.smartergpt/`) - Repository default configuration
- Local profile (`.smartergpt.local/`) - Development overlay
- Cross-repository prompts sharing
- Gitignore configuration
- Profile validation

## Quick Start

### 1. Initialize Local Profile

From your repository root:

```bash
# Initialize local profile (automated)
lex-pr init-local

# Verify setup
lex-pr doctor
```

### 2. Manual Setup (Alternative)

If you prefer manual setup or need custom configuration:

```bash
# Create local profile directory
mkdir -p .smartergpt.local

# Copy tracked profile as template
cp -r .smartergpt/* .smartergpt.local/

# Create profile.yml
cat > .smartergpt.local/profile.yml << 'EOF'
role: development
projectType: typescript  # or nodejs, python, go, rust, etc.
name: my-project
version: 1.0.0
EOF

# Update .gitignore
cat >> .gitignore << 'EOF'

# lexrunner local profile
.smartergpt.local/
.smartergpt/runner/
.smartergpt/cache/
.smartergpt/deliverables/
EOF
```

## Directory Structure

### Tracked Profile (`.smartergpt/`)

See [.smartergpt-example/](./.smartergpt-example/) for a complete tracked profile example.

**Key files:**
- `intent.md` - Project goals and scope
- `scope.yml` - PR discovery rules
- `deps.yml` - Dependency relationships
- `gates.yml` - Quality gates configuration
- `stack.yml` - PR ordering
- `merge-policy.yml` - Merge rules
- `pull-request-template.md` - PR template
- `prompts/` - Canonical prompts

**Characteristics:**
- Tracked in git
- Read-only (role: example)
- Provides defaults for team

### Local Profile (`.smartergpt.local/`)

See [.smartergpt.local-example/](./.smartergpt.local-example/) for a complete local profile example.

**Key files:**
- `profile.yml` - **REQUIRED** (role: development)
- All config files from tracked profile (optional overrides)
- `prompts/` - Custom prompt overlays
- `runner/` - Working artifacts (gitignored)
- `deliverables/` - Generated outputs (gitignored)

**Characteristics:**
- Gitignored
- Read-write (role: development)
- Overrides tracked profile on file-by-file basis

## Configuration Files

### profile.yml (Required for Local Profile)

```yaml
# Minimum configuration
role: development  # "example" | "development" | "local"

# Recommended metadata
name: my-project
version: 1.0.0
projectType: typescript  # Auto-detected by init-local

# Optional
description: My project description
author: Your Name
created: 2025-11-13
```

### intent.md (Recommended)

```markdown
# Project Intent

## Goals
- Implement feature X
- Refactor module Y
- Fix critical bug Z

## Success Criteria
- All tests pass
- Code coverage > 80%
- No security vulnerabilities

## Out of Scope
- Performance optimization
- UI redesign
```

### scope.yml (Required for Planning)

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
    - "work-in-progress"
defaults:
  strategy: merge-weave
  base: main
pin_commits: false
```

### gates.yml (Required for Gates)

```yaml
version: 1
gates:
  - name: typecheck
    run: npm run typecheck
    runtime: local
  - name: test
    run: npm test
    runtime: local
  - name: lint
    run: npm run lint
    runtime: local
```

### deps.yml (Optional)

```yaml
# Explicit dependency declarations
dependencies:
  pr-124:
    depends_on:
      - pr-123
  pr-125:
    depends_on:
      - pr-124
```

### stack.yml (Optional)

```yaml
# PR ordering configuration
stacks:
  auth-stack:
    base: main
    prs:
      - 123
      - 124
      - 125
```

### merge-policy.yml (Optional)

```yaml
# Merge policies
policies:
  - name: require-reviews
    type: approval
    min_approvals: 2
  - name: require-ci
    type: status
    required_statuses:
      - "CI / build"
      - "CI / test"
```

## Prompts Setup

### Using Tracked Prompts

Default behavior - prompts are loaded from `.smartergpt/prompts/`:

```bash
lex-pr plan --from-github
# Uses .smartergpt/prompts/create-project.md
```

### Custom Local Prompts

Create custom prompts in `.smartergpt.local/prompts/`:

```bash
mkdir -p .smartergpt.local/prompts

# Copy and customize
cp .smartergpt/prompts/create-project.md .smartergpt.local/prompts/
# Edit .smartergpt.local/prompts/create-project.md

# Automatically uses local version
lex-pr plan --from-github
```

### Cross-Repository Prompts

See [cross-repo-prompts/README.md](./cross-repo-prompts/README.md) for complete guide.

**Three methods:**

#### 1. Environment Variable (Recommended for CI/CD)

```bash
export LEX_PROMPTS_DIR=/path/to/lex/.smartergpt/prompts
lex-pr plan --from-github
```

#### 2. Symlink (Recommended for Development)

```bash
ln -s ../../lex/.smartergpt/prompts .smartergpt.local/prompts
lex-pr plan --from-github
```

#### 3. Copy (Recommended for Customization)

```bash
cp -r ../lex/.smartergpt/prompts .smartergpt.local/
# Edit files in .smartergpt.local/prompts/
lex-pr plan --from-github
```

## Gitignore Configuration

### Template

See [.gitignore.template](./.gitignore.template) for a complete template.

**Essential entries:**

```gitignore
# lexrunner local profile
.smartergpt.local/

# Working directories (even in tracked profile)
.smartergpt/runner/
.smartergpt/cache/

# Deliverables (optional, may track examples)
.smartergpt/deliverables/
```

### Add to Your Repository

```bash
# Append to existing .gitignore
cat examples/profile-setup/.gitignore.template >> .gitignore

# Or copy as new .gitignore
cp examples/profile-setup/.gitignore.template .gitignore
```

## Validation

### Verify Profile Setup

```bash
# Check profile resolution
lex-pr doctor

# Expected output:
# ✓ Profile: /path/to/.smartergpt.local (role: development)
# ✓ Prompts: /path/to/.smartergpt.local/prompts (source: .smartergpt.local/prompts)
```

### Verify Prompts Resolution

```bash
# Check prompts source
lex-pr doctor | grep prompts

# Expected output (local prompts):
# ✓ Prompts: /path/to/.smartergpt.local/prompts (source: .smartergpt.local/prompts)

# Expected output (environment variable):
# ✓ Prompts: /other/path/prompts (source: LEX_PROMPTS_DIR)
```

### Verify Configuration Files

```bash
# Validate scope.yml
lex-pr schema validate .smartergpt.local/scope.yml --schema runner.scope.schema.json

# Validate gates.yml
lex-pr schema validate .smartergpt.local/gates.yml --schema gates.schema.json

# Validate plan.json
lex-pr schema validate .smartergpt.local/runner/plan.json --schema execution-plan-v1.json
```

## Common Patterns

### Pattern 1: Team Tracked + Individual Local

**Setup:**
```bash
# Team maintains .smartergpt/ in repo
git add .smartergpt/
git commit -m "Add team profile"

# Each developer creates local overlay
lex-pr init-local

# Each developer customizes locally
echo "# My custom goals" > .smartergpt.local/intent.md
```

**Benefits:**
- Team has consistent defaults
- Individuals can customize without conflicts
- No need to coordinate local changes

### Pattern 2: CI/CD with Custom Profile

**Setup:**
```yaml
# .github/workflows/ci.yml
env:
  LEX_PR_PROFILE_DIR: /tmp/ci-profile

steps:
  - name: Setup profile
    run: |
      mkdir -p $LEX_PR_PROFILE_DIR
      cp -r .smartergpt/* $LEX_PR_PROFILE_DIR/
      cat > $LEX_PR_PROFILE_DIR/profile.yml << EOF
      role: local
      name: ci-pipeline
      EOF

  - name: Run gates
    run: lex-pr execute plan.json
```

**Benefits:**
- Isolated CI environment
- No conflicts with local development
- Reproducible builds

### Pattern 3: Multi-Repository with Shared Prompts

**Setup:**
```bash
# Lex repo (prompts source)
git clone https://github.com/org/lex.git
cd lex

# LexRunner repo (prompts consumer)
git clone https://github.com/org/lexrunner.git
cd lexrunner

# Use Lex prompts
export LEX_PROMPTS_DIR=../lex/.smartergpt/prompts
lex-pr plan --from-github
```

**Benefits:**
- Single source of truth for prompts
- Consistent prompts across projects
- Easy prompt updates

## Troubleshooting

### Problem: "Profile directory not found"

**Solution:**
```bash
# Initialize local profile
lex-pr init-local

# Or use explicit override
lex-pr plan --profile-dir .smartergpt
```

### Problem: "Write operation failed: role=example is read-only"

**Solution:**
```bash
# Use local profile instead
lex-pr init-local

# Or update profile.yml
echo "role: development" > .smartergpt/profile.yml  # If you own the tracked profile
```

### Problem: "Prompts directory not found"

**Solution:**
```bash
# Create prompts directory
mkdir -p .smartergpt/prompts

# Or copy from examples
cp -r examples/profile-setup/.smartergpt-example/prompts .smartergpt/

# Or use environment variable
export LEX_PROMPTS_DIR=/path/to/prompts
```

### Problem: Symlink not working on Windows

**Solution:**
```powershell
# Option 1: Enable Developer Mode (Windows 10+)
# Settings > Update & Security > For Developers > Developer Mode

# Option 2: Use environment variable instead
$env:LEX_PROMPTS_DIR = "C:\path\to\lex\.smartergpt\prompts"

# Option 3: Copy prompts
Copy-Item -Recurse ..\lex\.smartergpt\prompts .smartergpt.local\prompts
```

## Related Documentation

- [SmartGPT Structure v1 Spec](../../docs/specs/smartergpt-structure-v1.md) - Complete specification
- [Profile Resolution](../../docs/profile-resolution.md) - Profile resolution mechanics
- [Prompts Configuration](../../docs/prompts.md) - Prompts system documentation
- [Quickstart Guide](../../docs/quickstart.md) - Getting started
- [Cross-Repository Prompts](./cross-repo-prompts/README.md) - Cross-repo guide

## Examples in This Directory

- [.smartergpt-example/](./.smartergpt-example/) - Complete tracked profile example
- [.smartergpt.local-example/](./.smartergpt.local-example/) - Complete local profile example
- [cross-repo-prompts/](./cross-repo-prompts/) - Cross-repository prompts guide
- [.gitignore.template](./.gitignore.template) - Gitignore template

## Questions?

See [FAQ](../../FAQ.md) for common questions and answers.
